import express from "express";
import { supabase } from "../supabase";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nInternalLimiter } from "../middleware/rateLimits";
import { normalizePhoneBR } from "../lib/crypto";
import { sendUazapiText } from "../services/uazapi";
import { getBrokerCatalog, getCatalogEntry } from "../services/propertyCatalog";
import {
  searchCatalog, toAgentProperty, summarizeCatalog, formatCents,
  type SearchCriteria, type PropertyKind, type Purpose,
} from "../services/propertyCatalogCore";
import {
  readLeadKnowledge, saveLeadKnowledge, missingFields,
  type LeadKnowledgePatch,
} from "../services/leadKnowledge";

// ─────────────────────────────────────────────────────────────────────────
// Ferramentas do agente de vendas — os "olhos e mãos" que faltavam.
//
// Antes, o catálogo inteiro era despejado no prompt a cada mensagem (~10 mil
// tokens, a maior parte URLs de imagem) e o agente não tinha como PROCURAR
// nada: ele só podia opinar sobre o bloco que recebeu. Sem poder consultar,
// ele preenchia lacuna com invenção — foi assim que ofereceu um imóvel de
// R$ 6 milhões para quem tinha perguntado por uma casa em outra cidade.
//
// Duas decisões de projeto que sustentam o resto:
//
// 1. NENHUMA rota aqui responde erro. Elas ficam no caminho crítico de uma
//    conversa ao vivo; um 500 derruba a execução do n8n e o cliente fica sem
//    resposta. Falha vira `ok:false` com uma orientação em português.
//
// 2. Toda resposta traz um campo `orientacao`: uma instrução curta calculada
//    pelo BACKEND a partir do resultado real. Política que mora só no prompt
//    o modelo esquece no meio de uma conversa longa; política que chega junto
//    do dado, segundos antes de ele responder, ele obedece.
// ─────────────────────────────────────────────────────────────────────────

export const salesAgentRouter = express.Router();

const clean = (value: unknown, max = 200): string => String(value ?? "").replace(/^=+/, "").trim().slice(0, max);

function reaisToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  // A IA manda em reais ("400000"), o catálogo compara em centavos.
  return Math.round(n * 100);
}

function asKind(value: unknown): PropertyKind | null {
  const v = clean(value, 20).toLowerCase();
  if (v.startsWith("casa") || v.startsWith("sobrado")) return "casa";
  if (v.startsWith("ap") || v.startsWith("flat") || v.startsWith("cobertura")) return "apartamento";
  if (v.startsWith("comercial") || v.startsWith("sala") || v.startsWith("loja") || v.startsWith("galp")) return "comercial";
  if (v.startsWith("terreno") || v.startsWith("lote")) return "terreno";
  return null;
}

function asPurpose(value: unknown): Purpose | null {
  const v = clean(value, 20).toLowerCase();
  if (v.startsWith("compr") || v.startsWith("vend")) return "venda";
  if (v.startsWith("alug") || v.startsWith("loca")) return "aluguel";
  return null;
}

function asList(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map((v) => clean(v, 40)).filter(Boolean);
  const text = clean(value, 240);
  if (!text) return null;
  return text.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
}

