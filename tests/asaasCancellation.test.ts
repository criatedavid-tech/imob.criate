import assert from "node:assert/strict";
import test from "node:test";

// Chave fixa antes de importar o módulo: config.ts lê ASAAS_API_KEY na carga e
// dotenv não sobrescreve o que já existe em process.env. Assim o teste não
// depende do .env local nem do ambiente de CI.
process.env.ASAAS_API_KEY = "test-key-nao-usada";

const { cancelAsaasSubscription } = await import("../server/services/billing");

function stubFetch(status: number, calls: string[]) {
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ errors: [{ description: "Objeto não encontrado" }] }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

// Regressão de um travamento real em produção (11/08/2026): uma conta com
// asaas_subscription_id órfão devolvia 404 no cancelamento, e a rota de
// exclusão em admin.ts abortava. A conta ficava impossível de excluir, e
// repetir a ação nunca resolveria — o Asaas responderia 404 para sempre.
test("assinatura inexistente no Asaas (404) não impede cancelar plano nem excluir a conta", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const calls: string[] = [];
  stubFetch(404, calls);

  await assert.doesNotReject(() => cancelAsaasSubscription("sub_orfa"));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/subscriptions\/sub_orfa\/cancel$/);
});

test("erros que não provam a parada da cobrança continuam bloqueando a exclusão", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  // 401/403: chave errada. 5xx: instabilidade. Em nenhum deles dá para afirmar
  // que a assinatura parou — excluir a conta aqui deixaria o cliente sendo
  // cobrado sem nenhum registro local.
  for (const status of [400, 401, 403, 500, 502]) {
    stubFetch(status, []);
    await assert.rejects(
      () => cancelAsaasSubscription("sub_x"),
      new RegExp(`HTTP ${status}`),
      `HTTP ${status} deveria continuar lançando`,
    );
  }
});

test("cancelamento bem-sucedido continua passando", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  await assert.doesNotReject(() => cancelAsaasSubscription("sub_ok"));
});
