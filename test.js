async function run() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/api/properties', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-user-id': '923881c5-dafd-4d3d-b22d-732ec1ea8a73' 
    },
    body: JSON.stringify({
      title: 'Teste pelo User David 2',
      price: '500000',
      location: 'São Paulo',
      description: 'Uma casa mto top 2',
      images: ['data:image/png;base64,123'] 
    })
  });
  console.log(res.status, await res.text());
}
run();
