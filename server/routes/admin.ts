import express from "express";
import { supabase } from "../supabase";
import { requireAdmin } from "../middleware/auth";
import {
  ASAAS_API_KEY, ASAAS_BASE_URL,
  UAZAPI_HOST, UAZAPI_TOKEN, PLAN_INCLUDED_TICKETS, PLAN_OVERAGE_PRICE,
} from "../config";
import { asaasHeaders } from "../services/billing";
import { provisionUazapiInstanceNative } from "../services/provisioning";
import { fetchWithTimeout } from "../lib/http";

export const adminRouter = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// PAINEL ADMIN
// ─────────────────────────────────────────────────────────────────────────

// Lista todos os corretores com dados de assinatura
adminRouter.get("/api/admin/brokers", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data, error } = await supabase
      .from('imf_brokers')
      .select('id, name, email, phone, status, plan, valid_until, created_at, is_admin, asaas_customer_id, zpro_tenant_id')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Métricas globais da plataforma
adminRouter.get("/api/admin/metrics", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const [brokersRes, propertiesRes, leadsRes, activeRes, revenueRes] = await Promise.all([
      supabase.from('imf_brokers').select('id', { count: 'exact', head: true }),
      supabase.from('imf_properties').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('imf_brokers').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
      supabase.from('subscriptions').select('amount').eq('status', 'paid')
    ]);
    const totalRevenue = (revenueRes.data || []).reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
    res.json({
      totalBrokers: brokersRes.count || 0,
      activeBrokers: activeRes.count || 0,
      totalProperties: propertiesRes.count || 0,
      totalLeads: leadsRes.count || 0,
      totalRevenueCents: totalRevenue
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ativar ou bloquear um corretor
adminRouter.patch("/api/admin/brokers/:id/status", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { status } = req.body;
  if (!['ativo', 'pendente', 'bloqueado'].includes(status)) {
    return res.status(400).json({ error: "Status inválido" });
  }
  try {
    const { data, error } = await supabase
      .from('imf_brokers').update({ status }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Quantos corretores da equipe podem ter WhatsApp PRÓPRIO (em vez de
// compartilhar o da conta) — sem sistema formal de tiers de plano ainda,
// então isso funciona como um ajuste manual do admin (mesmo padrão de
// PLAN_OVERAGE_PRICE). 0/null = recurso indisponível pra essa conta (padrão).
// Validado em server/routes/equipe.ts::POST /api/equipe/members/invite.
adminRouter.patch("/api/admin/brokers/:id/member-limit", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const memberLimit = Number(req.body?.member_limit);
  if (!Number.isInteger(memberLimit) || memberLimit < 0) {
    return res.status(400).json({ error: "member_limit precisa ser um número inteiro ≥ 0." });
  }
  try {
    const { data, error } = await supabase
      .from('imf_brokers').update({ member_limit: memberLimit }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Detalhes de um corretor (imóveis, leads, assinaturas)
adminRouter.get("/api/admin/brokers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const [brokerRes, propsRes, subsRes] = await Promise.all([
      supabase.from('imf_brokers').select('*').eq('id', req.params.id).single(),
      supabase.from('imf_properties').select('id, title, status, created_at').eq('broker_id', req.params.id).order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('*').eq('broker_id', req.params.id).order('created_at', { ascending: false })
    ]);
    if (brokerRes.error) throw brokerRes.error;
    res.json({
      broker: brokerRes.data,
      properties: propsRes.data || [],
      subscriptions: subsRes.data || []
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Disparo manual de provisionamento (admin) — mesma rota do usuário normal
// pós-pagamento:
//   1. Garante status=ativo + valid_until (preserva 2099 se já estiver configurado)
//   2. Chama provisionUazapiInstanceNative (cria a instância UAZAPI direto, sem Z-PRO)
adminRouter.post("/api/admin/brokers/:id/provision", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('*').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    // Garante que o corretor está ativo antes de provisionar
    // Preserva valid_until já definido (ex: 2099) ou define +1 mês
    const currentValidUntil = broker.valid_until ? new Date(broker.valid_until) : null;
    const needsValidUntil = !currentValidUntil || currentValidUntil < new Date();
    if (needsValidUntil) {
      const validUntil = new Date();
      validUntil.setMonth(validUntil.getMonth() + 1);
      await supabase.from('imf_brokers').update({
        status: 'ativo',
        plan: broker.plan || 'mensal',
        valid_until: validUntil.toISOString()
      }).eq('id', broker.id);
      broker.status = 'ativo';
      broker.valid_until = validUntil.toISOString();
    } else if (broker.status !== 'ativo') {
      await supabase.from('imf_brokers').update({ status: 'ativo' }).eq('id', broker.id);
      broker.status = 'ativo';
    }

    if (!UAZAPI_HOST || !UAZAPI_TOKEN) {
      return res.status(503).json({ error: 'UAZAPI não configurada.' });
    }

    await provisionUazapiInstanceNative(broker);

    res.json({ success: true, message: 'Instância WhatsApp provisionada com sucesso.' });
  } catch (err: any) {
    console.error('[Provision] erro:', err?.message);
    res.status(500).json({ error: err.message });
  }
});

// Cancelar plano (mantém valid_until, cancela no Asaas)
adminRouter.post("/api/admin/brokers/:id/cancel-plan", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('asaas_subscription_id, asaas_customer_id, name').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    // Cancela assinatura no Asaas se existir
    if (broker.asaas_subscription_id && ASAAS_API_KEY) {
      await fetchWithTimeout(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}/cancel`, {
        method: 'POST',
        headers: asaasHeaders()
      }).catch(e => console.warn('[Asaas] cancel sub falhou:', e?.message));
    }

    // Marca corretor como cancelado — acesso mantido até valid_until (cronjob/webhook vai expirar)
    await supabase.from('imf_brokers').update({ status: 'bloqueado' }).eq('id', req.params.id);

    // Log admin
    const adminId = (req as any).userId;
    console.log(`[ADMIN] Plano cancelado: broker=${req.params.id} por user=${adminId}`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir conta de corretor
adminRouter.delete("/api/admin/brokers/:id", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('user_id, asaas_subscription_id').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    // 1. Cancela assinatura no Asaas
    if (broker.asaas_subscription_id && ASAAS_API_KEY) {
      await fetchWithTimeout(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}/cancel`, {
        method: 'POST', headers: asaasHeaders()
      }).catch(() => {});
    }

    // 2. Remove dados do corretor (cascade deve limpar propriedades/leads via FK)
    await supabase.from('imf_brokers').delete().eq('id', req.params.id);

    // 3. Remove usuário do Supabase Auth (invalida login)
    if (broker.user_id) {
      await supabase.auth.admin.deleteUser(broker.user_id).catch(e =>
        console.warn('[Admin] deleteUser falhou:', e?.message)
      );
    }

    const adminId = (req as any).userId;
    console.log(`[ADMIN] Conta excluída: broker=${req.params.id} por user=${adminId}`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Consulta consumo de atendimentos de um corretor (período atual)
adminRouter.get("/api/admin/brokers/:id/ticket-usage", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const brokerId = req.params.id;
    const { data: broker } = await supabase.from('imf_brokers')
      .select('valid_until, name').eq('id', brokerId).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    const periodEnd   = broker.valid_until ? new Date(broker.valid_until) : new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);

    const [{ count: ticketsRaw }, { data: adjData }] = await Promise.all([
      supabase.from('imf_ticket_events')
        .select('id', { count: 'exact', head: true })
        .eq('broker_id', brokerId)
        .gte('created_at', periodStart.toISOString())
        .lt('created_at', periodEnd.toISOString()),
      // SEM filtro de período: admin vê e pode estornar qualquer ajuste da história
      supabase.from('imf_ticket_adjustments')
        .select('id, amount, type, reason, created_at, period_start')
        .eq('broker_id', brokerId)
        .order('created_at', { ascending: false })
    ]);

    // Totais históricos (sem filtro de período) — base para elegibilidade de estorno
    const bonusAdj          = (adjData ?? []).filter((a: any) => a.type === 'bonus').reduce((s: number, a: any) => s + a.amount, 0);
    const chargeAdj         = (adjData ?? []).filter((a: any) => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
    // Limite efetivo usa apenas ajustes do período corrente para cálculo de cobrança
    const periodBonusAdj    = (adjData ?? []).filter((a: any) => a.type === 'bonus' && a.period_start >= periodStart.toISOString()).reduce((s: number, a: any) => s + a.amount, 0);
    const effectiveIncluded = Math.max(PLAN_INCLUDED_TICKETS, PLAN_INCLUDED_TICKETS + periodBonusAdj);
    const ticketsUsed       = ticketsRaw ?? 0;

    res.json({
      broker_name:              broker.name,
      period_start:             periodStart.toISOString(),
      period_end:               periodEnd.toISOString(),
      tickets_used:             ticketsUsed,
      tickets_raw:              ticketsRaw ?? 0,
      tickets_included_base:    PLAN_INCLUDED_TICKETS,
      tickets_bonus:            Math.max(0, bonusAdj),     // total histórico para estorno
      tickets_charge_adj:       Math.max(0, chargeAdj),    // total histórico para estorno
      tickets_included:         effectiveIncluded,
      overage_price_per_ticket: PLAN_OVERAGE_PRICE,
      adjustments:              adjData ?? [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ajuste manual de atendimentos de um corretor (período atual)
adminRouter.post("/api/admin/brokers/:id/ticket-adjustment", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const adminId  = (req as any).userId;
  const brokerId = req.params.id;

  const amount = parseInt(req.body?.amount, 10);
  const type   = String(req.body?.type || 'bonus');
  const reason = String(req.body?.reason || '').trim().slice(0, 500);

  if (!Number.isInteger(amount) || amount === 0) {
    return res.status(400).json({ error: 'amount deve ser um inteiro diferente de zero' });
  }
  if (!['bonus', 'charge'].includes(type)) {
    return res.status(400).json({ error: 'type deve ser "bonus" ou "charge"' });
  }
  try {
    const { data: broker } = await supabase.from('imf_brokers')
      .select('valid_until').eq('id', brokerId).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });

    const periodEnd   = broker.valid_until ? new Date(broker.valid_until) : new Date();
    const periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - 1);

    // Negativo: estorno de qualquer ajuste histórico (sem filtro de período)
    if (amount < 0) {
      const { data: existing } = await supabase.from('imf_ticket_adjustments')
        .select('amount')
        .eq('broker_id', brokerId)
        .eq('type', type);
      const historicTotal = (existing ?? []).reduce((s: number, a: any) => s + a.amount, 0);
      if (historicTotal + amount < 0) {
        return res.status(400).json({
          error: `${type === 'bonus' ? 'Bônus' : 'Cobrança'} total histórico: +${historicTotal}. Estorno máximo: ${historicTotal}. Não é possível estornar mais do que foi lançado.`,
          current_total: historicTotal,
        });
      }
    }

    const { data, error } = await supabase.from('imf_ticket_adjustments').insert({
      broker_id:    brokerId,
      amount,
      type,
      reason:       reason || null,
      admin_id:     adminId,
      period_start: periodStart.toISOString(),
      period_end:   periodEnd.toISOString(),
    }).select().single();
    if (error) throw error;

    console.log(`[ADMIN] Ajuste tickets: broker=${brokerId} type=${type} amount=${amount>0?'+':''}${amount} por admin=${adminId}`);
    res.json({ success: true, adjustment: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

