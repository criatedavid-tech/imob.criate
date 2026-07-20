import express from "express";
import { supabase } from "../supabase";
import { requireUser, optionalUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { fetchWithTimeout } from "../lib/http";
import { resolveNewLeadStage } from "../services/crmPipelines";

export const leadsRouter = express.Router();

const DEFAULT_LEADS_PAGE_SIZE = 100;
const MAX_LEADS_PAGE_SIZE = 200;
const MAX_PAGINATION_OFFSET = 10_000_000;
const LEAD_STATUSES = ['new', 'contato', 'visita', 'proposta', 'fechado'] as const;

function isLeadStatus(value: unknown): value is typeof LEAD_STATUSES[number] {
  return typeof value === 'string' && LEAD_STATUSES.includes(value as typeof LEAD_STATUSES[number]);
}

function parsePagination(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseOptionalDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Um lead pertence ao broker de duas formas: preso a um imóvel do broker
// (fluxo tradicional, landing page/cadastro manual com property_id), ou com
// property_id nulo e broker_id preenchido direto (fluxo novo — criado a
// partir de uma conversa, sem imóvel de interesse ainda). Centraliza a
// checagem pra PATCH/DELETE não precisarem embutir OR em query de update
// (supabase-js quebra .or() combinado com .update().eq(), já visto nesta
// base — ver provisioning.ts). Lê, valida posse, e só então muta pelo id.
async function leadBrokerAccess(brokerId: string, userId: string, isOwner: boolean, leadId: string): Promise<any | null> {
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (!lead) return null;

  let inScope = false;
  if (lead.property_id) {
    const { data: prop } = await supabase.from('imf_properties').select('id').eq('id', lead.property_id).eq('broker_id', brokerId).maybeSingle();
    inScope = !!prop;
  } else {
    inScope = lead.broker_id === brokerId;
  }
  if (!inScope) return null;
  if (!isOwner && lead.owner_user_id !== userId) return null;
  return lead;
}

leadsRouter.get("/api/leads/recent", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: propIds, error: idsError } = await supabase
      .from('imf_properties')
      .select('id, title')
      .eq('broker_id', brokerId);

    if (idsError) throw idsError;

    const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
    const ids = Array.from(propertiesMap.keys());

    // Lead pode estar preso a um imóvel do broker OU (sem imóvel ainda,
    // ex.: criado a partir de uma conversa) escopado direto por broker_id.
    let query = supabase.from('leads').select('*');
    query = ids.length > 0
      ? query.or(`property_id.in.(${ids.join(',')}),and(property_id.is.null,broker_id.eq.${brokerId})`)
      : query.eq('broker_id', brokerId).is('property_id', null);
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(5);
    if (error) throw error;
    const leads = data || [];

    const formattedLeads = leads.map((l: any) => ({
      id: l.id,
      name: l.name || l.client_name || 'Sem nome',
      property: l.property_id ? (propertiesMap.get(l.property_id) || 'Imóvel desconhecido') : null,
      time: l.created_at,
      status: l.status
    }));

    res.json(formattedLeads);
  } catch (err: any) {
    console.error("Erro GET /api/leads/recent:", err);
    res.json([]);
  }
});

// --- FLUXO DE CAPTURA DE LEADS (30/04/2026) ---
/**
 * Endpoint aprimorado para salvar leads e disparar integrações automáticas.
 */
