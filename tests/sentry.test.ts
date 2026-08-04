import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeSentryEvent } from "../server/lib/sentryPrivacy";

test("Sentry remove dados de cliente e segredos antes do envio", () => {
  const event = sanitizeSentryEvent({
    type: undefined,
    request: {
      url: "https://imobiflow-v2.fly.dev/api/conversations/123?token=segredo#parte",
      method: "POST",
      data: { message: "conteúdo privado" },
      query_string: "token=segredo",
      cookies: { session: "segredo" },
      headers: { authorization: "Bearer segredo" },
      env: { SUPABASE_SERVICE_ROLE_KEY: "segredo" },
    },
    user: { id: "corretor-123", email: "cliente@example.com", ip_address: "127.0.0.1" },
    extra: { prompt: "conteúdo privado" },
    breadcrumbs: [
      { category: "console", message: "mensagem privada" },
      {
        category: "http",
        data: { url: "https://api.exemplo.test/recurso?api_key=segredo" },
      },
    ],
  });

  assert.deepEqual(event.request, {
    url: "https://imobiflow-v2.fly.dev/api/conversations/123",
    method: "POST",
  });
  assert.equal(event.user, undefined);
  assert.equal(event.extra, undefined);
  assert.deepEqual(event.breadcrumbs, [
    {
      category: "http",
      data: { url: "https://api.exemplo.test/recurso" },
    },
  ]);
});

test("Sentry remove voucher transportado no caminho da URL", () => {
  const code = "imf_trial_01234567890123456789012345678901";
  const event = sanitizeSentryEvent({
    type: undefined,
    request: { url: `https://imobiflow-v2.fly.dev/api/auth/trial-vouchers/${code}?x=1` },
    breadcrumbs: [
      { category: "http", data: { url: `https://imobiflow-v2.fly.dev/experimentacao/${code}` } },
    ],
  });

  assert.equal(event.request?.url, "https://imobiflow-v2.fly.dev/api/auth/trial-vouchers/:voucher");
  assert.equal(event.breadcrumbs?.[0]?.data?.url, "https://imobiflow-v2.fly.dev/experimentacao/:voucher");
});
