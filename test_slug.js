async function check() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/api/properties/teste-pelo-user-david-dth4');
  console.log(res.status, await res.text());
}
check();
