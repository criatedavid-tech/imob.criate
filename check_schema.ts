import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://umvbrahsqvqeondwtikm.supabase.co";
const FALLBACK_KEY = "SUPABASE_SERVICE_ROLE_KEY_REDACTED";

const supabase = createClient(FALLBACK_URL, FALLBACK_KEY);

async function checkSchema() {
  const { data, error } = await supabase.from('properties').insert([{
    title: 'Test',
    price: '100',
    location: 'Test',
    description: 'Test',
    image_url: JSON.stringify(['img1', 'img2']),
  }]).select('image_url');
  console.log("data:", data, "error:", error);
}

checkSchema();
