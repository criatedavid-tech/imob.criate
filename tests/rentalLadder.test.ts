import assert from "node:assert/strict";
import test from "node:test";

// Estes módulos criam o cliente Supabase ao serem carregados; o teste não fala
// com o banco, só precisa que a importação não morra.
process.env.SUPABASE_URL ||= "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";

const { renderRentalMessage, unknownVariables, STEP_KEYS, LEGACY_STEP_OFFSETS } =
  await import("../server/services/rentalTemplates");
const { pickLadderStep, lastSentOffset } = await import("../server/services/rentalAutopilot");

const ctx = {
  tenantName: "Marcos Almeida Silva",
  amountCents: 245_000,
  originalCents: 240_000,
  lateFeeCents: 4_800,
  interestCents: 200,
  daysLate: 3,
  dueDate: "2026-08-10",
  referenceMonth: "2026-08-01",
  propertyTitle: "Apartamento 302",
  pix: "00020126CODIGO",
  boleto: "https://boleto.exemplo/1",
};

function step(over: Partial<any> = {}) {
  return {
    step: "late_1", title: "Passo", offset_days: 1, enabled: true, body: "texto",
    is_default: true, min_offset: 1, max_offset: 60, can_disable: true, hands_over: false,
    ...over,
  } as any;
}

test("substitui as variáveis pelos dados reais do contrato", () => {
  const texto = renderRentalMessage(
    "Oi, {{nome}}! O aluguel de {{valor}} venceu em {{vencimento}} ({{dias_atraso}} dias). Imóvel: {{imovel}}. Mês {{mes}}.",
    ctx,
  );
  assert.equal(
    texto,
    "Oi, Marcos! O aluguel de R$ 2.450,00 venceu em 10/08/2026 (3 dias). Imóvel: Apartamento 302. Mês agosto/2026.",
  );
});

test("o bloco do PIX sai inteiro, com rótulo, e some quando não há PIX", () => {
  const comPix = renderRentalMessage("Segue:\n\n{{pix}}", ctx);
  assert.equal(comPix, "Segue:\n\nPIX copia e cola:\n00020126CODIGO");

  const semPix = renderRentalMessage("Segue:\n\n{{pix}}\n\n{{boleto}}", { ...ctx, pix: null, boleto: null });
  // Sem código, nem o rótulo pode sobrar — senão o inquilino recebe
  // "PIX copia e cola:" sem nada embaixo.
  assert.equal(semPix, "Segue:");
});

test("variável inexistente sai vazia e é denunciada antes de salvar", () => {
  assert.deepEqual(unknownVariables("Oi {{nome}}, {{desconto}} e {{cupom}}"), ["desconto", "cupom"]);
  assert.equal(renderRentalMessage("Valor {{desconto}}fim", ctx), "Valor fim");
});

test("nome ausente não deixa pontuação órfã nem espaço duplo", () => {
  assert.equal(renderRentalMessage("Oi, {{nome}}! Tudo bem?", { ...ctx, tenantName: "" }), "Oi! Tudo bem?");
  assert.equal(renderRentalMessage("A {{imovel}} casa", { ...ctx, propertyTitle: "" }), "A casa");
});

test("valor com atraso e valor original são variáveis diferentes", () => {
  const texto = renderRentalMessage("{{valor_original}} + {{multa}} + {{juros}} = {{valor}}", ctx);
  assert.equal(texto, "R$ 2.400,00 + R$ 48,00 + R$ 2,00 = R$ 2.450,00");
});

test("degrau vigente é o de maior dia já vencido (não pula quando o robô atrasa)", () => {
  const ladder = [step({ step: "pre_5", offset_days: -5 }), step({ step: "due", offset_days: 0 }), step({ step: "late_3", offset_days: 3 })];
  assert.equal(pickLadderStep(-6, ladder), null, "antes do primeiro degrau não manda nada");
  assert.equal(pickLadderStep(-5, ladder)?.step, "pre_5");
  assert.equal(pickLadderStep(-2, ladder)?.step, "pre_5", "ficou um dia sem rodar: manda o degrau devido, não o seguinte");
  assert.equal(pickLadderStep(0, ladder)?.step, "due");
  assert.equal(pickLadderStep(90, ladder)?.step, "late_3");
});

test("degrau desligado ou sem texto é ignorado", () => {
  const ladder = [
    step({ step: "due", offset_days: 0 }),
    step({ step: "late_1", offset_days: 1, enabled: false }),
    step({ step: "late_3", offset_days: 3, body: "   " }),
  ];
  assert.equal(pickLadderStep(5, ladder)?.step, "due");
});

test("o degrau que entrega para humano vale mesmo sem mensagem ao inquilino", () => {
  const ladder = [step({ step: "escalated", offset_days: 15, body: "", hands_over: true, can_disable: false })];
  assert.equal(pickLadderStep(15, ladder)?.step, "escalated");
});

test("competência antiga (sem o dia gravado) usa a régua original como referência", () => {
  assert.equal(lastSentOffset({ dunning_step: "late_3", dunning_step_offset: null }), 3);
  assert.equal(lastSentOffset({ dunning_step: "late_3", dunning_step_offset: 5 }), 5, "o dia gravado manda");
  assert.equal(lastSentOffset({ dunning_step: null, dunning_step_offset: null }), null);
  assert.equal(lastSentOffset({ dunning_step: "passo_que_nao_existe" }), null);
});

test("a régua padrão cobre da emissão até a entrega para humano", () => {
  assert.deepEqual(STEP_KEYS, ["pre_5", "pre_1", "due", "late_1", "late_3", "late_7", "escalated"]);
  // O mapa legado precisa cobrir todos os degraus, senão competências antigas
  // reenviariam mensagem ao mudar de versão.
  for (const key of STEP_KEYS) assert.ok(key in LEGACY_STEP_OFFSETS, `falta ${key} no mapa legado`);
});
