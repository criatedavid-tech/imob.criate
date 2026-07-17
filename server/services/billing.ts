import { supabase } from "../supabase";
import {
  ASAAS_API_KEY, ASAAS_BASE_URL, SUBSCRIPTION_VALUE,
  PLAN_INCLUDED_TICKETS, PLAN_OVERAGE_PRICE, UAZAPI_HOST, UAZAPI_TOKEN,
  MEMBER_WHATSAPP_SLOT_PRICE,
} from "../config";
import { ensureBrokerInstance } from "./provisioning";
import { fetchWithTimeout } from "../lib/http";

export const asaasHeaders = () => ({
  'Content-Type': 'application/json',
  'access_token': ASAAS_API_KEY
});

const BASE_SUBSCRIPTION_DESCRIPTION = 'Criate — Plano mensal';

// Valor "base" de um broker NÃO é sempre SUBSCRIPTION_VALUE fixo — soma o
// WhatsApp próprio por membro contratado (member_limit). Usado tanto no
// checkout inicial quanto sempre que a assinatura precisa voltar a refletir
// o que o broker contratou (job de excedente, reconciliação pós-renovação).
export function subscriptionValueForMemberLimit(memberLimit: number | null | undefined): number {
  const slots = Math.max(0, Math.floor(memberLimit || 0));
  return Number((SUBSCRIPTION_VALUE + slots * MEMBER_WHATSAPP_SLOT_PRICE).toFixed(2));
}

export function subscriptionDescriptionForMemberLimit(memberLimit: number | null | undefined): string {
  const slots = Math.max(0, Math.floor(memberLimit || 0));
  if (slots <= 0) return BASE_SUBSCRIPTION_DESCRIPTION;
  return `${BASE_SUBSCRIPTION_DESCRIPTION} + ${slots} WhatsApp próprio${slots > 1 ? 's' : ''} de equipe`;
}

async function asaasResponseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => ({} as any));
  const message = payload?.errors?.[0]?.description || payload?.message || fallback;
  return new Error(`${message} (HTTP ${response.status})`);
}

async function updateAsaasSubscriptionValue(
  subscriptionId: string,
  value: number,
  description: string,
): Promise<void> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada.');
  const response = await fetchWithTimeout(`${ASAAS_BASE_URL}/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    headers: asaasHeaders(),
    body: JSON.stringify({ value, description }),
  });
  if (!response.ok) throw await asaasResponseError(response, 'Falha ao atualizar assinatura no Asaas');
}

export async function cancelAsaasSubscription(subscriptionId: string): Promise<void> {
  if (!ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada.');
  const response = await fetchWithTimeout(`${ASAAS_BASE_URL}/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: asaasHeaders(),
  });
  if (!response.ok) throw await asaasResponseError(response, 'Falha ao cancelar assinatura no Asaas');
}

