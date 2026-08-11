import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatConversationInsight,
  normalizeConversationInsight,
  resolveConversationContact,
} from "../server/services/conversationInsights";

test("localiza contato por nome, acento ou telefone sem misturar pessoas", () => {
  const contacts = [
    { name: "João Pedro", phone: "5562991111111" },
    { name: "Maria", phone: "5562992222222" },
  ];
  const byName = resolveConversationContact(contacts, { name: "joao pedro" });
  assert.equal(byName.kind, "found");
  // O formato canônico de conversas remove o nono dígito, como o restante do
  // sistema faz ao conciliar WhatsApp, CRM e contatos.
  if (byName.kind === "found") assert.equal(byName.contact.phone, "556291111111");

  const byPhone = resolveConversationContact(contacts, { phone: "+55 (62) 99222-2222" });
  assert.equal(byPhone.kind, "found");
  if (byPhone.kind === "found") assert.equal(byPhone.contact.name, "Maria");
});

test("nome parcial ambíguo pede identificação adicional", () => {
  const result = resolveConversationContact([
    { name: "Marcos Antônio", phone: "5562991111111" },
    { name: "Marcos Silva", phone: "5562992222222" },
  ], { name: "Marcos" });
  assert.equal(result.kind, "ambiguous");
  if (result.kind === "ambiguous") assert.equal(result.contacts.length, 2);
});

test("formata resumo e não transforma sugestão em envio", () => {
  const text = formatConversationInsight("Maria", {
    momento: "Aguardando retorno sobre a visita.",
    resumo: "Maria gostou do imóvel e pediu disponibilidade para sábado.",
    pontos_chave: ["Interesse no apartamento do Centro", "Prefere visita pela manhã"],
    pendencia: "Confirmar o horário.",
    proximo_passo: "Oferecer dois horários no sábado.",
    follow_up: "Oi Maria, consigo te receber sábado às 9h ou às 11h. Qual horário fica melhor?",
  });
  assert.match(text, /\*Resumo da conversa — Maria\*/);
  assert.match(text, /\*Modelo de follow-up:\*/);
  assert.match(text, /envie esse follow-up/);
  assert.doesNotMatch(text, /mensagem enviada/i);
});

test("limita respostas extensas da IA sem perder um resumo válido", () => {
  const insight = normalizeConversationInsight({
    momento: `Aguardando retorno. ${"detalhe ".repeat(50)}`,
    resumo: "Cliente interessado no imóvel.",
    pontos_chave: Array.from({ length: 8 }, (_, index) => `Ponto ${index + 1}`),
    pendencia: "Confirmar data da visita.",
    proximo_passo: "Oferecer dois horários.",
    follow_up: `Oi! ${"mensagem ".repeat(200)}`,
  });

  assert.equal(insight.momento.length, 240);
  assert.equal(insight.pontos_chave.length, 5);
  assert.equal(insight.follow_up?.length, 1_200);
});

test("WhatsApp Pai usa consulta real, permissão e contexto não confiável", async () => {
  const [agent, insight, guardrails] = await Promise.all([
    readFile(new URL("../server/services/agent.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/services/conversationInsights.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/security/agentGuardrails.ts", import.meta.url), "utf8"),
  ]);
  assert.match(agent, /summarizeConversationWithFollowup/);
  assert.match(agent, /summarize_conversation: \{ module: "conversas", action: "visualizar" \}/);
  assert.match(agent, /Trazer um modelo de follow-up não autoriza o envio/);
  assert.match(insight, /imf_conversation_messages/);
  assert.match(insight, /\.eq\("ticket_id", ticket\.id\)/);
  assert.match(insight, /buildUntrustedContextMessage/);
  assert.match(insight, /hasPermission\(userId, brokerId, "conversas", "gerenciar"\)/);
  assert.match(insight, /follow_up=null/);
  assert.match(guardrails, /"summarize_conversation"/);
});
