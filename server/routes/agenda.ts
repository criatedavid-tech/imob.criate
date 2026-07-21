import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
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

    const startRaw = req.query.start;
    const endRaw = req.query.end;
    const startDate = typeof startRaw === 'string' ? new Date(startRaw) : null;
    const endDate = typeof endRaw === 'string' ? new Date(endRaw) : null;
    if (
      (startRaw !== undefined && (!startDate || Number.isNaN(startDate.getTime())))
      || (endRaw !== undefined && (!endDate || Number.isNaN(endDate.getTime())))
    ) {
      return res.status(400).json({ error: 'start/end devem ser datas ISO válidas.' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: 'start não pode ser posterior a end.' });
    }
    const start = startDate?.toISOString();
    const end = endDate?.toISOString();
    const requestedLimit = req.query.limit === undefined ? 500 : Number(req.query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
      return res.status(400).json({ error: 'limit deve ser um inteiro entre 1 e 1000.' });
    }
    // event_type distingue visita real (padrão, calendário de sempre) de
    // lembrete criado pelo Assistente IA (ação create_reminder) — a tela
    // Lembretes pede ?event_type=lembrete; a Agenda não passa nada e cai
    // no padrão de sempre.
    const eventTypeRaw = req.query.event_type;
    if (eventTypeRaw !== undefined && eventTypeRaw !== 'visita' && eventTypeRaw !== 'lembrete') {
      return res.status(400).json({ error: "event_type deve ser 'visita' ou 'lembrete'." });
    }
    const eventType = eventTypeRaw === 'lembrete' ? 'lembrete' : 'visita';

    let query = supabase
      .from('imf_agenda')
      .select('*, imf_properties(title)')
      .eq('broker_id', brokerId)
      .eq('event_type', eventType);

    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);
    if (start) query = query.gte('scheduled_at', start);
    if (end)   query = query.lte('scheduled_at', end);
    query = query.order('scheduled_at', { ascending: true }).limit(requestedLimit);

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
        owner_user_id: userId,
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

    const query = supabase.from('imf_agenda').update(updates).eq('id', id).eq('broker_id', brokerId);
    if (!(await isBrokerOwner(userId, brokerId))) query.eq('owner_user_id', userId);

    const { data, error } = await query.select().maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
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
    const query = supabase.from('imf_agenda').delete().eq('id', id).eq('broker_id', brokerId);
    if (!(await isBrokerOwner(userId, brokerId))) query.eq('owner_user_id', userId);

    const { data, error } = await query.select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(403).json({ error: 'Acesso negado.' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/agenda/visits/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// AGENDA — Endpoints para N8N (auth: INTERNAL_PROXY_TOKEN, broker_id no body/query)
// Endpoints internos de agenda consumidos pelo Agente IA Corretor.
// ─────────────────────────────────────────────────────────────────────────

function requireInternalToken(req: any, res: any): boolean {
  const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
    res.status(401).json({ error: 'Token inválido.' });
    return false;
  }
  return true;
}

// [N8N] Lista agendamentos de um corretor.
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
      .eq('event_type', 'visita') // agente externo só decide horário ocupado/livre com base em visita real, nunca lembrete do corretor
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
      // Horário já convertido pro fuso de Brasília, pronto pra leitura —
      // startAt/scheduled_at acima são UTC puro (formato do banco), e pedir
      // pro modelo fazer a conta de fuso sozinho é frágil (foi exatamente
      // isso que causou uma visita marcada 3h errada em 2026-07-14: a
      // ferramenta de agendamento do N8N gravava a hora local como se já
      // fosse UTC). Sempre usar ESTE campo pra decidir horário ocupado/livre.
      horario_brasilia: new Date(a.scheduled_at).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }),
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

// [N8N] Cria agendamento.
// ⚠️ Contrato de fuso: startAt/endAt são passados direto pro `new Date()` do
// Node — precisam vir com offset EXPLÍCITO. "-03:00" pra hora de Brasília
// (ex.: "2026-07-14T16:00:00-03:00" pras 16h daqui), nunca "Z"/UTC nem sem
// offset nenhum pra representar hora local — isso já causou uma visita
// marcada 3h errada (16h combinada com o cliente virou 13h gravado, porque
// o prompt do N8N mandava "Z" pra hora que na verdade era de Brasília).
agendaRouter.post('/api/agenda/n8n/create', async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  try {
    const {
      broker_id, client_name, client_phone, client_email,
      startAt, endAt, title, notes, property_id
    } = req.body;

    if (!broker_id) return res.status(400).json({ error: 'broker_id é obrigatório.' });
    if (!startAt)   return res.status(400).json({ error: 'startAt é obrigatório.' });
    // Nome do cliente costuma não estar disponível ainda no momento de agendar
    // (o cliente pode marcar visita antes de se identificar) — telefone sempre
    // temos, vindo da própria conversa, então nunca bloqueia a criação.
    if (!client_name && !client_phone) return res.status(400).json({ error: 'client_name ou client_phone é obrigatório.' });

    const scheduled_at = new Date(startAt).toISOString();
    const duration_minutes = endAt
      ? Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)
      : 60;

    const { data, error } = await supabase
      .from('imf_agenda')
      .insert({
        broker_id,
        client_name: client_name || client_phone || 'Cliente',
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

// [N8N] Atualiza agendamento.
// Mesmo contrato de fuso do POST /create acima: startAt/endAt precisam de
// offset explícito ("-03:00" pra Brasília, nunca "Z").
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

// [N8N] Cancela agendamento.
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
