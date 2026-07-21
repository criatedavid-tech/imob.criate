import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { resolveOutboundInstanceToken, sendUazapiText } from "./wppShim";
import { recordConversationMessage } from "./conversationTickets";

// ─────────────────────────────────────────────────────────────────────────
// Follow-up agendado pelo Assistente IA interno (ação "schedule_followup"
// em server/services/agent.ts) — pedido tipo "envie em 24h um follow-up
// pro fulano". Diferente do Follow-Up Inteligente (régua automática por
// status de conversa, followup.ts/followup_config): aqui é um envio
// pontual, ad-hoc, agendado por comando explícito do corretor pra UM
// contato específico, com o texto já definido no momento do pedido —
// nada é gerado de novo na hora do envio.
// ─────────────────────────────────────────────────────────────────────────

export async function scheduleAgentFollowup(params: {
  brokerId: string;
  ownerUserId: string;
  contactName: string;
  contactPhone: string;
  message: string;
  dueAt: Date;
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("imf_agent_scheduled_followups")
    .insert({
      broker_id: params.brokerId,
      owner_user_id: params.ownerUserId,
      contact_name: params.contactName,
      contact_phone: normalizePhoneBR(params.contactPhone),
      message: params.message,
      due_at: params.dueAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

export async function runScheduledAgentFollowupsTick(): Promise<void> {
  const { data: locked, error: lockError } = await supabase.rpc("try_billing_lock", {
    p_key: "agent_scheduled_followups",
    p_ttl_seconds: 300,
  });
  if (lockError) {
    console.error("[Agent Follow-up] falha ao adquirir lock:", lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const { data: due, error } = await supabase
      .from("imf_agent_scheduled_followups")
      .select("id, broker_id, contact_phone, message")
      .eq("status", "pending")
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(20);
    if (error) throw error;
    if (!due?.length) return;

    for (const row of due as any[]) {
      try {
        const instanceToken = await resolveOutboundInstanceToken(row.broker_id, row.contact_phone);
        if (!instanceToken) throw new Error("Instância de WhatsApp não configurada para este corretor.");

        const sent = await sendUazapiText(instanceToken, row.contact_phone, row.message);
        if (!sent.ok) throw new Error(`Falha ao enviar via UAZAPI (status ${sent.status}).`);

        // senderType "ai" (não "broker_manual") e sem pauseAiForHumanTakeover:
        // este é um follow-up automático que dispara sozinho, mesmo espírito
        // do Follow-Up Inteligente (followup.ts) — não deve pausar o
        // atendimento normal da IA pra esse cliente depois do envio.
        await recordConversationMessage({
          brokerId: row.broker_id,
          customerPhone: row.contact_phone,
          direction: "out",
          senderType: "ai",
          body: row.message,
          initialStatus: "open",
        });

        await supabase
          .from("imf_agent_scheduled_followups")
          .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", row.id);
        console.log(`[Agent Follow-up] enviado #${row.id} → ${row.contact_phone} (broker ${row.broker_id})`);
      } catch (err: any) {
        console.error(`[Agent Follow-up] falha ao enviar #${row.id}:`, err.message);
        await supabase
          .from("imf_agent_scheduled_followups")
          .update({ status: "failed", last_error: String(err.message).slice(0, 500), updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
  } catch (err: any) {
    console.error("[Agent Follow-up] tick erro:", err.message);
  } finally {
    const { error } = await supabase.rpc("release_billing_lock", { p_key: "agent_scheduled_followups" });
    if (error) console.warn("[Agent Follow-up] falha ao liberar lock:", error.message);
  }
}
