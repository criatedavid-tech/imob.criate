import express from "express";
import { supabase } from "../supabase";
import { requireAdmin } from "../middleware/auth";
import {
  ASAAS_API_KEY, ASAAS_BASE_URL, ZPRO_ADMIN_URL, ZPRO_ADMIN_TOKEN,
  UAZAPI_HOST, UAZAPI_TOKEN, PLAN_INCLUDED_TICKETS, PLAN_OVERAGE_PRICE,
} from "../config";
import { asaasHeaders } from "../services/billing";
import { createZproTenantAndChannel, zproGet, zproPost, zproPut, setUazapiWebhook } from "../services/provisioning";
import { getZproAdminToken } from "../lib/zproAuth";

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

// Disparo manual de provisionamento Z-PRO (admin)
// Segue a mesma rota do usuário normal pós-pagamento:
//   1. Garante status=ativo + valid_until (preserva 2099 se já estiver configurado)
//   2. Chama createZproTenantAndChannel (cria tenant + sessão WhatsApp)
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

    // Executa o mesmo fluxo de provisionamento Z-PRO do pós-pagamento
    if (!ZPRO_ADMIN_URL || !ZPRO_ADMIN_TOKEN) {
      return res.status(503).json({ error: 'Z-PRO não configurado.' });
    }

    await createZproTenantAndChannel(broker);

    res.json({ success: true, message: 'Tenant Z-PRO provisionado com sucesso.' });
  } catch (err: any) {
    console.error('[Provision] erro:', err?.message);
    res.status(500).json({ error: err.message });
  }
});

