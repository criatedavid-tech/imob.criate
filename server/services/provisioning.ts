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
  const inboundUrl = `${APP_URL}/api/wpp-shim/inbound/${instanceId}`;
  const webhookRes = await fetchWithTimeout(`${UAZAPI_HOST}/webhook`, {
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
  console.log(`[Provisioning] webhook nativo ${webhookRes.ok ? 'configurado ✓' : 'FALHOU'} → ${inboundUrl}`);

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
