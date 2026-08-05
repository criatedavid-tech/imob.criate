import assert from "node:assert/strict";
import test from "node:test";
import { splitReplyIntoBubbles, sanitizeReply, typingDelayMs } from "../server/services/replyChunks";

process.env.SUPABASE_URL ||= "https://exemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste";

const { mergeLeadKnowledge, missingFields, emptyKnowledge } =
  await import("../server/services/leadKnowledge");

// ─── Balões ─────────────────────────────────────────────────────────────────

// Resposta real da IA (execução 1098587): um bloco de 5 linhas com parágrafos.
const RESPOSTA_REAL = `Bom dia, Flávio! Que bom te ter por aqui.

Temos um apartamento no Centro de Goiânia que se encaixa na sua busca, ele custa R$ 350.000,00.

Ele é bem espaçoso, com 5 quartos, 2 salas e 5 banheiros.

Você pode ver as fotos e mais detalhes neste link: https://imobiflow-v2.fly.dev/p/ap-centro-5z2a

O que achou?`;

test("resposta curta continua sendo um balão só", () => {
  assert.deepEqual(splitReplyIntoBubbles("Oi! Como posso te chamar?"), ["Oi! Como posso te chamar?"]);
});

test("textão vira no máximo 3 balões, sem quebrar o link", () => {
  const baloes = splitReplyIntoBubbles(RESPOSTA_REAL, 3);
  assert.ok(baloes.length > 1 && baloes.length <= 3, `saiu ${baloes.length} balões`);
  const juntado = baloes.join("\n\n");
  assert.ok(juntado.includes("https://imobiflow-v2.fly.dev/p/ap-centro-5z2a"));
  // Link não pode ser cortado entre dois balões.
  const comLink = baloes.filter((b) => b.includes("imobiflow-v2.fly.dev"));
  assert.equal(comLink.length, 1);
  // Nada se perde na quebra.
  for (const trecho of ["Bom dia, Flávio", "R$ 350.000,00", "O que achou?"]) {
    assert.ok(juntado.includes(trecho), `perdeu "${trecho}"`);
  }
});

test("fragmento curto não vira balão sozinho", () => {
  const baloes = splitReplyIntoBubbles("Perfeito!\n\nVou verificar a agenda e já te falo os horários livres.");
  assert.equal(baloes.length, 1, "'Perfeito!' sozinho num balão parece robô");
});

test("limite de balões junta o excedente no último em vez de disparar 6 mensagens", () => {
  const texto = ["Primeiro parágrafo bem longo para valer um balão inteiro sozinho.",
    "Segundo parágrafo também comprido o suficiente para virar balão.",
    "Terceiro parágrafo igualmente comprido para virar um balão.",
    "Quarto parágrafo que deveria ser colado no anterior sem virar balão novo.",
    "Quinto parágrafo que também deveria ser colado no mesmo lugar."].join("\n\n");
  const baloes = splitReplyIntoBubbles(texto, 3);
  assert.equal(baloes.length, 3);
  assert.ok(baloes[2].includes("Quarto parágrafo") && baloes[2].includes("Quinto parágrafo"));
});

