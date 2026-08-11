import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PUBLIC_APP_URL } from '../config';
import { supabase } from '../supabase';
import { generateAgendaIcs, type CalendarFeedAppointment } from './calendarFeed';
import type { CalendarConnection } from './googleCalendarSync';

const CALDAV_REALM = 'ImobiFlow Calendar';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 5_000;

interface CalDavLink {
  id: string;
  agenda_id: string | null;
  external_event_id: string;
  external_uid?: string | null;
  external_etag?: string | null;
}

interface ParsedIcsEvent {
  uid: string;
  summary: string;
  description: string;
  start: string;
  durationMinutes: number;
  status: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateCalDavCredentials(): { username: string; password: string; passwordHash: string } {
  const username = `imobiflow-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  return { username, password, passwordHash: sha256(password) };
}

export function calDavServerAddress(publicAppUrl = PUBLIC_APP_URL): string {
  return new URL(publicAppUrl).host;
}

function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function unfoldIcs(value: string): string {
  return value.replace(/\r?\n[ \t]/g, '');
}

function readIcsProperty(ics: string, name: string): { params: string; value: string } | null {
  const match = unfoldIcs(ics).match(new RegExp(`^${name}(?:;([^:]*))?:(.*)$`, 'im'));
  return match ? { params: match[1] || '', value: match[2].trim() } : null;
}

function parseCompactDate(value: string, params = ''): Date | null {
  const clean = value.trim();
  if (/^\d{8}$/.test(clean)) {
    const iso = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T09:00:00-03:00`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) {
    const date = new Date(clean);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const [, year, month, day, hour, minute, second, utc] = match;
  const timezone = /TZID=([^;:]+)/i.exec(params)?.[1] || '';
  const suffix = utc === 'Z' ? 'Z' : timezone === 'UTC' ? 'Z' : '-03:00';
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseCalDavEvent(ics: string): ParsedIcsEvent {
  if (Buffer.byteLength(ics, 'utf8') > MAX_BODY_BYTES) throw new Error('Evento excede o limite permitido.');
  if (!/BEGIN:VEVENT/i.test(ics) || !/END:VEVENT/i.test(ics)) throw new Error('VEVENT ausente.');
  if (/^RRULE:/im.test(unfoldIcs(ics))) throw new Error('Eventos recorrentes ainda não são suportados pelo ImobiFlow.');
  const startProp = readIcsProperty(ics, 'DTSTART');
  if (startProp && (/VALUE=DATE/i.test(startProp.params) || /^\d{8}$/.test(startProp.value))) {
    throw new Error('Eventos de dia inteiro ainda não são suportados pelo ImobiFlow.');
  }
  const start = startProp ? parseCompactDate(startProp.value, startProp.params) : null;
  if (!start) throw new Error('DTSTART inválido ou ausente.');
  const endProp = readIcsProperty(ics, 'DTEND');
  const end = endProp ? parseCompactDate(endProp.value, endProp.params) : null;
  const duration = end
    ? Math.max(5, Math.min(24 * 60, Math.round((end.getTime() - start.getTime()) / 60_000)))
    : 60;
  const uid = unescapeIcs(readIcsProperty(ics, 'UID')?.value || randomBytes(16).toString('hex')).slice(0, 255);
  const summary = unescapeIcs(readIcsProperty(ics, 'SUMMARY')?.value || 'Compromisso do iPhone').trim().slice(0, 200);
  const description = unescapeIcs(readIcsProperty(ics, 'DESCRIPTION')?.value || '').slice(0, 5_000);
  const rawStatus = readIcsProperty(ics, 'STATUS')?.value.toUpperCase();
  return {
    uid,
    summary: summary || 'Compromisso do iPhone',
    description,
    start: start.toISOString(),
    durationMinutes: duration,
    status: rawStatus === 'CANCELLED' ? 'cancelado' : 'pendente',
  };
}

function authParts(req: Request): { username: string; password: string } | null {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

async function authenticate(req: Request, res: Response): Promise<CalendarConnection | null> {
  const credentials = authParts(req);
  if (!credentials || !/^imobiflow-[0-9a-f]{16}$/.test(credentials.username)) {
    res.setHeader('WWW-Authenticate', `Basic realm="${CALDAV_REALM}", charset="UTF-8"`);
    res.status(401).end();
    return null;
  }
  const { data, error } = await supabase
    .from('imf_agenda_calendar_connections')
    .select('*')
    .eq('provider', 'caldav')
    .eq('caldav_username', credentials.username)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data?.caldav_password_hash) {
    res.setHeader('WWW-Authenticate', `Basic realm="${CALDAV_REALM}", charset="UTF-8"`);
    res.status(401).end();
    return null;
  }
  const actual = Buffer.from(sha256(credentials.password), 'hex');
  const expected = Buffer.from(data.caldav_password_hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.setHeader('WWW-Authenticate', `Basic realm="${CALDAV_REALM}", charset="UTF-8"`);
    res.status(401).end();
    return null;
  }
  return data as CalendarConnection;
}

function multistatus(res: Response, responses: string[]): void {
  res.status(207);
  res.type('application/xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">${responses.join('')}</D:multistatus>`);
}

function okPropResponse(href: string, properties: string): string {
  return `<D:response><D:href>${xmlEscape(href)}</D:href><D:propstat><D:prop>${properties}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

function notFoundResponse(href: string): string {
  return `<D:response><D:href>${xmlEscape(href)}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;
}

function principalPath(username: string): string {
  return `/caldav/principals/${encodeURIComponent(username)}/`;
}

function homePath(username: string): string {
  return `/caldav/calendars/${encodeURIComponent(username)}/`;
}

function calendarPath(username: string): string {
  return `${homePath(username)}imobiflow/`;
}

function normalizePath(req: Request): string {
  try { return new URL(req.originalUrl, PUBLIC_APP_URL).pathname; } catch { return req.path; }
}

function connectionUsername(connection: CalendarConnection): string {
  return String((connection as any).caldav_username || '');
}

function assertOwnPath(path: string, username: string, res: Response): boolean {
  if (path === '/caldav/' || path === '/caldav') return true;
  if (!path.includes(`/${encodeURIComponent(username)}/`) && !path.includes(`/${username}/`)) {
    res.status(403).end();
    return false;
  }
  return true;
}

function etagForIcs(ics: string): string {
  return `"${sha256(ics)}"`;
}

async function loadLinks(connectionId: string): Promise<CalDavLink[]> {
  const { data, error } = await supabase
    .from('imf_agenda_calendar_event_links')
    .select('id, agenda_id, external_event_id, external_uid, external_etag')
    .eq('connection_id', connectionId)
    .not('agenda_id', 'is', null)
    .limit(MAX_EVENTS);
  if (error) throw error;
  return (data || []) as CalDavLink[];
}

function compactRangeDate(value: string): string | null {
  const date = parseCompactDate(value);
  return date?.toISOString() || null;
}

function requestedRange(body: string): { start: string; end: string } {
  const floor = new Date(Date.now() - 366 * 24 * 60 * 60_000).toISOString();
  const ceiling = new Date(Date.now() + 3 * 366 * 24 * 60 * 60_000).toISOString();
  const tag = body.match(/<[^>]*time-range\b[^>]*>/i)?.[0] || '';
  const requestedStart = /\bstart="([^"]+)"/i.exec(tag)?.[1];
  const requestedEnd = /\bend="([^"]+)"/i.exec(tag)?.[1];
  const start = requestedStart ? compactRangeDate(requestedStart) : null;
  const end = requestedEnd ? compactRangeDate(requestedEnd) : null;
  return {
    start: start && start > floor ? start : floor,
    end: end && end < ceiling ? end : ceiling,
  };
}

