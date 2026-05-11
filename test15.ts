import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const { data } = await supabase.from('properties').select('*').eq('slug', 'slug-6');
  console.log(data);
}
check();
