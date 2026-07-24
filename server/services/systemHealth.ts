import { supabase } from "../supabase";
import { PUBLIC_APP_URL, REDIS_URL, SENTRY_DSN, N8N_WEBHOOK_URL } from "../config";

// ─── Saúde do sistema (painel do admin) ─────────────────────────────────────
// O objetivo é responder, sem abrir o SQL: o pipeline está drenando? tem
// mensagem parada? qual corretor está com o WhatsApp caído? o que falhou
// agora há pouco? Cada número aqui existe para levar a uma AÇÃO — por isso o
// painel também expõe as intervenções (reprocessar, destravar, purgar).

type HealthLevel = "ok" | "atencao" | "critico";

export interface QueueHealth {
  name: string;
  pending: number;
  processing: number;
  dead: number;
  completed24h: number;
  oldestPendingSeconds: number | null;
  staleLeases: number;
  level: HealthLevel;
}

const LEASE_STALE_SECONDS = 300;

async function countRows(table: string, apply: (q: any) => any): Promise<number> {
  const { count, error } = await apply(supabase.from(table).select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count || 0;
}

async function queueHealth(table: string, name: string): Promise<QueueHealth> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - LEASE_STALE_SECONDS * 1000).toISOString();

  const [pending, processing, dead, completed24h, staleLeases] = await Promise.all([
    countRows(table, (q) => q.eq("status", "pending")),
    countRows(table, (q) => q.eq("status", "processing")),
    countRows(table, (q) => q.eq("status", "dead")),
    countRows(table, (q) => q.eq("status", "completed").gte("created_at", since24h)),
    // Linha reivindicada por um worker que morreu no meio: fica "processing"
    // com lease vencido. O claim recupera sozinho, mas ver o número aqui
    // explica um pico de latência sem precisar adivinhar.
    countRows(table, (q) => q.eq("status", "processing").lt("locked_at", staleCutoff)),
  ]);

  const { data: oldest } = await supabase
    .from(table)
    .select("created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const oldestPendingSeconds = oldest?.created_at
    ? Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 1000)
    : null;

  // O sinal que antecede o colapso é a IDADE da fila, não o tamanho: um pico
  // grande drenado em segundos é saudável; 20 linhas paradas há 5 minutos não.
  let level: HealthLevel = "ok";
  if (dead > 0 || (oldestPendingSeconds !== null && oldestPendingSeconds > 300)) level = "critico";
  else if ((oldestPendingSeconds !== null && oldestPendingSeconds > 60) || staleLeases > 0 || pending > 200) level = "atencao";

  return { name, pending, processing, dead, completed24h, oldestPendingSeconds, staleLeases, level };
}

export interface BrokerHealthRow {
  broker_id: string;
  name: string;
  status: string | null;
  instance_id: string | null;
  provisioning_status: string | null;
  has_token: boolean;
  last_inbound_at: string | null;
  minutes_since_inbound: number | null;
  open_tickets: number;
  ai_paused_tickets: number;
  level: HealthLevel;
}

export async function getSystemHealth() {
  const [inbox, outbox] = await Promise.all([
    queueHealth("imf_webhook_inbox", "Entrada (WhatsApp -> app)"),
    queueHealth("imf_webhook_outbox", "Saída (app -> IA no n8n)"),
  ]);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [msgsIn24h, msgsOut24h, openTickets, aiPaused, deadLetterSamples, recentRejected] = await Promise.all([
    countRows("imf_conversation_messages", (q) => q.eq("direction", "in").gte("created_at", since24h)),
    countRows("imf_conversation_messages", (q) => q.eq("direction", "out").gte("created_at", since24h)),
    countRows("imf_conversation_tickets", (q) => q.in("conversation_status", ["open", "pending"])),
    countRows("imf_conversation_tickets", (q) => q.eq("ai_active", false).in("conversation_status", ["open", "pending"])),
    supabase.from("imf_webhook_inbox")
      .select("id, broker_id, event_type, attempts, last_error, created_at")
      .eq("status", "dead").order("created_at", { ascending: false }).limit(20),
    supabase.from("webhook_logs")
      .select("created_at, event_type, status")
      .eq("status", "rejected").gte("created_at", since24h).limit(50),
  ]);

  const mem = process.memoryUsage();

  return {
    generated_at: new Date().toISOString(),
    queues: [inbox, outbox],
    traffic: {
      inbound_messages_24h: msgsIn24h,
      outbound_messages_24h: msgsOut24h,
      open_tickets: openTickets,
      ai_paused_tickets: aiPaused,
    },
    dead_letters: deadLetterSamples.data || [],
    rejected_webhooks_24h: (recentRejected.data || []).length,
    runtime: {
      uptime_seconds: Math.round(process.uptime()),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      node_version: process.version,
    },
    config: {
      public_app_url: PUBLIC_APP_URL,
      // Só o estado (configurado ou não) — nunca o valor do segredo.
      redis_configured: !!REDIS_URL,
      sentry_configured: !!SENTRY_DSN,
      n8n_webhook_configured: !!N8N_WEBHOOK_URL,
    },
  };
}

