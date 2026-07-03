import dotenv from "dotenv";

// Carrega o .env (se existir), sobrescrevendo vars do ambiente se necessário
dotenv.config({ override: true });

// --- CREDENCIAIS SUPABASE (somente via ambiente — NUNCA hardcoded) ---
// A URL do projeto não é segredo; a service_role key é (acesso total ao
// banco, ignora RLS). Por isso ela só vem do ambiente e o servidor recusa
// subir sem ela, evitando rodar com chave vazia ou commitada por engano.
export const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || "https://umvbrahsqvqeondwtikm.supabase.co";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  || "";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "\n[FATAL] SUPABASE_SERVICE_ROLE_KEY ausente.\n" +
    "Defina a variável de ambiente (ou no .env local) antes de iniciar o servidor.\n"
  );
  process.exit(1);
}

// ─── VARIÁVEIS DE AMBIENTE EXTERNAS ───────────────────────────────────────────
export const APP_URL             = process.env.APP_URL             || "http://localhost:3000";
export const ASAAS_API_KEY       = process.env.ASAAS_API_KEY       || "";
export const ASAAS_BASE_URL      = process.env.ASAAS_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3';
export const ZPRO_ADMIN_URL      = process.env.ZPRO_ADMIN_URL      || "";
export const ZPRO_ADMIN_TOKEN    = process.env.ZPRO_ADMIN_TOKEN    || "";

// Versão vigente dos Termos de Uso / Política de Privacidade (data de vigência).
// Ao alterar os documentos de forma relevante, mude esta constante — usuários
// logados com versão aceita divergente verão o modal de re-aceite (TermsGate).
export const TERMS_VERSION = '2026-07-01';
// API_TOKEN_SECRET do backend Z-PRO — necessário para tenantApiCreateSession/StoreTenant
// Obtido pelo admin do servidor Z-PRO: cat /app/.env | grep API_TOKEN_SECRET
// Quando configurado, habilita criação automática de apiConfig no provisionamento.
export const ZPRO_API_SECRET     = process.env.ZPRO_API_SECRET     || "";
// JWT_SECRET do Z-PRO — permite forjar tokens de tenant para configuração automática.
// Valor: JWT_SECRET do arquivo .env do backend Z-PRO.
export const ZPRO_JWT_SECRET     = process.env.ZPRO_JWT_SECRET     || "";
export const UAZAPI_HOST             = process.env.UAZAPI_HOST             || "https://criate.uazapi.com";
export const UAZAPI_TOKEN            = process.env.UAZAPI_TOKEN            || "";
export const UAZAPI_PLATFORM_SESSION = process.env.UAZAPI_PLATFORM_SESSION || "";
export const PROVISIONING_WEBHOOK_URL = process.env.PROVISIONING_WEBHOOK_URL
  || "https://212hook.criate.online/webhook/f19c91c4-b826-4150-af8d-151200e619f0";
export const N8N_WEBHOOK_URL     = process.env.N8N_WEBHOOK_URL
  || "https://212hook.criate.online/webhook/edc20beb-c9c1-46c3-bbef-8fa81538cbb3";
export const SUBSCRIPTION_VALUE      = Number(process.env.SUBSCRIPTION_VALUE      || "49.90");
// Token configurado no painel Asaas (Configurações → Integrações → Webhooks → Token de Acesso).
// O Asaas envia este valor no header 'asaas-access-token' em cada evento.
// Sem ele configurado, a verificação é pulada (compatibilidade com sandbox sem token).
export const ASAAS_WEBHOOK_TOKEN     = process.env.ASAAS_WEBHOOK_TOKEN             || "";
// Plano: 100 atendimentos inclusos; excedente R$ 3,00/ticket cobrado automaticamente no ciclo seguinte.
// Para alterar sem redeploy: fly secrets set PLAN_INCLUDED_TICKETS=100 PLAN_OVERAGE_PRICE=3.00
export const PLAN_INCLUDED_TICKETS   = Number(process.env.PLAN_INCLUDED_TICKETS   || "100");
export const PLAN_OVERAGE_PRICE      = Number(process.env.PLAN_OVERAGE_PRICE      || "3.00");
// ─── PROXY LLM ────────────────────────────────────────────────────────────────
// Token interno: N8N → servidor (substitui "credential" estática no N8N).
// Enc key: AES-256-GCM para guardar as keys OpenRouter dos corretores no banco.
export const INTERNAL_PROXY_TOKEN = process.env.INTERNAL_PROXY_TOKEN || "";
export const LLM_PROXY_ENC_KEY    = process.env.LLM_PROXY_ENC_KEY    || "";
// Fallback: chave da empresa usada enquanto o corretor não configurou a própria.
export const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY   || "";
export const SENTRY_DSN           = process.env.SENTRY_DSN           || "";
export const REDIS_URL            = process.env.REDIS_URL            || "";
