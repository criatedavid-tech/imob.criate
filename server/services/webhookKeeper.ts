import { supabase } from "../supabase";
import { PUBLIC_APP_URL } from "../config";
import {
  getUazapiWebhookState,
  isUazapiWebhookReady,
  platformWebhookUrl,
  setUazapiPlatformWebhook,
  setUazapiWebhook,
} from "./provisioning";

// ─── Guardião do webhook UAZAPI ─────────────────────────────────────────────
// Causa-raiz do "inbound cai e precisa reconectar": o webhook só era (re)setado
// no provisionamento e na reconexão manual. Quando a UAZAPI perde a config do
// webhook (restart do provedor, re-init de sessão), o inbound morre em silêncio
// — a sessão continua conectada (o envio funciona), mas os eventos param de
// chegar. Este job reafirma o webhook periodicamente, sem ninguém reconectar.
//
// Escala: em vez de re-POSTar todas as instâncias a cada tick, primeiro LÊ o
// webhook atual (barato) e só re-seta em desvio confirmado. Quando não dá pra
// ler (a UAZAPI pode não expor GET), reafirma no máximo a cada FORCE_REFRESH_MS
// por instância — assim não martela o provedor mesmo com muitas contas.

let running = false;
const lastAssertedAt = new Map<string, number>();
const CONCURRENCY = 4;
const FORCE_REFRESH_MS = 30 * 60 * 1_000;

interface KeptInstance {
  instanceId: string;
  token: string;
  kind: "broker" | "pai";
  desiredEnabled: boolean;
}

function isPublicUrl(u: string): boolean {
  return /^https:\/\//i.test(u) && !/(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(u);
}

async function collectInstances(): Promise<KeptInstance[]> {
  const out: KeptInstance[] = [];
  const { data: brokers } = await supabase.from("imf_brokers")
    .select("uazapi_instance_id, uazapi_instance_token")
    .not("uazapi_instance_id", "is", null)
    .not("uazapi_instance_token", "is", null)
    .eq("provisioning_status", "completed");
  for (const b of brokers || []) {
    if (b.uazapi_instance_id && b.uazapi_instance_token) {
      out.push({ instanceId: b.uazapi_instance_id, token: b.uazapi_instance_token, kind: "broker", desiredEnabled: true });
    }
  }
  const { data: members } = await supabase.from("imf_broker_members")
    .select("uazapi_instance_id, uazapi_instance_token")
    .not("uazapi_instance_id", "is", null)
    .not("uazapi_instance_token", "is", null);
  for (const m of members || []) {
    if (m.uazapi_instance_id && m.uazapi_instance_token) {
      out.push({ instanceId: m.uazapi_instance_id, token: m.uazapi_instance_token, kind: "broker", desiredEnabled: true });
    }
  }
  const { data: platform } = await supabase.from("imf_platform_instances")
    .select("key, uazapi_instance_id, uazapi_instance_token, webhook_enabled")
    .eq("key", "pai")
    .maybeSingle();
  if (platform?.uazapi_instance_id && platform?.uazapi_instance_token) {
    out.push({
      instanceId: platform.uazapi_instance_id,
      token: platform.uazapi_instance_token,
      kind: "pai",
      desiredEnabled: platform.webhook_enabled === true,
    });
  }
  return out;
}

async function keepOne(inst: KeptInstance, nowMs: number): Promise<"ok" | "fixed" | "skip"> {
  const expected = inst.kind === "pai"
    ? platformWebhookUrl(PUBLIC_APP_URL)
    : `${PUBLIC_APP_URL}/api/wpp-shim/inbound/${inst.instanceId}`;
  if (!expected) return "skip";
  const current = await getUazapiWebhookState(inst.token);

  const reassert = () => inst.kind === "pai"
    ? setUazapiPlatformWebhook(inst.token, PUBLIC_APP_URL, inst.desiredEnabled)
    : setUazapiWebhook(inst.token, inst.instanceId);

  if (current && isUazapiWebhookReady(current, expected, inst.desiredEnabled)) {
    lastAssertedAt.set(inst.instanceId, nowMs);
    return "ok";
  }

  if (current && (
    current.url !== expected
    || current.enabled !== inst.desiredEnabled
    || current.events !== null
  )) {
    // Desvio confirmado (o webhook aponta pra outro lugar) → corrige já.
    const ok = await reassert();
    if (ok) { lastAssertedAt.set(inst.instanceId, nowMs); return "fixed"; }
    return "skip";
  }

  // current === null: não deu pra checar. Reafirma só de tempos em tempos.
  const last = lastAssertedAt.get(inst.instanceId) || 0;
  if (nowMs - last >= FORCE_REFRESH_MS) {
    const ok = await reassert();
    if (ok) { lastAssertedAt.set(inst.instanceId, nowMs); return "fixed"; }
  }
  return "skip";
}

export async function runWebhookKeeperTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isPublicUrl(PUBLIC_APP_URL)) {
      console.warn(`[Webhook Keeper] PUBLIC_APP_URL não-pública ("${PUBLIC_APP_URL}") — guardião inativo. Configure para o inbound funcionar.`);
      return;
    }
    const instances = await collectInstances();
    let fixed = 0;
    const nowMs = Date.now();
    for (let i = 0; i < instances.length; i += CONCURRENCY) {
      const batch = instances.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((inst) => keepOne(inst, nowMs).catch(() => "skip" as const)),
      );
      fixed += results.filter((r) => r === "fixed").length;
    }
    if (fixed > 0) console.log(`[Webhook Keeper] reafirmou o webhook de ${fixed} instância(s) que tinham desviado.`);
  } catch (error: any) {
    console.error("[Webhook Keeper] tick falhou:", error?.message);
  } finally {
    running = false;
  }
}