// Visão por corretor: qual conta está com o WhatsApp caído, sem receber
// mensagem há muito tempo, ou com a IA pausada em tudo.
export async function getBrokerHealth(): Promise<BrokerHealthRow[]> {
  const { data: brokers, error } = await supabase
    .from("imf_brokers")
    .select("id, name, status, uazapi_instance_id, uazapi_instance_token, provisioning_status")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;

  const rows: BrokerHealthRow[] = [];
  for (const b of brokers || []) {
    const [{ data: lastMsg }, openTickets, aiPaused] = await Promise.all([
      supabase.from("imf_conversation_messages")
        .select("created_at").eq("broker_id", b.id).eq("direction", "in")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      countRows("imf_conversation_tickets", (q) => q.eq("broker_id", b.id).in("conversation_status", ["open", "pending"])),
      countRows("imf_conversation_tickets", (q) => q.eq("broker_id", b.id).eq("ai_active", false).in("conversation_status", ["open", "pending"])),
    ]);

    const lastInbound = lastMsg?.created_at || null;
    const minutes = lastInbound ? Math.round((Date.now() - new Date(lastInbound).getTime()) / 60000) : null;

    let level: HealthLevel = "ok";
    if (!b.uazapi_instance_id || !b.uazapi_instance_token) level = "critico";
    else if (b.provisioning_status && b.provisioning_status !== "completed") level = "atencao";

    rows.push({
      broker_id: b.id,
      name: b.name || "(sem nome)",
      status: b.status,
      instance_id: b.uazapi_instance_id,
      provisioning_status: b.provisioning_status,
      has_token: !!b.uazapi_instance_token,
      last_inbound_at: lastInbound,
      minutes_since_inbound: minutes,
      open_tickets: openTickets,
      ai_paused_tickets: aiPaused,
      level,
    });
  }
  return rows;
}

// ─── Intervenções ───────────────────────────────────────────────────────────

// Devolve linhas da DLQ para a fila. Sem isso, uma indisponibilidade longa do
// n8n mandava tudo para `dead` e a única saída era UPDATE manual no banco.
export async function requeueDeadRows(table: "imf_webhook_inbox" | "imf_webhook_outbox", limit = 500) {
  const { data: rows, error } = await supabase
    .from(table).select("id").eq("status", "dead")
    .order("created_at", { ascending: true }).limit(Math.min(limit, 1000));
  if (error) throw error;
  const ids = (rows || []).map((r: any) => r.id);
  if (!ids.length) return 0;

  const { error: updateError } = await supabase.from(table).update({
    status: "pending",
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }).in("id", ids);
  if (updateError) throw updateError;
  return ids.length;
}

// Libera linhas presas em "processing" com lease vencido (worker morto no meio
// de um deploy, por exemplo). O claim já recupera sozinho após o lease, isto é
// o botão de "não quero esperar".
export async function releaseStaleLeases(table: "imf_webhook_inbox" | "imf_webhook_outbox") {
  const cutoff = new Date(Date.now() - LEASE_STALE_SECONDS * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from(table).select("id").eq("status", "processing").lt("locked_at", cutoff).limit(1000);
  if (error) throw error;
  const ids = (rows || []).map((r: any) => r.id);
  if (!ids.length) return 0;

  const { error: updateError } = await supabase.from(table).update({
    status: "pending",
    next_attempt_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
  }).in("id", ids);
  if (updateError) throw updateError;
  return ids.length;
}
