import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./config";

// Cliente Supabase (service_role) para o backend — ignora RLS por design.
// Isolamento multi-tenant é responsabilidade do código (ver DOCUMENTACAO.md §14.5.2):
// nunca confiar em broker_id vindo de query/body em rota de browser.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});
