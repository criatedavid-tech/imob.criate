import { supabase } from "../supabase";

const WEBHOOK_LOG_RETENTION_DAYS = 90;

export async function purgeExpiredWebhookLogs(): Promise<void> {
  const { data: locked, error: lockError } = await supabase.rpc("try_billing_lock", {
    p_key: "webhook_logs_purge",
    p_ttl_seconds: 3600,
  });
  if (lockError) {
    console.error("[Maintenance] falha ao adquirir lock do purge:", lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const cutoff = new Date(Date.now() - WEBHOOK_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("webhook_logs").delete().lt("created_at", cutoff);
    if (error) throw error;
    console.log(`[Maintenance] webhook_logs anteriores a ${cutoff.slice(0, 10)} removidos`);
  } catch (error: any) {
    console.error("[Maintenance] purge de webhook_logs falhou:", error?.message || error);
  } finally {
    const { error } = await supabase.rpc("release_billing_lock", { p_key: "webhook_logs_purge" });
    if (error) console.warn("[Maintenance] falha ao liberar lock do purge:", error.message);
  }
}
