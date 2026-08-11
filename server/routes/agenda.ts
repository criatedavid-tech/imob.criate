import express from "express";
import { PUBLIC_APP_URL } from "../config";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { requireInternalToken } from "../middleware/internalAuth";
import {
  calendarConnectionLimiter,
  calendarDavLimiter,
  calendarFeedReadLimiter,
  n8nInternalLimiter,
} from "../middleware/rateLimits";
import { decryptKey, encryptKey, normalizePhoneBR } from "../lib/crypto";
import {
  N8nInputValidationError,
  parseN8nAgendaContext,
  parseN8nAgendaCreate,
  parseN8nAgendaDelete,
  parseN8nAgendaList,
  parseN8nAgendaUpdate,
} from "../security/n8nGuardrails";
import { advanceLeadToVisitStage } from "../services/crmPipelines";
import {
  buildCalendarFeedUrl,
  calendarFeedTokenHash,
  generateAgendaIcs,
  generateCalendarFeedToken,
  isValidCalendarFeedToken,
} from "../services/calendarFeed";
import {
  buildGoogleAuthorizationUrl,
  calendarOAuthClientScript,
  completeGoogleCalendarConnection,
  disconnectGoogleCalendar,
  generateOAuthState,
  googleCalendarConfigured,
  googleOAuthCompletionHtml,
  hashOAuthState,
  syncGoogleCalendarConnection,
  type CalendarConnection,
} from "../services/googleCalendarSync";
import {
  calDavAccountUrl,
  calDavServerAddress,
  generateCalDavCredentials,
  handleCalDavRequest,
} from "../services/caldavServer";

export const agendaRouter = express.Router();

// ─── Sincronização bidirecional: Google Agenda ─────────────────────────────
agendaRouter.get('/api/agenda/google-sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });
    const { data, error } = await supabase
      .from('imf_agenda_calendar_connections')
      .select('id, include_all, status, last_synced_at, last_error, created_at')
      .eq('broker_id', brokerId)
      .eq('owner_user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();
    if (error) throw error;
    res.json({
      available: googleCalendarConfigured(),
      configured: !!data,
      ...(data || {}),
      scope: data?.include_all ? 'account' : 'user',
    });
  } catch (err) {
    console.error('[Agenda Google] GET status:', err);
    res.status(500).json({ error: 'Não foi possível consultar a conexão do Google.' });
  }
});

agendaRouter.post('/api/agenda/google-sync/connect', requireUser, calendarConnectionLimiter, async (req, res) => {
  try {
    if (!googleCalendarConfigured()) return res.status(503).json({ error: 'Google Agenda ainda não foi configurado no servidor.' });
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });
    const state = generateOAuthState();
    const includeAll = await isBrokerOwner(userId, brokerId);
    const { error } = await supabase.from('imf_agenda_calendar_oauth_states').insert({
      state_hash: hashOAuthState(state),
      broker_id: brokerId,
      owner_user_id: userId,
      include_all: includeAll,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw error;
    res.json({ authorization_url: buildGoogleAuthorizationUrl(state) });
  } catch (err) {
    console.error('[Agenda Google] POST connect:', err);
    res.status(500).json({ error: 'Não foi possível iniciar a conexão com o Google.' });
  }
});