// ─── Buscar imóveis ─────────────────────────────────────────────────────────
salesAgentRouter.post("/api/imoveis/n8n/buscar", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = clean(req.body?.broker_id, 60);
    if (!brokerId) {
      return res.json({ ok: false, orientacao: "Não consegui consultar o catálogo agora. Não invente imóveis: diga que vai confirmar e siga a conversa." });
    }

    const criteria: SearchCriteria = {
      finalidade: asPurpose(req.body?.finalidade),
      regiao: clean(req.body?.regiao, 120) || null,
      tipo: asKind(req.body?.tipo),
      quartosMin: req.body?.quartos_min ? Number(String(req.body.quartos_min).replace(/\D/g, "")) || null : null,
      precoMinCents: reaisToCents(req.body?.preco_min),
      precoMaxCents: reaisToCents(req.body?.preco_max),
      diferenciais: asList(req.body?.diferenciais),
      limite: Number(req.body?.limite) || 3,
    };

    const entries = await getBrokerCatalog(brokerId);
    if (!entries.length) {
      return res.json({
        ok: true,
        catalogo: { total: 0 },
        encontrou: false,
        imoveis: [],
        orientacao: "Este corretor ainda não tem imóvel disponível cadastrado. Diga isso com honestidade, pergunte o que a pessoa procura e ofereça avisar quando entrar algo. NÃO invente imóvel.",
      });
    }

    const result = searchCatalog(entries, criteria);
    const imoveis = result.resultados.map(toAgentProperty);
    const temIncerteza = result.resultados.some((h) => h.entry.camposIncertos.length > 0);

    const orientacao: string[] = [];
    if (result.encontrouExatos) {
      orientacao.push(
        imoveis.length > 1
          ? "Apresente APENAS o primeiro imóvel, em mensagem curta. Guarde os outros para o caso de a pessoa querer mais uma opção."
          : "Apresente este imóvel em mensagem curta.",
      );
    } else if (result.gargalos.length) {
      orientacao.push(
        `Você NÃO tem nada que atenda: ${result.gargalos.join(", ")}. Diga isso claramente ANTES de sugerir alternativa — não empurre o que não foi pedido.`,
      );
      orientacao.push("Se apresentar uma alternativa, avise na mesma frase o que nela não bate com o pedido.");
    } else {
      orientacao.push("Nenhum imóvel atende a tudo que foi pedido. Diga o que não bate em cada opção antes de apresentá-la.");
    }
    if (temIncerteza) {
      orientacao.push("Campos em `dados_incertos` estão faltando ou contraditórios no cadastro: NÃO afirme esses números. Se a pessoa perguntar, diga que confirma com o corretor.");
    }

    res.json({
      ok: true,
      catalogo: summarizeCatalog(entries),
      encontrou: result.encontrouExatos,
      nada_exato: !result.encontrouExatos,
      o_que_nao_tenho: result.gargalos,
      imoveis,
      orientacao: orientacao.join(" "),
    });
  } catch (err: any) {
    console.error("Erro POST /api/imoveis/n8n/buscar (degradando):", err?.message);
    res.json({ ok: false, orientacao: "A consulta ao catálogo falhou agora. NÃO invente imóveis: diga que vai confirmar a disponibilidade e continue entendendo o que a pessoa procura." });
  }
});

// ─── Detalhar um imóvel ─────────────────────────────────────────────────────
salesAgentRouter.post("/api/imoveis/n8n/detalhar", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = clean(req.body?.broker_id, 60);
    const imovelId = clean(req.body?.imovel_id, 60);
    if (!brokerId || !imovelId) return res.json({ ok: false, orientacao: "Não consegui abrir a ficha do imóvel." });

    const entry = await getCatalogEntry(brokerId, imovelId);
    if (!entry) {
      return res.json({
        ok: false,
        orientacao: "Esse imóvel não está mais disponível ou não é deste corretor. Não fale dele como se estivesse à venda — busque outra opção.",
      });
    }

    res.json({
      ok: true,
      imovel: {
        id: entry.id,
        titulo: entry.titulo,
        local: entry.local || "(não informado)",
        preco: entry.precoTexto ?? "(não informado)",
        ...(entry.tipoConfiavel && entry.tipo !== "indefinido" ? { tipo: entry.tipo } : {}),
        ...(entry.quartos !== null ? { quartos: entry.quartos } : {}),
        ...(entry.banheiros !== null ? { banheiros: entry.banheiros } : {}),
        ...(entry.areaM2 !== null ? { area_m2: entry.areaM2 } : {}),
        ...(entry.vagas ? { vagas_garagem: entry.vagas } : {}),
        destaques: entry.destaques,
        descricao: entry.resumo,
        link: entry.linkPublico,
        fotos: entry.qtdFotos,
        dados_incertos: entry.camposIncertos,
      },
      orientacao: entry.camposIncertos.length
        ? `Estes campos não estão confiáveis no cadastro: ${entry.camposIncertos.join(", ")}. Não afirme esses números — diga que confirma com o corretor.`
        : "Responda só o que a pessoa perguntou sobre este imóvel. Não recite a ficha inteira.",
    });
  } catch (err: any) {
    console.error("Erro POST /api/imoveis/n8n/detalhar (degradando):", err?.message);
    res.json({ ok: false, orientacao: "Não consegui abrir a ficha agora. Diga que confirma o detalhe e siga a conversa." });
  }
});

