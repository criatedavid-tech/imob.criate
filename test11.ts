import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
  console.log("Users:", users?.users.map(u => ({ id: u.id, email: u.email })));
  
  const { data: brokers } = await supabase.from('brokers').select('*');
  console.log("Brokers:", brokers);
}
check();
