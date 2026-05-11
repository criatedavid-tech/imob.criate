import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const property = {
    title: 'Teste de Casa 5',
    price: '100000',
    location: 'RJ',
    description: 'Uma casa mto show',
    image_url: '["data:image..."]',
    slug: 'slug-5'
  };

  const { data, error } = await supabase.from('properties').upsert(property).select().single();
  console.log("Upsert result:", error?.message, error);
  console.log("Data:", data);
}
check();
