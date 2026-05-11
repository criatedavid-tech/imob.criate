import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtdmJyYWhzcXZxZW9uZHd0aWttIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjE5NDkxOSwiZXhwIjoyMDQ3NzcwOTE5fQ.slT50A_aa1rmo3fNX8eP7qZeHEPSDcCGGPXrB8GcfhQ");
async function check() {
  const { data, error } = await supabase.from('properties').insert([{
    title: 'Test',
    price: '100',
    location: 'Test',
    description: 'Test',
    image_url: 'img1',
    slug: 'test-some-slug-123',
    broker_id: '4fa0e23b-a25e-49b0-9f17-b77cdba33e9b' // valid broker_id?
  }]);
  console.log(data, error);
}
check();