leadsRouter.post("/api/leads", optionalUser, async (req, res) => {
  try {
    const { property_id, name, phone, email, status, notes, pipeline_id: pipelineIdHint } = req.body;

    // 1. Validação básica
    if (!name || !phone || !property_id) {
      return res.status(400).json({ error: "Nome, telefone e ID do imóvel são obrigatórios." });
    }
    const leadStatus = status === undefined || status === null || status === '' ? 'new' : status;
    if (!isLeadStatus(leadStatus)) {
      return res.status(400).json({ error: `Status inválido. Use: ${LEAD_STATUSES.join(', ')}.` });
    }

    const { data: prop } = await supabase.from('imf_properties').select('owner_user_id, broker_id').eq('id', property_id).maybeSingle();
    if (!prop) return res.status(400).json({ error: "Imóvel não encontrado." });

    // Dono do lead: se foi um membro logado que cadastrou manualmente, o
    // lead é dele. Se veio da landing pública (cliente se cadastrando
    // sozinho, sem sessão), o lead herda o dono do imóvel anunciado.
    const userId = (req as any).userId as string | null;
    const ownerUserId = userId || prop.owner_user_id || null;

    // Todo lead novo entra no pipeline padrão do broker (ou no pipeline
    // indicado pelo body, se pertencer a ele — ex.: corretor criando direto
    // de dentro de um pipeline específico no Kanban) já na primeira etapa
    // ativa. Nunca confia cegamente num pipeline_id solto vindo do cliente.
    const { pipeline_id, pipeline_stage_id } = await resolveNewLeadStage(
      prop.broker_id,
      typeof pipelineIdHint === 'string' ? pipelineIdHint : null,
    );

    // 2. Inserir na tabela leads
    const { data: lead, error: insertError } = await supabase.from('leads').insert([
      {
        property_id,
        name,
        phone,
        email: email || '',
        status: leadStatus,
        notes: notes || 'Lead via Landing Page',
        owner_user_id: ownerUserId,
        pipeline_id,
        pipeline_stage_id,
        created_at: new Date()
      }
    ]).select().single();

    if (insertError) throw insertError;

    // 3. Roteamento (Chatbot Webhook ou E-mail)
    const webhookUrl = process.env.CHATBOT_WEBHOOK_URL;
    let integrationStatus = "none";

    if (webhookUrl) {
      // Envio assíncrono para o Webhook (Fire and Forget)
      fetchWithTimeout(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          name,
          phone,
          property_id,
          origin: 'Landing Page',
          timestamp: new Date().toISOString()
        })
      }).catch(err => console.error("Erro ao disparar Webhook:", err));
      integrationStatus = "chatbot";
    } else {
      integrationStatus = "none";
    }

    // 4. Log (Opcional - usando console para não criar novas tabelas se não existirem)
    console.log(`// FLUXO ENVIAR LEAD 30/04/2026: Lead ID ${lead.id} enviado. Chatbot: ${webhookUrl ? 'sim' : 'nao'}`);

    res.status(201).json({ ...lead, integrationStatus });
  } catch (err: any) {
    console.error("Erro no fluxo de envio de lead:", err);
    res.status(500).json({ error: "Falha ao processar contato. Por favor, use o WhatsApp." });
  }
});

