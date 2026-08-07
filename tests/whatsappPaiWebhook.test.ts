import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { platformWebhookUrl } from "../server/services/provisioning";

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
  assert.equal(platformWebhookUrl("não-é-url"), null);
  assert.equal(
    platformWebhookUrl("https://pai.example.com/caminho-ignorado"),
    "https://pai.example.com/api/wpp-pai/inbound",
  );
});

test("conexão administrativa reafirma o webhook antes de parear", async () => {
  const source = await readFile(new URL("../server/routes/admin.ts", import.meta.url), "utf8");
  const start = source.indexOf('adminRouter.post("/api/admin/whatsapp-pai/connect"');
  const end = source.indexOf('adminRouter.post("/api/admin/whatsapp-pai/disconnect"', start);
  assert.ok(start >= 0 && end > start);
  const connectSource = source.slice(start, end);

  assert.match(connectSource, /setUazapiPlatformWebhook\(token\)/);
  assert.ok(
    connectSource.indexOf("setUazapiPlatformWebhook(token)") < connectSource.indexOf("/instance/connect"),
    "o webhook precisa ser reafirmado antes do pareamento",
  );
  assert.match(connectSource, /status\(503\)/);
});

test("guardião periódico também cobre a instância central do Pai", async () => {
  const source = await readFile(new URL("../server/services/webhookKeeper.ts", import.meta.url), "utf8");
  assert.match(source, /from\("imf_platform_instances"\)/);
  assert.match(source, /kind: "pai"/);
  assert.match(source, /setUazapiPlatformWebhook\(inst\.token\)/);
  assert.match(source, /platformWebhookUrl\(PUBLIC_APP_URL\)/);
});
