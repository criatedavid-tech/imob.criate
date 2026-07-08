import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";

// ─────────────────────────────────────────────────────────────────────────
// O CÉREBRO REAL (Etapa 13 do UX_MASTERPLAN.md)
// A command bar deixa de ser mock: um agente Gemini lê o estado real da conta
// do corretor e responde/age em linguagem natural sobre os endpoints que já
// existem. A autonomia (Etapa 12) governa de verdade: piloto executa na hora,
// copiloto/manual só propõem e esperam confirmação.
// ─────────────────────────────────────────────────────────────────────────

export type Autonomy = "piloto" | "copiloto" | "manual";

export interface AgentAction {
  type: "answer" | "navigate" | "create_lead" | "create_visit";
  area?: string;
  // create_lead / create_visit
  name?: string;
  phone?: string;
  property_id?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
}

export interface AgentResult {
  reply: string;
  navigate?: string;
  executed?: string;          // resumo do que foi feito (piloto)
  proposedAction?: AgentAction; // precisa de confirmação (copiloto/manual)
  refresh?: boolean;          // pede pro front recarregar a área atual
}

// Áreas navegáveis por persona (espelha engine.ts no front — mantém as duas em sincronia).
const AREAS_BY_PERSONA: Record<string, string[]> = {
  corretor:      ["hoje", "conversas", "carteira", "negocios", "agenda", "divulgacao", "relatorios", "config"],
  imobiliaria:   ["hoje", "conversas", "carteira", "negocios", "agenda", "locacao", "financeiro", "equipe", "divulgacao", "relatorios", "config"],
  incorporadora: ["hoje", "conversas", "carteira", "negocios", "agenda", "lancamentos", "financeiro", "equipe", "divulgacao", "relatorios", "config"],
};

interface Snapshot {
  brokerName: string;
  properties: { id: string; title: string; price: string; status: string }[];
  leadCounts: Record<string, number>;
  leadsTotal: number;
  upcomingVisits: { when: string; who: string }[];
  activeRentals: number;
}

async function buildSnapshot(brokerId: string): Promise<Snapshot> {
  const [{ data: broker }, { data: props }] = await Promise.all([
    supabase.from("imf_brokers").select("name").eq("id", brokerId).maybeSingle(),
    supabase.from("imf_properties").select("id, title, price, status").eq("broker_id", brokerId).limit(40),
  ]);

  const propIds = (props || []).map((p: any) => p.id);

  const leadCounts: Record<string, number> = {};
  let leadsTotal = 0;
  if (propIds.length > 0) {
    const { data: leads } = await supabase.from("leads").select("status").in("property_id", propIds);
    for (const l of leads || []) {
      const s = l.status || "new";
      leadCounts[s] = (leadCounts[s] || 0) + 1;
      leadsTotal++;
    }
  }

  const { data: visits } = await supabase
    .from("imf_agenda")
    .select("scheduled_at, client_name")
    .eq("broker_id", brokerId)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(5);

  const { count: activeRentals } = await supabase
    .from("imf_rental_contracts")
    .select("id", { count: "exact", head: true })
    .eq("broker_id", brokerId)
    .eq("status", "ativo");

  return {
    brokerName: broker?.name || "corretor",
    properties: (props || []).map((p: any) => ({ id: p.id, title: p.title, price: p.price, status: p.status || "disponivel" })),
    leadCounts,
    leadsTotal,
    upcomingVisits: (visits || []).map((v: any) => ({
      when: new Date(v.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
      who: v.client_name || "cliente",
    })),
    activeRentals: activeRentals || 0,
  };
}

function buildSystemPrompt(snap: Snapshot, persona: string, autonomy: Autonomy): string {
  const areas = AREAS_BY_PERSONA[persona] || AREAS_BY_PERSONA.corretor;
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const isoHoje = new Date().toISOString().split("T")[0];

  const propsList = snap.properties.length
    ? snap.properties.map((p) => `- id=${p.id} · "${p.title}" · ${p.price} · ${p.status}`).join("\n")
    : "(nenhum imóvel cadastrado)";

  const leadsResumo = snap.leadsTotal
    ? Object.entries(snap.leadCounts).map(([k, v]) => `${k}: ${v}`).join(", ")
    : "nenhum lead ainda";

  const visitasResumo = snap.upcomingVisits.length
    ? snap.upcomingVisits.map((v) => `${v.when} — ${v.who}`).join("; ")
    : "nenhuma visita agendada";

  return `Você é a assistente de IA do ImobiFlow, trabalhando para ${snap.brokerName}, um corretor de imóveis. Você fala português do Brasil, de forma curta, direta e cordial — como um colega de trabalho competente, nunca robótica.

Hoje é ${hoje} (data ISO: ${isoHoje}).

Você conhece o estado REAL da conta e deve responder com base nele, sem inventar números:
- Imóveis na carteira:
${propsList}
- Leads: ${leadsResumo} (total ${snap.leadsTotal})
- Próximas visitas: ${visitasResumo}
- Contratos de locação ativos: ${snap.activeRentals}

Você pode fazer 4 coisas, escolhendo uma no campo action.type:
1. "answer" — responder uma pergunta ou conversar. Use os dados acima. Se não souber, diga que não sabe; nunca invente.
2. "navigate" — levar o corretor até uma área do sistema. Preencha action.area com uma destas: ${areas.join(", ")}. Use quando ele pedir "me mostra X", "abre X", "quero ver X".
3. "create_lead" — cadastrar um lead novo. Precisa de name, phone e property_id (escolha o id do imóvel mais provável da lista acima; se nenhum imóvel combinar ou não houver imóveis, use "answer" pedindo pra ele especificar o imóvel).
4. "create_visit" — agendar uma visita. Precisa de name (cliente), date (YYYY-MM-DD) e time (HH:MM); phone e property_id são opcionais. Resolva datas relativas ("amanhã", "sexta") a partir da data de hoje.

Regras:
- O campo reply é SEMPRE preenchido, em linguagem natural, confirmando o que você entendeu ou respondendo.
- Para create_lead/create_visit, o reply deve resumir a ação em uma frase (ex.: "Vou cadastrar a Maria no Apartamento Centro.").
- phone: pode vir como o corretor falar; não precisa formatar.
- Só use create_lead/create_visit quando o pedido for claramente uma ação de criar. Perguntas são sempre "answer".`;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    action: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ["answer", "navigate", "create_lead", "create_visit"] },
        area: { type: Type.STRING },
        name: { type: Type.STRING },
        phone: { type: Type.STRING },
        property_id: { type: Type.STRING },
        date: { type: Type.STRING },
        time: { type: Type.STRING },
      },
      required: ["type"],
    },
  },
  required: ["reply", "action"],
};

