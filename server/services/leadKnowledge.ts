import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────────────────
// O que a IA sabe sobre a pessoa — e o que ela apenas supôs.
//
// A separação entre FATO e HIPÓTESE é o coração deste módulo. No caso real que
// motivou tudo isto, o cliente escreveu "eu morou balneário moço" e a IA tratou
// como fato que ele queria comprar em Balneário Camboriú — e ofereceu um imóvel
// de R$ 6 milhões. Com hipótese registrada como hipótese, a conversa seguinte
// começa com "isso ainda não está confirmado", e a IA pergunta.
//
// Regra de mesclagem: informação nova nunca APAGA informação anterior. Só
// substitui quando traz valor; e confirmar um campo elimina as hipóteses sobre
// ele.
// ─────────────────────────────────────────────────────────────────────────

interface LeadHypothesis {
  campo: string;
  valor: string;
  evidencia: string;
  em: string;
}

export interface LeadKnowledge {
  broker_id: string;
  phone: string;
  nome: string | null;
  /** Nome do perfil do WhatsApp — serve para se dirigir à pessoa, não é cadastro. */
  nome_whatsapp: string | null;
  finalidade: string | null;
  regiao: string | null;
  tipo: string | null;
  quartos: number | null;
  orcamento_min_cents: number | null;
  orcamento_max_cents: number | null;
  diferenciais: string[];
  imovel_interesse: string | null;
  observacoes: string | null;
  hipoteses: LeadHypothesis[];
  resumo: string | null;
  mensagens: number;
  primeira_interacao: string | null;
  ultima_interacao: string | null;
}

export interface LeadKnowledgePatch {
  nome?: string | null;
  finalidade?: string | null;
  regiao?: string | null;
  tipo?: string | null;
  quartos?: number | null;
  orcamento_min_cents?: number | null;
  orcamento_max_cents?: number | null;
  diferenciais?: string[] | null;
  imovel_interesse?: string | null;
  observacao?: string | null;
  resumo?: string | null;
  hipotese?: { campo: string; valor: string; evidencia: string } | null;
}

const MAX_HYPOTHESES = 8;
const MAX_FEATURES = 12;
const MAX_NOTES_CHARS = 2000;

// Ordem em que um corretor bom descobre as coisas: para quê, onde, que tipo,
// tamanho e só então dinheiro. A IA usa isso para escolher a PRÓXIMA pergunta
// em vez de aplicar um questionário.
const FIELD_PRIORITY: { campo: keyof LeadKnowledge; rotulo: string }[] = [
  { campo: "finalidade", rotulo: "comprar ou alugar" },
  { campo: "regiao", rotulo: "região" },
  { campo: "tipo", rotulo: "tipo de imóvel" },
  { campo: "quartos", rotulo: "quantos quartos" },
  { campo: "orcamento_max_cents", rotulo: "faixa de valor" },
  { campo: "nome", rotulo: "nome" },
];

export function emptyKnowledge(brokerId: string, phone: string): LeadKnowledge {
  return {
    broker_id: brokerId, phone,
    nome: null, nome_whatsapp: null, finalidade: null, regiao: null, tipo: null, quartos: null,
    orcamento_min_cents: null, orcamento_max_cents: null,
    diferenciais: [], imovel_interesse: null, observacoes: null,
    hipoteses: [], resumo: null, mensagens: 0,
    primeira_interacao: null, ultima_interacao: null,
  };
}

function cleanString(value: unknown, max = 300): string | null {
  if (value === null || value === undefined) return null;
  // n8n/$fromAI às vezes deixa vazar um "=" na frente do valor resolvido.
  const text = String(value).replace(/^=+/, "").trim().slice(0, max);
  return text || null;
}

function cleanNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/**
 * Mescla o que já se sabia com o que a IA acabou de apurar. Puro de propósito:
 * é a regra mais fácil de errar de todo o módulo (apagar o que já se sabia) e
 * a mais fácil de testar isolada.
 */
