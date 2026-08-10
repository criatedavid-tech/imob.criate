import { supabase } from "../supabase";
import { CLIENT_FINANCIAL_OPERATIONS_ENABLED } from "../config";
import { sendUazapiText, resolveOutboundInstanceToken } from "./uazapi";
import { generateRentCharge } from "./rentalBilling";
import {
  getRentalLadder,
  renderRentalMessage,
  LEGACY_STEP_OFFSETS,
  EARLIEST_REMINDER_OFFSET,
  type LadderStep,
} from "./rentalTemplates";

// ─────────────────────────────────────────────────────────────────────────
// Piloto automático da locação
//
// Duas engrenagens separadas de propósito:
//  1. GERAÇÃO da cobrança do mês (determinística, sem IA) — D-5 do vencimento.
//  2. RÉGUA de cobrança (mensagens no WhatsApp do inquilino) — D-5 até D+15.
//
// Nada aqui usa IA para decidir valor ou data: a IA só CONVERSA (ver
// server/routes/rentalAgent.ts). Todo número que o inquilino recebe é
// calculado aqui, no backend, a partir do contrato. Essa separação é o que
// impede o erro clássico de agente de cobrança inventar desconto ou juros.
//
// Segurança em camadas — a régua só roda se TUDO abaixo estiver ligado:
//   CLIENT_FINANCIAL_OPERATIONS_ENABLED (global, por env)
//   imf_rental_ai_settings.charge_generation_enabled / dunning_enabled (conta)
//   imf_rental_contracts.autopilot_enabled (contrato)
// Assim dá para pilotar UM contrato antes de liberar a carteira toda.
// ─────────────────────────────────────────────────────────────────────────

const BR_TZ = "America/Sao_Paulo";

export interface RentalAiSettings {
  broker_id: string;
  enabled: boolean;
  charge_generation_enabled: boolean;
  dunning_enabled: boolean;
  can_send_second_copy: boolean;
  can_register_promise: boolean;
  max_promise_days: number;
  can_offer_discount: boolean;
  max_discount_percent: number;
  can_offer_installments: boolean;
  escalate_after_silent_steps: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
}

const DEFAULT_SETTINGS: Omit<RentalAiSettings, "broker_id"> = {
  enabled: false,
  charge_generation_enabled: false,
  dunning_enabled: false,
  can_send_second_copy: true,
  can_register_promise: true,
  max_promise_days: 7,
  can_offer_discount: false,
  max_discount_percent: 0,
  can_offer_installments: false,
  escalate_after_silent_steps: 3,
  quiet_hours_start: 21,
  quiet_hours_end: 8,
};

export async function getRentalAiSettings(brokerId: string): Promise<RentalAiSettings> {
  const { data } = await supabase
    .from("imf_rental_ai_settings")
    .select("*")
    .eq("broker_id", brokerId)
    .maybeSingle();
  return { broker_id: brokerId, ...DEFAULT_SETTINGS, ...(data || {}) } as RentalAiSettings;
}

// ─── Diário do contrato ─────────────────────────────────────────────────────
export async function logRentalEvent(input: {
  brokerId: string;
  contractId: string;
  paymentId?: string | null;
  type: string;
  actor?: "sistema" | "ia" | "humano";
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("imf_rental_events").insert({
    broker_id: input.brokerId,
    contract_id: input.contractId,
    payment_id: input.paymentId || null,
    event_type: input.type,
    actor: input.actor || "sistema",
    description: input.description,
    metadata: input.metadata || {},
  });
  if (error) console.warn("[Locação] falha ao gravar evento:", error.message);
}

// ─── Dinheiro ───────────────────────────────────────────────────────────────
// Multa (percentual fixo, uma vez) + juros (percentual ao mês, pró-rata por
// dia). É a convenção usada em contrato de locação no Brasil e é o cálculo que
// o inquilino confere na calculadora dele — por isso fica explícito e testável,
// nunca dentro de um prompt.
export function computeLateAmount(
  amountCents: number,
  dueDate: string,
  lateFeePercent: number,
  monthlyInterestPercent: number,
  today = new Date(),
): { totalCents: number; lateFeeCents: number; interestCents: number; daysLate: number } {
  const due = new Date(`${dueDate}T00:00:00-03:00`);
  const daysLate = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
  if (daysLate <= 0) {
    return { totalCents: amountCents, lateFeeCents: 0, interestCents: 0, daysLate: 0 };
  }
  const lateFeeCents = Math.round(amountCents * (Number(lateFeePercent) || 0) / 100);
  const dailyRate = (Number(monthlyInterestPercent) || 0) / 100 / 30;
  const interestCents = Math.round(amountCents * dailyRate * daysLate);
  return {
    totalCents: amountCents + lateFeeCents + interestCents,
    lateFeeCents,
    interestCents,
    daysLate,
  };
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function todayInBrasilia(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: BR_TZ }));
}