async function loadAppointments(connection: CalendarConnection, body = ''): Promise<any[]> {
  const range = requestedRange(body);
  let query = supabase
    .from('imf_agenda')
    .select('id, client_name, client_phone, client_email, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at, imf_properties(title)')
    .eq('broker_id', connection.broker_id)
    .eq('event_type', 'visita')
    .neq('status', 'cancelado')
    .gte('scheduled_at', range.start)
    .lte('scheduled_at', range.end)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_EVENTS);
  if (!connection.include_all) query = query.eq('owner_user_id', connection.owner_user_id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function appointmentResource(
  appointment: any,
  connection: CalendarConnection,
  link?: CalDavLink,
): { href: string; ics: string; etag: string; resource: string } {
  const username = connectionUsername(connection);
  const resource = link?.external_event_id || `${appointment.id}.ics`;
  const ics = generateAgendaIcs([{
    ...appointment,
    uid: link?.external_uid || `${appointment.id}@imobiflow.app`,
    property: appointment.imf_properties?.title || null,
  } as CalendarFeedAppointment], {
    calendarName: 'ImobiFlow',
    uidDomain: 'imobiflow.app',
    includeMethod: false,
  });
  return { href: `${calendarPath(username)}${encodeURIComponent(resource)}`, ics, etag: etagForIcs(ics), resource };
}

async function listResources(connection: CalendarConnection, body = '') {
  // Este servidor não anuncia sync-token: cada consulta devolve o conjunto
  // atual, então lápides CalDAV antigas já podem ser removidas com segurança.
  await supabase.from('imf_agenda_calendar_event_links').delete()
    .eq('connection_id', connection.id).is('agenda_id', null);
  const [appointments, links] = await Promise.all([
    loadAppointments(connection, body),
    loadLinks(connection.id),
  ]);
  const byAgenda = new Map(links.filter((link) => link.agenda_id).map((link) => [link.agenda_id!, link]));
  return appointments.map((appointment) => appointmentResource(appointment, connection, byAgenda.get(appointment.id)));
}

function extractRequestedHrefs(body: string): Set<string> {
  const result = new Set<string>();
  for (const match of body.matchAll(/<(?:[A-Za-z][\w.-]*:)?href[^>]*>([^<]+)<\/(?:[A-Za-z][\w.-]*:)?href>/gi)) result.add(match[1]);
  return result;
}

async function handleReport(req: Request, res: Response, connection: CalendarConnection): Promise<void> {
  const body = typeof req.body === 'string' ? req.body : '';
  const resources = await listResources(connection, body);
  const requested = /calendar-multiget/i.test(body) ? extractRequestedHrefs(body) : null;
  const responses = resources
    .filter((resource) => !requested || requested.has(resource.href) || requested.has(decodeURIComponent(resource.href)))
    .map((resource) => okPropResponse(resource.href,
      `<D:getetag>${xmlEscape(resource.etag)}</D:getetag><D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype><C:calendar-data>${xmlEscape(resource.ics)}</C:calendar-data>`,
    ));
  if (requested) {
    for (const href of requested) if (!resources.some((resource) => resource.href === href || decodeURIComponent(resource.href) === href)) responses.push(notFoundResponse(href));
  }
  multistatus(res, responses);
}

async function findResource(connection: CalendarConnection, resource: string) {
  const { data: link } = await supabase
    .from('imf_agenda_calendar_event_links')
    .select('id, agenda_id, external_event_id, external_uid, external_etag')
    .eq('connection_id', connection.id)
    .eq('external_event_id', resource)
    .maybeSingle();
  let agendaId = link?.agenda_id || null;
  if (!agendaId && /^[0-9a-f-]{36}\.ics$/i.test(resource)) agendaId = resource.slice(0, -4);
  if (!agendaId) return null;
  let query = supabase
    .from('imf_agenda')
    .select('id, owner_user_id, client_name, client_phone, client_email, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at, imf_properties(title)')
    .eq('id', agendaId)
    .eq('broker_id', connection.broker_id)
    .eq('event_type', 'visita');
  if (!connection.include_all) query = query.eq('owner_user_id', connection.owner_user_id);
  const { data } = await query.maybeSingle();
  return data ? { appointment: data, link: link as CalDavLink | null } : null;
}

async function handleGet(req: Request, res: Response, connection: CalendarConnection, resource: string): Promise<void> {
  const found = await findResource(connection, resource);
  if (!found || found.appointment.status === 'cancelado') { res.status(404).end(); return; }
  const output = appointmentResource(found.appointment, connection, found.link || undefined);
  res.setHeader('ETag', output.etag);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  if (req.method === 'HEAD') res.status(200).end();
  else res.status(200).send(output.ics);
}

function safeResource(path: string): string | null {
  const value = decodeURIComponent(path.split('/').pop() || '');
  return /^[A-Za-z0-9._-]{1,200}\.ics$/.test(value) ? value : null;
}

async function handlePut(req: Request, res: Response, connection: CalendarConnection, resource: string): Promise<void> {
  const parsed = parseCalDavEvent(typeof req.body === 'string' ? req.body : '');
  const found = await findResource(connection, resource);
  const ifNoneMatch = String(req.headers['if-none-match'] || '');
  if (found && ifNoneMatch === '*') { res.status(412).end(); return; }
  if (!found && req.headers['if-match']) { res.status(412).end(); return; }
  if (found && req.headers['if-match'] && String(req.headers['if-match']) !== '*') {
    const current = appointmentResource(found.appointment, connection, found.link || undefined);
    if (String(req.headers['if-match']) !== current.etag) { res.status(412).end(); return; }
  }

  let agendaId = found?.appointment?.id || null;
  const values = {
    client_name: parsed.summary,
    scheduled_at: parsed.start,
    duration_minutes: parsed.durationMinutes,
    title: parsed.summary,
    notes: parsed.description || null,
    status: parsed.status,
    updated_at: new Date().toISOString(),
  };
  if (agendaId) {
    const { error } = await supabase.from('imf_agenda').update(values)
      .eq('id', agendaId).eq('broker_id', connection.broker_id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('imf_agenda').insert({
      broker_id: connection.broker_id,
      owner_user_id: connection.owner_user_id,
      ...values,
      event_type: 'visita',
      source: 'calendar_iphone',
    }).select('id').single();
    if (error || !data) throw error || new Error('Falha ao importar evento do iPhone.');
    agendaId = data.id;
  }

  const { data: saved } = await supabase.from('imf_agenda')
    .select('id, client_name, client_phone, client_email, scheduled_at, duration_minutes, title, notes, status, created_at, updated_at')
    .eq('id', agendaId).single();
  const ics = generateAgendaIcs([{ ...saved, uid: parsed.uid }], { includeMethod: false });
  const etag = etagForIcs(ics);
  const { error: linkError } = await supabase.from('imf_agenda_calendar_event_links').upsert({
    connection_id: connection.id,
    agenda_id: agendaId,
    external_event_id: resource,
    external_uid: parsed.uid,
    external_etag: etag,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,external_event_id' });
  if (linkError) throw linkError;
  await supabase.from('imf_agenda_calendar_connections').update({
    last_synced_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  res.setHeader('ETag', etag);
  res.setHeader('Location', `${calendarPath(connectionUsername(connection))}${encodeURIComponent(resource)}`);
  res.status(found ? 204 : 201).end();
}

async function handleDelete(req: Request, res: Response, connection: CalendarConnection, resource: string): Promise<void> {
  const found = await findResource(connection, resource);
  if (!found) { res.status(404).end(); return; }
  if (req.headers['if-match'] && String(req.headers['if-match']) !== '*') {
    const current = appointmentResource(found.appointment, connection, found.link || undefined);
    if (String(req.headers['if-match']) !== current.etag) { res.status(412).end(); return; }
  }
  const { error } = await supabase.from('imf_agenda').delete()
    .eq('id', found.appointment.id).eq('broker_id', connection.broker_id);
  if (error) throw error;
  await supabase.from('imf_agenda_calendar_event_links').delete()
    .eq('connection_id', connection.id).eq('external_event_id', resource);
  res.status(204).end();
}

async function collectionTag(connection: CalendarConnection): Promise<string> {
  const { data } = await supabase.from('imf_agenda')
    .select('updated_at').eq('broker_id', connection.broker_id)
    .eq('event_type', 'visita').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return sha256(`${connection.id}:${data?.updated_at || connection.last_synced_at || ''}`).slice(0, 24);
}

async function handlePropfind(req: Request, res: Response, connection: CalendarConnection, path: string): Promise<void> {
  const username = connectionUsername(connection);
  const principal = principalPath(username);
  const home = homePath(username);
  const calendar = calendarPath(username);
  const depth = String(req.headers.depth || '0');
  const common = `<D:current-user-principal><D:href>${principal}</D:href></D:current-user-principal><D:principal-URL><D:href>${principal}</D:href></D:principal-URL>`;

  if (path === '/caldav' || path === '/caldav/') {
    multistatus(res, [okPropResponse('/caldav/', `<D:resourcetype><D:collection/></D:resourcetype>${common}`)]);
    return;
  }
  if (path === principal) {
    multistatus(res, [okPropResponse(principal, `<D:resourcetype><D:principal/></D:resourcetype><D:displayname>ImobiFlow</D:displayname>${common}<C:calendar-home-set><D:href>${home}</D:href></C:calendar-home-set>`)]);
    return;
  }
  if (path === home) {
    const responses = [okPropResponse(home, `<D:resourcetype><D:collection/></D:resourcetype><D:displayname>Calendários ImobiFlow</D:displayname>${common}`)];
    if (depth !== '0') responses.push(okPropResponse(calendar, `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>ImobiFlow</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set><CS:getctag>${await collectionTag(connection)}</CS:getctag>${common}`));
    multistatus(res, responses);
    return;
  }
  if (path === calendar) {
    const responses = [okPropResponse(calendar, `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>ImobiFlow</D:displayname><C:calendar-description>Agenda bidirecional do ImobiFlow</C:calendar-description><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set><C:supported-calendar-data><C:calendar-data content-type="text/calendar" version="2.0"/></C:supported-calendar-data><D:supported-report-set><D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report><D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report></D:supported-report-set><D:current-user-privilege-set><D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege></D:current-user-privilege-set><CS:getctag>${await collectionTag(connection)}</CS:getctag>${common}`)];
    if (depth !== '0') {
      for (const resource of await listResources(connection)) responses.push(okPropResponse(resource.href, `<D:getetag>${xmlEscape(resource.etag)}</D:getetag><D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>`));
    }
    multistatus(res, responses);
    return;
  }
  const resource = safeResource(path);
  if (resource) {
    const found = await findResource(connection, resource);
    if (!found) { res.status(404).end(); return; }
    const output = appointmentResource(found.appointment, connection, found.link || undefined);
    multistatus(res, [okPropResponse(output.href, `<D:getetag>${xmlEscape(output.etag)}</D:getetag><D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>`)]);
    return;
  }
  res.status(404).end();
}

export async function handleCalDavRequest(req: Request, res: Response): Promise<void> {
  res.setHeader('DAV', '1, 3, calendar-access');
  res.setHeader('MS-Author-Via', 'DAV');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.setHeader('Allow', 'OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE, PROPPATCH'); res.status(200).end(); return; }
  const connection = await authenticate(req, res);
  if (!connection) return;
  const path = normalizePath(req);
  const username = connectionUsername(connection);
  if (!assertOwnPath(path, username, res)) return;

  try {
    if (req.method === 'PROPFIND') return await handlePropfind(req, res, connection, path);
    if (req.method === 'REPORT') {
      if (path !== calendarPath(username)) { res.status(404).end(); return; }
      return await handleReport(req, res, connection);
    }
    if (req.method === 'PROPPATCH') { multistatus(res, [okPropResponse(path, '')]); return; }
    const resource = safeResource(path);
    if (!resource || !path.startsWith(calendarPath(username))) { res.status(404).end(); return; }
    if (req.method === 'GET' || req.method === 'HEAD') return await handleGet(req, res, connection, resource);
    if (req.method === 'PUT') return await handlePut(req, res, connection, resource);
    if (req.method === 'DELETE') return await handleDelete(req, res, connection, resource);
    res.status(405).end();
  } catch (error: any) {
    const message = String(error?.message || 'Falha no calendário CalDAV.').slice(0, 500);
    await supabase.from('imf_agenda_calendar_connections').update({
      last_error: message,
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);
    if (/VEVENT|DTSTART|limite|inválido/i.test(message)) res.status(400).send(message);
    else { console.error('[Agenda CalDAV]', message); res.status(500).end(); }
  }
}