// ─── O que já sei desta pessoa ──────────────────────────────────────────────
salesAgentRouter.post("/api/crm/n8n/lead", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = clean(req.body?.broker_id, 60);
    const phone = normalizePhoneBR(clean(req.body?.phone, 30));
    if (!brokerId || !phone) return res.json({ ok: false, primeira_conversa: true, orientacao: "Trate como primeira conversa." });

    const knowledge = await readLeadKnowledge(brokerId, phone);
    const falta = missingFields(knowledge);

    const [{ data: visitas }, { data: lead }] = await Promise.all([
      supabase
        .from("imf_agenda")
        .select("id, scheduled_at, status, title")
        .eq("broker_id", brokerId)
        .eq("client_phone", phone)
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(3),
      supabase
        .from("leads")
        .select("id, name, status, property_id")
        .eq("broker_id", brokerId)
        .eq("phone", phone)
        .maybeSingle(),
    ]);

    const jaConversou = (knowledge.mensagens || 0) > 0;
    const orientacao: string[] = [];
    if (!jaConversou) {
      orientacao.push("É a primeira conversa com esta pessoa. Não presuma nada sobre ela.");
    } else {
      orientacao.push("Você já falou com esta pessoa: NÃO repita as perguntas cujas respostas estão em `sei`, e não se apresente de novo.");
    }
    if (knowledge.hipoteses.length) {
      orientacao.push("O que está em `apenas_suposicoes` NÃO foi confirmado por ela. Confirme antes de usar como verdade.");
    }
    if (falta.length) {
      orientacao.push(`Ainda não sabe: ${falta.join(", ")}. Descubra o próximo item que fizer sentido na conversa — uma pergunta por vez, nunca uma lista.`);
    }

    res.json({
      ok: true,
      primeira_conversa: !jaConversou,
      sei: {
        nome: knowledge.nome,
        finalidade: knowledge.finalidade,
        regiao: knowledge.regiao,
        tipo: knowledge.tipo,
        quartos: knowledge.quartos,
        orcamento: knowledge.orcamento_max_cents
          ? `até ${formatCents(knowledge.orcamento_max_cents)}`
          : null,
        diferenciais: knowledge.diferenciais,
        imovel_de_interesse: knowledge.imovel_interesse,
      },
      apenas_suposicoes: knowledge.hipoteses,
      observacoes: knowledge.observacoes,
      resumo_anterior: knowledge.resumo,
      ainda_nao_sei: falta,
      visitas_marcadas: (visitas || []).map((v: any) => ({ id: v.id, quando: v.scheduled_at, status: v.status })),
      lead_no_crm: lead ? { id: lead.id, nome: lead.name, etapa: lead.status } : null,
      orientacao: orientacao.join(" "),
    });
  } catch (err: any) {
    console.error("Erro POST /api/crm/n8n/lead (degradando):", err?.message);
    res.json({ ok: false, primeira_conversa: true, orientacao: "Não consegui recuperar o histórico. Siga a conversa sem presumir nada e pergunte o que precisar." });
  }
});

