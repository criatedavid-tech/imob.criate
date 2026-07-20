import { supabase } from "../supabase";
import {
  UAZAPI_HOST, UAZAPI_TOKEN, APP_URL,
} from "../config";
import { fetchWithTimeout } from "../lib/http";

// ─── Provisionamento nativo (v2) — sem Z-PRO ──────────────────────────────
// Substitui createZproTenantAndChannel: cria a instância UAZAPI direto (POST
// /instance/create com admintoken) e aponta o webhook dela pro nosso próprio
// backend (/api/wpp-shim/inbound/:instanceId — server/routes/wppShim.ts),
// nunca pro Z-PRO. Sem tenant, sem canal, sem api-config, sem bot Z-PRO —
// o atendimento roda 100% nativo (backend → n8n → agente).
//
// Núcleo comum entre provisionar a CONTA (provisionUazapiInstanceNative) e
// provisionar um MEMBRO com WhatsApp próprio (provisionUazapiInstanceForMember)
// — cria a instância na UAZAPI e já aponta o webhook nativo pra ela. Quem
// chama decide em qual tabela/linha persistir o resultado.
// Aponta (ou RE-aponta) o webhook nativo da instância pro nosso backend atual
// (`${APP_URL}/api/wpp-shim/inbound/:instanceId`), NUNCA pro Z-PRO. Idempotente
// de propósito: chamado tanto na criação quanto a cada conexão, pra corrigir
// instâncias legadas cujo webhook ainda aponta pro backend antigo do Z-PRO
// (`appback.criate.online/uazapi-webhook/...`) — era exatamente isso que fazia
// as mensagens de entrada dessas contas nunca chegarem no V2. Best-effort:
// nunca lança (loga e devolve false), pra não derrubar quem chama.
export async function setUazapiWebhook(instanceToken: string, instanceId: string): Promise<boolean> {
  const inboundUrl = `${APP_URL}/api/wpp-shim/inbound/${instanceId}`;
  try {
    const res = await fetchWithTimeout(`${UAZAPI_HOST}/webhook`, {
      method: 'POST',
      headers: { token: instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: inboundUrl,
        enabled: true,
        events: ['messages', 'connection', 'wasSentByApi', 'messages_update', 'call', 'contacts', 'groups', 'history'],
        excludeMessages: [],
        addUrlEvents: false,
        addUrlTypesMessages: false,
      }),
    });
    console.log(`[Provisioning] webhook nativo ${res.ok ? 'configurado ✓' : 'FALHOU'} → ${inboundUrl}`);
    return res.ok;
  } catch (e: any) {
    console.warn('[Provisioning] setUazapiWebhook exceção:', e.message);
    return false;
  }
}

async function createUazapiInstance(channelName: string): Promise<{ instanceId: string; instanceToken: string }> {
  const res = await fetchWithTimeout(`${UAZAPI_HOST}/instance/create`, {
    method: 'POST',
    headers: { admintoken: UAZAPI_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: channelName }),
  });
  const json: any = await res.json().catch(() => null);
  const instanceToken: string | null = json?.token ?? json?.instance?.token ?? null;
  const instanceId: string | null = json?.instance?.id ?? json?.id ?? null;
  console.log(`[Provisioning] POST /instance/create "${channelName}": status=${res.status} instanceId=${instanceId ?? 'null'}`);
  if (!instanceToken || !instanceId) {
    throw new Error(`UAZAPI não retornou token/id da instância (status ${res.status}): ${JSON.stringify(json)?.slice(0, 300)}`);
  }

  // Webhook direto pro nosso backend — NUNCA pro Z-PRO.
  await setUazapiWebhook(instanceToken, instanceId);

  return { instanceId, instanceToken };
}

export async function provisionUazapiInstanceNative(broker: any): Promise<void> {
  if (!UAZAPI_HOST || !UAZAPI_TOKEN) {
    console.warn('[Provisioning] UAZAPI_HOST/UAZAPI_TOKEN ausente — não é possível provisionar.');
    await supabase.from('imf_brokers').update({
      provisioning_status: 'failed',
      provisioning_error: 'UAZAPI não configurada no servidor.',
    }).eq('id', broker.id);
    return;
  }

  try {
    const { instanceId, instanceToken } = await createUazapiInstance(`WhatsApp - ${broker.name || 'Corretor'}`);

    await supabase.from('imf_brokers').update({
      uazapi_instance_id: instanceId,
      uazapi_instance_token: instanceToken,
      provisioning_status: 'completed',
      provisioning_completed_at: new Date().toISOString(),
      provisioning_error: null,
    }).eq('id', broker.id);

    console.log(`[Provisioning] Instância nativa criada pra broker ${broker.id}: ${instanceId}`);
  } catch (err: any) {
    console.error('[Provisioning] Falha no provisionamento nativo:', err.message);
    await supabase.from('imf_brokers').update({
      provisioning_status: 'failed',
      provisioning_error: err.message,
    }).eq('id', broker.id);
  }
}