leadsRouter.get("/api/leads", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = parsePagination(req.query.limit, DEFAULT_LEADS_PAGE_SIZE, 1, MAX_LEADS_PAGE_SIZE);
    const offset = parsePagination(req.query.offset, 0, 0, MAX_PAGINATION_OFFSET);
    const createdFrom = parseOptionalDate(req.query.created_from);
    const createdTo = parseOptionalDate(req.query.created_to);
    if (limit === null || offset === null) {
      return res.status(400).json({ error: `limit deve estar entre 1 e ${MAX_LEADS_PAGE_SIZE}; offset deve ser um inteiro entre 0 e ${MAX_PAGINATION_OFFSET}.` });
    }
    if (createdFrom === null || createdTo === null) {
      return res.status(400).json({ error: 'created_from/created_to devem ser datas ISO válidas.' });
    }

    const brokerId = await getBrokerId(userId);
    if (!brokerId) {
      res.setHeader('X-Total-Count', '0');
      res.setHeader('X-Has-More', 'false');
      return res.json([]);
    }

    const { data: propIds, error: idsError } = await supabase
      .from('imf_properties')
      .select('id, title')
      .eq('broker_id', brokerId);

    if (idsError) throw idsError;

    const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
    const ids = Array.from(propertiesMap.keys());

    // Lead pode estar preso a um imóvel do broker OU (sem imóvel ainda,
    // ex.: criado a partir de uma conversa) escopado direto por broker_id.
    let query = supabase.from('leads').select('*', { count: 'exact' });
    query = ids.length > 0
      ? query.or(`property_id.in.(${ids.join(',')}),and(property_id.is.null,broker_id.eq.${brokerId})`)
      : query.eq('broker_id', brokerId).is('property_id', null);
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
    if (createdFrom) query = query.gte('created_at', createdFrom);
    if (createdTo) query = query.lt('created_at', createdTo);
    // Filtro do Kanban do CRM — leads já são escopados ao broker acima, então
    // um pipeline_id de outro broker só resulta em lista vazia, nunca em vazamento.
    if (typeof req.query.pipeline_id === 'string' && req.query.pipeline_id) {
      query = query.eq('pipeline_id', req.query.pipeline_id);
    }
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const leads = data || [];
    const total = count || 0;

    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Pagination-Limit', String(limit));
    res.setHeader('X-Pagination-Offset', String(offset));
    res.setHeader('X-Has-More', String(offset + leads.length < total));

    res.json(leads.map((l: any) => ({
      ...l,
      name: l.name || l.client_name || 'Sem nome',
      phone: l.phone || l.client_phone || '',
      property: l.property_id ? (propertiesMap.get(l.property_id) || 'Imóvel desconhecido') : null
    })));
  } catch (err: any) {
    console.error("Erro GET /api/leads:", err);
    res.status(500).json({ error: err.message });
  }
});

// Atualiza o status de um lead
leadsRouter.patch("/api/leads/:id/status", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status é obrigatório." });
    if (!isLeadStatus(status)) {
      return res.status(400).json({ error: `Status inválido. Use: ${LEAD_STATUSES.join(', ')}.` });
    }

    const isOwner = await isBrokerOwner(userId, brokerId);
    const lead = await leadBrokerAccess(brokerId, userId, isOwner, req.params.id);
    if (!lead) return res.status(403).json({ error: 'Acesso negado.' });

    // Compatibilidade com integrações antigas: se o lead já usa CRM dinâmico,
    // o status legado não pode divergir da coluna mostrada no Kanban.
    const updates: Record<string, any> = { status };
    updates.closed_at = status === 'fechado' ? new Date().toISOString() : null;

    if (lead.pipeline_id) {
      const { data: pipeline, error: pipelineError } = await supabase
        .from('imf_crm_pipelines')
        .select('id')
        .eq('id', lead.pipeline_id)
        .eq('broker_id', brokerId)
        .eq('active', true)
        .maybeSingle();
      if (pipelineError) throw pipelineError;
      if (!pipeline) return res.status(409).json({ error: 'O pipeline atual do lead não está ativo.' });

      const { data: stages, error: stagesError } = await supabase
        .from('imf_crm_pipeline_stages')
        .select('id, name, position, stage_type')
        .eq('pipeline_id', pipeline.id)
        .eq('active', true)
        .order('position', { ascending: true });
      if (stagesError) throw stagesError;

      const activeStages = stages || [];
      let targetStage: any | undefined;
      if (status === 'fechado') {
        targetStage = activeStages.find((stage: any) => stage.stage_type === 'won');
      } else {
        const expectedName: Record<string, string> = {
          new: 'novo',
          contato: 'em contato',
          visita: 'visita',
          proposta: 'proposta',
        };
        targetStage = activeStages.find((stage: any) => stage.stage_type === 'open'
          && String(stage.name || '').trim().toLocaleLowerCase('pt-BR') === expectedName[status]);
        // Pipelines personalizados podem não usar os nomes históricos. Nesse
        // caso, preserva a etapa open atual; se ela não existir, usa a primeira.
        targetStage ||= activeStages.find((stage: any) => stage.id === lead.pipeline_stage_id && stage.stage_type === 'open');
        targetStage ||= activeStages.find((stage: any) => stage.stage_type === 'open');
      }

      if (!targetStage) {
        return res.status(409).json({
          error: status === 'fechado'
            ? 'Este pipeline não possui uma etapa ativa do tipo Ganho.'
            : 'Este pipeline não possui uma etapa ativa em andamento.',
        });
      }
      // O trigger deriva pipeline_id e reforça status/closed_at a partir do
      // tipo semântico da etapa. Incluir status mantém o valor legado mais
      // específico (contato/visita/proposta) quando a etapa é open.
      updates.pipeline_stage_id = targetStage.id;
    }

    const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/leads/:id/status:", err);
    res.status(500).json({ error: "Falha interna ao atualizar o status do lead." });
  }
});

