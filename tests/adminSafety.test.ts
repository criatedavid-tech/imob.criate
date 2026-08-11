import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(new URL("../src/pages/Admin.tsx", import.meta.url), "utf8");

test("admin só atualiza status local após resposta válida da API", () => {
  const start = adminSource.indexOf("async function updateStatus");
  const end = adminSource.indexOf("const closeDetail", start);
  assert.ok(start >= 0 && end > start);
  const updateStatusSource = adminSource.slice(start, end);

  assert.match(updateStatusSource, /confirm\(confirmationByStatus\[status\]\)/);
  assert.match(updateStatusSource, /if \(!res\.ok\) throw new Error/);
  assert.ok(
    updateStatusSource.indexOf("if (!res.ok)") < updateStatusSource.indexOf("setBrokers"),
    "o estado local não pode mudar antes da confirmação da API",
  );
});

test("ações administrativas sensíveis exigem confirmação", () => {
  assert.match(adminSource, /Alterar o limite de WhatsApp próprio/);
  assert.match(adminSource, /atendimento\(s\) como \$\{adjustmentName\}/);
  assert.match(adminSource, /Provisionar uma nova instância de WhatsApp/);
});

test("drawer administrativo é acessível, cancelável e responsivo", () => {
  assert.match(adminSource, /role="dialog"/);
  assert.match(adminSource, /aria-modal="true"/);
  assert.match(adminSource, /aria-label="Fechar detalhes do corretor"/);
  assert.match(adminSource, /event\.key === 'Escape'/);
  assert.match(adminSource, /detailRequestIdRef\.current \+= 1/);
  assert.match(adminSource, /hidden sm:inline/);
});

test("drawer fecha somente depois de salvar funcionalidades com sucesso", () => {
  const start = adminSource.indexOf("async function saveCapabilities");
  const end = adminSource.indexOf("async function saveMemberLimit", start);
  assert.ok(start >= 0 && end > start);
  const saveSource = adminSource.slice(start, end);

  assert.match(saveSource, /if \(current === desired\) \{\s*closeDetail\(\);/);
  assert.ok(
    saveSource.indexOf("if (!res.ok) throw new Error") < saveSource.lastIndexOf("closeDetail();"),
    "o drawer não pode fechar antes de a API confirmar a alteração",
  );
  assert.match(saveSource, /catch \(err: any\) \{\s*setActionMsg/);
});

test("atualizar painel recarrega também a aba administrativa ativa", () => {
  assert.match(adminSource, /function refreshPanel\(\)/);
  assert.match(adminSource, /onClick=\{refreshPanel\}/);
  assert.match(adminSource, /AdminWhatsappPai key=\{`whatsapp-pai-\$\{refreshKey\}`\}/);
});