// Mesma lógica, pra um MEMBRO da equipe que ganhou WhatsApp próprio
// (imf_broker_members.whatsapp_mode='own') em vez de compartilhar o da
// conta — disparado em POST /api/auth/join (server/routes/auth.ts) quando
// o convite aceito pedia instância própria. `member.id` é o id da linha em
// imf_broker_members (não o user_id) — mesmo padrão de `broker.id` acima.
export async function provisionUazapiInstanceForMember(member: { id: string; name: string }): Promise<void> {
  if (!UAZAPI_HOST || !UAZAPI_TOKEN) {
    console.warn('[Provisioning] UAZAPI_HOST/UAZAPI_TOKEN ausente — não é possível provisionar membro.');
    await supabase.from('imf_broker_members').update({
      provisioning_status: 'failed',
      provisioning_error: 'UAZAPI não configurada no servidor.',
    }).eq('id', member.id);
    return;
  }

  try {
    const { instanceId, instanceToken } = await createUazapiInstance(`WhatsApp - ${member.name || 'Corretor'}`);

    await supabase.from('imf_broker_members').update({
      uazapi_instance_id: instanceId,
      uazapi_instance_token: instanceToken,
      provisioning_status: 'completed',
      provisioning_completed_at: new Date().toISOString(),
      provisioning_error: null,
    }).eq('id', member.id);

    console.log(`[Provisioning] Instância própria criada pro membro ${member.id}: ${instanceId}`);
  } catch (err: any) {
    console.error('[Provisioning] Falha no provisionamento do membro:', err.message);
    await supabase.from('imf_broker_members').update({
      provisioning_status: 'failed',
      provisioning_error: err.message,
    }).eq('id', member.id);
  }
}

// ─── Auto-recuperação (self-healing) ──────────────────────────────────────
// Garante que exista uma instância pronta pra broker/membro, provisionando
// na hora se ainda não houver (nunca tentado, tentativa anterior falhou, ou
// ainda no estado inicial 'pending'). Chamado a partir de GET/POST
// /api/brokers/whatsapp/* (server/routes/brokers.ts) pra que a tela de
// WhatsApp nunca fique presa em "ainda sendo configurada" esperando um
// evento externo (pagamento, ação manual do admin).
//
// Trava por comparar-e-trocar: lê o status atual e só provisiona se ele NÃO
// for 'processing'/'completed'; a atualização em si só é aplicada se o valor
// no banco ainda for exatamente o que acabou de ser lido (.eq/.is pro valor
// conhecido, nunca .neq/.or). Duas armadilhas descobertas testando ao vivo
// contra imf_brokers real, nessa ordem:
//   1. .neq('status','completed').neq('status','processing') encadeado nunca
//      captura uma linha com status NULL (em SQL, `col <> valor` é NULL, não
//      true, quando `col` é NULL) — bug que impedia a trava de travar no
//      primeiro provisionamento de contas mais antigas.
//   2. A troca por .or('status.is.null,status.eq.pending,...') pra cobrir
//      esse caso quebra especificamente em UPDATE no PostgREST/supabase-js
//      ("column ... does not exist", 42703) — .or() funciona em SELECT mas
//      não nesse combo com .update().eq(). Daí o comparar-e-trocar abaixo,
//      que evita os dois problemas.
const PROVISIONING_BLOCKING_STATES = ['processing', 'completed'];

async function ensureInstance<T extends { id: string }>(
  table: 'imf_brokers' | 'imf_broker_members',
  row: { id: string; name?: string },
  provisionFn: (row: any) => Promise<void>,
): Promise<{ token: string | null; status: string | null; error: string | null }> {
  const { data: current } = await supabase.from(table)
    .select('uazapi_instance_token, provisioning_status, provisioning_error')
    .eq('id', row.id)
    .single();

  if (current?.uazapi_instance_token) {
    return { token: current.uazapi_instance_token, status: current.provisioning_status || null, error: current.provisioning_error || null };
  }
  if (current?.provisioning_status && PROVISIONING_BLOCKING_STATES.includes(current.provisioning_status)) {
    return { token: null, status: current.provisioning_status, error: current.provisioning_error || null };
  }

  let lockQuery = supabase.from(table).update({ provisioning_status: 'processing' }).eq('id', row.id);
  lockQuery = current?.provisioning_status
    ? lockQuery.eq('provisioning_status', current.provisioning_status)
    : lockQuery.is('provisioning_status', null);
  const { data: locked } = await lockQuery.select('id');

  if (locked?.length) {
    await provisionFn(row);
  }

  const { data: fresh } = await supabase.from(table)
    .select('uazapi_instance_token, provisioning_status, provisioning_error')
    .eq('id', row.id)
    .single();
  return {
    token: fresh?.uazapi_instance_token || null,
    status: fresh?.provisioning_status || null,
    error: fresh?.provisioning_error || null,
  };
}

export function ensureBrokerInstance(broker: { id: string; name?: string }) {
  return ensureInstance('imf_brokers', broker, provisionUazapiInstanceNative);
}

export function ensureMemberInstance(member: { id: string; name?: string }) {
  return ensureInstance('imf_broker_members', member, (m) => provisionUazapiInstanceForMember(m as { id: string; name: string }));
}

// Encerra a sessão do WhatsApp conectada na instância (POST /instance/disconnect
// da UAZAPI) SEM apagar a instância — ela continua existindo, pronta pra um
// novo QR code parear outro número (POST /instance/connect logo em seguida).
// Diferente de /instance/delete (não usado aqui): não perde token/webhook.
export async function disconnectUazapiInstance(instanceToken: string): Promise<void> {
  const r = await fetchWithTimeout(`${UAZAPI_HOST}/instance/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: instanceToken },
    body: JSON.stringify({}),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`UAZAPI /instance/disconnect respondeu ${r.status}: ${text.slice(0, 200)}`);
  }
}
