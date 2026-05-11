async function check() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/api/properties', {
    headers: { 'x-user-id': 'b9679234-ca49-410a-85ba-b0767c514d48' } // dummy
  });
  console.log("GET:", res.status, await res.text());
}
check();
