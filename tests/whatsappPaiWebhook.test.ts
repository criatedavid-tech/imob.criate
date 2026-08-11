import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isUazapiWebhookReady,
  parseUazapiWebhookState,
  platformWebhookUrl,
} from "../server/services/provisioning";

test("webhook do Pai aceita somente origem HTTPS pública e normaliza barras", () => {
  assert.equal(
    platformWebhookUrl("https://pai.example.com/"),
    "https://pai.example.com/api/wpp-pai/inbound",
  );
  assert.equal(platformWebhookUrl("http://pai.example.com"), null);
  assert.equal(platformWebhookUrl("http://localhost:3000"), null);
  assert.equal(platformWebhookUrl("https://127.0.0.1:3000"), null);
  assert.equal(platformWebhookUrl("https://0.0.0.0:3000"), null);
  assert.equal(platformWebhookUrl("https://[::1]:3000"), null);
  assert.equal(platformWebhookUrl("https://192.168.1.10"), null);
  assert.equal(platformWebhookUrl("https://172.20.1.10"), null);
  assert.equal(platformWebhookUrl("https://fdocumentos.example.com"), "https://fdocumentos.example.com/api/wpp-pai/inbound");
  assert.equal(platformWebhookUrl("não-é-url"), null);
  assert.equal(
    platformWebhookUrl("https://pai.example.com/caminho-ignorado"),
    "https://pai.example.com/api/wpp-pai/inbound",
  );
});

test("conexão administrativa só reafirma webhook ativado e depois de parear", async () => {
  const source = await readFile(new URL("../server/routes/admin.ts", import.meta.url), "utf8");
  const start = source.indexOf('adminRouter.post("/api/admin/whatsapp-pai/connect"');
  const end = source.indexOf('adminRouter.post("/api/admin/whatsapp-pai/disconnect"', start);
  assert.ok(start >= 0 && end > start);
  const connectSource = source.slice(start, end);

  assert.match(connectSource, /setUazapiPlatformWebhook\(token\)/);
  assert.match(connectSource, /platform\?\.webhook_enabled/);
  assert.ok(
    connectSource.indexOf("setUazapiPlatformWebhook(token)") > connectSource.indexOf("/instance/connect"),
    "o webhook deve ser reafirmado depois do pareamento, que pode limpar eventos",
  );
  assert.match(connectSource, /status\(503\)/);
});

test("guardião periódico também cobre a instância central do Pai", async () => {
  const source = await readFile(new URL("../server/services/webhookKeeper.ts", import.meta.url), "utf8");
  assert.match(source, /from\("imf_platform_instances"\)/);
  assert.match(source, /kind: "pai"/);
  assert.match(source, /desiredEnabled: platform\.webhook_enabled === true/);
  assert.match(source, /setUazapiPlatformWebhook\(inst\.token, PUBLIC_APP_URL, inst\.desiredEnabled\)/);
  assert.match(source, /isUazapiWebhookReady\(current, expected, inst\.desiredEnabled\)/);
  assert.match(source, /platformWebhookUrl\(PUBLIC_APP_URL\)/);
});

test("estado do webhook exige URL, enabled e conjunto exato de eventos", () => {
  const expected = "https://pai.example.com/api/wpp-pai/inbound";
  const state = parseUazapiWebhookState([{
    url: expected,
    enabled: true,
    events: ["messages", "connection"],
  }]);
  assert.deepEqual(state.events, ["connection", "messages"]);
  assert.equal(isUazapiWebhookReady(state, expected), true);
  assert.equal(isUazapiWebhookReady({ ...state, enabled: false }, expected), false);
  assert.equal(isUazapiWebhookReady({ ...state, enabled: false }, expected, false), true);
  assert.equal(isUazapiWebhookReady({ ...state, events: ["messages"] }, expected), false);
});

test("painel diferencia desvio confirmado de falha temporária na leitura do provedor", async () => {
  const routeSource = await readFile(new URL("../server/routes/admin.ts", import.meta.url), "utf8");
  const componentSource = await readFile(new URL("../src/components/AdminWhatsappPai.tsx", import.meta.url), "utf8");

  assert.match(routeSource, /webhookState\s*\? isUazapiWebhookReady\([\s\S]*?\)\s*:\s*null/);
  assert.match(componentSource, /status\.webhookReady === true/);
  assert.match(componentSource, /status\.webhookDesired && status\.webhookReady === false/);
  assert.match(componentSource, /Não foi possível confirmar o webhook agora/);
  assert.doesNotMatch(componentSource, /Desative e ative novamente/);
});
