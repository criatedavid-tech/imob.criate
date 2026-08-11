import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calDavAccountUrl, calDavServerAddress, generateCalDavCredentials, parseCalDavEvent } from '../server/services/caldavServer';
import {
  agendaToGoogleEvent,
  buildGoogleAuthorizationUrl,
  googleEventToAgenda,
  hashOAuthState,
  localAppointmentHash,
} from '../server/services/googleCalendarSync';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('credencial CalDAV é forte, revogável e a senha não compõe o usuário', () => {
  const credentials = generateCalDavCredentials();
  assert.match(credentials.username, /^imobiflow-[0-9a-f]{16}$/);
  assert.match(credentials.password, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(credentials.passwordHash, createHash('sha256').update(credentials.password).digest('hex'));
  assert.equal(calDavServerAddress('https://imobiflow-v2.fly.dev/'), 'imobiflow-v2.fly.dev');
  assert.equal(calDavAccountUrl('https://imobiflow-v2.fly.dev/app'), 'https://imobiflow-v2.fly.dev/caldav/');
});

test('parser CalDAV preserva o horário de São Paulo já homologado', () => {
  const event = parseCalDavEvent([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:iphone-teste-123',
    'DTSTART;TZID=America/Sao_Paulo:20260812T180000',
    'DTEND;TZID=America/Sao_Paulo:20260812T190000',
    'SUMMARY:Teste 123', 'DESCRIPTION:Criado no iPhone', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
  assert.equal(event.uid, 'iphone-teste-123');
  assert.equal(event.start, '2026-08-12T21:00:00.000Z');
  assert.equal(event.durationMinutes, 60);
  assert.equal(event.summary, 'Teste 123');
  assert.equal(event.description, 'Criado no iPhone');
  assert.throws(() => parseCalDavEvent([
    'BEGIN:VEVENT', 'UID:recorrente',
    'DTSTART;TZID=America/Sao_Paulo:20260812T180000',
    'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  ].join('\r\n')), /recorrentes ainda não são suportados/);
});

test('mapeamento Google é determinístico, bidirecional e preserva duração', () => {
  const local = {
    id: 'agenda-1', broker_id: 'broker-1', client_name: 'Maria',
    scheduled_at: '2026-08-12T21:00:00.000Z', duration_minutes: 60,
    title: 'Visita ao imóvel', notes: 'Levar a chave', status: 'pendente',
    imf_properties: { title: 'Casa Centro' },
  };
  const outbound = agendaToGoogleEvent(local, 'connection-1');
  assert.equal(outbound.start.dateTime, '2026-08-12T21:00:00.000Z');
  assert.equal(outbound.end.dateTime, '2026-08-12T22:00:00.000Z');
  assert.equal(outbound.start.timeZone, 'America/Sao_Paulo');
  assert.equal(outbound.extendedProperties.private.imobiflowAgendaId, 'agenda-1');
  assert.equal(localAppointmentHash(local), localAppointmentHash({ ...local }));

  const inbound = googleEventToAgenda({
    id: 'google-1', summary: 'Teste 123', description: 'Criado no telefone',
    start: { dateTime: '2026-08-12T18:00:00-03:00' },
    end: { dateTime: '2026-08-12T19:00:00-03:00' },
  });
  assert.equal(inbound?.scheduled_at, '2026-08-12T21:00:00.000Z');
  assert.equal(inbound?.duration_minutes, 60);
  assert.equal(inbound?.title, 'Teste 123');
});

test('OAuth usa state forte, acesso offline e escopo restrito à agenda criada pelo app', () => {
  const state = 'A'.repeat(43);
  assert.match(hashOAuthState(state), /^[0-9a-f]{64}$/);
  const url = new URL(buildGoogleAuthorizationUrl(state));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.app.created');
});

test('backend e migration mantêm credenciais fora do navegador e sincronização no scheduler', async () => {
  const [route, migration, scheduler, modal, env] = await Promise.all([
    read('../server/routes/agenda.ts'),
    read('../supabase/migrations/20260811a_agenda_bidirectional_sync.sql'),
    read('../scheduler-worker.ts'),
    read('../src/components/CalendarSyncModal.tsx'),
    read('../.env.example'),
  ]);
  assert.match(route, /hashOAuthState/);
  assert.match(route, /calendarConnectionLimiter/);
  assert.match(route, /calendarDavLimiter/);
  assert.match(route, /agendaRouter\.all\(\['\/\.well-known\/caldav', '\/\.well-known\/caldav\/'\]/);
  assert.doesNotMatch(route, /agendaRouter\.get\('\/\.well-known\/caldav'/);
  assert.match(route, /express\.text\(\{ type: \(\) => true, limit: '256kb' \}\)/);
  assert.match(migration, /refresh_token_enc TEXT/);
  assert.match(migration, /caldav_password_hash TEXT/);
  assert.doesNotMatch(migration, /caldav_password\s+TEXT/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.imf_agenda_calendar_connections FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /imf_mark_calendar_event_deleted/);
  assert.match(migration, /imf_claim_agenda_calendar_sync/);
  assert.match(scheduler, /task: runGoogleCalendarSyncTick/);
  assert.match(modal, /Google Agenda — bidirecional/);
  assert.match(modal, /Calendário do iPhone — bidirecional/);
  assert.match(modal, /A assinatura é somente leitura/);
  assert.match(env, /GOOGLE_CALENDAR_CLIENT_SECRET/);
});
