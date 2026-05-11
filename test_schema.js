import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");

async function check() {
  const property = {
    title: 'Teste de Limit',
    price: '100000',
    location: 'RJ',
    description: 'Uma casa mto show',
    image_url: 'a'.repeat(2 * 1024 * 1024), // 2MB string
    slug: 'slug-limit-1'
  };

  const { data, error } = await supabase.from('properties').upsert(property).select().single();
  console.log("Upsert result:", error?.message, error);
}
check();