export function mergeLeadKnowledge(
  current: LeadKnowledge,
  patch: LeadKnowledgePatch,
  now = new Date().toISOString(),
): LeadKnowledge {
  const next: LeadKnowledge = { ...current, diferenciais: [...current.diferenciais], hipoteses: [...current.hipoteses] };

  const scalars: [keyof LeadKnowledgePatch, keyof LeadKnowledge, "texto" | "numero"][] = [
    ["nome", "nome", "texto"],
    ["finalidade", "finalidade", "texto"],
    ["regiao", "regiao", "texto"],
    ["tipo", "tipo", "texto"],
    ["imovel_interesse", "imovel_interesse", "texto"],
    ["resumo", "resumo", "texto"],
    ["quartos", "quartos", "numero"],
    ["orcamento_min_cents", "orcamento_min_cents", "numero"],
    ["orcamento_max_cents", "orcamento_max_cents", "numero"],
  ];

  const confirmados: string[] = [];
  for (const [from, to, kind] of scalars) {
    const incoming = kind === "texto" ? cleanString(patch[from]) : cleanNumber(patch[from]);
    if (incoming === null) continue; // ausente ou vazio nunca apaga o que já se sabia
    (next as any)[to] = incoming;
    confirmados.push(String(to));
  }

  if (patch.diferenciais?.length) {
    const merged = new Set(next.diferenciais);
    for (const item of patch.diferenciais) {
      const clean = cleanString(item, 40);
      if (clean) merged.add(clean.toLowerCase());
    }
    next.diferenciais = [...merged].slice(0, MAX_FEATURES);
  }

  const observacao = cleanString(patch.observacao, 500);
  if (observacao) {
    const combined = next.observacoes ? `${next.observacoes}\n• ${observacao}` : `• ${observacao}`;
    // Guarda o FIM: o contexto recente vale mais que o começo da conversa.
    next.observacoes = combined.length > MAX_NOTES_CHARS ? combined.slice(-MAX_NOTES_CHARS) : combined;
  }

  if (patch.hipotese) {
    const campo = cleanString(patch.hipotese.campo, 40);
    const valor = cleanString(patch.hipotese.valor, 120);
    const evidencia = cleanString(patch.hipotese.evidencia, 240);
    if (campo && valor) {
      next.hipoteses = [
        { campo, valor, evidencia: evidencia || "não informada", em: now },
        ...next.hipoteses.filter((h) => h.campo !== campo),
      ].slice(0, MAX_HYPOTHESES);
    }
  }

  // Campo confirmado nesta rodada mata a hipótese sobre ele — senão o palpite
  // antigo continuaria aparecendo depois de o cliente já ter respondido.
  if (confirmados.length) {
    next.hipoteses = next.hipoteses.filter((h) => !confirmados.includes(h.campo));
  }

  next.ultima_interacao = now;
  return next;
}

/** O que ainda falta descobrir, na ordem em que vale a pena perguntar. */
export function missingFields(knowledge: LeadKnowledge): string[] {
  return FIELD_PRIORITY.filter(({ campo }) => {
    const value = knowledge[campo];
    return value === null || value === undefined || value === "";
  }).map(({ rotulo }) => rotulo);
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function fromRow(row: any, brokerId: string, phone: string): LeadKnowledge {
  const base = emptyKnowledge(brokerId, phone);
  if (!row) return base;
  return {
    ...base,
    ...row,
    diferenciais: Array.isArray(row.diferenciais) ? row.diferenciais : [],
    hipoteses: Array.isArray(row.hipoteses) ? row.hipoteses : [],
  };
}

export async function readLeadKnowledge(brokerId: string, phone: string): Promise<LeadKnowledge> {
  const { data } = await supabase
    .from("imf_lead_knowledge")
    .select("*")
    .eq("broker_id", brokerId)
    .eq("phone", phone)
    .maybeSingle();
  return fromRow(data, brokerId, phone);
}

export async function saveLeadKnowledge(
  brokerId: string,
  phone: string,
  patch: LeadKnowledgePatch,
): Promise<LeadKnowledge> {
  const current = await readLeadKnowledge(brokerId, phone);
  const now = new Date().toISOString();
  const next = mergeLeadKnowledge(current, patch, now);

  const { error } = await supabase.from("imf_lead_knowledge").upsert({
    broker_id: brokerId,
    phone,
    nome: next.nome,
    finalidade: next.finalidade,
    regiao: next.regiao,
    tipo: next.tipo,
    quartos: next.quartos,
    orcamento_min_cents: next.orcamento_min_cents,
    orcamento_max_cents: next.orcamento_max_cents,
    diferenciais: next.diferenciais,
    imovel_interesse: next.imovel_interesse,
    observacoes: next.observacoes,
    hipoteses: next.hipoteses,
    resumo: next.resumo,
    mensagens: (current.mensagens || 0) + 1,
    ultima_interacao: now,
    updated_at: now,
  }, { onConflict: "broker_id,phone" });
  if (error) throw error;

  return next;
}
