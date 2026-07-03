import { createHmac } from 'node:crypto';
import { ZPRO_ADMIN_URL, ZPRO_ADMIN_TOKEN, ZPRO_JWT_SECRET } from "../config";

// ─── Z-PRO JWT AUTO-REFRESH ──────────────────────────────────────────────────
// O JWT do superadmin expira em ~24h. Este objeto mantém o token em memória e
// o renova via POST /auth/refresh_token antes de qualquer chamada Z-PRO.
// Lógica:
//   • parseJwtExp()      → extrai o campo "exp" do payload sem biblioteca
//   • getZproAdminToken()→ retorna token válido, renovando se faltar < 30 min
//   • refreshZproJwt()   → chama /auth/refresh_token; em fallback tenta /auth/login
//   A variável ZPRO_ADMIN_TOKEN carrega o JWT inicial (obtido do browser ou
//   atualizado via "fly secrets set"); daí em diante o refresh é automático.

export function parseJwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch { return 0; }
}

const _zproJwt = {
  token: ZPRO_ADMIN_TOKEN,
  exp:   parseJwtExp(ZPRO_ADMIN_TOKEN),
  refreshing: false
};

export async function refreshZproJwt(): Promise<void> {
  if (_zproJwt.refreshing) return; // evita refresh duplo simultâneo
  _zproJwt.refreshing = true;
  try {
    // Tentativa 1: POST /auth/refresh_token (não exige senha — usa o token atual)
    const r = await fetch(`${ZPRO_ADMIN_URL}/auth/refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_zproJwt.token}` },
      body: JSON.stringify({ token: _zproJwt.token })
    });
    const raw = await r.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch {}
    const newToken = json?.token ?? json?.access_token ?? json?.accessToken ?? json?.data?.token;
    if (r.ok && newToken) {
      _zproJwt.token = newToken;
      _zproJwt.exp   = parseJwtExp(newToken);
      console.log(`[Z-PRO] JWT renovado via /auth/refresh_token — exp=${new Date(_zproJwt.exp * 1000).toISOString()}`);
      return;
    }
    console.warn(`[Z-PRO] /auth/refresh_token → ${r.status} | ${raw.slice(0, 200)}`);
  } catch (e: any) {
    console.warn('[Z-PRO] refresh_token exception:', e.message);
  } finally {
    _zproJwt.refreshing = false;
  }
  // Sem refresh bem-sucedido — continua com token atual (pode estar expirado;
  // os endpoints vão retornar 401 e o erro ficará visível nos logs).
  console.warn('[Z-PRO] Não foi possível renovar JWT — usando token atual (pode estar expirado)');
}

export async function getZproAdminToken(): Promise<string> {
  // Prefere forgeSuperAdminJwt() quando ZPRO_JWT_SECRET está disponível:
  // gera token fresco a cada chamada (HMAC local, sem rede), nunca expira por clock drift.
  // Fallback para o token armazenado apenas quando JWT_SECRET não está configurado.
  if (ZPRO_JWT_SECRET) {
    return forgeSuperAdminJwt();
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const margin = 30 * 60;
  if (_zproJwt.exp > 0 && nowSec >= _zproJwt.exp - margin) {
    console.log(`[Z-PRO] JWT prestes a expirar (exp=${new Date(_zproJwt.exp * 1000).toISOString()}) — renovando...`);
    await refreshZproJwt();
  }
  return _zproJwt.token;
}

// Gera um JWT HS256 válido para o Z-PRO sem precisar de login.
// Usa o JWT_SECRET do Z-PRO para assinar — funciona porque Z-PRO usa JWT stateless.
// Usado como fallback quando o login do tenant falha (usuário criado no tenant errado).
export function forgeTenantJwt(tenantId: number, userId: number, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: userId, username: email, profile: 'admin',
    tenantId, iat: now, exp: now + 86400
  })).toString('base64url');
  const sig = createHmac('sha256', ZPRO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// Forja token de super-admin para o Z-PRO (não requer restart do servidor Z-PRO).
// Requer ZPRO_JWT_SECRET. Typo intencional: "usarname" (Z-PRO usa esse campo).
export function forgeSuperAdminJwt(): string {
  if (!ZPRO_JWT_SECRET) throw new Error('ZPRO_JWT_SECRET não configurado — não é possível forjar token super-admin');
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    usarname: 'Super Administrador',  // typo intencional do Z-PRO
    tenantId: 1, profile: 'superadmin', id: 2,
    iat: now, exp: now + 86400
  })).toString('base64url');
  const sig = createHmac('sha256', ZPRO_JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
