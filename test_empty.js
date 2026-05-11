import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const { data, error } = await supabase.from('properties').insert([{title:'a'}]).select();
  console.log("Insert title only:", error?.message, error);
}
check();
