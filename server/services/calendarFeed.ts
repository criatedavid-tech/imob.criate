import { createHash, randomBytes } from 'node:crypto';

export interface CalendarFeedAppointment {
  id: string;
  uid?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  scheduled_at: string;
  duration_minutes?: number | null;
  title?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  property?: string | null;
}

export function generateCalendarFeedToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidCalendarFeedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function calendarFeedTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildCalendarFeedUrl(publicAppUrl: string, token: string): string {
  return `${publicAppUrl.replace(/\/+$/, '')}/api/agenda/calendar-feed/${token}.ics`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatIcsDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida na Agenda.');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// RFC 5545 recomenda no máximo 75 octetos por linha. A continuação começa com
// um espaço; a contagem é por bytes UTF-8, não por caracteres JavaScript.
function foldIcsLine(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const character of line) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (current && currentBytes + bytes > 74) {
      chunks.push(current);
      current = ` ${character}`;
      currentBytes = 1 + bytes;
    } else {
      current += character;
      currentBytes += bytes;
    }
  }
  if (current) chunks.push(current);
  return chunks.join('\r\n');
}

function appointmentStatus(status?: string | null): 'CANCELLED' | 'CONFIRMED' | 'TENTATIVE' {
  if (status === 'cancelado') return 'CANCELLED';
  if (status === 'confirmado' || status === 'realizado') return 'CONFIRMED';
  return 'TENTATIVE';
}

export function generateAgendaIcs(
  appointments: CalendarFeedAppointment[],
  options: { calendarName?: string; uidDomain?: string; includeMethod?: boolean } = {},
): string {
  const calendarName = escapeIcsText(options.calendarName || 'ImobiFlow - Agenda');
  const uidDomain = (options.uidDomain || 'imobiflow.app').replace(/[^a-z0-9.-]/gi, '') || 'imobiflow.app';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Criate//ImobiFlow Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${calendarName}`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
    'X-PUBLISHED-TTL:PT5M',
  ];
  if (options.includeMethod !== false) lines.splice(4, 0, 'METHOD:PUBLISH');

  for (const appointment of appointments) {
    const start = new Date(appointment.scheduled_at);
    if (Number.isNaN(start.getTime())) continue;
    const duration = Number.isFinite(appointment.duration_minutes)
      ? Math.min(24 * 60, Math.max(5, Number(appointment.duration_minutes)))
      : 60;
    const end = new Date(start.getTime() + duration * 60_000);
    const summary = appointment.title?.trim()
      || `Visita - ${appointment.client_name?.trim() || 'Cliente'}`;
    const description = [
      appointment.client_name ? `Cliente: ${appointment.client_name}` : null,
      appointment.client_phone ? `Telefone: +${appointment.client_phone.replace(/\D/g, '')}` : null,
      appointment.client_email ? `E-mail: ${appointment.client_email}` : null,
      appointment.notes ? `Observações: ${appointment.notes}` : null,
      appointment.status ? `Situação: ${appointment.status}` : null,
      'Gerenciado pelo ImobiFlow.',
    ].filter(Boolean).join('\n');
    const stamp = appointment.updated_at || appointment.created_at || appointment.scheduled_at;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(appointment.uid || `${appointment.id}@${uidDomain}`)}`,
      `DTSTAMP:${formatIcsDate(stamp)}`,
      `LAST-MODIFIED:${formatIcsDate(stamp)}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `STATUS:${appointmentStatus(appointment.status)}`,
      'TRANSP:OPAQUE',
    );
    if (appointment.property) lines.push(`LOCATION:${escapeIcsText(appointment.property)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
