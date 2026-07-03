import type { Request } from 'express';
import { supabase } from '../supabase';

// --- AUTENTICAÇÃO REAL (valida o JWT do Supabase, não confia em headers) ---
// O header x-user-id é ignorado para fins de identidade: o userId vem
// exclusivamente do access_token validado pelo Supabase Auth.
// Cache de 60s evita uma chamada ao Auth por request.
const tokenCache = new Map<string, { userId: string; expires: number }>();

export async function verifyAccessToken(req: Request): Promise<string | null> {
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
  try {
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
      return newBroker.id;
    }

    return brokers[0].id;
  } catch (err) {
    console.error("error in getBrokerId:", err);
    return null;
  }
}
