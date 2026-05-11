import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const { data, error } = await supabase.from('users').select('*').limit(5);
  console.log("Users in public:", error?.message || data);
}
check();