// Executa uma ação de mutação, revalidando que o imóvel é do corretor.
export async function executeAction(brokerId: string, action: AgentAction): Promise<{ summary: string; navigate?: string }> {
  if (action.type === "create_lead") {
    if (!action.name || !action.phone) throw new Error("Nome e telefone são obrigatórios pra cadastrar o lead.");
    if (!action.property_id) throw new Error("Preciso saber a qual imóvel esse lead está ligado.");
    // valida posse do imóvel
    const { data: prop } = await supabase.from("imf_properties").select("id, title").eq("id", action.property_id).eq("broker_id", brokerId).maybeSingle();
    if (!prop) throw new Error("Imóvel não encontrado na sua carteira.");
    const { error } = await supabase.from("leads").insert({
      property_id: action.property_id,
      name: action.name,
      phone: normalizePhoneBR(action.phone),
      status: "new",
      notes: "Criado pela assistente de IA",
      created_at: new Date(),
    });
    if (error) throw error;
    return { summary: `Lead ${action.name} cadastrado em "${prop.title}".`, navigate: "negocios" };
  }

  if (action.type === "create_visit") {
    if (!action.name) throw new Error("Preciso do nome do cliente pra agendar a visita.");
    if (!action.date || !action.time) throw new Error("Preciso da data e do horário da visita.");
    let propertyId: string | null = null;
    if (action.property_id) {
      const { data: prop } = await supabase.from("imf_properties").select("id").eq("id", action.property_id).eq("broker_id", brokerId).maybeSingle();
      propertyId = prop?.id || null;
    }
    const scheduledAt = new Date(`${action.date}T${action.time}:00`);
    if (isNaN(scheduledAt.getTime())) throw new Error("Não consegui entender a data/horário da visita.");
    const { error } = await supabase.from("imf_agenda").insert({
      broker_id: brokerId,
      property_id: propertyId,
      client_name: action.name,
      client_phone: action.phone ? normalizePhoneBR(action.phone) : null,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: 60,
      status: "pendente",
      source: "ia",
    });
    if (error) throw error;
    const quando = scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return { summary: `Visita com ${action.name} agendada para ${quando}.`, navigate: "agenda" };
  }

  throw new Error("Ação não executável.");
}

