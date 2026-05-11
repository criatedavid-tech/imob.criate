async function run() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/api/properties', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-user-id': 'b9679234-ca49-410a-85ba-b0767c514d48' 
    },
    body: JSON.stringify({
      title: 'Teste de Casa 2',
      price: '100000',
      location: 'RJ',
      description: 'Uma casa mto show',
      images: ['data:image/jpeg;base64,...'] // dummy
    })
  });
  console.log(res.status, await res.text());
}
run();
