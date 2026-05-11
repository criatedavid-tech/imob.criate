async function run() {
  const fetch = globalThis.fetch;
  const res = await fetch('http://localhost:3000/api/properties/health');
  console.log(await res.text());
}
run();
