import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtdmJyYWhzcXZxZW9uZHd0aWttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE5NDkxOSwiZXhwIjoyMDQ3NzcwOTE5fQ.slT50A_aa1rmo3fNX8eP7qZeHEPSDcCGGPXrB8GcfhQ");

async function check() {
  const property = {
    title: 'Teste de Casa 4',
    price: '100000',
    location: 'RJ',
    description: 'Uma casa mto show',
    image_url: '["data:image..."]',
    slug: 'slug-4',
    broker_id: '4fa0e23b-a25e-49b0-9f17-b77cdba33e9b' // doesn't exist
  };

  const { data, error } = await supabase.from('properties').upsert(property).select().single();
  console.log("Upsert result:", error?.message, error);
}
check();
