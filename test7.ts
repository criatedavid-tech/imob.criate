import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const userId = 'b9679234-ca49-410a-85ba-b0767c514d48';

  const { data: broker, error: brokerErr } = await supabase.from('brokers').select('id').eq('user_id', userId).single();
  let brokerId = broker?.id;
  console.log("Found broker:", brokerId, brokerErr);

  const property = {
    title: 'Teste de Casa 3',
    price: '100000',
    location: 'RJ',
    description: 'Uma casa mto show',
    image_url: '["data:image..."]',
    slug: 'slug-3',
    broker_id: brokerId
  };

  const { data, error } = await supabase.from('properties').upsert(property).select().single();
  console.log("Upsert result:", error?.message, error);
}
check();
