import { createHash, randomBytes } from 'node:crypto';
import {
  GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET,
  GOOGLE_CALENDAR_REDIRECT_URI,
  PUBLIC_APP_URL,
} from '../config';
import { decryptKey, encryptKey } from '../lib/crypto';
import { fetchWithTimeout } from '../lib/http';
import { supabase } from '../supabase';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const SYNC_PAST_MS = 366 * 24 * 60 * 60_000;
const SYNC_FUTURE_MS = 3 * 366 * 24 * 60 * 60_000;

export interface CalendarConnection {
  id: string;
  broker_id: string;
  owner_user_id: string;
  provider: 'google' | 'caldav';
  include_all: boolean;
  status: 'active' | 'reauthorize' | 'error' | 'disabled';
  external_calendar_id?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  token_expires_at?: string | null;
  sync_cursor?: string | null;
  last_synced_at?: string | null;
}

interface LocalAppointment {
  id: string;
  broker_id: string;
  owner_user_id?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  scheduled_at: string;
  duration_minutes?: number | null;
  title?: string | null;
  notes?: string | null;
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  imf_properties?: { title?: string | null } | null;
}

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface EventLink {
  id: string;
  connection_id: string;
  agenda_id: string | null;
  external_event_id: string;
  external_etag?: string | null;
  local_hash?: string | null;
  deleted_at?: string | null;
}

export function googleCalendarConfigured(): boolean {
  return Boolean(GOOGLE_CALENDAR_CLIENT_ID && GOOGLE_CALENDAR_CLIENT_SECRET && GOOGLE_CALENDAR_REDIRECT_URI);
}

export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CALENDAR_CLIENT_ID,
    redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_SCOPE,
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function googleErrorMessage(body: any, fallback: string): string {
  return String(body?.error_description || body?.error?.message || body?.error || fallback).slice(0, 500);
}

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

async function exchangeAuthorizationCode(code: string) {
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(googleErrorMessage(body, 'O Google não devolveu acesso offline. Tente conectar novamente.'));
  }
  return body as { access_token: string; refresh_token: string; expires_in?: number };
}

async function createAppCalendar(accessToken: string): Promise<string> {
  const response = await fetchWithTimeout(`${GOOGLE_CALENDAR_API}/calendars`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: 'ImobiFlow',
      description: 'Agenda bidirecional gerenciada pelo ImobiFlow.',
      timeZone: 'America/Sao_Paulo',
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.id) throw new Error(googleErrorMessage(body, 'Não foi possível criar a agenda ImobiFlow no Google.'));
  return String(body.id);
}

export async function completeGoogleCalendarConnection(input: {
  code: string;
  brokerId: string;
  userId: string;
  includeAll: boolean;
}): Promise<string> {
  if (!googleCalendarConfigured()) throw new Error('Google Agenda ainda não foi configurado no servidor.');
  const tokens = await exchangeAuthorizationCode(input.code);
  const calendarId = await createAppCalendar(tokens.access_token);
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('imf_agenda_calendar_connections')
    .upsert({
      broker_id: input.brokerId,
      owner_user_id: input.userId,
      provider: 'google',
      include_all: input.includeAll,
      status: 'active',
      external_calendar_id: calendarId,
      access_token_enc: encryptKey(tokens.access_token),
      refresh_token_enc: encryptKey(tokens.refresh_token),
      token_expires_at: expiresAt,
      sync_cursor: null,
      last_error: null,
      updated_at: now,
    }, { onConflict: 'owner_user_id,provider' })
    .select('id')
    .single();
  if (error || !data) throw error || new Error('Falha ao salvar a conexão do Google.');
  return data.id;
}