async function ensurePendingSubscriptionReset(
  brokerId: string,
  subscriptionId: string,
  desiredValue: number,
  desiredDescription: string,
): Promise<string> {
  const payload = {
    broker_id: brokerId,
    action: 'reset_subscription_value',
    asaas_subscription_id: subscriptionId,
    desired_value: desiredValue,
    desired_description: desiredDescription,
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('imf_billing_reconciliations')
    .insert(payload)
    .select('id')
    .single();

  if (!error && data?.id) return data.id;
  if (error?.code !== '23505') {
    throw new Error(`Falha ao persistir reconciliação de billing: ${error?.message || 'registro não criado'}`);
  }

  const { data: existing, error: existingError } = await supabase
    .from('imf_billing_reconciliations')
    .select('id')
    .eq('action', 'reset_subscription_value')
    .eq('asaas_subscription_id', subscriptionId)
    .eq('status', 'pending')
    .maybeSingle();
  if (existingError || !existing?.id) {
    throw new Error(`Falha ao localizar reconciliação já existente: ${existingError?.message || 'registro ausente'}`);
  }
  return existing.id;
}

async function resetSubscriptionToBaseWithReconciliation(
  brokerId: string,
  subscriptionId: string,
  desiredValue: number,
  desiredDescription: string,
): Promise<void> {
  // Persiste antes da chamada externa: até um crash entre banco e Asaas deixa
  // uma intenção recuperável para o job periódico.
  const reconciliationId = await ensurePendingSubscriptionReset(brokerId, subscriptionId, desiredValue, desiredDescription);
  try {
    await updateAsaasSubscriptionValue(subscriptionId, desiredValue, desiredDescription);
    const { error } = await supabase.from('imf_billing_reconciliations').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', reconciliationId);
    if (error) throw new Error(`Asaas atualizado, mas a reconciliação não foi concluída no banco: ${error.message}`);
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 1000);
    const { error: pendingError } = await supabase.from('imf_billing_reconciliations').update({
      last_error: message,
      next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', reconciliationId).eq('status', 'pending');
    if (pendingError) {
      // A linha já foi inserida como pending antes da chamada externa; mesmo
      // que os metadados falhem, o job ainda a encontrará pelo next_attempt_at
      // padrão. Não converta uma falha externa em falso sucesso silencioso.
      console.error('[Billing] falha ao registrar metadados da reconciliação:', pendingError.message);
    }
    console.error('[Billing] reset pendente de reconciliação:', message);
  }
}

export async function reconcilePendingBillingActions(): Promise<void> {
  if (!ASAAS_API_KEY) return;

  const { data: locked, error: lockError } = await supabase.rpc('try_billing_lock', {
    p_key: 'billing_reconciliation',
    p_ttl_seconds: 600,
  });
  if (lockError) {
    console.error('[Billing Reconciliation] falha ao adquirir lock:', lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const { data: pending, error } = await supabase
      .from('imf_billing_reconciliations')
      .select('id, action, asaas_subscription_id, desired_value, desired_description, attempts')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('next_attempt_at', { ascending: true })
      .limit(20);
    if (error) {
      console.error('[Billing Reconciliation] falha ao consultar pendências:', error.message);
      return;
    }

    for (const row of pending || []) {
      try {
        if (row.action !== 'reset_subscription_value') {
          throw new Error(`Ação de reconciliação desconhecida: ${row.action}`);
        }
        await updateAsaasSubscriptionValue(
          row.asaas_subscription_id,
          Number(row.desired_value),
          row.desired_description,
        );
        const { error: completeError } = await supabase.from('imf_billing_reconciliations').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        }).eq('id', row.id).eq('status', 'pending');
        if (completeError) throw completeError;
        console.log(`[Billing Reconciliation] assinatura ${row.asaas_subscription_id} reconciliada`);
      } catch (reconcileError: any) {
        const attempts = Number(row.attempts || 0) + 1;
        const delayMinutes = Math.min(24 * 60, 5 * (2 ** Math.min(attempts - 1, 8)));
        const message = String(reconcileError?.message || reconcileError).slice(0, 1000);
        await supabase.from('imf_billing_reconciliations').update({
          attempts,
          last_error: message,
          next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('status', 'pending');
        console.error(`[Billing Reconciliation] tentativa ${attempts} falhou:`, message);
      }
    }
  } finally {
    const { error } = await supabase.rpc('release_billing_lock', { p_key: 'billing_reconciliation' });
    if (error) console.warn('[Billing Reconciliation] falha ao liberar lock:', error.message);
  }
}

// ─── Cobrança de excedente de atendimentos ────────────────────────────────
// Chamada na renovação mensal (handleAsaasPaymentReceived com isRenewal=true).
// Conta os tickets do ciclo encerrado, cobra R$ PLAN_OVERAGE_PRICE por ticket
// acima de PLAN_INCLUDED_TICKETS diretamente no cartão já cadastrado via token.
// Idempotente: se já existe registro para o mesmo período, não cobra novamente.
async function chargeOverageIfDue(
  brokerId: string,
  periodEnd: Date,
  asaasCustomerId: string,
  creditCardToken: string
): Promise<void> {
  const periodStart = new Date(periodEnd);
  periodStart.setMonth(periodStart.getMonth() - 1);

  // Idempotência: verifica se já existe cobrança para este período (±12h de tolerância)
  const windowStart = new Date(periodEnd.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const windowEnd   = new Date(periodEnd.getTime() + 12 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase.from('imf_overage_charges')
    .select('id, status')
    .eq('broker_id', brokerId)
    .gte('billing_period_end', windowStart)
    .lte('billing_period_end', windowEnd)
    .neq('status', 'failed')
    .maybeSingle();

  if (existing) {
    console.log(`[Overage] período ${periodEnd.toISOString().slice(0,10)} já processado (${existing.status}) — ${brokerId}`);
    return;
  }

  // Conta tickets no período encerrado
  const { count } = await supabase.from('imf_ticket_events')
    .select('id', { count: 'exact', head: true })
    .eq('broker_id', brokerId)
    .gte('created_at', periodStart.toISOString())
    .lt('created_at', periodEnd.toISOString());

  const totalTickets = count ?? 0;
  const overage      = Math.max(0, totalTickets - PLAN_INCLUDED_TICKETS);
  const amountCents  = Math.round(overage * PLAN_OVERAGE_PRICE * 100);

  console.log(`[Overage] ${brokerId} — ${totalTickets} tickets (${overage} excedentes, R$ ${(amountCents / 100).toFixed(2)})`);

  // Sem excedente: registra apenas para auditoria
  if (overage === 0) {
    await supabase.from('imf_overage_charges').insert({
      broker_id: brokerId,
      billing_period_start: periodStart.toISOString(),
      billing_period_end:   periodEnd.toISOString(),
      tickets_total:   totalTickets,
      tickets_included: PLAN_INCLUDED_TICKETS,
      tickets_overage: 0,
      price_per_ticket: PLAN_OVERAGE_PRICE,
      amount_cents: 0,
      status: 'no_charge',
    });
    return;
  }

  // Insere registro 'pending' ANTES de chamar o Asaas (garante idempotência em retries)
  const { data: chargeRow } = await supabase.from('imf_overage_charges').insert({
    broker_id: brokerId,
    billing_period_start: periodStart.toISOString(),
    billing_period_end:   periodEnd.toISOString(),
    tickets_total:    totalTickets,
    tickets_included: PLAN_INCLUDED_TICKETS,
    tickets_overage:  overage,
    price_per_ticket: PLAN_OVERAGE_PRICE,
    amount_cents:     amountCents,
    status: 'pending',
  }).select('id').single();

  try {
    const amount = amountCents / 100;
    const dueDate = new Date().toISOString().split('T')[0];
    const description =
      `Criate — Excedente ${overage} atendimento${overage > 1 ? 's' : ''} ` +
      `(${periodStart.toISOString().slice(0,10)} a ${periodEnd.toISOString().slice(0,10)}) ` +
      `× R$ ${PLAN_OVERAGE_PRICE.toFixed(2)}`;

    const payResp = await fetchWithTimeout(`${ASAAS_BASE_URL}/payments`, {
      method: 'POST',
      headers: asaasHeaders(),
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: 'CREDIT_CARD',
        value: amount,
        dueDate,
        description,
        creditCardToken,
      })
    });

    const payment = await payResp.json();
    if (!payResp.ok) {
      throw new Error(payment.errors?.[0]?.description || payment.message || 'Falha na cobrança Asaas');
    }

    await supabase.from('imf_overage_charges').update({
      status: 'charged',
      asaas_payment_id: payment.id,
      charged_at: new Date().toISOString(),
    }).eq('id', chargeRow?.id);

    console.log(`[Overage] ✅ R$ ${amount.toFixed(2)} cobrado — payment ${payment.id} — ${brokerId}`);
  } catch (err: any) {
    await supabase.from('imf_overage_charges').update({
      status: 'failed',
      error: err.message,
    }).eq('id', chargeRow?.id);
    // Falha na cobrança de excedente não deve derrubar o fluxo principal de renovação
    console.error(`[Overage] ❌ falha ao cobrar excedente ${brokerId}:`, err.message);
  }
}

export async function handleAsaasPaymentReceived({ id, customerId, value, brokerId, subscriptionId, isRenewal = false }: {
  id: string; customerId: string; value: number; brokerId: string; subscriptionId?: string; isRenewal?: boolean;
}) {
  try {
    // Captura valid_until ANTES de atualizar — necessário para delimitar o ciclo encerrado
    const { data: brokerBefore } = await supabase.from('imf_brokers')
      .select('valid_until, asaas_credit_card_token, provisioning_status, member_limit').eq('id', brokerId).single();

    // Cobrança órfã de assinatura cancelada: SUBSCRIPTION_DELETED seta
    // provisioning_status='disabled', mas o Asaas ainda pode cobrar uma
    // cobrança remanescente (ex.: retry de overdue gerada antes do cancelamento).
    // Registra o pagamento para auditoria e alerta, mas NÃO reativa o corretor
    // nem reprovisiona ('disabled' passaria pela trava de provisionamento).
    // Recompra legítima entra pelo checkout (isRenewal=false) e não cai aqui.
    if (isRenewal && brokerBefore?.provisioning_status === 'disabled') {
      await supabase.from('subscriptions').upsert({
        broker_id: brokerId,
        asaas_payment_id: id,
        asaas_customer_id: customerId,
        plan: 'mensal',
        amount: Math.round(value * 100),
        currency: 'brl',
        status: 'paid_after_cancellation',
        paid_at: new Date().toISOString(),
        valid_until: brokerBefore?.valid_until || new Date().toISOString()
      }, { onConflict: 'asaas_payment_id', ignoreDuplicates: true });
      await supabase.from('webhook_logs').insert({
        source: 'asaas',
        event_type: 'payment_after_cancellation',
        payload: { payment_id: id, customer_id: customerId, value, broker_id: brokerId },
        status: 'alert',
        broker_id: brokerId
      });
      console.warn(`[Asaas] ⚠️ pagamento ${id} de assinatura CANCELADA — broker ${brokerId} não reativado; avaliar estorno`);
      return;
    }

    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + 1);

    const brokerUpdate: any = {
      status: 'ativo',
      asaas_customer_id: customerId,
      plan: 'mensal',
      valid_until: validUntil.toISOString(),
      grace_until: null   // pagamento confirmado limpa inadimplência/grace
    };
    if (subscriptionId) brokerUpdate.asaas_subscription_id = subscriptionId;

    await supabase.from('imf_brokers').update(brokerUpdate).eq('id', brokerId);

    // Processa excedente do ciclo encerrado (apenas em renovações)
    if (isRenewal && brokerBefore?.valid_until && subscriptionId) {
      const periodEnd = new Date(brokerBefore.valid_until);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      if (periodEnd >= sevenDaysAgo) {
        // Verifica se prepareOverageBilling() já embutiu o excedente na assinatura
        const windowStart = new Date(periodEnd.getTime() - 12 * 60 * 60 * 1000).toISOString();
        const windowEnd   = new Date(periodEnd.getTime() + 12 * 60 * 60 * 1000).toISOString();
        const { data: scheduled } = await supabase.from('imf_overage_charges')
          .select('id, tickets_overage, amount_cents')
          .eq('broker_id', brokerId)
          .eq('status', 'scheduled_in_subscription')
          .gte('billing_period_end', windowStart)
          .lte('billing_period_end', windowEnd)
          .maybeSingle();

        if (scheduled) {
          // Reseta a assinatura para o valor-base. A intenção é persistida
          // antes da chamada e o job periódico tenta novamente em caso de falha.
          // Esta função só absorve falhas depois que a pendência já existe. Se
          // a persistência inicial falhar, a exceção interrompe a conclusão
          // local e o excedente não é marcado falsamente como reconciliável.
          await resetSubscriptionToBaseWithReconciliation(
            brokerId,
            subscriptionId,
            subscriptionValueForMemberLimit(brokerBefore?.member_limit),
            subscriptionDescriptionForMemberLimit(brokerBefore?.member_limit),
          );
          // Só muda o estado do ciclo depois que a intenção de reset já está
          // durável. Assim um crash nunca deixa o valor inflado sem retry.
          const { error: includedError } = await supabase.from('imf_overage_charges')
            .update({ status: 'included_in_subscription', charged_at: new Date().toISOString() })
            .eq('id', scheduled.id);
          if (includedError) throw includedError;
          console.log(`[Billing] excedente de ${scheduled.tickets_overage} tickets já incluído na renovação — ${brokerId}`);
        } else if (brokerBefore?.asaas_credit_card_token) {
          // Fallback: job de preparo não rodou (ex: servidor estava offline) → cobrança separada
          await chargeOverageIfDue(brokerId, periodEnd, customerId, brokerBefore.asaas_credit_card_token);
        }
      }
    }

    // Idempotente: o Asaas entrega o mesmo webhook em duplicidade (~200ms de
    // intervalo) — ON CONFLICT no asaas_payment_id descarta a repetição.
    await supabase.from('subscriptions').upsert({
      broker_id: brokerId,
      asaas_payment_id: id,
      asaas_customer_id: customerId,
      plan: 'mensal',
      amount: Math.round(value * 100),
      currency: 'brl',
      status: 'paid',
      paid_at: new Date().toISOString(),
      valid_until: validUntil.toISOString()
    }, { onConflict: 'asaas_payment_id', ignoreDuplicates: true });

    const { data: broker } = await supabase.from('imf_brokers').select('*').eq('id', brokerId).single();
    if (!broker) return;

    if (UAZAPI_HOST && UAZAPI_TOKEN) {
      // ensureBrokerInstance já trava atomicamente (is.null OR eq.failed) e
      // ignora silenciosamente se já estiver 'processing'/'completed' — cobre
      // tanto o caso normal quanto webhook duplicado do Asaas.
      await ensureBrokerInstance(broker);
    }

    console.log(`✅ Corretor ${brokerId} ativado — Asaas ${id}`);
  } catch (err: any) {
    console.error("Erro ao ativar corretor:", err);
  }
}

// ─── Preparo de billing consolidado (roda a cada hora) ───────────────────
// Para cada corretor cuja renovação é amanhã, calcula o excedente do ciclo
// atual e atualiza o valor da assinatura no Asaas ANTES que ela seja cobrada.
// Assim o corretor recebe UMA cobrança = mensalidade + excedente (se houver).
// Quando o webhook de renovação chega, handleAsaasPaymentReceived reseta o
// valor de volta ao base e marca o registro como 'included_in_subscription'.
export async function prepareOverageBilling(): Promise<void> {
  if (!ASAAS_API_KEY) return;

  // Lock distribuído: garante execução única mesmo com múltiplas máquinas Fly
  const { data: locked } = await supabase.rpc('try_billing_lock', { p_key: 'billing_prep', p_ttl_seconds: 7200 });
  if (!locked) {
    console.log('[Billing Prep] outra máquina segura o lock — tick ignorado');
    return;
  }

  try {
  const now = new Date();
  // Janela: corretores com valid_until nas próximas 20-28 horas
  // (evita preparar muito cedo ou deixar passar)
  const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 28 * 60 * 60 * 1000);

  const { data: brokers } = await supabase.from('imf_brokers')
    .select('id, asaas_subscription_id, valid_until, member_limit')
    .eq('status', 'ativo')
    .gte('valid_until', windowStart.toISOString())
    .lte('valid_until', windowEnd.toISOString())
    .not('asaas_subscription_id', 'is', null);

  if (!brokers?.length) return;
  console.log(`[Billing Prep] ${brokers.length} corretor(es) com renovação amanhã`);

  for (const broker of brokers) {
    try {
      const periodEnd   = new Date(broker.valid_until);
      const periodStart = new Date(periodEnd);
      periodStart.setMonth(periodStart.getMonth() - 1);

      // Idempotência: não preparar duas vezes o mesmo ciclo
      const { data: alreadyDone } = await supabase.from('imf_overage_charges')
        .select('id')
        .eq('broker_id', broker.id)
        .in('status', ['scheduled_in_subscription', 'included_in_subscription', 'no_charge'])
        .gte('billing_period_end', new Date(periodEnd.getTime() - 12 * 60 * 60 * 1000).toISOString())
        .lte('billing_period_end', new Date(periodEnd.getTime() + 12 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (alreadyDone) continue;

      const [{ count }, { data: adjRows }] = await Promise.all([
        supabase.from('imf_ticket_events')
          .select('id', { count: 'exact', head: true })
          .eq('broker_id', broker.id)
          .gte('created_at', periodStart.toISOString())
          .lt('created_at', periodEnd.toISOString()),
        supabase.from('imf_ticket_adjustments')
          .select('amount, type')
          .eq('broker_id', broker.id)
          .gte('period_start', periodStart.toISOString())
      ]);

      const bonusAdj      = (adjRows ?? []).filter((a: any) => a.type === 'bonus').reduce((s: number, a: any) => s + a.amount, 0);
      const chargeAdj     = (adjRows ?? []).filter((a: any) => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
      const totalTickets  = count ?? 0;
      const effectiveLim  = Math.max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + bonusAdj);
      const regularOver   = Math.max(0, totalTickets - effectiveLim);
      const overage       = regularOver + Math.max(0, chargeAdj);
      const overageAmount = overage * PLAN_OVERAGE_PRICE;
      // Base já soma o WhatsApp próprio de equipe contratado (member_limit) —
      // sem isso, todo ciclo (com ou sem excedente) esse valor extra some,
      // porque essa rota SEMPRE reescreve o value da assinatura no Asaas.
      const baseValue     = subscriptionValueForMemberLimit(broker.member_limit);
      const totalValue    = Number((baseValue + overageAmount).toFixed(2));

      const description = overage > 0
        ? `${subscriptionDescriptionForMemberLimit(broker.member_limit)} + ${overage} atendimento${overage > 1 ? 's' : ''} excedente${overage > 1 ? 's' : ''} × R$ ${PLAN_OVERAGE_PRICE.toFixed(2)}`
        : subscriptionDescriptionForMemberLimit(broker.member_limit);

      // Atualiza valor da assinatura no Asaas para o próximo ciclo
      const upResp = await fetchWithTimeout(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}`, {
        method: 'PUT',
        headers: asaasHeaders(),
        body: JSON.stringify({ value: totalValue, description })
      });

      if (!upResp.ok) {
        const err = await upResp.json().catch(() => ({}));
        console.error(`[Billing Prep] falha ao atualizar subscription ${broker.asaas_subscription_id}:`, err);
        continue;
      }

      await supabase.from('imf_overage_charges').insert({
        broker_id:            broker.id,
        billing_period_start: periodStart.toISOString(),
        billing_period_end:   periodEnd.toISOString(),
        tickets_total:        totalTickets,
        tickets_included:     PLAN_INCLUDED_TICKETS,
        tickets_overage:      overage,
        price_per_ticket:     PLAN_OVERAGE_PRICE,
        amount_cents:         Math.round(overageAmount * 100),
        status:               overage > 0 ? 'scheduled_in_subscription' : 'no_charge',
      });

      console.log(`[Billing Prep] ✅ ${broker.id} — R$ ${totalValue.toFixed(2)} (${overage} excedentes) agendado`);
    } catch (err: any) {
      console.error(`[Billing Prep] erro para ${broker.id}:`, err.message);
    }
  }
  } finally {
    try {
      await supabase.rpc('release_billing_lock', { p_key: 'billing_prep' });
    } catch (e: any) {
      console.warn('[Billing Prep] falha ao liberar lock:', e?.message);
    }
  }
}