// ─── Anotar o que aprendeu ──────────────────────────────────────────────────
salesAgentRouter.post("/api/crm/n8n/anotar", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = clean(req.body?.broker_id, 60);
    const phone = normalizePhoneBR(clean(req.body?.phone, 30));
    if (!brokerId || !phone) return res.json({ ok: false });

    // Imóvel de interesse só é aceito se for mesmo deste corretor — nunca
    // confiar em id vindo do modelo (mesmo cuidado de /sync-lead e /agenda).
    let imovelInteresse: string | null = null;
    const imovelId = clean(req.body?.imovel_interesse, 60);
    if (imovelId) {
      const entry = await getCatalogEntry(brokerId, imovelId);
      if (entry) imovelInteresse = entry.id;
    }

    const patch: LeadKnowledgePatch = {
      nome: clean(req.body?.nome, 120) || null,
      finalidade: asPurpose(req.body?.finalidade),
      regiao: clean(req.body?.regiao, 120) || null,
      tipo: asKind(req.body?.tipo),
      quartos: req.body?.quartos ? Number(String(req.body.quartos).replace(/\D/g, "")) || null : null,
      orcamento_min_cents: reaisToCents(req.body?.orcamento_min),
      orcamento_max_cents: reaisToCents(req.body?.orcamento_max),
      diferenciais: asList(req.body?.diferenciais),
      imovel_interesse: imovelInteresse,
      observacao: clean(req.body?.observacao, 500) || null,
      resumo: clean(req.body?.resumo, 600) || null,
    };

    const campoHipotese = clean(req.body?.hipotese_campo, 40);
    const valorHipotese = clean(req.body?.hipotese_valor, 120);
    if (campoHipotese && valorHipotese) {
      patch.hipotese = {
        campo: campoHipotese,
        valor: valorHipotese,
        evidencia: clean(req.body?.hipotese_evidencia, 240) || "não informada",
      };
    }

    const saved = await saveLeadKnowledge(brokerId, phone, patch);
    res.json({ ok: true, ainda_nao_sei: missingFields(saved) });
  } catch (err: any) {
    console.error("Erro POST /api/crm/n8n/anotar (degradando):", err?.message);
    res.json({ ok: false });
  }
});

// ─── Passar para uma pessoa ─────────────────────────────────────────────────
salesAgentRouter.post("/api/crm/n8n/transferir", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = clean(req.body?.broker_id, 60);
    const phone = normalizePhoneBR(clean(req.body?.phone, 30));
    const motivo = clean(req.body?.motivo, 300) || "não informado";
    if (!brokerId || !phone) return res.json({ ok: false });

    // Cala a IA nesta conversa — mesmo mecanismo do handover manual, para não
    // haver dois "atendentes" respondendo a mesma pessoa.
    await supabase
      .from("imf_conversation_tickets")
      .update({ ai_active: false, human_takeover_at: new Date().toISOString() })
      .eq("broker_id", brokerId)
      .eq("customer_phone", phone)
      .in("conversation_status", ["open", "pending"]);

    const { data: broker } = await supabase
      .from("imf_brokers")
      .select("notification_phone, uazapi_instance_token")
      .eq("id", brokerId)
      .maybeSingle();

    if (broker?.notification_phone && broker?.uazapi_instance_token) {
      const knowledge = await readLeadKnowledge(brokerId, phone).catch(() => null);
      const quem = knowledge?.nome ? `${knowledge.nome} (${phone})` : phone;
      await sendUazapiText(
        broker.uazapi_instance_token,
        broker.notification_phone,
        `Atendimento precisa de você\n\nCliente: ${quem}\nMotivo: ${motivo}\n\nAbra a aba Conversas para assumir.`,
      ).catch(() => null);
    }

    await saveLeadKnowledge(brokerId, phone, { observacao: `Transferido para atendimento humano: ${motivo}` }).catch(() => null);

    res.json({
      ok: true,
      orientacao: "Avise a pessoa, em UMA frase, que alguém da equipe vai continuar daqui. Depois disso não responda mais nada nesta conversa.",
    });
  } catch (err: any) {
    console.error("Erro POST /api/crm/n8n/transferir (degradando):", err?.message);
    res.json({ ok: false, orientacao: "Não consegui transferir. Diga que vai pedir para alguém da equipe entrar em contato." });
  }
});