test("limpa os vícios que o modelo insiste em produzir", () => {
  assert.equal(sanitizeReply('"Oi, tudo bem?"'), "Oi, tudo bem?", "resposta inteira entre aspas");
  assert.equal(sanitizeReply("=Oi"), "Oi", "artefato de expressão do n8n");
  assert.equal(sanitizeReply("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(sanitizeReply("  espaco  \n  "), "espaco");
});

test("muletas do modelo somem mesmo quando o prompt nao segura", () => {
  // Frase real da execucao 1099687, com a muleta proibida no meio.
  assert.equal(
    sanitizeReply("Ah, entendi, Hiago!\n\nPara eu te ajudar melhor, você busca comprar ou alugar?"),
    "Ah, entendi, Hiago!\n\nVocê busca comprar ou alugar?",
  );
  assert.equal(
    sanitizeReply("Pelo que entendi, você quer uma casa no Setor Bueno."),
    "Você quer uma casa no Setor Bueno.",
  );
  assert.equal(
    sanitizeReply("Que bom te ter por aqui! Temos duas opções."),
    "Temos duas opções.",
  );
  assert.equal(sanitizeReply("Vou verificar. Posso ajudar em mais alguma coisa?"), "Vou verificar.");
});

test("remocao de muleta nao estraga texto normal", () => {
  const normal = "Não encontrei nenhuma casa em Moema no momento.\n\nTenho opções no Setor Oeste. Quer ver?";
  assert.equal(sanitizeReply(normal), normal);
});

test("pausa entre balões existe mas nunca vira espera longa", () => {
  assert.ok(typingDelayMs("oi") >= 350);
  assert.ok(typingDelayMs("x".repeat(5000)) <= 2_200);
});

// ─── O que a IA sabe vs. o que ela supôs ────────────────────────────────────

const AGORA = "2026-08-06T12:00:00.000Z";

test("informação nova nunca apaga o que já se sabia", () => {
  const base = mergeLeadKnowledge(emptyKnowledge("b", "5562999"), {
    nome: "Hiago", regiao: "Setor Bueno", finalidade: "venda",
  }, AGORA);
  const depois = mergeLeadKnowledge(base, { quartos: 3 }, AGORA);

  assert.equal(depois.nome, "Hiago");
  assert.equal(depois.regiao, "Setor Bueno");
  assert.equal(depois.quartos, 3);
});

test("campo vazio ou nulo não zera o que estava preenchido", () => {
  const base = mergeLeadKnowledge(emptyKnowledge("b", "5562999"), { nome: "Hiago", regiao: "Centro" }, AGORA);
  const depois = mergeLeadKnowledge(base, { nome: "", regiao: null, tipo: "casa" }, AGORA);
  assert.equal(depois.nome, "Hiago");
  assert.equal(depois.regiao, "Centro");
  assert.equal(depois.tipo, "casa");
});

test("suposição fica separada do fato e some quando o cliente confirma", () => {
  // O caso real: "eu morou balneário moço" não é confirmação de que ele quer
  // comprar em Balneário Camboriú.
  const comHipotese = mergeLeadKnowledge(emptyKnowledge("b", "5562999"), {
    hipotese: { campo: "regiao", valor: "Balneário Camboriú", evidencia: 'cliente escreveu "eu morou balneário"' },
  }, AGORA);
  assert.equal(comHipotese.regiao, null, "hipótese NÃO pode virar campo confirmado");
  assert.equal(comHipotese.hipoteses.length, 1);
  assert.equal(comHipotese.hipoteses[0].campo, "regiao");

  const confirmado = mergeLeadKnowledge(comHipotese, { regiao: "Goiânia, perto da Santo Amaro" }, AGORA);
  assert.equal(confirmado.regiao, "Goiânia, perto da Santo Amaro");
  assert.equal(confirmado.hipoteses.length, 0, "palpite velho não pode sobreviver à resposta do cliente");
});

test("nova suposição sobre o mesmo campo substitui a anterior", () => {
  let k = mergeLeadKnowledge(emptyKnowledge("b", "1"), {
    hipotese: { campo: "orcamento", valor: "até 300 mil", evidencia: "a" },
  }, AGORA);
  k = mergeLeadKnowledge(k, { hipotese: { campo: "orcamento", valor: "até 500 mil", evidencia: "b" } }, AGORA);
  assert.equal(k.hipoteses.length, 1);
  assert.equal(k.hipoteses[0].valor, "até 500 mil");
});

test("diferenciais acumulam sem duplicar", () => {
  let k = mergeLeadKnowledge(emptyKnowledge("b", "1"), { diferenciais: ["Piscina", "garagem"] }, AGORA);
  k = mergeLeadKnowledge(k, { diferenciais: ["piscina", "pet"] }, AGORA);
  assert.deepEqual(k.diferenciais.sort(), ["garagem", "pet", "piscina"]);
});

test("observações guardam o fim, não o começo — contexto recente vale mais", () => {
  let k = emptyKnowledge("b", "1");
  for (let i = 0; i < 60; i++) {
    k = mergeLeadKnowledge(k, { observacao: `nota numero ${i} com um texto razoavelmente longo para encher` }, AGORA);
  }
  assert.ok(k.observacoes!.length <= 2000);
  assert.ok(k.observacoes!.includes("nota numero 59"), "a mais recente precisa sobreviver");
  assert.ok(!k.observacoes!.includes("nota numero 0 "), "a mais antiga é a que cai");
});

test("o que falta descobrir vem na ordem em que vale perguntar", () => {
  const vazio = emptyKnowledge("b", "1");
  assert.deepEqual(missingFields(vazio), [
    "comprar ou alugar", "região", "tipo de imóvel", "quantos quartos", "faixa de valor", "nome",
  ]);

  const parcial = mergeLeadKnowledge(vazio, { nome: "Hiago", finalidade: "venda" }, AGORA);
  assert.deepEqual(missingFields(parcial), ["região", "tipo de imóvel", "quantos quartos", "faixa de valor"]);
});