async function loadConnection(connectionId: string): Promise<CalendarConnection> {
  const { data, error } = await supabase
    .from('imf_agenda_calendar_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('provider', 'google')
    .maybeSingle();
  if (error || !data) throw error || new Error('Conexão Google não encontrada.');
  return data as CalendarConnection;
}

async function refreshAccessToken(connection: CalendarConnection, force = false): Promise<string> {
  if (!force && connection.access_token_enc && connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at).getTime();
    if (expiresAt > Date.now() + 90_000) return decryptKey(connection.access_token_enc);
  }
  if (!connection.refresh_token_enc) throw new Error('Google precisa ser conectado novamente.');

  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decryptKey(connection.refresh_token_enc),
      client_id: GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.access_token) {
    const message = googleErrorMessage(body, 'A autorização do Google expirou.');
    await supabase.from('imf_agenda_calendar_connections').update({
      status: 'reauthorize',
      last_error: message,
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);
    throw new Error(message);
  }

  const expiresAt = new Date(Date.now() + Math.max(60, body.expires_in || 3600) * 1000).toISOString();
  await supabase.from('imf_agenda_calendar_connections').update({
    access_token_enc: encryptKey(body.access_token),
    token_expires_at: expiresAt,
    status: 'active',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  connection.access_token_enc = encryptKey(body.access_token);
  connection.token_expires_at = expiresAt;
  return body.access_token;
}

async function googleRequest(
  connection: CalendarConnection,
  path: string,
  options: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  let accessToken = await refreshAccessToken(connection);
  const call = (token: string) => fetchWithTimeout(`${GOOGLE_CALENDAR_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let response = await call(accessToken);
  if (response.status === 401) {
    accessToken = await refreshAccessToken(connection, true);
    response = await call(accessToken);
  }
  const body = await readJson(response);
  if (!response.ok) throw new Error(googleErrorMessage(body, `Google Calendar respondeu ${response.status}.`));
  return { response, body };
}

function statusFromGoogle(event: GoogleEvent): string {
  if (event.status === 'cancelled') return 'cancelado';
  const stored = event.extendedProperties?.private?.imobiflowStatus;
  return ['pendente', 'confirmado', 'realizado', 'cancelado'].includes(stored || '') ? stored! : 'pendente';
}

function googleDateTime(value: { dateTime?: string; date?: string } | undefined): string | null {
  if (value?.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value?.date) {
    const parsed = new Date(`${value.date}T09:00:00-03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function googleEventToAgenda(event: GoogleEvent) {
  const start = googleDateTime(event.start);
  if (!start) return null;
  const end = googleDateTime(event.end);
  const duration = end
    ? Math.max(5, Math.min(24 * 60, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000)))
    : 60;
  const summary = String(event.summary || 'Compromisso do calendário').trim().slice(0, 200);
  return {
    client_name: summary || 'Compromisso do calendário',
    scheduled_at: start,
    duration_minutes: duration,
    title: summary || null,
    notes: event.description ? String(event.description).slice(0, 5_000) : null,
    status: statusFromGoogle(event),
  };
}

export function localAppointmentHash(appointment: LocalAppointment): string {
  return createHash('sha256').update(JSON.stringify({
    client_name: appointment.client_name || '',
    scheduled_at: new Date(appointment.scheduled_at).toISOString(),
    duration_minutes: Math.max(5, Number(appointment.duration_minutes) || 60),
    title: appointment.title || '',
    notes: appointment.notes || '',
    status: appointment.status || 'pendente',
    property: appointment.imf_properties?.title || '',
  })).digest('hex');
}

export function agendaToGoogleEvent(appointment: LocalAppointment, connectionId: string) {
  const start = new Date(appointment.scheduled_at);
  const duration = Math.max(5, Math.min(24 * 60, Number(appointment.duration_minutes) || 60));
  const end = new Date(start.getTime() + duration * 60_000);
  return {
    summary: appointment.title?.trim() || appointment.client_name?.trim() || 'Compromisso ImobiFlow',
    description: appointment.notes || '',
    location: appointment.imf_properties?.title || '',
    start: { dateTime: start.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: end.toISOString(), timeZone: 'America/Sao_Paulo' },
    extendedProperties: {
      private: {
        imobiflowAgendaId: appointment.id,
        imobiflowConnectionId: connectionId,
        imobiflowStatus: appointment.status || 'pendente',
      },
    },
  };
}

async function listRemoteChanges(connection: CalendarConnection): Promise<{ events: GoogleEvent[]; cursor: string | null }> {
  const calendarId = encodeURIComponent(connection.external_calendar_id || '');
  const events: GoogleEvent[] = [];
  let pageToken = '';
  let nextSyncToken: string | null = null;
  let cursor = connection.sync_cursor || '';

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ maxResults: '2500', showDeleted: 'true', singleEvents: 'true' });
    if (cursor) params.set('syncToken', cursor);
    else {
      params.set('timeMin', new Date(Date.now() - SYNC_PAST_MS).toISOString());
      params.set('timeMax', new Date(Date.now() + SYNC_FUTURE_MS).toISOString());
    }
    if (pageToken) params.set('pageToken', pageToken);

    try {
      const { body } = await googleRequest(connection, `/calendars/${calendarId}/events?${params.toString()}`);
      events.push(...(Array.isArray(body.items) ? body.items : []));
      pageToken = String(body.nextPageToken || '');
      if (body.nextSyncToken) nextSyncToken = String(body.nextSyncToken);
      if (!pageToken) break;
    } catch (error: any) {
      if (cursor && /410|sync token|full sync/i.test(error?.message || '')) {
        cursor = '';
        pageToken = '';
        events.length = 0;
        page = -1;
        continue;
      }
      throw error;
    }
  }
  return { events, cursor: nextSyncToken };
}

