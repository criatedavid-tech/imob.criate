import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { INTERNAL_PROXY_TOKEN } from "../config";

export const agendaRouter = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// AGENDA — CRUD completo
// ─────────────────────────────────────────────────────────────────────────

agendaRouter.get("/api/agenda/visits", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { start, end } = req.query as { start?: string; end?: string };

    let query = supabase
      .from('imf_agenda')
      .select('*, imf_properties(title)')
      .eq('broker_id', brokerId)
      .order('scheduled_at', { ascending: true });

    if (start) query = query.gte('scheduled_at', start);
    if (end)   query = query.lte('scheduled_at', end);

    const { data: agendaVisits, error: agendaError } = await query;
    if (agendaError) throw agendaError;

    const formatted = (agendaVisits || []).map((a: any) => ({
      ...a,
      name: a.client_name || 'Sem nome',
      phone: a.client_phone || '',
      email: a.client_email || '',
      property: a.imf_properties?.title || null,
    }));

    res.json(formatted);
  } catch (err: any) {
    console.error("Erro GET /api/agenda/visits:", err);
    res.status(500).json({ error: err.message });
  }
});

agendaRouter.post("/api/agenda/visits", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const {
      client_name, client_phone, client_email,
      scheduled_at, duration_minutes, title, notes,
      property_id, source
    } = req.body;

    if (!client_name || !scheduled_at) {
      return res.status(400).json({ error: "client_name e scheduled_at são obrigatórios" });
    }

    const { data, error } = await supabase
      .from('imf_agenda')
      .insert({
        broker_id: brokerId,
        property_id: property_id || null,
        client_name,
        client_phone: client_phone || null,
        client_email: client_email || null,
        scheduled_at,
        duration_minutes: duration_minutes || 60,
        title: title || null,
        notes: notes || null,
        status: 'pendente',
        source: source || 'manual',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/agenda/visits:", err);
    res.status(500).json({ error: err.message });
  }
});

