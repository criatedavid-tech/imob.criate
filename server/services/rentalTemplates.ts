import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────────────────
// Régua de cobrança: QUAL mensagem sai e EM QUE DIA.
//
// O padrão mora aqui no código, não no banco. Corretor que nunca abriu a tela
// já tem uma régua completa funcionando; a tabela guarda apenas o que ele
// mudou. Isso evita o modo de falha clássico ("a IA não cobrou porque ninguém
// cadastrou as mensagens") e faz "restaurar padrão" ser só apagar a linha.
//
// A mensagem é template com variáveis — o corretor escreve o texto, o backend
// preenche os números. Nenhum valor vem do modelo de IA (ver rentalAgent.ts).
// ─────────────────────────────────────────────────────────────────────────

export type DunningStepKey =
  | "pre_5" | "pre_1" | "due" | "late_1" | "late_3" | "late_7" | "escalated";

export interface LadderStep {
  step: DunningStepKey;
  /** Nome do momento, do jeito que o corretor pensa nele. */
  title: string;
  /** Dias em relação ao vencimento: negativo = antes, 0 = no dia, positivo = atraso. */
  offset_days: number;
  enabled: boolean;
  body: string;
  /** true = está valendo o texto/dia de fábrica (nada foi editado). */
  is_default: boolean;
  /** Limites de dia aceitos para este degrau. */
  min_offset: number;
  max_offset: number;
  /** O último degrau é rede de segurança: não pode ser desligado. */
  can_disable: boolean;
  /** Este degrau entrega a conversa para uma pessoa. */
  hands_over: boolean;
}

type StepBlueprint = Omit<LadderStep, "is_default">;

// A cobrança do mês é gerada 5 dias antes do vencimento (CHARGE_LEAD_DAYS em
// rentalAutopilot.ts). Antes disso não existe boleto/PIX para enviar — por isso
// nenhum lembrete pode ser agendado para antes de D-5.
export const EARLIEST_REMINDER_OFFSET = -5;

const BLUEPRINT: StepBlueprint[] = [
  {
    step: "pre_5",
    title: "Lembrete antecipado",
    offset_days: -5,
    enabled: true,
    min_offset: EARLIEST_REMINDER_OFFSET,
    max_offset: -1,
    can_disable: true,
    hands_over: false,
    body: `Oi, {{nome}}! Tudo bem?

Seu aluguel de {{valor}} vence dia {{vencimento}}. Já deixo aqui pra facilitar.

{{pix}}

{{boleto}}`,
  },
  {
    step: "pre_1",
    title: "Véspera do vencimento",
    offset_days: -1,
    enabled: true,
    min_offset: EARLIEST_REMINDER_OFFSET,
    max_offset: -1,
    can_disable: true,
    hands_over: false,
    body: `Oi, {{nome}}! Passando pra lembrar: o aluguel de {{valor}} vence amanhã ({{vencimento}}).

{{pix}}`,
  },
  {
    step: "due",
    title: "No dia do vencimento",
    offset_days: 0,
    enabled: true,
    min_offset: 0,
    max_offset: 0,
    can_disable: true,
    hands_over: false,
    body: `Oi, {{nome}}! O aluguel de {{valor}} vence hoje. Se já pagou, pode desconsiderar esta mensagem.

{{pix}}`,
  },
  {
    step: "late_1",
    title: "Primeiro aviso de atraso",
    offset_days: 1,
    enabled: true,
    min_offset: 1,
    max_offset: 60,
    can_disable: true,
    hands_over: false,
    body: `Oi, {{nome}}! O aluguel que venceu em {{vencimento}} consta em aberto.

Com multa e juros, o valor atualizado hoje é {{valor}}. Se já pagou ou precisar de ajuda, é só me responder por aqui.

{{pix}}`,
  },
  {
    step: "late_3",
    title: "Cobrança pedindo uma data",
    offset_days: 3,
    enabled: true,
    min_offset: 1,
    max_offset: 60,
    can_disable: true,
    hands_over: false,
    body: `Oi, {{nome}}! O aluguel de {{vencimento}} segue em aberto ({{dias_atraso}} dias).

Valor atualizado: {{valor}}. Consegue me dizer uma data pra regularizar?

{{pix}}`,
  },
  {
    step: "late_7",
    title: "Cobrança firme",
    offset_days: 7,
    enabled: true,
    min_offset: 1,
    max_offset: 90,
    can_disable: true,
    hands_over: false,
    body: `Oi, {{nome}}! Ainda não localizamos o pagamento do aluguel de {{vencimento}}.

Hoje o valor atualizado está em {{valor}}. Me chama por aqui pra combinarmos uma solução.

{{pix}}`,
  },
  {
    step: "escalated",
    title: "Passa para uma pessoa",
    offset_days: 15,
    enabled: true,
    min_offset: 2,
    max_offset: 120,
    can_disable: false,
    hands_over: true,
    body: `Oi, {{nome}}! Sobre o aluguel de {{vencimento}}: vou pedir para um responsável falar com você para resolvermos juntos.`,
  },
];

