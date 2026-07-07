import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { checkoutLimiter, webhookLimiter } from "../middleware/rateLimits";
import {
  SUBSCRIPTION_VALUE, ASAAS_API_KEY, ASAAS_BASE_URL, TERMS_VERSION,
  PLAN_INCLUDED_TICKETS, PLAN_OVERAGE_PRICE, ASAAS_WEBHOOK_TOKEN,
} from "../config";
import { asaasHeaders, handleAsaasPaymentReceived } from "../services/billing";
import { handleRentalPaymentWebhook } from "../services/rentalBilling";

export const billingRouter = express.Router();

// Retorna configurações públicas do plano (preço atual)
billingRouter.get("/api/config/plan", (_req, res) => {
  const price = SUBSCRIPTION_VALUE;
  const priceDisplay = price.toFixed(2).replace('.', ',');
  res.json({ price, priceDisplay });
});

// ─────────────────────────────────────────────────────────────────────────
// ASAAS — CHECKOUT E WEBHOOK
// ─────────────────────────────────────────────────────────────────────────

// Cria cobrança no Asaas (cartão de crédito) e ativa o corretor imediatamente
billingRouter.post("/api/checkout", checkoutLimiter, requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  if (!ASAAS_API_KEY) {
    return res.status(503).json({ error: "Pagamento ainda não configurado. Aguarde." });
  }

  const { cpfCnpj, cardHolder, cardNumber, expiryMonth, expiryYear, cvv } = req.body;
  if (!cpfCnpj || !cardHolder || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
    return res.status(400).json({ error: "Dados do cartão incompletos." });
  }

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

    const { data: broker } = await supabase.from('imf_brokers').select('*').eq('id', brokerId).single();
    if (!broker) return res.status(404).json({ error: "Corretor não encontrado." });

    // 1. Cria cliente no Asaas
    const customerResp = await fetch(`${ASAAS_BASE_URL}/customers`, {
      method: 'POST',
      headers: asaasHeaders(),
      body: JSON.stringify({
        name: broker.name || broker.email,
        cpfCnpj: cpfCnpj.replace(/\D/g, ''),
        email: broker.email,
        phone: (broker.phone || '').replace(/\D/g, '')
      })
    });

    const customerData = await customerResp.json();
    if (!customerResp.ok) {
      throw new Error(customerData.errors?.[0]?.description || 'Erro ao registrar cliente');
    }
    const customerId = customerData.id;

    // 2. Cria assinatura RECORRENTE mensal com cartão de crédito
    const nextDueDate = new Date().toISOString().split('T')[0];
    const subscriptionResp = await fetch(`${ASAAS_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: asaasHeaders(),
      body: JSON.stringify({
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: SUBSCRIPTION_VALUE,
        nextDueDate,
        cycle: 'MONTHLY',
        description: 'ImobiFlow - Assinatura Mensal',
        creditCard: {
          holderName: cardHolder,
          number: cardNumber.replace(/\s/g, ''),
          expiryMonth,
          expiryYear,
          ccv: cvv
        },
        creditCardHolderInfo: {
          name: cardHolder,
          email: broker.email,
          cpfCnpj: cpfCnpj.replace(/\D/g, ''),
          postalCode: '00000000',
          addressNumber: 'S/N',
          phone: (broker.phone || '').replace(/\D/g, '') || '00000000000'
        }
      })
    });

    const subscription = await subscriptionResp.json();
    if (!subscriptionResp.ok) {
      throw new Error(subscription.errors?.[0]?.description || subscription.message || 'Assinatura recusada');
    }

    // 3. Busca o primeiro payment gerado pela subscription
    const firstPaymentResp = await fetch(
      `${ASAAS_BASE_URL}/subscriptions/${subscription.id}/payments`,
      { method: 'GET', headers: asaasHeaders() }
    );
    const firstPaymentList = await firstPaymentResp.json();
    const firstPayment = firstPaymentList.data?.[0];

    if (!firstPayment) {
      throw new Error('Primeira cobrança da assinatura não foi gerada.');
    }
    if (firstPayment.status !== 'CONFIRMED' && firstPayment.status !== 'RECEIVED') {
      throw new Error('Pagamento não aprovado. Verifique os dados do cartão.');
    }

    // 4. Salva subscription_id e token do cartão no broker e ativa imediatamente
    // O creditCardToken permite cobranças avulsas futuras (excedente) sem pedir o cartão novamente.
    const creditCardToken = subscription.creditCard?.creditCardToken || '';
    await supabase.from('imf_brokers')
      .update({
        asaas_subscription_id: subscription.id,
        ...(creditCardToken ? { asaas_credit_card_token: creditCardToken } : {})
      })
      .eq('id', brokerId);

    // Registro do aceite dos Termos/Privacidade (checkbox obrigatório no
    // checkout) — update separado para nunca comprometer o update crítico acima.
    await supabase.from('imf_brokers')
      .update({ terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() })
      .eq('id', brokerId);

    await handleAsaasPaymentReceived({
      id: firstPayment.id,
      customerId,
      value: firstPayment.value,
      brokerId,
      subscriptionId: subscription.id
    });

    res.json({ success: true, paymentId: firstPayment.id, subscriptionId: subscription.id });
  } catch (err: any) {
    console.error("Erro no checkout Asaas:", err);
    res.status(400).json({ error: err.message });
  }
});

// Retorna status da assinatura do corretor
billingRouter.get("/api/subscription", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

    let { data: broker } = await supabase.from('imf_brokers')
      .select('status, plan, valid_until, grace_until, zpro_tenant_id, zpro_channel_id, zpro_qr_code, is_admin')
      .eq('id', brokerId).single();

    // Admin tem acesso vitalício — nunca bloquear por assinatura
    if (broker?.is_admin) {
      return res.json({ broker: { ...broker, status: 'ativo' }, lastSubscription: null });
    }

    // Enforcement lazy do grace period: se passou de grace_until e ainda está
    // 'ativo', suspende o acesso agora (cobre PAYMENT_OVERDUE sem cron job).
    if (broker?.status === 'ativo' && broker?.grace_until && new Date(broker.grace_until) < new Date()) {
      await supabase.from('imf_brokers').update({ status: 'inativo' }).eq('id', brokerId);
      broker = { ...broker, status: 'inativo' };
    }

    const { data: lastSub } = await supabase.from('subscriptions')
      .select('*').eq('broker_id', brokerId)
      .order('created_at', { ascending: false }).limit(1).single();

    res.json({ broker, lastSubscription: lastSub });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Retorna os últimos atendimentos (ticket_events) do corretor para o dashboard
billingRouter.get("/api/tickets/recent", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });
    const { data, error } = await supabase
      .from("imf_ticket_events")
      .select("id, zpro_ticket_id, created_at")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Retorna o consumo de atendimentos do ciclo atual e histórico de cobranças de excedente
billingRouter.get("/api/billing/usage", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });

    const { data: broker } = await supabase.from('imf_brokers')
      .select('valid_until').eq('id', brokerId).single();

    // Início do ciclo atual = valid_until - 1 mês
    const periodEnd   = broker?.valid_until ? new Date(broker.valid_until) : new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);

    const [{ count: ticketsRaw }, { data: adjData }] = await Promise.all([
      supabase.from('imf_ticket_events')
        .select('id', { count: 'exact', head: true })
        .eq('broker_id', brokerId)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString()),
      supabase.from('imf_ticket_adjustments')
        .select('amount, type')
        .eq('broker_id', brokerId)
        .gte('period_start', periodStart.toISOString())
    ]);

    // bonus → aumenta o limite incluso (gratuito para o cliente)
    // charge → vai direto para excedente, independente do plano (admin cobra manualmente)
    const bonusAdj          = (adjData ?? []).filter((a: any) => a.type === 'bonus').reduce((s: number, a: any) => s + a.amount, 0);
    const chargeAdj         = (adjData ?? []).filter((a: any) => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
    const ticketsUsed       = ticketsRaw ?? 0;
    const effectiveIncluded = Math.max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + bonusAdj);
    const regularOverage    = Math.max(0, ticketsUsed - effectiveIncluded);
    const overage           = regularOverage + Math.max(0, chargeAdj);
    const overageAmount     = overage * PLAN_OVERAGE_PRICE;

    // Histórico das últimas 6 cobranças de excedente
    const { data: history } = await supabase.from('imf_overage_charges')
      .select('billing_period_start, billing_period_end, tickets_total, tickets_overage, amount_cents, status, charged_at')
      .eq('broker_id', brokerId)
      .order('billing_period_end', { ascending: false })
      .limit(6);

    res.json({
      current_period: {
        start:                    periodStart.toISOString(),
        end:                      periodEnd.toISOString(),
        tickets_used:             ticketsUsed,
        tickets_included:         effectiveIncluded,
        tickets_included_base:    PLAN_INCLUDED_TICKETS,
        tickets_bonus:            Math.max(0, bonusAdj),
        tickets_charge_adj:       Math.max(0, chargeAdj),
        tickets_remaining:        Math.max(0, effectiveIncluded - ticketsUsed),
        overage_tickets:          overage,
        overage_amount:           overageAmount,
        overage_price_per_ticket: PLAN_OVERAGE_PRICE,
      },
      history: history ?? [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook do Asaas — confirmação de pagamento, cancelamento
billingRouter.post("/api/webhooks/asaas", webhookLimiter, async (req, res) => {
  // Verifica token de acesso enviado pelo Asaas no header (configurado em Asaas → Webhooks).
  // Se ASAAS_WEBHOOK_TOKEN não estiver definido no ambiente, a verificação é pulada
  // para manter compatibilidade com o sandbox de desenvolvimento.
  if (ASAAS_WEBHOOK_TOKEN) {
    const incoming = req.headers['asaas-access-token'];
    if (incoming !== ASAAS_WEBHOOK_TOKEN) {
      console.warn(`[Webhook] token inválido — origin: ${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const event = req.body;

  await supabase.from('webhook_logs').insert({
    source: 'asaas',
    event_type: event.event,
    payload: event,
    status: 'received'
  });

  // Cobrança de aluguel (Locação) usa o MESMO Asaas, mas o customer é o
  // inquilino, não o corretor — nunca vai bater no lookup por
  // asaas_customer_id em imf_brokers abaixo. Verifica primeiro, por
  // asaas_payment_id (ver server/services/rentalBilling.ts); se for uma
  // cobrança de aluguel, trata e sai — não é evento de assinatura do broker.
  if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED'].includes(event.event)) {
    const wasRentalPayment = await handleRentalPaymentWebhook(event).catch((e) => {
      console.error('[Webhook] erro tratando possível pagamento de aluguel:', e.message);
      return false;
    });
    if (wasRentalPayment) {
      res.json({ received: true });
      return;
    }
  }

  if (event.event === 'PAYMENT_RECEIVED' || event.event === 'PAYMENT_CONFIRMED') {
    const p = event.payment;
    const { data: broker } = await supabase.from('imf_brokers')
      .select('id, asaas_subscription_id').eq('asaas_customer_id', p.customer).single();
    if (broker) {
      await handleAsaasPaymentReceived({
        id: p.id,
        customerId: p.customer,
        value: p.value,
        brokerId: broker.id,
        subscriptionId: p.subscription || broker.asaas_subscription_id || undefined,
        isRenewal: true  // webhook = cobrança de renovação → calcula excedente do ciclo encerrado
      });
    }
  } else if (event.event === 'PAYMENT_OVERDUE') {
    // Inadimplência: NÃO bloqueia na hora — concede grace period de 3 dias.
    // A suspensão efetiva é aplicada lazy em GET /api/subscription quando grace_until expira.
    const p = event.payment;
    const graceUntil = new Date();
    graceUntil.setDate(graceUntil.getDate() + 3);
    await supabase.from('imf_brokers')
      .update({ grace_until: graceUntil.toISOString() })
      .eq('asaas_customer_id', p.customer);
    await supabase.from('subscriptions').update({ status: 'overdue' }).eq('asaas_payment_id', p.id);
  } else if (event.event === 'PAYMENT_DELETED') {
    const p = event.payment;
    await supabase.from('imf_brokers').update({ status: 'inativo' }).eq('asaas_customer_id', p.customer);
    await supabase.from('subscriptions').update({ status: 'cancelled' }).eq('asaas_payment_id', p.id);
  } else if (
    event.event === 'SUBSCRIPTION_DELETED' ||
    event.event === 'SUBSCRIPTION_INACTIVATED' ||
    event.event === 'SUBSCRIPTION_CANCELED'
  ) {
    // Assinatura cancelada → desativa o corretor e marca o tenant Z-PRO como desativado.
    const sub = event.subscription || event.payment;
    const subId = sub?.id || sub?.subscription;
    if (subId) {
      await supabase.from('imf_brokers')
        .update({ status: 'inativo', provisioning_status: 'disabled' })
        .eq('asaas_subscription_id', subId);
    }
  }

  res.json({ received: true });
});

// Rejeita métodos não-POST no endpoint de webhook
billingRouter.all("/api/webhooks/asaas", (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed' });
});

// Endpoint de teste — simula ativação sem Asaas (apenas dev)
billingRouter.post("/api/webhooks/asaas/test", async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: "Não disponível em produção." });
  }
  const { broker_id } = req.body;
  if (!broker_id) return res.status(400).json({ error: "broker_id obrigatório." });

  await handleAsaasPaymentReceived({
    id: `pay_test_${Date.now()}`,
    customerId: `cus_test_${Date.now()}`,
    value: 1.00,
    brokerId: broker_id
  });
  res.json({ success: true, message: "Corretor ativado via teste." });
});
