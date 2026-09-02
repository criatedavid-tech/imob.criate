// fetch com timeout — sem isso, uma chamada externa (Asaas, UAZAPI,
// OpenRouter, N8N) que trava deixa a request HTTP do PANTUS Real Estate presa
// indefinidamente. Assinatura compatível com fetch() — só troca o nome no
// call site e adiciona o import.
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