export const STEP_KEYS: DunningStepKey[] = BLUEPRINT.map((s) => s.step);

// Régua antiga (dias fixos no código). Serve de referência para competências
// que já andaram na régua antes desta tela existir — sem isso, a trava de
// reenvio não saberia em que altura elas pararam.
export const LEGACY_STEP_OFFSETS: Record<string, number> = {
  pre_5: -5, pre_1: -1, due: 0, late_1: 1, late_3: 3, late_7: 7, escalated: 15,
};

// ─── Variáveis ──────────────────────────────────────────────────────────────

export const TEMPLATE_VARIABLES: { key: string; label: string; example: string }[] = [
  { key: "nome", label: "Primeiro nome do inquilino", example: "Marcos" },
  { key: "nome_completo", label: "Nome completo do inquilino", example: "Marcos Almeida" },
  { key: "valor", label: "Valor a pagar hoje (já com multa e juros, se houver atraso)", example: "R$ 2.450,00" },
  { key: "valor_original", label: "Valor do aluguel, sem multa e juros", example: "R$ 2.400,00" },
  { key: "multa", label: "Valor da multa", example: "R$ 48,00" },
  { key: "juros", label: "Valor dos juros até hoje", example: "R$ 2,40" },
  { key: "vencimento", label: "Data de vencimento", example: "10/08/2026" },
  { key: "dias_atraso", label: "Quantos dias de atraso", example: "3" },
  { key: "mes", label: "Mês de referência", example: "agosto/2026" },
  { key: "imovel", label: "Imóvel do contrato", example: "Apartamento 302 — Setor Bueno" },
  { key: "pix", label: "Bloco do PIX copia e cola (some sozinho se não houver PIX)", example: "PIX copia e cola:\n00020126…" },
  { key: "boleto", label: "Bloco do link do boleto (some sozinho se não houver)", example: "Boleto: https://…" },
];

const VALID_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));

export interface RenderContext {
  tenantName: string;
  amountCents: number;
  originalCents: number;
  lateFeeCents: number;
  interestCents: number;
  daysLate: number;
  dueDate: string;
  referenceMonth?: string | null;
  propertyTitle?: string | null;
  pix?: string | null;
  boleto?: string | null;
}

function brl(cents: number): string {
  // O Intl separa "R$" do número com espaço rígido (U+00A0). Em mensagem de
  // WhatsApp isso vira caractere estranho ao copiar/colar — troca por espaço
  // normal para o texto ser exatamente o que se vê na tela.
  return (cents / 100)
    .toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    .replace(/\u00a0/g, " ");
}

function monthLabel(iso?: string | null): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const name = names[Number(m) - 1];
  return name ? `${name}/${y}` : "";
}

/** Lista as variáveis escritas no texto que não existem (para avisar antes de salvar). */
export function unknownVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([\w_]+)\s*\}\}/g)) {
    const key = match[1];
    if (!VALID_KEYS.has(key)) found.add(key);
  }
  return [...found];
}

/**
 * Troca as variáveis pelos valores reais. É a MESMA função usada pelo motor de
 * envio e pela prévia da tela — o corretor vê exatamente o texto que o
 * inquilino vai receber, sem "mais ou menos".
 */
