const BR_TZ = "America/Sao_Paulo";
const MAX_DAILY_AGENDA_DAYS = 7;

export interface AgendaRangeAppointment {
  scheduled_at: string;
  client_name?: string | null;
  title?: string | null;
  status?: string | null;
  imf_properties?: { title?: string | null } | { title?: string | null }[] | null;
}

const VISIT_STATUS_LABEL: Record<string, string> = {
  pendente: "pendente",
  confirmado: "confirmado",
  realizado: "realizada",
  cancelado: "cancelada",
};

function parseDateAtUtcNoon(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function appointmentDateKey(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function propertyTitle(appointment: AgendaRangeAppointment): string {
  const property = Array.isArray(appointment.imf_properties)
    ? appointment.imf_properties[0]
    : appointment.imf_properties;
  return property?.title?.trim() || "";
}

function appointmentLine(appointment: AgendaRangeAppointment): string {
  const scheduledAt = new Date(appointment.scheduled_at);
  const time = scheduledAt.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BR_TZ,
  });
  const client = appointment.client_name?.trim();
  const title = appointment.title?.trim() || (client ? `Visita com ${client}` : "Visita agendada");
  const property = propertyTitle(appointment);
  const place = property && !title.toLocaleLowerCase("pt-BR").includes(property.toLocaleLowerCase("pt-BR"))
    ? ` — ${property}`
    : "";
  const statusLabel = appointment.status ? (VISIT_STATUS_LABEL[appointment.status] || appointment.status) : "";
  const status = statusLabel ? ` (${statusLabel})` : "";
  return `• ${time} — ${title}${place}${status}`;
}

function dailyKeys(from: string, to: string): string[] | null {
  const start = parseDateAtUtcNoon(from);
  const end = parseDateAtUtcNoon(to);
  if (!start || !end || end.getTime() < start.getTime()) return null;
  const total = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (total < 1 || total > MAX_DAILY_AGENDA_DAYS) return null;
  return Array.from({ length: total }, (_, index) => dateKey(new Date(start.getTime() + index * 86_400_000)));
}

function dayHeading(key: string): string {
  const date = parseDateAtUtcNoon(key)!;
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  const normalizedWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `*${normalizedWeekday}, dia ${date.getUTCDate()}*`;
}

/**
 * Formata consultas curtas (principalmente "agenda da semana") em blocos
 * diários próprios para WhatsApp. Retorna null para intervalos acima de sete
 * dias, permitindo que o chamador use uma resposta compacta.
 */
export function formatAgendaByDay(
  from: string,
  to: string,
  appointments: AgendaRangeAppointment[],
): string | null {
  const keys = dailyKeys(from, to);
  if (!keys) return null;

  const buckets = new Map(keys.map((key) => [key, [] as AgendaRangeAppointment[]]));
  for (const appointment of appointments) {
    const key = appointmentDateKey(appointment.scheduled_at);
    if (key && buckets.has(key)) buckets.get(key)!.push(appointment);
  }

  const blocks = keys.map((key) => {
    const items = buckets.get(key)!
      .sort((left, right) => new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime());
    const lines = items.length > 0
      ? items.map(appointmentLine)
      : ["• Nenhum compromisso agendado"];
    return `${dayHeading(key)}\n${lines.join("\n")}`;
  });

  return blocks.join("\n\n");
}
