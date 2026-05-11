import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://umvbrahsqvqeondwtikm.supabase.co";
const FALLBACK_KEY = "SUPABASE_SERVICE_ROLE_KEY_REDACTED";

const supabase = createClient(FALLBACK_URL, FALLBACK_KEY);

async function check() {
  const { data, error } = await supabase.from('properties').select('id').limit(1);
  console.log(data, error);
}
check();
