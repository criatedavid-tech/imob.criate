import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BRASILIA_ISO = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d):00(?:\.000)?-03:00$/;
const MAX_AGENDA_DAYS_AHEAD = 365;

const safeText = (max: number) => z.string()
  .trim()
  .min(1)
  .max(max)
  .transform((value) => value.replace(CONTROL_CHARACTERS, " "));

const optionalSafeText = (max: number) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  safeText(max).optional(),
);

const uuid = z.string().trim().uuid();
const phone = z.string().trim().min(10).max(32).regex(/^\+?[\d\s().-]+$/);
const brasiliaDateTime = z.string().trim().regex(
  BRASILIA_ISO,
  "deve usar ISO 8601 com offset -03:00 e segundos zerados",
);

const agendaListSchema = z.object({
  broker_id: uuid,
  phone: phone.optional(),
}).strict();

const agendaContextSchema = z.object({
  broker_id: uuid,
  phone,
}).strict();

const propertyCatalogSchema = z.object({
  broker_id: uuid,
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const agendaCreateSchema = z.object({
  broker_id: uuid,
  client_name: optionalSafeText(120),
  client_phone: phone.optional(),
  client_email: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().email().max(254).optional(),
  ),
  startAt: brasiliaDateTime,
  endAt: brasiliaDateTime.optional(),
  title: optionalSafeText(160),
  notes: optionalSafeText(1_000),
  property_id: uuid.optional(),
  event_id: uuid.optional(),
}).strict().refine(
  (value) => Boolean(value.client_name || value.client_phone),
  { message: "client_name ou client_phone é obrigatório", path: ["client_name"] },
);

const agendaUpdateSchema = z.object({
  broker_id: uuid,
  startAt: brasiliaDateTime.optional(),
  endAt: brasiliaDateTime.optional(),
  title: optionalSafeText(160),
  notes: optionalSafeText(1_000),
  status: z.enum(["pendente", "confirmado", "realizado", "cancelado"]).optional(),
  event_id: uuid.optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.startAt) !== Boolean(value.endAt)) {
    context.addIssue({
      code: "custom",
      message: "startAt e endAt devem ser enviados juntos",
      path: [value.startAt ? "endAt" : "startAt"],
    });
  }
  if (!value.startAt && !value.title && !value.notes && !value.status) {
    context.addIssue({ code: "custom", message: "nenhuma alteração válida foi enviada" });
  }
});

const agendaDeleteSchema = z.object({
  id: uuid,
  broker_id: uuid,
  event_id: uuid.optional(),
}).strict();

const aiReplySchema = z.object({
  broker_id: uuid,
  customer_phone: phone,
  text: safeText(4_000),
  ticket_id: uuid.optional(),
  event_id: uuid.optional(),
}).strict();

const llmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string().max(50_000), z.null()]),
}).passthrough();

const llmProxySchema = z.object({
  model: z.string().trim().min(1).max(120),
  messages: z.array(llmMessageSchema).min(1).max(50),
  stream: z.literal(false).optional(),
  max_tokens: z.number().int().min(1).max(2_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.literal(1).optional(),
  tools: z.array(z.record(z.string(), z.unknown())).max(8).optional(),
}).passthrough();

export class N8nInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "N8nInputValidationError";
  }
}

export function isInternalBearerTokenValid(header: unknown, expectedToken: string): boolean {
  if (typeof header !== "string" || !expectedToken) return false;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  const receivedToken = match?.[1] || "";
  if (!receivedToken) return false;

  const received = Buffer.from(receivedToken);
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  throw new N8nInputValidationError(`Entrada inválida. ${field}${issue?.message || "formato incorreto"}`);
}

function assertAgendaSlot(startAt: string, endAt: string | undefined, now: Date): void {
  const match = BRASILIA_ISO.exec(startAt);
  const startMs = Date.parse(startAt);
  if (!match || !Number.isFinite(startMs)) {
    throw new N8nInputValidationError("Entrada inválida. startAt: data inexistente.");
  }

  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  if (startMinute !== 0 || startHour < 7 || startHour > 18) {
    throw new N8nInputValidationError("Entrada inválida. startAt: a visita deve começar de hora em hora, entre 07h e 18h.");
  }

  if (startMs < now.getTime() - 5 * 60_000) {
    throw new N8nInputValidationError("Entrada inválida. startAt: não é permitido agendar no passado.");
  }
  if (startMs > now.getTime() + MAX_AGENDA_DAYS_AHEAD * 24 * 60 * 60_000) {
    throw new N8nInputValidationError(`Entrada inválida. startAt: limite de ${MAX_AGENDA_DAYS_AHEAD} dias excedido.`);
  }

  if (endAt) {
    const endMs = Date.parse(endAt);
    if (!Number.isFinite(endMs) || endMs - startMs !== 60 * 60_000) {
      throw new N8nInputValidationError("Entrada inválida. endAt: a visita deve durar exatamente uma hora.");
    }
  }
}

export function parseN8nAgendaList(input: unknown) {
  return parseInput(agendaListSchema, input);
}

export function parseN8nAgendaContext(input: unknown) {
  return parseInput(agendaContextSchema, input);
}

export function parseN8nPropertyCatalog(input: unknown) {
  return parseInput(propertyCatalogSchema, input);
}

export function parseN8nAgendaCreate(input: unknown, now = new Date()) {
  const parsed = parseInput(agendaCreateSchema, input);
  assertAgendaSlot(parsed.startAt, parsed.endAt, now);
  return parsed;
}

export function parseN8nAgendaUpdate(input: unknown, now = new Date()) {
  const parsed = parseInput(agendaUpdateSchema, input);
  if (parsed.startAt) assertAgendaSlot(parsed.startAt, parsed.endAt, now);
  return parsed;
}

export function parseN8nAgendaDelete(input: unknown) {
  return parseInput(agendaDeleteSchema, input);
}

export function parseN8nAiReply(input: unknown) {
  return parseInput(aiReplySchema, input);
}

export function parseN8nLlmProxyRequest(input: unknown, allowedModels: ReadonlySet<string>) {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new N8nInputValidationError("Entrada inválida. Corpo JSON não serializável.");
  }
  if (Buffer.byteLength(encoded, "utf8") > 256 * 1024) {
    throw new N8nInputValidationError("Entrada inválida. Limite de 256 KB excedido.");
  }

  const parsed = parseInput(llmProxySchema, input);
  if (!allowedModels.has(parsed.model)) {
    throw new N8nInputValidationError("Entrada inválida. Modelo não autorizado.");
  }
  return parsed;
}

export function isValidNormalizedBrazilianPhone(value: string): boolean {
  return /^55\d{10}$/.test(value);
}
