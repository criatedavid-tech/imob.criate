import { supabase } from "../supabase";
import { sendUazapiText } from "./uazapi";

// ─────────────────────────────────────────────────────────────────────────
// Alerta por WhatsApp pro PRÓPRIO corretor quando um lembrete
// (create_reminder, server/services/agent.ts) vence — complementa o badge
// visual do sino (ManualRail.tsx, useDueReminderCount). Destino: prefere o
// número PESSOAL (imf_brokers.notification_phone), com fallback pro phone de
// sempre; envia sempre pela instância da CONTA (uazapi_instance_token),
// nunca a instância própria de um membro
// (imf_broker_members.whatsapp_mode='own'): não existe telefone do membro
// salvo em lugar nenhum do schema hoje — só o instance_token, que a UAZAPI
// usa pra ENVIAR, mas o número de destino do próprio membro nunca precisou
// ser armazenado até agora (só decidia de qual instância RESPONDER um
// cliente, nunca mandar mensagem pro membro). Numa conta com membro em modo
// "own", este alerta cai no número da conta (titular), não no do membro que
// criou o lembrete — limitação conhecida, documentada em DECISIONS.md.
// ─────────────────────────────────────────────────────────────────────────

export async function runReminderWhatsappAlertTick(): Promise<void> {
  const { data: locked, error: lockError } = await supabase.rpc("try_billing_lock", {
    p_key: "reminder_whatsapp_alerts",
    p_ttl_seconds: 300,
  });
  if (lockError) {
    console.error("[Reminder Alert] falha ao adquirir lock:", lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const { data: due, error } = await supabase
      .from("imf_agenda")
      .select("id, broker_id, client_name, title")
      .eq("event_type", "lembrete")
      .eq("status", "pendente")
      .is("whatsapp_alert_sent_at", null)
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);
    if (error) throw error;
    if (!due?.length) return;

    for (const row of due as any[]) {
      try {
        const { data: broker } = await supabase
          .from("imf_brokers")
          .select("notification_phone, phone, uazapi_instance_token")
          .eq("id", row.broker_id)
          .maybeSingle();
        // Prefere o numero PESSOAL (notification_phone) — separado do comercial
        // conectado a instancia, evita o auto-envio (um numero nao notifica a si
        // mesmo pelo WhatsApp). Sem ele, cai no phone de sempre (sem regressao).
        const destination = broker?.notification_phone || broker?.phone;
        if (!destination || !broker?.uazapi_instance_token) {
          throw new Error("Corretor sem telefone ou instância de WhatsApp configurados.");
        }

        const text = row.client_name
          ? `Lembrete: ${row.title || "fazer follow-up"} — ${row.client_name}`
          : `Lembrete: ${row.title || "fazer follow-up"}`;

        const sent = await sendUazapiText(broker.uazapi_instance_token, destination, text);
        if (!sent.ok) throw new Error(`Falha ao enviar via UAZAPI (status ${sent.status}).`);

        await supabase
          .from("imf_agenda")
          .update({ whatsapp_alert_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        console.log(`[Reminder Alert] enviado #${row.id} (broker ${row.broker_id})`);
      } catch (err: any) {
        // Sem estado "failed" separado (baixo risco, alerta é complementar ao
        // badge visual) — só loga e tenta de novo no próximo tick de 60s.
        console.error(`[Reminder Alert] falha ao alertar #${row.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[Reminder Alert] tick erro:", err.message);
  } finally {
    const { error } = await supabase.rpc("release_billing_lock", { p_key: "reminder_whatsapp_alerts" });
    if (error) console.warn("[Reminder Alert] falha ao liberar lock:", error.message);
  }
}
