async function run() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/api/properties', {
    headers: { 'x-user-id': '923881c5-dafd-4d3d-b22d-732ec1ea8a73' }
  });
  console.log(res.status, await res.text());
}
run();
