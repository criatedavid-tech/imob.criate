import { supabase } from "../supabase";
import { sendUazapiText } from "./uazapi";

// ─────────────────────────────────────────────────────────────────────────
// Alerta por WhatsApp pro corretor quando a IA de atendimento (N8N) marca uma
// visita (POST /api/agenda/n8n/create → imf_agenda.booked_by_chatbot=true).
// Complementa o badge visual na Agenda (ManualRail.tsx). Manda a mensagem pro
// numero PESSOAL do corretor (imf_brokers.notification_phone), a partir da
// instancia UAZAPI da CONTA (uazapi_instance_token) — que e o numero comercial
// que a IA usa pra falar com o cliente. O destino tem que ser um numero
// DIFERENTE do comercial: um numero nao consegue se notificar de forma
// confiavel pelo WhatsApp (por isso um campo pessoal separado).
//
// Sem notification_phone configurado, o WhatsApp e pulado (marca a linha como
// resolvida pra nao reprocessar toda hora) — o badge in-app cobre o aviso.
//
// Mesma limitacao do reminderAlerts.ts: numa conta com membro em modo "own"
// (imf_broker_members.whatsapp_mode='own'), o alerta usa o numero/instancia da
// conta (titular), nunca o do membro — nao existe telefone de membro no schema.
// ─────────────────────────────────────────────────────────────────────────

const BR_TZ = "America/Sao_Paulo";

export async function runVisitWhatsappAlertTick(): Promise<void> {
  const { data: locked, error: lockError } = await supabase.rpc("try_billing_lock", {
    p_key: "visit_whatsapp_alerts",
    p_ttl_seconds: 300,
  });
  if (lockError) {
    console.error("[Visit Alert] falha ao adquirir lock:", lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const { data: due, error } = await supabase
      .from("imf_agenda")
      .select("id, broker_id, client_name, scheduled_at")
      .eq("booked_by_chatbot", true)
      .is("whatsapp_notified_at", null)
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);
    if (error) throw error;
    if (!due?.length) return;

    for (const row of due as any[]) {
      try {
        const { data: broker } = await supabase
          .from("imf_brokers")
          .select("notification_phone, uazapi_instance_token")
          .eq("id", row.broker_id)
          .maybeSingle();

        // Sem numero pessoal (ou sem instancia): nao da pra alertar por
        // WhatsApp. Marca como resolvida pra nao reprocessar a cada tick — o
        // badge in-app ja cobre. Se o corretor configurar o numero depois,
        // perde so o WhatsApp DESTA visita, nunca o badge.
        if (!broker?.notification_phone || !broker?.uazapi_instance_token) {
          await supabase
            .from("imf_agenda")
            .update({ whatsapp_notified_at: new Date().toISOString() })
            .eq("id", row.id);
          continue;
        }

        const quando = new Date(row.scheduled_at).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: BR_TZ,
        });
        const cliente = row.client_name ? ` com ${row.client_name}` : "";
        const text = `Nova visita agendada pela IA${cliente} para ${quando}. Confira na sua Agenda.`;

        const sent = await sendUazapiText(broker.uazapi_instance_token, broker.notification_phone, text);
        if (!sent.ok) throw new Error(`Falha ao enviar via UAZAPI (status ${sent.status}).`);

        await supabase
          .from("imf_agenda")
          .update({ whatsapp_notified_at: new Date().toISOString() })
          .eq("id", row.id);
        console.log(`[Visit Alert] enviado #${row.id} (broker ${row.broker_id})`);
      } catch (err: any) {
        // Falha de ENVIO nao marca a linha — tenta de novo no proximo tick de
        // 60s (enquanto a visita ainda for futura). So o caso "sem numero" acima
        // marca como resolvida.
        console.error(`[Visit Alert] falha ao alertar #${row.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[Visit Alert] tick erro:", err.message);
  } finally {
    const { error } = await supabase.rpc("release_billing_lock", { p_key: "visit_whatsapp_alerts" });
    if (error) console.warn("[Visit Alert] falha ao liberar lock:", error.message);
  }
}