agendaRouter.get('/api/agenda/google/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  const providerError = String(req.query.error || '');
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('State OAuth inválido.');
    const stateHash = hashOAuthState(state);
    const { data, error } = await supabase
      .from('imf_agenda_calendar_oauth_states')
      .select('broker_id, owner_user_id, include_all, expires_at')
      .eq('state_hash', stateHash)
      .maybeSingle();
    if (error || !data || new Date(data.expires_at) <= new Date()) throw new Error('Esta tentativa de conexão expirou. Inicie novamente.');
    // Uso único antes de trocar o code. Um replay não pode reutilizar o state.
    await supabase.from('imf_agenda_calendar_oauth_states').delete().eq('state_hash', stateHash);
    if (providerError || !code) throw new Error(providerError === 'access_denied' ? 'A permissão do Google foi cancelada.' : 'O Google não devolveu o código de autorização.');
    const connectionId = await completeGoogleCalendarConnection({
      code,
      brokerId: data.broker_id,
      userId: data.owner_user_id,
      includeAll: !!data.include_all,
    });
    // A conexão já está persistida; a primeira carga não bloqueia o retorno do OAuth.
    syncGoogleCalendarConnection(connectionId).catch((syncError) => console.error('[Agenda Google] primeira sincronização:', syncError));
    res.type('html').send(googleOAuthCompletionHtml(true));
  } catch (err: any) {
    const message = String(err?.message || 'Falha ao conectar Google Agenda.').slice(0, 180);
    console.error('[Agenda Google] callback:', message);
    res.status(400).type('html').send(googleOAuthCompletionHtml(false, message));
  }
});

agendaRouter.get('/calendar-oauth-complete.js', (_req, res) => {
  res.type('application/javascript').send(calendarOAuthClientScript);
});

agendaRouter.post('/api/agenda/google-sync/run', requireUser, calendarConnectionLimiter, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    const { data } = await supabase.from('imf_agenda_calendar_connections')
      .select('id').eq('broker_id', brokerId).eq('owner_user_id', userId).eq('provider', 'google').maybeSingle();
    if (!data) return res.status(404).json({ error: 'Google Agenda não conectado.' });
    await syncGoogleCalendarConnection(data.id);
    res.json({ ok: true, synced_at: new Date().toISOString() });
  } catch (err: any) {
    console.error('[Agenda Google] sincronização manual:', err);
    res.status(502).json({ error: String(err?.message || 'Falha ao sincronizar com o Google.').slice(0, 300) });
  }
});

agendaRouter.delete('/api/agenda/google-sync', requireUser, calendarConnectionLimiter, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    const { data } = await supabase.from('imf_agenda_calendar_connections')
      .select('*').eq('broker_id', brokerId).eq('owner_user_id', userId).eq('provider', 'google').maybeSingle();
    if (data) await disconnectGoogleCalendar(data as CalendarConnection);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Agenda Google] desconectar:', err);
    res.status(500).json({ error: 'Não foi possível desconectar o Google Agenda.' });
  }
});

// ─── Sincronização bidirecional: Calendário do iPhone via CalDAV ───────────
agendaRouter.get('/api/agenda/iphone-sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });
    const { data, error } = await supabase.from('imf_agenda_calendar_connections')
      .select('id, include_all, status, caldav_username, last_synced_at, last_error, created_at')
      .eq('broker_id', brokerId).eq('owner_user_id', userId).eq('provider', 'caldav').maybeSingle();
    if (error) throw error;
    res.json({
      configured: !!data,
      ...(data || {}),
      server: calDavServerAddress(),
      account_url: calDavAccountUrl(),
      scope: data?.include_all ? 'account' : 'user',
    });
  } catch (err) {
    console.error('[Agenda iPhone] GET status:', err);
    res.status(500).json({ error: 'Não foi possível consultar a conexão do iPhone.' });
  }
});

agendaRouter.post('/api/agenda/iphone-sync', requireUser, calendarConnectionLimiter, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });
    const includeAll = await isBrokerOwner(userId, brokerId);
    const credentials = generateCalDavCredentials();
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('imf_agenda_calendar_connections').upsert({
      broker_id: brokerId,
      owner_user_id: userId,
      provider: 'caldav',
      include_all: includeAll,
      status: 'active',
      caldav_username: credentials.username,
      caldav_password_hash: credentials.passwordHash,
      last_error: null,
      updated_at: now,
    }, { onConflict: 'owner_user_id,provider' }).select('id, include_all, status, caldav_username, created_at').single();
    if (error) throw error;
    res.json({
      configured: true,
      ...data,
      server: calDavServerAddress(),
      account_url: calDavAccountUrl(),
      username: credentials.username,
      password: credentials.password,
      password_visible_once: true,
      scope: includeAll ? 'account' : 'user',
    });
  } catch (err) {
    console.error('[Agenda iPhone] gerar credencial:', err);
    res.status(500).json({ error: 'Não foi possível gerar a conexão segura do iPhone.' });
  }
});

