async function check() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/p/slug-123');
  console.log(res.status, await res.text());
}
check();
