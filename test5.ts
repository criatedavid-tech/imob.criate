import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://umvbrahsqvqeondwtikm.supabase.co", "SUPABASE_SERVICE_ROLE_KEY_REDACTED");
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