// Move o lead pra uma etapa de um pipeline do CRM — substitui /status como
// caminho principal do Kanban novo (pipelines/etapas configuráveis), mas
// /status continua disponível ao lado e sincroniza a etapa quando possível
// (compat com chamador externo que ainda usa os 5 valores fixos). pipeline_id
// nunca é recebido do cliente: é sempre derivado do stage_id pelo trigger
// trg_imf_sync_lead_pipeline_stage no banco, junto com status/closed_at
// (ver supabase/migrations/20260717b_crm_pipelines.sql).
leadsRouter.patch("/api/leads/:id/stage", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { stage_id } = req.body;
    if (!stage_id || typeof stage_id !== 'string') return res.status(400).json({ error: "stage_id é obrigatório." });

    const { data: stage } = await supabase
      .from('imf_crm_pipeline_stages')
      .select('id, pipeline_id')
      .eq('id', stage_id)
      .eq('active', true)
      .maybeSingle();
    if (!stage) return res.status(404).json({ error: "Etapa não encontrada." });
    const { data: pipeline } = await supabase
      .from('imf_crm_pipelines')
      .select('id')
      .eq('id', stage.pipeline_id)
      .eq('broker_id', brokerId)
      .eq('active', true)
      .maybeSingle();
    if (!pipeline) return res.status(403).json({ error: "Etapa não pertence a este broker." });

    const isOwner = await isBrokerOwner(userId, brokerId);
    const lead = await leadBrokerAccess(brokerId, userId, isOwner, req.params.id);
    if (!lead) return res.status(403).json({ error: 'Acesso negado.' });

    const { data, error } = await supabase.from('leads').update({ pipeline_stage_id: stage_id }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/leads/:id/stage:", err);
    res.status(500).json({ error: "Falha interna ao mover o lead." });
  }
});

// Edita os dados do lead (nome/telefone/imóvel/observações) — diferente do
// /status acima, que só move o estágio do funil.
leadsRouter.patch("/api/leads/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const isOwner = await isBrokerOwner(userId, brokerId);
    const lead = await leadBrokerAccess(brokerId, userId, isOwner, req.params.id);
    if (!lead) return res.status(403).json({ error: 'Acesso negado.' });

    const allowed = ['name', 'phone', 'email', 'notes', 'property_id'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada para atualizar.' });
    if (updates.property_id) {
      const { data: prop } = await supabase.from('imf_properties').select('id').eq('id', updates.property_id).eq('broker_id', brokerId).maybeSingle();
      if (!prop) return res.status(403).json({ error: 'Imóvel não pertence a este corretor.' });
    }
    // broker_id fica sempre presente pra escopar o lead mesmo se property_id virar null depois.
    if (!lead.broker_id) updates.broker_id = brokerId;

    const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/leads/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

leadsRouter.delete("/api/leads/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const isOwner = await isBrokerOwner(userId, brokerId);
    const lead = await leadBrokerAccess(brokerId, userId, isOwner, req.params.id);
    if (!lead) return res.status(403).json({ error: 'Acesso negado.' });

    const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/leads/:id:", err);
    res.status(500).json({ error: err.message });
  }
});
