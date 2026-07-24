import type { Request } from 'express';
import { supabase } from '../supabase';

// --- AUTENTICAÇÃO REAL (valida o JWT do Supabase, não confia em headers) ---
// O header x-user-id é ignorado para fins de identidade: o userId vem
// exclusivamente do access_token validado pelo Supabase Auth.
// Cache de 60s evita uma chamada ao Auth por request.
const tokenCache = new Map<string, { userId: string; expires: number }>();

// Cache com TTL e teto de tamanho. A limpeza antiga só removia entradas já
// expiradas — com muitos tokens válidos ao mesmo tempo (200 corretores ×
// abas/dispositivos) o Map crescia sem limite. Aqui, se a purga não liberar
// espaço, os mais antigos saem (o Map do JS preserva ordem de inserção).
const CACHE_MAX_ENTRIES = 5_000;
function cacheSet<V>(map: Map<string, { value: V; expires: number }>, key: string, value: V, ttlMs: number) {
  if (map.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of map) if (v.expires <= now) map.delete(k);
    while (map.size >= CACHE_MAX_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
  map.set(key, { value, expires: Date.now() + ttlMs });
}
function cacheGet<V>(map: Map<string, { value: V; expires: number }>, key: string): V | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) { map.delete(key); return undefined; }
  return hit.value;
}

// getBrokerId aparece em ~112 rotas e isBrokerOwner em ~34, sempre resolvidos
// por SELECT — eram 2-3 idas ao banco de overhead fixo em TODA requisição
// autenticada. Mudança de equipe/posse é rara; 60s de defasagem é aceitável.
const brokerIdCache = new Map<string, { value: string | null; expires: number }>();
const ownerCache = new Map<string, { value: boolean; expires: number }>();
const IDENTITY_TTL_MS = 60_000;

// Chamar quando a composição da equipe muda (convite aceito, membro removido),
// pra não esperar o TTL.
export function invalidateIdentityCache(userId?: string) {
  if (!userId) { brokerIdCache.clear(); ownerCache.clear(); return; }
  brokerIdCache.delete(userId);
  for (const k of ownerCache.keys()) if (k.startsWith(`${userId}:`)) ownerCache.delete(k);
}

async function verifyAccessToken(req: Request): Promise<string | null> {
  const token = (req.headers.authorization || '').toString().replace(/^Bearer\s+/i, '').trim();
  if (!token || token === 'dummy_token' || token === 'null' || token === 'undefined') return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.userId;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  if (tokenCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of tokenCache) if (v.expires <= now) tokenCache.delete(k);
  }
  tokenCache.set(token, { userId: data.user.id, expires: Date.now() + 60_000 });
  return data.user.id;
}

// Rotas que EXIGEM usuário logado
export async function requireUser(req: any, res: any, next: any) {
  const userId = await verifyAccessToken(req);
  if (!userId) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  req.userId = userId;
  next();
}

// Rotas com auth opcional (ex.: GET /api/properties serve landing pública)
export async function optionalUser(req: any, _res: any, next: any) {
  req.userId = await verifyAccessToken(req);
  next();
}

export async function requireAdmin(req: any, res: any): Promise<boolean> {
  const userId = await verifyAccessToken(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return false; }
  req.userId = userId;
  const { data } = await supabase.from('imf_brokers').select('is_admin').eq('user_id', userId).single();
  if (!data?.is_admin) { res.status(403).json({ error: "Acesso negado" }); return false; }
  return true;
}

// Helper to ensure broker exists
export async function getBrokerId(userId: string) {
  if (!userId) return null;
  const cached = cacheGet(brokerIdCache, userId);
  if (cached !== undefined) return cached;
  try {
    // Membros (Equipe) resolvem primeiro — inclui o dono original, que a
    // migração 20260708d faz virar membro de si mesmo. Isso cobre tanto o
    // dono quanto quem entrou depois via convite, sem duplicar lógica.
    const { data: membership } = await supabase.from('imf_broker_members').select('broker_id').eq('user_id', userId).maybeSingle();
    if (membership?.broker_id) {
      cacheSet(brokerIdCache, userId, membership.broker_id, IDENTITY_TTL_MS);
      return membership.broker_id;
    }

    const { data: brokers, error } = await supabase.from('imf_brokers').select('id').eq('user_id', userId).order('created_at', { ascending: true }).limit(1);

    if (error) {
      console.error("Error fetching broker:", error);
      return null;
    }

    if (!brokers || brokers.length === 0) {
      console.log("Broker profile not found for user, creating one...");
      // Fallback: fetch user info from auth to get name/email if possible, or use defaults
      // Note: admin.getUserById might not work with standard key, but we try
      const { data: userData } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: { user: null } }));
      const user = userData?.user;

      const { data: newBroker, error: createError } = await supabase.from('imf_brokers').insert([
        {
          user_id: userId,
          name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Corretor',
          phone: '',
          ai_name: 'Minha Assistente IA',
          broker_address: ''
        }
      ]).select().single();

      if (createError) {
        console.error("Error creating broker profile on the fly:", createError);
        return null;
      }
      await supabase.from('imf_broker_members').upsert({ broker_id: newBroker.id, user_id: userId }, { onConflict: 'user_id' });
      return newBroker.id;
    }

    // Dono encontrado pelo caminho antigo mas sem linha de membership ainda
    // (ex.: conta criada antes da migração 20260708d) — auto-cura aqui.
    await supabase.from('imf_broker_members').upsert({ broker_id: brokers[0].id, user_id: userId }, { onConflict: 'user_id' });
    // Depois da auto-cura acima, o caminho de membership resolve nas próximas
    // requisições — cachear aqui evita repetir o UPSERT de escrita no caminho
    // quente enquanto o TTL durar.
    cacheSet(brokerIdCache, userId, brokers[0].id, IDENTITY_TTL_MS);
    return brokers[0].id;
  } catch (err) {
    console.error("error in getBrokerId:", err);
    return null;
  }
}

// Isolamento por membro (Etapa 9 revisada): dono da conta (imf_brokers.user_id)
// enxerga os dados de todos os membros; cada membro só enxerga (e só pode
// mutar) o que ele mesmo criou. Usado em Carteira, Leads, Agenda e Conversas.
export async function isBrokerOwner(userId: string, brokerId: string): Promise<boolean> {
  const key = `${userId}:${brokerId}`;
  const cached = cacheGet(ownerCache, key);
  if (cached !== undefined) return cached;
  const { data } = await supabase.from('imf_brokers').select('id').eq('id', brokerId).eq('user_id', userId).maybeSingle();
  const isOwner = !!data;
  cacheSet(ownerCache, key, isOwner, IDENTITY_TTL_MS);
  return isOwner;
}