agendaRouter.patch("/api/agenda/visits/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { id } = req.params;
    const allowed = [
      'client_name', 'client_phone', 'client_email',
      'scheduled_at', 'duration_minutes', 'title', 'notes',
      'property_id', 'status'
    ];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from('imf_agenda')
      .update(updates)
      .eq('id', id)
      .eq('broker_id', brokerId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/agenda/visits/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

agendaRouter.delete("/api/agenda/visits/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { id } = req.params;
    const { error } = await supabase
      .from('imf_agenda')
      .delete()
      .eq('id', id)
      .eq('broker_id', brokerId);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/agenda/visits/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// AGENDA — Endpoints para N8N (auth: INTERNAL_PROXY_TOKEN, broker_id no body/query)
// Substituem as tools zpro_api_url/appointment/* do Agente IA Corretor
// ─────────────────────────────────────────────────────────────────────────

function requireInternalToken(req: any, res: any): boolean {
  const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
    res.status(401).json({ error: 'Token inválido.' });
    return false;
  }
  return true;
}

// [N8N] Lista agendamentos de um corretor (substitui GET /appointment/list do ZPro)
// Query: broker_id (obrigatório), phone (opcional — filtra por cliente)
agendaRouter.get('/api/agenda/n8n/list', async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  try {
    const { broker_id, phone } = req.query as { broker_id?: string; phone?: string };
    if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório.' });

    let query = supabase
      .from('imf_agenda')
      .select('*, imf_properties(title)')
      .eq('broker_id', broker_id)
      .order('scheduled_at', { ascending: true });

    if (phone) {
      const normalized = phone.replace(/\D/g, '');
      query = query.ilike('client_phone', `%${normalized}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json((data || []).map((a: any) => ({
      id:               a.id,
      title:            a.title || `Visita — ${a.client_name}`,
      client_name:      a.client_name,
      client_phone:     a.client_phone,
      scheduled_at:     a.scheduled_at,
      startAt:          a.scheduled_at,
      endAt:            new Date(new Date(a.scheduled_at).getTime() + (a.duration_minutes || 60) * 60000).toISOString(),
      duration_minutes: a.duration_minutes,
      status:           a.status,
      notes:            a.notes,
      property:         a.imf_properties?.title || null,
      source:           a.source,
      created_at:       a.created_at,
    })));
  } catch (err: any) {
    console.error('[Agenda N8N] GET list:', err);
    res.status(500).json({ error: err.message });
  }
});

// [N8N] Cria agendamento (substitui POST /appointment/create do ZPro)
agendaRouter.post('/api/agenda/n8n/create', async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  try {
    const {
      broker_id, client_name, client_phone, client_email,
      startAt, endAt, title, notes, property_id
    } = req.body;

    if (!broker_id)   return res.status(400).json({ error: 'broker_id é obrigatório.' });
    if (!client_name) return res.status(400).json({ error: 'client_name é obrigatório.' });
    if (!startAt)     return res.status(400).json({ error: 'startAt é obrigatório.' });

    const scheduled_at = new Date(startAt).toISOString();
    const duration_minutes = endAt
      ? Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)
      : 60;

    const { data, error } = await supabase
      .from('imf_agenda')
      .insert({
        broker_id,
        client_name,
        client_phone:     client_phone || null,
        client_email:     client_email || null,
        scheduled_at,
        duration_minutes: duration_minutes > 0 ? duration_minutes : 60,
        title:            title || null,
        notes:            notes || null,
        property_id:      property_id || null,
        status:           'pendente',
        source:           'ia',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ ok: true, id: data.id, scheduled_at: data.scheduled_at });
  } catch (err: any) {
    console.error('[Agenda N8N] POST create:', err);
    res.status(500).json({ error: err.message });
  }
});

// [N8N] Atualiza agendamento (substitui /appointment/update do ZPro)
agendaRouter.patch('/api/agenda/n8n/:id', async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  try {
    const { id } = req.params;
    const { broker_id, startAt, endAt, title, notes, status } = req.body;

    if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório.' });

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (startAt) updates.scheduled_at = new Date(startAt).toISOString();
    if (endAt && startAt) {
      updates.duration_minutes = Math.round(
        (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000
      );
    }
    if (title)  updates.title  = title;
    if (notes)  updates.notes  = notes;
    if (status) updates.status = status;

    const { data, error } = await supabase
      .from('imf_agenda')
      .update(updates)
      .eq('id', id)
      .eq('broker_id', broker_id)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, id: data.id, scheduled_at: data.scheduled_at });
  } catch (err: any) {
    console.error('[Agenda N8N] PATCH update:', err);
    res.status(500).json({ error: err.message });
  }
});

// [N8N] Cancela agendamento (substitui /appointment/delete/:id do ZPro)
agendaRouter.delete('/api/agenda/n8n/:id', async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  try {
    const { id } = req.params;
    const broker_id = (req.query.broker_id || req.body?.broker_id) as string;

    if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório.' });

    const { error } = await supabase
      .from('imf_agenda')
      .delete()
      .eq('id', id)
      .eq('broker_id', broker_id);

    if (error) throw error;
    res.json({ ok: true, deleted_id: id });
  } catch (err: any) {
    console.error('[Agenda N8N] DELETE:', err);
    res.status(500).json({ error: err.message });
  }
});

// NOVO LANDING 30/04/2026 - Endpoint para buscar agenda
// Slots públicos de agendamento NÃO implementados: o front (PropertyLanding)
// espera {data, horario}, campos que não existem em imf_agenda, e este endpoint
// é público — expor imf_agenda aqui vazaria nome/telefone de clientes de todos
// os corretores. Retorna vazio até a feature de slots existir de verdade.
agendaRouter.get("/api/agenda", async (_req, res) => {
  res.json([]);
});