agendaRouter.delete('/api/agenda/iphone-sync', requireUser, calendarConnectionLimiter, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    const { error } = await supabase.from('imf_agenda_calendar_connections').delete()
      .eq('broker_id', brokerId).eq('owner_user_id', userId).eq('provider', 'caldav');
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[Agenda iPhone] desconectar:', err);
    res.status(500).json({ error: 'Não foi possível desativar a conexão do iPhone.' });
  }
});

// O iOS faz a descoberta com PROPFIND (e, conforme a versão, OPTIONS), não
// necessariamente com GET. Restringir esta rota a GET devolvia 404 e deixava
// a tela presa indefinidamente em "Verifying". O 308 preserva o método e o
// corpo ao redirecionar para a coleção CalDAV real.
agendaRouter.all(['/.well-known/caldav', '/.well-known/caldav/'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(308, '/caldav/');
});
agendaRouter.all(
  ['/caldav', '/caldav/*'],
  calendarDavLimiter,
  express.text({ type: () => true, limit: '256kb' }),
  (req, res) => { void handleCalDavRequest(req, res); },
);

// Assinatura privada iCalendar para Google Agenda e Apple Calendar.
agendaRouter.get('/api/agenda/calendar-sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });

    const { data, error } = await supabase
      .from('imf_agenda_calendar_feeds')
      .select('token_enc, include_all, created_at, rotated_at, last_accessed_at')
      .eq('broker_id', brokerId)
      .eq('owner_user_id', userId)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.json({ configured: false });

    const token = decryptKey(data.token_enc);
    res.json({
      configured: true,
      subscription_url: buildCalendarFeedUrl(PUBLIC_APP_URL, token),
      scope: data.include_all ? 'account' : 'user',
      created_at: data.created_at,
      rotated_at: data.rotated_at,
      last_accessed_at: data.last_accessed_at,
    });
  } catch (err) {
    console.error('[Agenda Calendar] GET status:', err);
    res.status(500).json({ error: 'Não foi possível consultar a sincronização.' });
  }
});

agendaRouter.post('/api/agenda/calendar-sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });

    const token = generateCalendarFeedToken();
    const includeAll = await isBrokerOwner(userId, brokerId);
    const rotatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('imf_agenda_calendar_feeds')
      .upsert({
        broker_id: brokerId,
        owner_user_id: userId,
        token_hash: calendarFeedTokenHash(token),
        token_enc: encryptKey(token),
        include_all: includeAll,
        rotated_at: rotatedAt,
        revoked_at: null,
      }, { onConflict: 'owner_user_id' });
    if (error) throw error;

    res.json({
      configured: true,
      subscription_url: buildCalendarFeedUrl(PUBLIC_APP_URL, token),
      scope: includeAll ? 'account' : 'user',
      rotated_at: rotatedAt,
    });
  } catch (err) {
    console.error('[Agenda Calendar] POST rotate:', err);
    res.status(500).json({ error: 'Não foi possível gerar o link privado.' });
  }
});

agendaRouter.delete('/api/agenda/calendar-sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = userId ? await getBrokerId(userId) : null;
    if (!userId || !brokerId) return res.status(403).json({ error: 'Conta não encontrada.' });

    const { error } = await supabase
      .from('imf_agenda_calendar_feeds')
      .delete()
      .eq('broker_id', brokerId)
      .eq('owner_user_id', userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[Agenda Calendar] DELETE:', err);
    res.status(500).json({ error: 'Não foi possível desativar a sincronização.' });
  }
});