async function loadLinks(connectionId: string): Promise<EventLink[]> {
  const { data, error } = await supabase
    .from('imf_agenda_calendar_event_links')
    .select('*')
    .eq('connection_id', connectionId)
    .limit(10_000);
  if (error) throw error;
  return (data || []) as EventLink[];
}

async function pullRemote(connection: CalendarConnection, remoteEvents: GoogleEvent[], links: EventLink[]): Promise<void> {
  const byExternal = new Map(links.map((link) => [link.external_event_id, link]));
  for (const event of remoteEvents) {
    if (!event.id) continue;
    const link = byExternal.get(event.id);
    if (event.status === 'cancelled') {
      if (link?.agenda_id) {
        await supabase.from('imf_agenda').update({
          status: 'cancelado',
          updated_at: new Date().toISOString(),
        }).eq('id', link.agenda_id).eq('broker_id', connection.broker_id);
      }
      continue;
    }
    if (link && link.external_etag === event.etag) continue;
    const mapped = googleEventToAgenda(event);
    if (!mapped) continue;

    let agendaId = link?.agenda_id || event.extendedProperties?.private?.imobiflowAgendaId || null;
    if (agendaId) {
      const { data } = await supabase
        .from('imf_agenda')
        .update({ ...mapped, updated_at: new Date().toISOString() })
        .eq('id', agendaId)
        .eq('broker_id', connection.broker_id)
        .select('id, client_name, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at')
        .maybeSingle();
      agendaId = data?.id || null;
    }
    if (!agendaId) {
      const { data, error } = await supabase
        .from('imf_agenda')
        .insert({
          broker_id: connection.broker_id,
          owner_user_id: connection.owner_user_id,
          ...mapped,
          event_type: 'visita',
          source: 'calendar_google',
        })
        .select('id')
        .single();
      if (error || !data) throw error || new Error('Falha ao importar evento do Google.');
      agendaId = data.id;
    }

    const { data: local } = await supabase
      .from('imf_agenda')
      .select('id, client_name, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at')
      .eq('id', agendaId)
      .maybeSingle();
    const localHash = local ? localAppointmentHash(local as LocalAppointment) : null;
    const { error } = await supabase.from('imf_agenda_calendar_event_links').upsert({
      connection_id: connection.id,
      agenda_id: agendaId,
      external_event_id: event.id,
      external_etag: event.etag || null,
      local_hash: localHash,
      remote_updated_at: event.updated || null,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,external_event_id' });
    if (error) throw error;
  }
}

async function queryLocalAppointments(connection: CalendarConnection): Promise<LocalAppointment[]> {
  let query = supabase
    .from('imf_agenda')
    .select('id, broker_id, owner_user_id, client_name, client_phone, client_email, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at, imf_properties(title)')
    .eq('broker_id', connection.broker_id)
    .eq('event_type', 'visita')
    .gte('scheduled_at', new Date(Date.now() - SYNC_PAST_MS).toISOString())
    .lte('scheduled_at', new Date(Date.now() + SYNC_FUTURE_MS).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(5_000);
  if (!connection.include_all) query = query.eq('owner_user_id', connection.owner_user_id);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as LocalAppointment[];
}

async function deleteGoogleEvent(connection: CalendarConnection, externalEventId: string): Promise<void> {
  const calendarId = encodeURIComponent(connection.external_calendar_id || '');
  try {
    await googleRequest(connection, `/calendars/${calendarId}/events/${encodeURIComponent(externalEventId)}`, { method: 'DELETE' });
  } catch (error: any) {
    if (!/404|410|not found/i.test(error?.message || '')) throw error;
  }
}

async function pushLocal(connection: CalendarConnection, links: EventLink[]): Promise<void> {
  const byAgenda = new Map(links.filter((link) => link.agenda_id).map((link) => [link.agenda_id!, link]));
  const calendarId = encodeURIComponent(connection.external_calendar_id || '');
  const localAppointments = await queryLocalAppointments(connection);

  for (const appointment of localAppointments) {
    const link = byAgenda.get(appointment.id);
    if (appointment.status === 'cancelado') {
      if (link) {
        await deleteGoogleEvent(connection, link.external_event_id);
        await supabase.from('imf_agenda_calendar_event_links').delete().eq('id', link.id);
      }
      continue;
    }
    const localHash = localAppointmentHash(appointment);
    if (link?.local_hash === localHash) continue;
    const payload = agendaToGoogleEvent(appointment, connection.id);

    if (link) {
      try {
        const { body } = await googleRequest(
          connection,
          `/calendars/${calendarId}/events/${encodeURIComponent(link.external_event_id)}`,
          { method: 'PATCH', body: JSON.stringify(payload) },
        );
        await supabase.from('imf_agenda_calendar_event_links').update({
          external_etag: body.etag || null,
          local_hash: localHash,
          remote_updated_at: body.updated || null,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        }).eq('id', link.id);
        continue;
      } catch (error: any) {
        if (!/404|410|not found/i.test(error?.message || '')) throw error;
        await supabase.from('imf_agenda_calendar_event_links').delete().eq('id', link.id);
      }
    }

    const { body } = await googleRequest(
      connection,
      `/calendars/${calendarId}/events`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (!body.id) throw new Error('Google não devolveu o identificador do evento criado.');
    const { error } = await supabase.from('imf_agenda_calendar_event_links').upsert({
      connection_id: connection.id,
      agenda_id: appointment.id,
      external_event_id: body.id,
      external_etag: body.etag || null,
      local_hash: localHash,
      remote_updated_at: body.updated || null,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,external_event_id' });
    if (error) throw error;
  }

  for (const tombstone of links.filter((link) => !link.agenda_id && link.deleted_at)) {
    await deleteGoogleEvent(connection, tombstone.external_event_id);
    await supabase.from('imf_agenda_calendar_event_links').delete().eq('id', tombstone.id);
  }
}

export async function syncGoogleCalendarConnection(connectionId: string): Promise<void> {
  const leaseToken = randomBytes(24).toString('base64url');
  const { data: claimed, error: claimError } = await supabase.rpc('imf_claim_agenda_calendar_sync', {
    p_connection_id: connectionId,
    p_lease_token: leaseToken,
    p_lease_until: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (claimError) throw claimError;
  if (!claimed) return;
  try {
    const connection = await loadConnection(connectionId);
    if (connection.status === 'disabled') return;
    if (!googleCalendarConfigured()) throw new Error('Credenciais do Google Agenda ausentes.');
    const linksBefore = await loadLinks(connection.id);
    const remote = await listRemoteChanges(connection);
    await pullRemote(connection, remote.events, linksBefore);
    const linksAfterPull = await loadLinks(connection.id);
    await pushLocal(connection, linksAfterPull);
    await supabase.from('imf_agenda_calendar_connections').update({
      sync_cursor: remote.cursor || connection.sync_cursor || null,
      status: 'active',
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);
  } catch (error: any) {
    const message = String(error?.message || 'Falha na sincronização Google.').slice(0, 500);
    await supabase.from('imf_agenda_calendar_connections').update({
      status: /autoriza|credential|token|oauth/i.test(message) ? 'reauthorize' : 'error',
      last_error: message,
      updated_at: new Date().toISOString(),
    }).eq('id', connectionId);
    throw error;
  } finally {
    try {
      await supabase.rpc('imf_release_agenda_calendar_sync', {
        p_connection_id: connectionId,
        p_lease_token: leaseToken,
      });
    } catch { /* a lease expira sozinha; não mascara o resultado do sync */ }
  }
}

export async function runGoogleCalendarSyncTick(): Promise<void> {
  if (!googleCalendarConfigured()) return;
  const now = new Date().toISOString();
  await supabase.from('imf_agenda_calendar_oauth_states').delete().lt('expires_at', now);
  const { data, error } = await supabase
    .from('imf_agenda_calendar_connections')
    .select('id')
    .eq('provider', 'google')
    .in('status', ['active', 'error'])
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(100);
  if (error) throw error;
  const ids = (data || []).map((row: any) => row.id as string);
  for (let index = 0; index < ids.length; index += 4) {
    await Promise.allSettled(ids.slice(index, index + 4).map(syncGoogleCalendarConnection));
  }
}

export async function disconnectGoogleCalendar(connection: CalendarConnection): Promise<void> {
  const token = connection.refresh_token_enc ? decryptKey(connection.refresh_token_enc) : '';
  if (token) {
    await fetchWithTimeout(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }).catch(() => null);
  }
  await supabase.from('imf_agenda_calendar_connections').delete().eq('id', connection.id);
}

export function googleOAuthCompletionHtml(ok: boolean, message = ''): string {
  const query = new URLSearchParams({ ok: ok ? '1' : '0', message: message.slice(0, 180) });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ImobiFlow</title></head><body><p>${ok ? 'Google Agenda conectado. Esta janela pode ser fechada.' : 'Não foi possível conectar o Google Agenda.'}</p><script src="/calendar-oauth-complete.js?${query.toString()}"></script></body></html>`;
}

export const calendarOAuthClientScript = `(() => {\n  const p = new URLSearchParams(document.currentScript.src.split('?')[1] || '');\n  const payload = { type: 'imobiflow:calendar-oauth', ok: p.get('ok') === '1', message: p.get('message') || '' };\n  if (window.opener && window.opener !== window) { window.opener.postMessage(payload, ${JSON.stringify(new URL(PUBLIC_APP_URL).origin)}); window.close(); }\n})();`;
