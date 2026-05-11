import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtdmJyYWhzcXZxZW9uZHd0aWttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE5NDkxOSwiZXhwIjoyMDQ3NzcwOTE5fQ.slT50A_aa1rmo3fNX8eP7qZeHEPSDcCGGPXrB8GcfhQ");

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
