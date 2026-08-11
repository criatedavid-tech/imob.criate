import { supabase } from "../supabase";

export type SystemErrorChannel = "whatsapp_pai" | "painel_interno" | "integracao" | "worker" | "sistema";
export type SystemErrorCategory =
  | "execution_error"
  | "integration_failure"
  | "agent_unhandled"
  | "tool_failure"
  | "validation_error"
  | "queue_failure";

export function sanitizeOperationalText(value: unknown, max = 2_000): string {
  let text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ");
  text = text
    .replace(/(authorization|api[-_ ]?key|token|secret|password|senha)\s*[:=]\s*([^\s,;]+)/gi, "$1=[PROTEGIDO]")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "[CHAVE_PROTEGIDA]")
    .replace(/\beyJ[a-zA-Z0-9._-]{20,}\b/g, "[TOKEN_PROTEGIDO]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL_PROTEGIDO]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, "[TELEFONE_PROTEGIDO]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF_PROTEGIDO]");
  return text.trim().slice(0, max);
}

function sanitizeContext(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const entries = Object.entries(input || {}).slice(0, 30).map(([key, value]) => {
    if (typeof value === "string") return [key.slice(0, 80), sanitizeOperationalText(value, 500)];
    if (typeof value === "number" || typeof value === "boolean" || value === null) return [key.slice(0, 80), value];
    return [key.slice(0, 80), sanitizeOperationalText(JSON.stringify(value), 500)];
  });
  return Object.fromEntries(entries);
}

export async function recordSystemError(input: {
  brokerId: string;
  userId?: string | null;
  channel: SystemErrorChannel;
  category: SystemErrorCategory;
  requestedAction?: string | null;
  stage: string;
  publicMessage?: string | null;
  technicalMessage: unknown;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.from("imf_system_error_logs").insert({
      broker_id: input.brokerId,
      user_id: input.userId || null,
      channel: input.channel,
      category: input.category,
      requested_action: input.requestedAction ? sanitizeOperationalText(input.requestedAction, 500) : null,
      stage: sanitizeOperationalText(input.stage, 160) || "nao_informada",
      public_message: input.publicMessage ? sanitizeOperationalText(input.publicMessage, 1_000) : null,
      technical_message: sanitizeOperationalText(input.technicalMessage) || "Erro sem mensagem tecnica.",
      context: sanitizeContext(input.context),
    });
    if (error && !/imf_system_error_logs|schema cache|does not exist/i.test(error.message || "")) {
      console.warn("[SystemLogs] falha ao registrar erro:", sanitizeOperationalText(error.message, 500));
    }
  } catch (error: any) {
    // O mecanismo de observabilidade nunca pode derrubar o fluxo observado.
    console.warn("[SystemLogs] falha inesperada:", sanitizeOperationalText(error?.message || error, 500));
  }
}
