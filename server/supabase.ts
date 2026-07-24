import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./config";
import { fetchWithTimeout } from "./lib/http";

// Teto por chamada ao Supabase. Todo provedor externo (Asaas, UAZAPI,
// OpenRouter, n8n) já passava por fetchWithTimeout — só o Supabase, que é a
// dependência de 100% das requisições, usava o fetch global SEM timeout. Uma
// lentidão do banco deixava requisições penduradas indefinidamente: sockets e
// objetos acumulavam até o OOM, e a concorrência subia até o proxy passar a
// devolver 503 para todo mundo, inclusive para a vitrine pública.
const SUPABASE_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS) || 10_000;

// Cliente Supabase (service_role) para o backend — ignora RLS por design.
// Isolamento multi-tenant é responsabilidade do código (ver DOCUMENTACAO.md §14.5.2):
// nunca confiar em broker_id vindo de query/body em rota de browser.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: (input: any, init?: any) =>
      fetchWithTimeout(typeof input === "string" ? input : String(input), init, SUPABASE_TIMEOUT_MS),
  },
});
