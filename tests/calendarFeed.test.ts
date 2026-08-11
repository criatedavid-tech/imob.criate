import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildCalendarFeedUrl,
  calendarFeedTokenHash,
  generateAgendaIcs,
  generateCalendarFeedToken,
  isValidCalendarFeedToken,
} from '../server/services/calendarFeed';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('token da agenda é forte, fechado e nunca viaja no banco em texto puro', () => {
  const token = generateCalendarFeedToken();
  assert.equal(token.length, 43);
  assert.equal(isValidCalendarFeedToken(token), true);
  assert.equal(isValidCalendarFeedToken(`${token}.ics`), false);
  assert.match(calendarFeedTokenHash(token), /^[0-9a-f]{64}$/);
  assert.equal(buildCalendarFeedUrl('https://imobiflow-v2.fly.dev/', token), `https://imobiflow-v2.fly.dev/api/agenda/calendar-feed/${token}.ics`);
});

test('feed iCalendar preserva horário, duração, cancelamento e caracteres do cliente', () => {
  const calendar = generateAgendaIcs([{
    id: 'evento-1',
    client_name: 'João, Silva',
    client_phone: '5562999999999',
    scheduled_at: '2026-08-10T15:00:00.000Z',
    duration_minutes: 90,
    title: 'Visita; Casa',
    notes: 'Levar contrato\nConfirmar portaria',
    status: 'cancelado',
    created_at: '2026-08-01T12:00:00.000Z',
    property: 'Casa, Centro',
  }], { uidDomain: 'imobiflow-v2.fly.dev' });

  assert.match(calendar, /^BEGIN:VCALENDAR\r\n/);
  assert.match(calendar, /UID:evento-1@imobiflow-v2\.fly\.dev/);
  assert.match(calendar, /DTSTART:20260810T150000Z/);
  assert.match(calendar, /DTEND:20260810T163000Z/);
  assert.match(calendar, /SUMMARY:Visita\\; Casa/);
  assert.match(calendar, /LOCATION:Casa\\, Centro/);
  assert.match(calendar, /STATUS:CANCELLED/);
  assert.match(calendar, /END:VCALENDAR\r\n$/);
  for (const line of calendar.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 74, `linha iCalendar longa: ${line}`);
  }
});

test('integração aplica isolamento, revogação e interface orientada aos dois calendários', async () => {
  const [route, migration, modal, area] = await Promise.all([
    read('../server/routes/agenda.ts'),
    read('../supabase/migrations/20260810c_agenda_calendar_feed.sql'),
    read('../src/components/CalendarSyncModal.tsx'),
    read('../src/experience/AgendaArea.tsx'),
  ]);

  assert.match(route, /\.eq\('owner_user_id', userId\)/);
  assert.match(route, /if \(!feed\.include_all\) query = query\.eq\('owner_user_id', feed\.owner_user_id\)/);
  assert.match(route, /isValidCalendarFeedToken/);
  assert.match(route, /calendarFeedReadLimiter/);
  assert.match(route, /text\/calendar; charset=utf-8/);
  assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.imf_agenda_calendar_feeds FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /\btoken\s+TEXT\b/);
  assert.match(modal, /Google Agenda/);
  assert.match(modal, /Calendário do iPhone — bidirecional/);
  assert.match(modal, /A assinatura é somente leitura/);
  assert.match(area, /Sincronizar calendário/);
});