agendaRouter.get('/api/agenda/calendar-feed/:token.ics', calendarFeedReadLimiter, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!isValidCalendarFeedToken(token)) return res.status(404).send('Calendário indisponível.');
    const tokenHash = calendarFeedTokenHash(token);

    const { data: feed, error: feedError } = await supabase
      .from('imf_agenda_calendar_feeds')
      .select('broker_id, owner_user_id, include_all')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (feedError || !feed) return res.status(404).send('Calendário indisponível.');

    const now = Date.now();
    let query = supabase
      .from('imf_agenda')
      .select('id, client_name, client_phone, client_email, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at, imf_properties(title)')
      .eq('broker_id', feed.broker_id)
      .eq('event_type', 'visita')
      .gte('scheduled_at', new Date(now - 366 * 24 * 60 * 60_000).toISOString())
      .lte('scheduled_at', new Date(now + 3 * 366 * 24 * 60 * 60_000).toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(5_000);
    if (!feed.include_all) query = query.eq('owner_user_id', feed.owner_user_id);

    const { data: appointments, error: agendaError } = await query;
    if (agendaError) throw agendaError;
    let uidDomain = 'imobiflow.app';
    try { uidDomain = new URL(PUBLIC_APP_URL).hostname || uidDomain; } catch { /* origem validada no deploy */ }
    const calendar = generateAgendaIcs((appointments || []).map((item: any) => ({
      ...item,
      property: item.imf_properties?.title || null,
    })), { uidDomain });

    supabase
      .from('imf_agenda_calendar_feeds')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('token_hash', tokenHash)
      .then(() => {}, () => {});

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="imobiflow-agenda.ics"');
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=300');
    res.send(calendar);
  } catch (err) {
    console.error('[Agenda Calendar] GET feed:', err);
    res.status(500).send('Não foi possível montar o calendário.');
  }
});

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