// JSON Schema equivalente ao responseSchema (Gemini), pro modo json_object do
// OpenRouter — que não valida schema, só garante JSON válido, então o formato
// exato também é reforçado em texto no fim do system prompt (ver buildSystemPrompt).
const JSON_SHAPE_HINT = `Responda SEMPRE em JSON válido, exatamente neste formato:
{"reply": "string", "action": {"type": "answer|navigate|create_lead|create_visit", "area"?: "string", "name"?: "string", "phone"?: "string", "property_id"?: "string", "date"?: "string", "time"?: "string"}}`;

async function callGemini(apiKey: string, systemPrompt: string, message: string): Promise<{ reply: string; action: AgentAction }> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    // Mesmo modelo do enhance-text (server/routes/ai.ts), já comprovado em
    // produção com esta chave — evita divergência de cota entre features.
    model: "gemini-2.0-flash-lite",
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.3,
    },
    contents: message,
  });
  return JSON.parse(response.text || "{}");
}

async function callOpenRouter(apiKey: string, systemPrompt: string, message: string): Promise<{ reply: string; action: AgentAction }> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://imobiflow.fly.dev",
      "X-Title": "ImobiFlow",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${JSON_SHAPE_HINT}` },
        { role: "user", content: message },
      ],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${resp.status}`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta vazia do OpenRouter.");
  return JSON.parse(content);
}

export async function runAgent(opts: {
  brokerId: string;
  message: string;
  persona: string;
  autonomy: Autonomy;
}): Promise<AgentResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const hasGemini = !!geminiKey && geminiKey.length >= 10;
  const hasOpenRouter = !!openRouterKey && openRouterKey.startsWith("sk-or-");
  if (!hasGemini && !hasOpenRouter) {
    return { reply: "A assistente de IA não está configurada no servidor (falta a chave da IA)." };
  }

  const snap = await buildSnapshot(opts.brokerId);
  const systemPrompt = buildSystemPrompt(snap, opts.persona, opts.autonomy);

  let parsed: { reply: string; action: AgentAction };
  try {
    // Gemini é preferido quando configurado (é o que roda em produção hoje);
    // OpenRouter é o caminho alternativo — usado quando não há chave Gemini
    // com cota, sem exigir nenhuma mudança em produção.
    if (hasGemini) {
      parsed = await callGemini(geminiKey!, systemPrompt, opts.message);
    } else {
      parsed = await callOpenRouter(openRouterKey!, systemPrompt, opts.message);
    }
  } catch (err: any) {
    const msg = String(err?.message || "");
    console.error(`[Agent] erro ${hasGemini ? "Gemini" : "OpenRouter"}:`, msg);

    // Gemini com cota estourada e OpenRouter configurado como plano B → tenta.
    if (hasGemini && hasOpenRouter && (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("resource_exhausted"))) {
      try {
        parsed = await callOpenRouter(openRouterKey!, systemPrompt, opts.message);
      } catch (err2: any) {
        console.error("[Agent] erro OpenRouter (fallback):", err2.message);
        return { reply: "Tive um problema pra pensar nisso agora. Pode tentar de novo?" };
      }
    } else if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("resource_exhausted")) {
      // Cota/limite é um estado operacional, não um bug — mensagem honesta e
      // distinta pra você saber que é a chave da IA, não o código.
      return { reply: "A IA atingiu o limite de uso da chave configurada. Verifique o plano/cota da chave do servidor." };
    } else {
      return { reply: "Tive um problema pra pensar nisso agora. Pode tentar de novo?" };
    }
  }

  const action = parsed.action || { type: "answer" };
  const reply = parsed.reply || "Certo.";

  // answer e navigate nunca são mutação — seguem direto, autonomia não se aplica.
  if (action.type === "answer") return { reply };
  if (action.type === "navigate") {
    const areas = AREAS_BY_PERSONA[opts.persona] || AREAS_BY_PERSONA.corretor;
    const area = areas.includes(action.area || "") ? action.area : undefined;
    return { reply, navigate: area };
  }

  // create_lead / create_visit são mutações — a autonomia decide.
  if (opts.autonomy === "piloto") {
    try {
      const { summary, navigate } = await executeAction(opts.brokerId, action);
      return { reply, executed: summary, navigate, refresh: true };
    } catch (err: any) {
      return { reply: `${reply}\n\nMas não consegui concluir: ${err.message}` };
    }
  }

  // copiloto / manual: propõe e espera confirmação.
  return { reply, proposedAction: action };
}