// Atualiza credenciais Z-PRO de um corretor (usado enquanto ZPRO_API_SECRET não configurado)
// Body: { zpro_api_key, zpro_api_token, zpro_api_url? }
adminRouter.patch("/api/admin/brokers/:id/zpro-credentials", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const { zpro_api_key, zpro_api_token, zpro_api_url } = req.body;
  if (!zpro_api_key || !zpro_api_token) {
    return res.status(400).json({ error: 'zpro_api_key e zpro_api_token são obrigatórios' });
  }
  const url = zpro_api_url || `${ZPRO_ADMIN_URL}/v2/api/external/${zpro_api_key}`;
  const { error } = await supabase.from('imf_brokers').update({
    zpro_api_key: String(zpro_api_key),
    zpro_api_url: url,
    zpro_api_token: String(zpro_api_token)
  }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  console.log(`[Admin] zpro-credentials atualizados para broker ${req.params.id}`);
  res.json({ success: true, zpro_api_key, zpro_api_url: url });
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
      await fetch(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}/cancel`, {
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
      await fetch(`${ASAAS_BASE_URL}/subscriptions/${broker.asaas_subscription_id}/cancel`, {
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

// Re-vincula instância UAZAPI ao canal Z-PRO: garante wppUser (Number ID) salvo
// E o webhook UAZAPI→Z-PRO configurado, sem recriar a instância nem disparar connect.
// Corrige canais provisionados antes da correção do webhook (sintoma: CONNECTED mas "Não ativado").
// IMPORTANTE: lê o canal via LOGIN do tenant (token forjado com userId=0 dá ERR_AUTH_USER_NOT_FOUND;
// super admin dá 500 em /whatsapp/:id de outro tenant — só o token de login do tenant funciona).
adminRouter.post("/api/admin/brokers/:id/relink-uazapi", async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data: broker } = await supabase
      .from('imf_brokers').select('*').eq('id', req.params.id).single();
    if (!broker) return res.status(404).json({ error: 'Corretor não encontrado' });
    if (!broker.zpro_channel_id) return res.status(400).json({ error: 'Canal Z-PRO não configurado para este corretor.' });
    if (!UAZAPI_HOST || !UAZAPI_TOKEN) return res.status(503).json({ error: 'UAZAPI não configurado no servidor.' });

    const whatsappId = Number(broker.zpro_channel_id);
    const tenantId   = Number(broker.zpro_tenant_id) || 0;
    const tenantEmail = broker.zpro_user_email || broker.email;

    // Obtém token de tenant válido via LOGIN (userId real). Fallback: forja com userId do JWT.
    let tenantToken: string | undefined;
    if (tenantEmail && broker.zpro_password) {
      const loginRes = await zproPost('/auth/login', { email: tenantEmail, password: broker.zpro_password });
      const rawToken = loginRes.json?.token ?? loginRes.json?.access_token ?? loginRes.json?.accessToken ?? loginRes.json?.data?.token;
      if (rawToken) {
        tenantToken = rawToken;
        console.log(`[ReLink] Login tenant ${tenantId} OK`);
      } else {
        console.warn(`[ReLink] Login falhou (${loginRes.status}) — seguindo com super admin`);
      }
    }
    const readToken = tenantToken ?? await getZproAdminToken();

    // 1. Busca canal Z-PRO para obter tokenAPI e wppUser atuais
    const channelCheck = await zproGet(`/whatsapp/${whatsappId}`, readToken);
    const currentTokenAPI = channelCheck.json?.tokenAPI;
    let currentWabaId     = channelCheck.json?.wabaId;
    console.log(`[ReLink] Canal ${whatsappId}: tokenAPI=${currentTokenAPI?.slice(0,8) ?? 'null'} wabaId=${currentWabaId ?? 'null'}`);

    if (!currentTokenAPI) {
      return res.status(400).json({
        error: 'tokenAPI não encontrado no canal Z-PRO. Re-provisione o corretor para recriar a instância UAZAPI.'
      });
    }

    // 2. Lista instâncias UAZAPI e encontra a que corresponde ao tokenAPI
    const uazapiResp = await fetch(`${UAZAPI_HOST}/instance/all`, {
      headers: { 'admintoken': UAZAPI_TOKEN }
    });
    const instances: any[] = await uazapiResp.json().catch(() => []);
    const instance = instances.find((i: any) =>
      i.token === currentTokenAPI || i.instance?.token === currentTokenAPI
    );

    if (!instance) {
      return res.status(404).json({
        error: 'Instância UAZAPI não encontrada para o tokenAPI do canal. Pode ter sido removida no UAZAPI.',
        tokenAPI: currentTokenAPI.slice(0, 8) + '...',
        totalInstances: instances.length
      });
    }

    const instanceId: string    = instance.id ?? instance.instance?.id ?? '';
    const instanceToken: string = instance.token ?? instance.instance?.token ?? currentTokenAPI;
    if (!instanceId) {
      return res.status(500).json({ error: 'instanceId não encontrado na resposta UAZAPI.', instance });
    }
    console.log(`[ReLink] Instância UAZAPI encontrada: id=${instanceId}`);

    // 3. Salva o Number ID na coluna `wabaId` (campo real do painel) se ainda não estiver setado.
    let wabaIdSaved = currentWabaId === instanceId;
    if (!wabaIdSaved) {
      const tokens = tenantToken
        ? [{ label: 'tenant', tok: tenantToken }, { label: 'superAdmin', tok: await getZproAdminToken() }]
        : [{ label: 'superAdmin', tok: await getZproAdminToken() }];
      for (const { label, tok } of tokens) {
        await zproPut(`/whatsapp/${whatsappId}`, { wabaId: instanceId }, tok);
        const check = await zproGet(`/whatsapp/${whatsappId}`, tok);
        if (check.json?.wabaId === instanceId) {
          console.log(`[ReLink] wabaId=${instanceId} salvo via ${label} ✓`);
          wabaIdSaved = true; currentWabaId = instanceId;
          break;
        }
        console.warn(`[ReLink] wabaId NÃO salvo via ${label}: check=${check.json?.wabaId}`);
      }
    }
    // wppUser também (best-effort, compatibilidade)
    await zproPut(`/whatsapp/${whatsappId}`, { wppUser: instanceId }, tenantToken);

    // 4. Configura o webhook UAZAPI→Z-PRO (entrega de mensagens) — SEMPRE.
    const webhookOk = await setUazapiWebhook(instanceToken, instanceId);

    res.json({
      success: wabaIdSaved && webhookOk,
      wabaId: instanceId,
      wabaIdSaved,
      webhookConfigured: webhookOk,
      message: (wabaIdSaved && webhookOk)
        ? `Canal ${whatsappId} corrigido: Number ID "${instanceId}" salvo (wabaId) e webhook ativo. Desconecte e reconecte o WhatsApp para ativar.`
        : `Parcial — wabaIdSaved=${wabaIdSaved}, webhookConfigured=${webhookOk}. Verifique os logs do servidor.`
    });
  } catch (err: any) {
    console.error('[ReLink] erro:', err?.message);
    res.status(500).json({ error: err.message });
  }
});
