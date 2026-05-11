import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const userId = 'b9679234-ca49-410a-85ba-b0767c514d48'; // dummy ID

  const { data: broker, error } = await supabase.from('brokers').select('id').eq('user_id', userId).single();
  
  if (error && error.code === 'PGRST116') {
     console.log("Broker not found, simulating creation...");
     const { data: user } = await supabase.auth.admin.getUserById(userId);
     console.log("Auth user found:", user);
     
     const { data: newBroker, error: createError } = await supabase.from('brokers').insert([{
       user_id: userId,
       name: 'Corretor'
     }]).select().single();
     
     console.log("Create broker error:", createError);
     console.log("New broker:", newBroker);
  } else {
     console.log("Broker found:", broker, error);
  }
}
check();
