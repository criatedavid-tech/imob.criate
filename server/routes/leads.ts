import express from "express";
import { supabase } from "../supabase";
import { requireUser, optionalUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { fetchWithTimeout } from "../lib/http";

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

    let leads: any[] = [];
    if (ids.length > 0) {
      let query = supabase.from('leads').select('*').in('property_id', ids);
      if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(5);
      if (error) throw error;
      leads = data || [];
    }

    const formattedLeads = leads.map((l: any) => ({
      id: l.id,
      name: l.name || l.client_name || 'Sem nome',
      property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido',
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
    const { property_id, name, phone, email, status, notes } = req.body;

    // 1. Validação básica
    if (!name || !phone || !property_id) {
      return res.status(400).json({ error: "Nome, telefone e ID do imóvel são obrigatórios." });
    }
    const leadStatus = status === undefined || status === null || status === '' ? 'new' : status;
    if (!isLeadStatus(leadStatus)) {
      return res.status(400).json({ error: `Status inválido. Use: ${LEAD_STATUSES.join(', ')}.` });
    }

    // Dono do lead: se foi um membro logado que cadastrou manualmente, o
    // lead é dele. Se veio da landing pública (cliente se cadastrando
    // sozinho, sem sessão), o lead herda o dono do imóvel anunciado.
    const userId = (req as any).userId as string | null;
    let ownerUserId = userId || null;
    if (!ownerUserId) {
      const { data: prop } = await supabase.from('imf_properties').select('owner_user_id').eq('id', property_id).maybeSingle();
      ownerUserId = prop?.owner_user_id || null;
    }

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

    let leads: any[] = [];
    let total = 0;
    if (ids.length > 0) {
      let query = supabase.from('leads').select('*', { count: 'exact' }).in('property_id', ids);
      if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
      if (createdFrom) query = query.gte('created_at', createdFrom);
      if (createdTo) query = query.lt('created_at', createdTo);
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      leads = data || [];
      total = count || 0;
    }

    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Pagination-Limit', String(limit));
    res.setHeader('X-Pagination-Offset', String(offset));
    res.setHeader('X-Has-More', String(offset + leads.length < total));

    res.json(leads.map((l: any) => ({
      ...l,
      name: l.name || l.client_name || 'Sem nome',
      phone: l.phone || l.client_phone || '',
      property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido'
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

    // Escopo multi-tenant: só atualiza lead cujo imóvel pertence ao corretor autenticado
    const { data: propIds } = await supabase
      .from('imf_properties')
      .select('id')
      .eq('broker_id', brokerId);
    const ids = (propIds || []).map((p: any) => p.id);
    if (!ids.length) return res.status(403).json({ error: 'Acesso negado.' });

    // closed_at marca quando o negócio foi de fato fechado (usado pela meta
    // do mês em /api/equipe/goal) — seta ao entrar em "fechado", limpa se
    // for movido de volta por engano.
    const updates: Record<string, any> = { status };
    updates.closed_at = status === 'fechado' ? new Date().toISOString() : null;

    let query = supabase.from('leads').update(updates).eq('id', req.params.id).in('property_id', ids);
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
    const { data, error } = await query.select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/leads/:id/status:", err);
    res.status(500).json({ error: err.message });
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

    const { data: propIds } = await supabase
      .from('imf_properties')
      .select('id')
      .eq('broker_id', brokerId);
    const ids = (propIds || []).map((p: any) => p.id);
    if (!ids.length) return res.status(403).json({ error: 'Acesso negado.' });

    const allowed = ['name', 'phone', 'email', 'notes', 'property_id'];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada para atualizar.' });
    if (updates.property_id && !ids.includes(updates.property_id)) {
      return res.status(403).json({ error: 'Imóvel não pertence a este corretor.' });
    }

    let query = supabase.from('leads').update(updates).eq('id', req.params.id).in('property_id', ids);
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
    const { data, error } = await query.select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/leads/:id:", err);
    res.status(500).json({ error: err.message });
  }
});