// Marca como vistas todas as visitas do chatbot ainda nao vistas — chamado
// quando o corretor abre a Agenda no app, zerando o badge (ManualRail.tsx).
// So mexe em broker_seen_at; nao afeta o alerta por WhatsApp (whatsapp_notified_at),
// que e uma via independente.
agendaRouter.post("/api/agenda/visits/mark-chatbot-seen", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json({ ok: true, updated: 0 });

    let query = supabase
      .from('imf_agenda')
      .update({ broker_seen_at: new Date().toISOString() })
      .eq('broker_id', brokerId)
      .eq('booked_by_chatbot', true)
      .is('broker_seen_at', null);
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq('owner_user_id', userId);

    const { data, error } = await query.select('id');
    if (error) throw error;
    res.json({ ok: true, updated: data?.length || 0 });
  } catch (err: any) {
    console.error("Erro POST /api/agenda/visits/mark-chatbot-seen:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// AGENDA — Endpoints para N8N (auth: INTERNAL_PROXY_TOKEN, broker_id no body/query)
// Endpoints internos de agenda consumidos pelo Agente IA Corretor.
// ─────────────────────────────────────────────────────────────────────────

function brasiliaLabel(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

async function hasAgendaConflict(
  brokerId: string,
  startMs: number,
  endMs: number,
  excludeId?: string,
): Promise<boolean> {
  let query = supabase
    .from('imf_agenda')
    .select('id, scheduled_at, duration_minutes')
    .eq('broker_id', brokerId)
    .eq('event_type', 'visita')
    .neq('status', 'cancelado')
    .gte('scheduled_at', new Date(startMs - 24 * 60 * 60_000).toISOString())
    .lt('scheduled_at', new Date(endMs).toISOString())
    .limit(1_000);
  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).some((visit: any) => {
    const existingStart = new Date(visit.scheduled_at).getTime();
    const existingEnd = existingStart + (visit.duration_minutes || 60) * 60_000;
    return startMs < existingEnd && endMs > existingStart;
  });
}

function n8nAgendaError(res: express.Response, err: unknown, operation: string) {
  if (err instanceof N8nInputValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if ((err as any)?.code === '23P01') {
    return res.status(409).json({ error: 'Este horário já está ocupado.' });
  }
  console.error(`[Agenda N8N] ${operation}:`, err);
  return res.status(500).json({ error: 'Falha interna na agenda.' });
}

// Contexto seguro para o agente: dados identificáveis apenas das visitas do
// próprio telefone; compromissos dos demais clientes viram slots anônimos.
agendaRouter.get(
  '/api/agenda/n8n/context',
  requireInternalToken,
  n8nInternalLimiter,
  async (req, res) => {
    try {
      const { broker_id, phone } = parseN8nAgendaContext(req.query);
      const normalizedPhone = normalizePhoneBR(phone);
      const now = Date.now();
      const { data, error } = await supabase
        .from('imf_agenda')
        .select('id, client_name, client_phone, scheduled_at, duration_minutes, title, status, imf_properties(title)')
        .eq('broker_id', broker_id)
        .eq('event_type', 'visita')
        .neq('status', 'cancelado')
        .gte('scheduled_at', new Date(now - 24 * 60 * 60_000).toISOString())
        .lte('scheduled_at', new Date(now + 120 * 24 * 60 * 60_000).toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1_000);
      if (error) throw error;

      const visits = data || [];
      res.json({
        customer_visits: visits
          .filter((visit: any) => normalizePhoneBR(String(visit.client_phone || '')) === normalizedPhone)
          .map((visit: any) => ({
            id: visit.id,
            title: visit.title || 'Visita',
            scheduled_at: visit.scheduled_at,
            horario_brasilia: brasiliaLabel(visit.scheduled_at),
            duration_minutes: visit.duration_minutes || 60,
            status: visit.status,
            property: visit.imf_properties?.title || null,
          })),
        busy_slots: visits.map((visit: any) => ({
          scheduled_at: visit.scheduled_at,
          horario_brasilia: brasiliaLabel(visit.scheduled_at),
          duration_minutes: visit.duration_minutes || 60,
        })),
      });
    } catch (err) {
      return n8nAgendaError(res, err, 'GET context');
    }
  },
);

// [N8N] Lista agendamentos de um corretor.
// Query: broker_id (obrigatório), phone (opcional — filtra por cliente)
agendaRouter.get('/api/agenda/n8n/list', requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const { broker_id, phone } = parseN8nAgendaList(req.query);

    let query = supabase
      .from('imf_agenda')
      .select('*, imf_properties(title)')
      .eq('broker_id', broker_id)
      .eq('event_type', 'visita') // agente externo só decide horário ocupado/livre com base em visita real, nunca lembrete do corretor
      .order('scheduled_at', { ascending: true })
      .limit(1_000);

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
      horario_brasilia: brasiliaLabel(a.scheduled_at),
      duration_minutes: a.duration_minutes,
      status:           a.status,
      notes:            a.notes,
      property:         a.imf_properties?.title || null,
      source:           a.source,
      created_at:       a.created_at,
    })));
  } catch (err: any) {
    return n8nAgendaError(res, err, 'GET list');
  }
});