export function renderRentalMessage(body: string, ctx: RenderContext): string {
  const firstName = (ctx.tenantName || "").trim().split(/\s+/)[0] || "";
  const values: Record<string, string> = {
    nome: firstName,
    nome_completo: (ctx.tenantName || "").trim(),
    valor: brl(ctx.amountCents),
    valor_original: brl(ctx.originalCents),
    multa: brl(ctx.lateFeeCents),
    juros: brl(ctx.interestCents),
    vencimento: (ctx.dueDate || "").split("-").reverse().join("/"),
    dias_atraso: String(Math.max(0, ctx.daysLate)),
    mes: monthLabel(ctx.referenceMonth),
    imovel: ctx.propertyTitle || "",
    // Blocos: carregam o próprio rótulo e somem inteiros quando não existem,
    // para não sobrar "PIX copia e cola:" sem código embaixo.
    pix: ctx.pix ? `PIX copia e cola:\n${ctx.pix}` : "",
    boleto: ctx.boleto ? `Boleto: ${ctx.boleto}` : "",
  };

  return (body || "")
    .replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "")
    // Variável vazia no meio da frase não pode deixar espaço duplo nem
    // pontuação órfã ("Oi, !" quando o nome falta).
    .replace(/,\s*([!?.,])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Leitura e escrita da régua ─────────────────────────────────────────────

export async function getRentalLadder(brokerId: string): Promise<LadderStep[]> {
  const { data } = await supabase
    .from("imf_rental_message_templates")
    .select("step, body, offset_days, enabled")
    .eq("broker_id", brokerId);

  const overrides = new Map<string, any>((data || []).map((r: any) => [r.step, r]));
  return BLUEPRINT.map((base) => {
    const row = overrides.get(base.step);
    if (!row) return { ...base, is_default: true };
    return {
      ...base,
      offset_days: Number.isFinite(row.offset_days) ? row.offset_days : base.offset_days,
      enabled: base.can_disable ? row.enabled !== false : true,
      body: typeof row.body === "string" ? row.body : base.body,
      is_default: false,
    };
  });
}

export interface LadderStepInput {
  step: string;
  offset_days?: number;
  enabled?: boolean;
  body?: string;
  /** true = apagar a personalização e voltar ao texto/dia de fábrica. */
  reset?: boolean;
}

/**
 * Grava a régua. Devolve erro em texto simples quando a configuração não faz
 * sentido — dia fora do permitido ou fora de ordem — em vez de aceitar e
 * deixar um degrau inalcançável.
 */
export async function saveRentalLadder(
  brokerId: string,
  input: LadderStepInput[],
): Promise<{ ok: boolean; ladder?: LadderStep[]; error?: string }> {
  const current = await getRentalLadder(brokerId);
  const byStep = new Map(current.map((s) => [s.step, s]));
  const resets: string[] = [];
  const upserts: any[] = [];

  for (const item of input) {
    const base = byStep.get(item.step as DunningStepKey);
    if (!base) return { ok: false, error: `Degrau desconhecido: ${item.step}` };

    if (item.reset) {
      resets.push(item.step);
      byStep.set(base.step, { ...BLUEPRINT.find((b) => b.step === base.step)!, is_default: true });
      continue;
    }

    const offset = item.offset_days === undefined ? base.offset_days : Math.trunc(Number(item.offset_days));
    if (!Number.isFinite(offset) || offset < base.min_offset || offset > base.max_offset) {
      return {
        ok: false,
        error: `"${base.title}": o dia precisa estar entre ${base.min_offset} e ${base.max_offset}.`,
      };
    }

    const body = item.body === undefined ? base.body : String(item.body);
    if (body.length > 1500) return { ok: false, error: `"${base.title}": a mensagem passou de 1500 caracteres.` };
    const unknown = unknownVariables(body);
    if (unknown.length) {
      return { ok: false, error: `"${base.title}": variável inexistente ${unknown.map((u) => `{{${u}}}`).join(", ")}.` };
    }

    const enabled = base.can_disable ? item.enabled !== false : true;
    byStep.set(base.step, { ...base, offset_days: offset, enabled, body, is_default: false });
    upserts.push({ broker_id: brokerId, step: base.step, offset_days: offset, enabled, body, updated_at: new Date().toISOString() });
  }

  // Os dias precisam crescer na ordem da régua; senão um degrau nunca é
  // alcançado (o motor escolhe sempre o maior dia já vencido).
  const merged = STEP_KEYS.map((k) => byStep.get(k)!);
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].offset_days <= merged[i - 1].offset_days) {
      return {
        ok: false,
        error: `"${merged[i].title}" precisa vir depois de "${merged[i - 1].title}". Ajuste os dias em ordem crescente.`,
      };
    }
  }

  if (resets.length) {
    const { error } = await supabase
      .from("imf_rental_message_templates")
      .delete()
      .eq("broker_id", brokerId)
      .in("step", resets);
    if (error) return { ok: false, error: error.message };
  }
  if (upserts.length) {
    const { error } = await supabase
      .from("imf_rental_message_templates")
      .upsert(upserts, { onConflict: "broker_id,step" });
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, ladder: merged };
}