function isQuietHour(settings: RentalAiSettings): boolean {
  const hour = todayInBrasilia().getHours();
  const { quiet_hours_start: start, quiet_hours_end: end } = settings;
  // Janela cruza a meia-noite (ex.: 21h -> 8h).
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

async function sendToTenant(brokerId: string, phone: string, text: string): Promise<boolean> {
  const token = await resolveOutboundInstanceToken(brokerId, phone);
  if (!token) return false;
  const sent = await sendUazapiText(token, phone, text);
  return sent.ok;
}

// ─── 1) Geração da cobrança do mês ──────────────────────────────────────────
export const CHARGE_LEAD_DAYS = 5;

export async function runRentalChargeGenerationTick(): Promise<void> {
  // A flag global é uma trava de segurança, não apenas um estado visual.
  // Sem esta checagem, flags antigas no banco poderiam gerar cobranças mesmo
  // quando o produto financeiro estivesse desligado no ambiente.
  if (!CLIENT_FINANCIAL_OPERATIONS_ENABLED) return;

  const { data: locked } = await supabase.rpc("try_billing_lock", {
    p_key: "rental_charge_generation",
    p_ttl_seconds: 1800,
  });
  if (!locked) return;

  try {
    const { data: contracts, error } = await supabase
      .from("imf_rental_contracts")
      .select("id, broker_id, due_day, rent_amount_cents, tenant_name, status")
      .eq("status", "ativo")
      .eq("autopilot_enabled", true)
      .limit(500);
    if (error) throw error;
    if (!contracts?.length) return;

    const today = todayInBrasilia();
    const settingsCache = new Map<string, RentalAiSettings>();

    for (const contract of contracts as any[]) {
      try {
        let settings = settingsCache.get(contract.broker_id);
        if (!settings) {
          settings = await getRentalAiSettings(contract.broker_id);
          settingsCache.set(contract.broker_id, settings);
        }
        if (!settings.charge_generation_enabled) continue;

        // Gera quando faltam CHARGE_LEAD_DAYS para o vencimento do mês corrente.
        const dueThisMonth = new Date(today.getFullYear(), today.getMonth(), contract.due_day);
        const daysUntilDue = Math.floor((dueThisMonth.getTime() - today.getTime()) / 86_400_000);
        if (daysUntilDue > CHARGE_LEAD_DAYS || daysUntilDue < -30) continue;

        const referenceMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        // generateRentCharge é idempotente por (contrato, mês de referência):
        // rodar de novo devolve a cobrança existente em vez de duplicar.
        const result = await generateRentCharge(contract.id, referenceMonth);

        await supabase.from("imf_rental_contracts")
          .update({ last_charge_run_at: new Date().toISOString() })
          .eq("id", contract.id);

        await logRentalEvent({
          brokerId: contract.broker_id,
          contractId: contract.id,
          paymentId: result.payment.id,
          type: "cobranca_gerada",
          description: `Cobrança de ${formatBRL(result.payment.amount_cents)} gerada, vence ${result.payment.due_date}.`,
          metadata: { reference_month: referenceMonth.toISOString().slice(0, 10) },
        });
      } catch (e: any) {
        console.error(`[Locação] falha ao gerar cobrança do contrato ${contract.id}:`, e?.message);
        await logRentalEvent({
          brokerId: contract.broker_id,
          contractId: contract.id,
          type: "cobranca_falhou",
          description: `Não foi possível gerar a cobrança: ${String(e?.message || e).slice(0, 200)}`,
        });
      }
    }
  } finally {
    await supabase.rpc("release_billing_lock", { p_key: "rental_charge_generation" });
  }
}

// ─── 2) Régua de cobrança ───────────────────────────────────────────────────
// Cada degrau manda no MÁXIMO uma mensagem. O estado fica na própria
// competência (dunning_step_offset), então reiniciar o processo não reenvia
// nada — e o corretor pode mudar os dias sem risco de a régua "voltar".
//
// Os dias e os textos vêm de rentalTemplates.ts (padrão do código + o que o
// corretor editou na tela). Aqui só se escolhe QUAL degrau se aplica hoje.

/**
 * Degrau vigente = o de maior dia que já passou. Se o robô ficou um dia sem
 * rodar, ele não pula o degrau: manda o que era devido, e só uma vez.
 */
export function pickLadderStep(daysFromDue: number, ladder: LadderStep[]): LadderStep | null {
  let chosen: LadderStep | null = null;
  for (const step of ladder) {
    if (!step.enabled) continue;
    // Degrau sem texto não manda nada — exceto o último, cuja função é
    // entregar para uma pessoa (a mensagem ao inquilino é opcional).
    if (!step.hands_over && !step.body.trim()) continue;
    if (step.offset_days > daysFromDue) continue;
    if (!chosen || step.offset_days > chosen.offset_days) chosen = step;
  }
  return chosen;
}

/** Até onde a competência já andou na régua, em dias. */
export function lastSentOffset(payment: { dunning_step?: string | null; dunning_step_offset?: number | null }): number | null {
  if (typeof payment.dunning_step_offset === "number") return payment.dunning_step_offset;
  if (payment.dunning_step && payment.dunning_step in LEGACY_STEP_OFFSETS) {
    return LEGACY_STEP_OFFSETS[payment.dunning_step];
  }
  return null;
}

export async function runRentalDunningTick(): Promise<void> {
  // A régua nunca pode enviar WhatsApp se a operação financeira de clientes
  // estiver globalmente desligada, ainda que conta e contrato estejam ligados.
  if (!CLIENT_FINANCIAL_OPERATIONS_ENABLED) return;

  const { data: locked } = await supabase.rpc("try_billing_lock", {
    p_key: "rental_dunning",
    p_ttl_seconds: 900,
  });
  if (!locked) return;

  try {
    const today = todayInBrasilia();
    // Alcance da busca = o lembrete mais antecipado que a régua permite.
    const horizonDays = Math.abs(EARLIEST_REMINDER_OFFSET) + 1;
    const horizon = new Date(today.getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10);

    const { data: payments, error } = await supabase
      .from("imf_rental_payments")
      .select("id, contract_id, amount_cents, due_date, status, boleto_url, pix_copy_paste, dunning_step, dunning_step_offset, promise_date, reference_month")
      .in("status", ["pending", "overdue"])
      .lte("due_date", horizon)
      .order("due_date", { ascending: true })
      .limit(300);
    if (error) throw error;
    if (!payments?.length) return;

    const contractCache = new Map<string, any>();
    const settingsCache = new Map<string, RentalAiSettings>();
    const ladderCache = new Map<string, LadderStep[]>();
    const propertyCache = new Map<string, string>();

    for (const payment of payments as any[]) {
      try {
        let contract = contractCache.get(payment.contract_id);
        if (!contract) {
          const { data } = await supabase
            .from("imf_rental_contracts")
            .select("id, broker_id, tenant_name, tenant_phone, autopilot_enabled, status, late_fee_percent, monthly_interest_percent, property_id")
            .eq("id", payment.contract_id)
            .maybeSingle();
          contract = data;
          contractCache.set(payment.contract_id, data);
        }
        if (!contract || !contract.autopilot_enabled || contract.status !== "ativo") continue;
        if (!contract.tenant_phone) continue;

        let settings = settingsCache.get(contract.broker_id);
        if (!settings) {
          settings = await getRentalAiSettings(contract.broker_id);
          settingsCache.set(contract.broker_id, settings);
        }
        if (!settings.dunning_enabled) continue;
        // Cobrança fora de hora é o caminho mais rápido para o número ser
        // denunciado e bloqueado no WhatsApp.
        if (isQuietHour(settings)) continue;

        // Promessa de pagamento registrada: a régua espera a data combinada.
        // Respeitar a palavra do inquilino é o que faz a cobrança parecer
        // humana — e evita cobrar quem já se comprometeu.
        if (payment.promise_date && payment.promise_date >= today.toISOString().slice(0, 10)) continue;

        let ladder = ladderCache.get(contract.broker_id);
        if (!ladder) {
          ladder = await getRentalLadder(contract.broker_id);
          ladderCache.set(contract.broker_id, ladder);
        }

        const daysFromDue = Math.floor(
          (today.getTime() - new Date(`${payment.due_date}T00:00:00-03:00`).getTime()) / 86_400_000,
        );
        const step = pickLadderStep(daysFromDue, ladder);
        if (!step) continue;

        // Já passou por este degrau (ou por um posterior)? Não repete.
        const alreadySent = lastSentOffset(payment);
        if (alreadySent !== null && step.offset_days <= alreadySent) continue;

        const late = computeLateAmount(
          payment.amount_cents,
          payment.due_date,
          contract.late_fee_percent,
          contract.monthly_interest_percent,
          today,
        );

        let propertyTitle = contract.property_id ? propertyCache.get(contract.property_id) : "";
        if (contract.property_id && propertyTitle === undefined) {
          const { data: prop } = await supabase
            .from("imf_properties").select("title").eq("id", contract.property_id).maybeSingle();
          propertyTitle = prop?.title || "";
          propertyCache.set(contract.property_id, propertyTitle);
        }

        const text = renderRentalMessage(step.body, {
          tenantName: contract.tenant_name,
          amountCents: late.daysLate > 0 ? late.totalCents : payment.amount_cents,
          originalCents: payment.amount_cents,
          lateFeeCents: late.lateFeeCents,
          interestCents: late.interestCents,
          daysLate: late.daysLate,
          dueDate: payment.due_date,
          referenceMonth: payment.reference_month,
          propertyTitle,
          pix: payment.pix_copy_paste,
          boleto: payment.boleto_url,
        });

        // Só marca o degrau como vencido depois de a mensagem sair de fato;
        // falha de envio faz o próximo tick tentar de novo o mesmo degrau.
        if (text) {
          const ok = await sendToTenant(contract.broker_id, contract.tenant_phone, text);
          if (!ok) {
            console.warn(`[Locação] envio da régua falhou (contrato ${contract.id}, degrau ${step.step})`);
            continue;
          }
        }

        const reachedAt = new Date().toISOString();
        await supabase.from("imf_rental_payments")
          .update({
            dunning_step: step.step,
            dunning_step_offset: step.offset_days,
            dunning_last_sent_at: reachedAt,
            ...(step.hands_over ? { escalated_at: reachedAt } : {}),
          })
          .eq("id", payment.id);

        if (step.hands_over) {
          await escalateContractToHuman(
            contract,
            payment.id,
            `Aluguel de ${payment.due_date} em aberto há ${late.daysLate} dias (${formatBRL(late.totalCents)}).`,
          );
          continue;
        }

        await logRentalEvent({
          brokerId: contract.broker_id,
          contractId: contract.id,
          paymentId: payment.id,
          type: "cobranca_enviada",
          actor: "sistema",
          description: `Mensagem de cobrança enviada (${step.title}) — ${formatBRL(late.daysLate > 0 ? late.totalCents : payment.amount_cents)}.`,
          metadata: { step: step.step, offset_days: step.offset_days, days_late: late.daysLate },
        });
      } catch (e: any) {
        console.error(`[Locação] falha na régua da competência ${payment.id}:`, e?.message);
      }
    }
  } finally {
    await supabase.rpc("release_billing_lock", { p_key: "rental_dunning" });
  }
}

// ─── Escalonamento para humano ──────────────────────────────────────────────
// Avisa o corretor no WhatsApp pessoal dele e registra no diário. Também pausa
// a IA na conversa com aquele inquilino, para a IA não continuar respondendo
// depois que o caso virou humano.
export async function escalateContractToHuman(
  contract: { id: string; broker_id: string; tenant_name: string; tenant_phone: string },
  paymentId: string | null,
  reason: string,
): Promise<void> {
  const { data: broker } = await supabase
    .from("imf_brokers")
    .select("notification_phone, uazapi_instance_token")
    .eq("id", contract.broker_id)
    .maybeSingle();

  if (broker?.notification_phone && broker?.uazapi_instance_token) {
    const text = `Locação — atenção necessária\n\nInquilino: ${contract.tenant_name}\n${reason}\n\nAbra a aba Locação para ver o histórico e assumir a conversa.`;
    await sendUazapiText(broker.uazapi_instance_token, broker.notification_phone, text).catch(() => null);
  }

  // Pausa a IA na conversa desse inquilino (mesmo mecanismo do handover de
  // atendimento) para não haver dois "atendentes" na mesma conversa.
  if (contract.tenant_phone) {
    await supabase.from("imf_conversation_tickets")
      .update({ ai_active: false, human_takeover_at: new Date().toISOString() })
      .eq("broker_id", contract.broker_id)
      .eq("customer_phone", contract.tenant_phone)
      .in("conversation_status", ["open", "pending"]);
  }

  await logRentalEvent({
    brokerId: contract.broker_id,
    contractId: contract.id,
    paymentId,
    type: "escalado_humano",
    actor: "sistema",
    description: reason,
  });
}

// ─── 3) Alerta de chave em atraso ───────────────────────────────────────────
export async function runKeyOverdueAlertTick(): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: overdue, error } = await supabase
    .from("imf_property_keys")
    .select("id, broker_id, property_id, holder_name, holder_phone, due_at")
    .is("returned_at", null)
    .is("overdue_alert_sent_at", null)
    .lt("due_at", nowIso)
    .limit(20);
  if (error || !overdue?.length) return;

  for (const key of overdue as any[]) {
    try {
      const [{ data: broker }, { data: property }] = await Promise.all([
        supabase.from("imf_brokers").select("notification_phone, uazapi_instance_token").eq("id", key.broker_id).maybeSingle(),
        supabase.from("imf_properties").select("title").eq("id", key.property_id).maybeSingle(),
      ]);

      if (broker?.notification_phone && broker?.uazapi_instance_token) {
        const text = `Chave em atraso\n\nImóvel: ${property?.title || "(sem título)"}\nCom: ${key.holder_name}${key.holder_phone ? ` (${key.holder_phone})` : ""}\nPrevisto para: ${new Date(key.due_at).toLocaleString("pt-BR", { timeZone: BR_TZ })}\n\nA chave ainda não foi registrada como devolvida.`;
        await sendUazapiText(broker.uazapi_instance_token, broker.notification_phone, text).catch(() => null);
      }
      // Marca sempre — sem número de aviso, o alerta visual na aba já cobre e
      // não faz sentido reprocessar a cada minuto.
      await supabase.from("imf_property_keys")
        .update({ overdue_alert_sent_at: nowIso })
        .eq("id", key.id);
    } catch (e: any) {
      console.error("[Locação] alerta de chave falhou:", e?.message);
    }
  }
}