// [N8N] Cria agendamento.
// ⚠️ Contrato de fuso: startAt/endAt são passados direto pro `new Date()` do
// Node — precisam vir com offset EXPLÍCITO. "-03:00" pra hora de Brasília
// (ex.: "2026-07-14T16:00:00-03:00" pras 16h daqui), nunca "Z"/UTC nem sem
// offset nenhum pra representar hora local — isso já causou uma visita
// marcada 3h errada (16h combinada com o cliente virou 13h gravado, porque
// o prompt do N8N mandava "Z" pra hora que na verdade era de Brasília).
agendaRouter.post('/api/agenda/n8n/create', requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const input = parseN8nAgendaCreate(req.body);
    const {
      broker_id, client_name, client_phone, client_email,
      startAt, endAt, title, notes, property_id
    } = input;

    const scheduled_at = new Date(startAt).toISOString();
    const startMs = new Date(startAt).getTime();
    const endMs = endAt ? new Date(endAt).getTime() : startMs + 60 * 60_000;

    if (property_id) {
      const { data: property, error: propertyError } = await supabase
        .from('imf_properties')
        .select('id')
        .eq('id', property_id)
        .eq('broker_id', broker_id)
        .maybeSingle();
      if (propertyError) throw propertyError;
      if (!property) return res.status(400).json({ error: 'Imóvel inválido para este corretor.' });
    }

    if (await hasAgendaConflict(broker_id, startMs, endMs)) {
      return res.status(409).json({ error: 'Este horário já está ocupado.' });
    }

    const { data, error } = await supabase
      .from('imf_agenda')
      .insert({
        broker_id,
        client_name: client_name || client_phone || 'Cliente',
        client_phone:     client_phone || null,
        client_email:     client_email || null,
        scheduled_at,
        duration_minutes: 60,
        title:            title || null,
        notes:            notes || null,
        property_id:      property_id || null,
        status:           'pendente',
        source:           'ia',
        // Marca a visita como vinda da IA de atendimento (N8N) — o corretor
        // nao esta no loop dessa conversa, entao precisa ser notificado
        // (badge in-app + WhatsApp, server/services/visitAlerts.ts). O
        // Assistente IA in-app e a criacao manual NAO setam isso: ali o
        // corretor ja ve a visita na tela na hora.
        booked_by_chatbot: true,
      })
      .select()
      .single();

    if (error) throw error;

    // Fire-and-forget honesto: avança o lead pra etapa "Visita" no CRM,
    // automático, sem depender do modelo lembrar/decidir. Nunca bloqueia
    // nem falha a resposta da visita (mesmo padrão do webhook fire-and-
    // forget em leads.ts).
    if (client_phone) advanceLeadToVisitStage(broker_id, client_phone).catch(() => {});

    res.status(201).json({ ok: true, id: data.id, scheduled_at: data.scheduled_at });
  } catch (err: any) {
    return n8nAgendaError(res, err, 'POST create');
  }
});

// [N8N] Atualiza agendamento.
// Mesmo contrato de fuso do POST /create acima: startAt/endAt precisam de
// offset explícito ("-03:00" pra Brasília, nunca "Z").
agendaRouter.patch('/api/agenda/n8n/:id', requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const id = parseN8nAgendaDelete({ id: req.params.id, broker_id: req.body?.broker_id }).id;
    const { broker_id, startAt, endAt, title, notes, status } = parseN8nAgendaUpdate(req.body);

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (endAt && startAt) {
      const startMs = new Date(startAt).getTime();
      const endMs = new Date(endAt).getTime();
      if (await hasAgendaConflict(broker_id, startMs, endMs, id)) {
        return res.status(409).json({ error: 'Este horário já está ocupado.' });
      }
      updates.scheduled_at = new Date(startAt).toISOString();
      updates.duration_minutes = 60;
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
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json({ ok: true, id: data.id, scheduled_at: data.scheduled_at });
  } catch (err: any) {
    return n8nAgendaError(res, err, 'PATCH update');
  }
});

// [N8N] Cancela agendamento.
agendaRouter.delete('/api/agenda/n8n/:id', requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const { id, broker_id } = parseN8nAgendaDelete({
      id: req.params.id,
      broker_id: req.query.broker_id || req.body?.broker_id,
      event_id: req.query.event_id || req.body?.event_id,
    });

    const { data, error } = await supabase
      .from('imf_agenda')
      .delete()
      .eq('id', id)
      .eq('broker_id', broker_id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json({ ok: true, deleted_id: id });
  } catch (err: any) {
    return n8nAgendaError(res, err, 'DELETE');
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
