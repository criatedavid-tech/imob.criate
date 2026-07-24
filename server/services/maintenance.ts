import { supabase } from "../supabase";

const WEBHOOK_LOG_RETENTION_DAYS = 90;
// Filas: linhas já resolvidas viram só peso. Sem retenção, os índices UNIQUE
// de dedupe (que cobrem TODO o histórico) crescem para sempre e cada INSERT
// de ingestão sonda um btree cada vez maior — a latência degrada de forma
// permanente, mesmo com a fila vazia. A 50 msg/s seriam milhões de linhas/dia.
const QUEUE_RETENTION_HOURS = Number(process.env.QUEUE_RETENTION_HOURS) || 72;
const QUEUE_PURGE_BATCH = 2_000;
const QUEUE_PURGE_MAX_BATCHES = 25;

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

// Purga LOTADA: um DELETE único numa tabela grande estoura o statement timeout
// e nunca conclui — a tabela só cresce. Apagando em lotes, cada instrução é
// curta e o job progride mesmo com backlog acumulado.
async function purgeQueueTable(table: string, cutoffIso: string): Promise<number> {
  let removed = 0;
  for (let i = 0; i < QUEUE_PURGE_MAX_BATCHES; i++) {
    const { data: batch, error: selectError } = await supabase
      .from(table)
      .select("id")
      .in("status", ["completed", "ignored"])
      .lt("created_at", cutoffIso)
      .limit(QUEUE_PURGE_BATCH);
    if (selectError) throw selectError;
    const ids = (batch || []).map((r: any) => r.id);
    if (!ids.length) break;

    const { error: deleteError } = await supabase.from(table).delete().in("id", ids);
    if (deleteError) throw deleteError;
    removed += ids.length;
    if (ids.length < QUEUE_PURGE_BATCH) break;
  }
  return removed;
}

export async function purgeResolvedQueueRows(): Promise<void> {
  const { data: locked, error: lockError } = await supabase.rpc("try_billing_lock", {
    p_key: "webhook_queue_purge",
    p_ttl_seconds: 1800,
  });
  if (lockError) {
    console.error("[Maintenance] falha ao adquirir lock do purge de filas:", lockError.message);
    return;
  }
  if (!locked) return;

  try {
    const cutoff = new Date(Date.now() - QUEUE_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
    // Outbox primeiro: ela referencia a inbox (FK com cascade), então limpar
    // na ordem inversa evita apagar por cascata sem contabilizar.
    const outbox = await purgeQueueTable("imf_webhook_outbox", cutoff);
    const inbox = await purgeQueueTable("imf_webhook_inbox", cutoff);
    if (outbox || inbox) {
      console.log(`[Maintenance] filas purgadas: outbox=${outbox}, inbox=${inbox} (anteriores a ${cutoff})`);
    }
  } catch (error: any) {
    console.error("[Maintenance] purge de filas falhou:", error?.message || error);
  } finally {
    const { error } = await supabase.rpc("release_billing_lock", { p_key: "webhook_queue_purge" });
    if (error) console.warn("[Maintenance] falha ao liberar lock do purge de filas:", error.message);
  }
}
