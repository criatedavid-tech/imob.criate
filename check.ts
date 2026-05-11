import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://umvbrahsqvqeondwtikm.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtdmJyYWhzcXZxZW9uZHd0aWttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE5NDkxOSwiZXhwIjoyMDQ3NzcwOTE5fQ.slT50A_aa1rmo3fNX8eP7qZeHEPSDcCGGPXrB8GcfhQ";

const supabase = createClient(FALLBACK_URL, FALLBACK_KEY);

async function check() {
  const { data, error } = await supabase.from('properties').select('id').limit(1);
  console.log(data, error);
}
check();
