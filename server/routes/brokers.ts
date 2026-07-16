import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { normalizePhoneBR, normalizePhoneBRFull, encryptKey, decryptKey } from "../lib/crypto";
import { TERMS_VERSION, INTERNAL_PROXY_TOKEN, UAZAPI_HOST } from "../config";
import { fetchWithTimeout } from "../lib/http";
import { ensureBrokerInstance, ensureMemberInstance, disconnectUazapiInstance } from "../services/provisioning";
import { asaasBaseUrlForEnv } from "../services/asaasCredentials";

export const brokersRouter = express.Router();

brokersRouter.get("/api/brokers/me", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found or created" });

    // Campos seguros para expor ao frontend — NUNCA incluir:
    // asaas_credit_card_token (cobra cartão), zpro_password, reset_token, reset_token_expires_at
    const { data, error } = await supabase.from('imf_brokers').select(
      'id, user_id, name, email, phone, ai_name, broker_address, status, plan, account_type, ' +
      'valid_until, grace_until, is_admin, corretora_id, ' +
      'zpro_tenant_id, zpro_channel_id, zpro_channel_name, zpro_user_email, zpro_username, zpro_qr_code, ' +
      'zpro_api_url, zpro_api_key, ' +
      'asaas_customer_id, asaas_subscription_id, ' +
      'provisioning_status, provisioning_error, provisioning_completed_at, ' +
      'created_at, updated_at'
    ).eq('id', brokerId).single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Atualiza as configurações e informações do perfil do corretor.
 */
brokersRouter.post("/api/brokers/settings", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker profile could not be found" });

    // Whitelist: impede mass assignment (ex.: is_admin, valid_until, status
    // ou tokens de pagamento enviados no body seriam gravados sem isso).
    const ALLOWED_SETTINGS = ['name', 'phone', 'ai_name', 'broker_address'] as const;
    const settings: Record<string, any> = {};
    for (const field of ALLOWED_SETTINGS) {
      if (req.body?.[field] !== undefined) settings[field] = req.body[field];
    }
    if (settings.phone !== undefined) settings.phone = normalizePhoneBR(settings.phone);
    const { data, error } = await supabase.from('imf_brokers').update({
      ...settings,
      updated_at: new Date()
    }).eq('id', brokerId).select(
      'id, name, phone, ai_name, broker_address, updated_at'
    ).single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Termos de Uso — versão vigente e registro de aceite ─────────────────

brokersRouter.get("/api/terms/status", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });
    const { data } = await supabase.from('imf_brokers')
      .select('terms_version, terms_accepted_at').eq('id', brokerId).single();
    res.json({
      current: TERMS_VERSION,
      accepted_version: data?.terms_version || null,
      accepted_at: data?.terms_accepted_at || null,
      needs_acceptance: data?.terms_version !== TERMS_VERSION
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokersRouter.post("/api/terms/accept", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Perfil não encontrado." });
    const acceptedAt = new Date().toISOString();
    const { error } = await supabase.from('imf_brokers')
      .update({ terms_version: TERMS_VERSION, terms_accepted_at: acceptedAt })
      .eq('id', brokerId);
    if (error) throw error;
    res.json({ ok: true, version: TERMS_VERSION, accepted_at: acceptedAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agente IA do corretor ───────────────────────────────────────────────

brokersRouter.get("/api/brokers/my-agent", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { data } = await supabase
      .from('broker_agents')
      .select('id, agent_name, system_prompt, is_active, updated_at')
      .eq('broker_id', brokerId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    res.json(data ?? { agent_name: 'Agente Principal', system_prompt: '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

brokersRouter.post("/api/brokers/my-agent", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const agent_name: string = req.body?.agent_name || 'Agente Principal';
    const system_prompt: string = req.body?.system_prompt ?? '';

    const { data: existing } = await supabase
      .from('broker_agents')
      .select('id')
      .eq('broker_id', brokerId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('broker_agents')
        .update({ agent_name, system_prompt, updated_at: new Date() })
        .eq('id', existing.id)
        .select('id, agent_name, system_prompt, updated_at')
        .single();
      if (error) throw error;
      return res.json(data);
    }

    const { data, error } = await supabase
      .from('broker_agents')
      .insert({ broker_id: brokerId, agent_name, system_prompt })
      .select('id, agent_name, system_prompt, updated_at')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para N8N — auth via INTERNAL_PROXY_TOKEN
brokersRouter.get("/api/brokers/:id/agent", async (req, res) => {
  const auth = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!INTERNAL_PROXY_TOKEN || auth !== INTERNAL_PROXY_TOKEN) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
  try {
    const { id } = req.params;
    const { data } = await supabase
      .from('broker_agents')
      .select('agent_name, system_prompt')
      .eq('broker_id', id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    res.json({ agent_name: data?.agent_name ?? 'Agente Principal', system_prompt: data?.system_prompt ?? '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WhatsApp — conexão via QR code (substitui o painel externo do Z-PRO) ──
// A instância UAZAPI já é criada no provisionamento (server/services/provisioning.ts);
// aqui só expomos status/QR pra o corretor parear o número direto no imob.

// Descobre qual instância ESSE usuário logado deve ver/gerenciar aqui: se
// ele é membro com WhatsApp próprio (imf_broker_members.whatsapp_mode='own'),
// é a instância dele; senão (dono da conta, ou membro compartilhado) é a
// instância da conta — mesmo comportamento de sempre.
// Autocura: se a instância que esse usuário deveria ter ainda não existe
// (nunca provisionada, ou tentativa anterior falhou), provisiona na hora em
// vez de devolver "ainda sendo configurada" esperando um evento externo.
// UAZAPI_HOST vazio = integração desligada no servidor (não tenta provisionar,
// só reporta o que já tem no banco).
async function resolveManagedInstance(userId: string, brokerId: string): Promise<{
  token: string | null; ownInstance: boolean; provisioningStatus: string | null; provisioningError: string | null;
}> {
  const { data: member } = await supabase
    .from('imf_broker_members')
    .select('id, name, whatsapp_mode, uazapi_instance_token, provisioning_status, provisioning_error')
    .eq('broker_id', brokerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (member?.whatsapp_mode === 'own') {
    if (!member.uazapi_instance_token && UAZAPI_HOST) {
      const ensured = await ensureMemberInstance({ id: member.id, name: member.name });
      return { token: ensured.token, ownInstance: true, provisioningStatus: ensured.status, provisioningError: ensured.error };
    }
    return {
      token: member.uazapi_instance_token || null, ownInstance: true,
      provisioningStatus: member.provisioning_status || null, provisioningError: member.provisioning_error || null,
    };
  }

  const { data: broker } = await supabase.from('imf_brokers')
    .select('id, name, uazapi_instance_token, provisioning_status, provisioning_error')
    .eq('id', brokerId).single();

  if (!broker?.uazapi_instance_token && UAZAPI_HOST) {
    const ensured = await ensureBrokerInstance({ id: brokerId, name: broker?.name });
    return { token: ensured.token, ownInstance: false, provisioningStatus: ensured.status, provisioningError: ensured.error };
  }
  return {
    token: broker?.uazapi_instance_token || null, ownInstance: false,
    provisioningStatus: broker?.provisioning_status || null, provisioningError: broker?.provisioning_error || null,
  };
}

brokersRouter.get("/api/brokers/whatsapp/status", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { token, ownInstance, provisioningStatus, provisioningError } = await resolveManagedInstance(userId, brokerId);

    if (!token) {
      return res.json({
        provisioned: false, connected: false, loggedIn: false, ownInstance,
        provisioningStatus, provisioningError,
      });
    }

    const r = await fetchWithTimeout(`${UAZAPI_HOST}/instance/status`, {
      headers: { token },
    });
    if (!r.ok) throw new Error(`UAZAPI respondeu ${r.status}`);
    const data = await r.json();

    res.json({
      provisioned: true,
      connected: !!data?.status?.connected,
      loggedIn: !!data?.status?.loggedIn,
      profileName: data?.instance?.profileName || null,
      owner: data?.instance?.owner || null,
      ownInstance,
    });
  } catch (err: any) {
    console.error("Erro GET /api/brokers/whatsapp/status:", err);
    res.status(500).json({ error: err.message });
  }
});

brokersRouter.post("/api/brokers/whatsapp/connect", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { token, provisioningStatus, provisioningError } = await resolveManagedInstance(userId, brokerId);

    if (!token) {
      const error = provisioningStatus === 'failed'
        ? (provisioningError || "Falha ao provisionar a instância de WhatsApp. Tente novamente.")
        : "Sua instância de WhatsApp ainda está sendo preparada. Tente de novo em alguns segundos.";
      return res.status(409).json({ error, provisioningStatus });
    }

    // phone opcional: se vier, a UAZAPI gera código de pareamento em vez de
    // QR code (POST /instance/connect aceita os dois modos — ver doc oficial).
    // NÃO usar normalizePhoneBR aqui: ela remove o 9º dígito do celular (
    // convenção usada pra mensagens), mas o exemplo oficial da UAZAPI pro
    // pareamento é o número completo com o 9 ("5511999999999") — código
    // gerado pro número errado (sem o 9) nunca bate com o WhatsApp real do
    // celular, confirmado testando ao vivo.
    const phone = req.body?.phone ? normalizePhoneBRFull(String(req.body.phone)) : undefined;

    const r = await fetchWithTimeout(`${UAZAPI_HOST}/instance/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify(phone ? { phone } : {}),
    });
    if (!r.ok) throw new Error(`UAZAPI respondeu ${r.status}`);
    const data = await r.json();

    res.json({
      connected: !!data?.connected,
      qrcode: data?.instance?.qrcode || null,
      paircode: data?.instance?.paircode || null,
    });
  } catch (err: any) {
    console.error("Erro POST /api/brokers/whatsapp/connect:", err);
    res.status(500).json({ error: err.message });
  }
});

// Encerra a sessão do WhatsApp conectada (não apaga a instância — ela
// continua pronta pra um QR novo logo em seguida via /connect). É isso que
// faltava pra "trocar de número": antes, o único botão existente reenviava
// /instance/connect direto sem nunca deslogar a sessão atual primeiro.
brokersRouter.post("/api/brokers/whatsapp/disconnect", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { token } = await resolveManagedInstance(userId, brokerId);
    if (!token) {
      return res.status(400).json({ error: "Nenhuma instância WhatsApp provisionada pra desconectar." });
    }

    await disconnectUazapiInstance(token);
    res.json({ disconnected: true });
  } catch (err: any) {
    console.error("Erro POST /api/brokers/whatsapp/disconnect:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chave de cobrança Asaas própria da imobiliária/incorporadora ──────────
// Usada nas cobranças dos clientes DELA (aluguel + sinal PIX de reserva). Sem
// ela, o backend cai na conta global da Criate. A chave é guardada
// criptografada (AES-256-GCM) e NUNCA é devolvida ao frontend — só um
// resumo (configurada?/env/últimos 4 dígitos). Só o TITULAR da conta
// gerencia (membros de equipe não).

// Valida a chave contra o Asaas (GET /myAccount) antes de aceitar. Retorna a
// mensagem de erro sanitizada, nunca a chave.
async function validateAsaasKey(apiKey: string, env: string): Promise<void> {
  const resp = await fetchWithTimeout(`${asaasBaseUrlForEnv(env)}/myAccount`, {
    headers: { "Content-Type": "application/json", access_token: apiKey },
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Chave recusada pelo Asaas. Confira se copiou a chave certa e o ambiente (sandbox/produção).");
  }
  if (!resp.ok) {
    throw new Error(`O Asaas respondeu ${resp.status} ao validar a chave. Tente de novo em instantes.`);
  }
}

brokersRouter.get("/api/brokers/asaas-key", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });

    const { data } = await supabase
      .from("imf_brokers")
      .select("asaas_api_key_enc, asaas_env")
      .eq("id", brokerId)
      .maybeSingle();

    let keyLast4: string | null = null;
    if (data?.asaas_api_key_enc) {
      try { keyLast4 = decryptKey(data.asaas_api_key_enc).slice(-4); } catch { keyLast4 = null; }
    }

    res.json({
      configured: !!data?.asaas_api_key_enc,
      env: data?.asaas_env || null,
      key_last4: keyLast4,
      can_manage: await isBrokerOwner(userId, brokerId),
    });
  } catch (err: any) {
    console.error("Erro GET /api/brokers/asaas-key:", err);
    res.status(500).json({ error: err.message });
  }
});

brokersRouter.post("/api/brokers/asaas-key", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });
    if (!(await isBrokerOwner(userId, brokerId))) {
      return res.status(403).json({ error: "Apenas o titular da conta gerencia a chave de cobrança." });
    }

    const apiKey = String(req.body?.api_key || "").trim();
    const env = String(req.body?.env || "").trim();
    if (!apiKey) return res.status(400).json({ error: "Informe a chave de API do Asaas." });
    if (!["sandbox", "production"].includes(env)) {
      return res.status(400).json({ error: "Ambiente inválido (use sandbox ou produção)." });
    }

    await validateAsaasKey(apiKey, env);

    const { error } = await supabase.from("imf_brokers").update({
      asaas_api_key_enc: encryptKey(apiKey),
      asaas_env: env,
      updated_at: new Date(),
    }).eq("id", brokerId);
    if (error) throw error;

    res.json({ configured: true, env, key_last4: apiKey.slice(-4) });
  } catch (err: any) {
    console.error("Erro POST /api/brokers/asaas-key:", err?.message);
    res.status(400).json({ error: err.message || "Falha ao salvar a chave de cobrança." });
  }
});

brokersRouter.delete("/api/brokers/asaas-key", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: "Broker not found" });
    if (!(await isBrokerOwner(userId, brokerId))) {
      return res.status(403).json({ error: "Apenas o titular da conta gerencia a chave de cobrança." });
    }

    const { error } = await supabase.from("imf_brokers").update({
      asaas_api_key_enc: null,
      asaas_env: null,
      updated_at: new Date(),
    }).eq("id", brokerId);
    if (error) throw error;

    res.json({ configured: false });
  } catch (err: any) {
    console.error("Erro DELETE /api/brokers/asaas-key:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- UPLOAD DE FOTO DO CORRETOR ---
brokersRouter.post("/api/brokers/upload-photo", requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: "No image data" });

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `broker-${userId}.jpg`;

    // Garante que o bucket existe
    await supabase.storage.createBucket('broker-photos', {
      public: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      fileSizeLimit: 5242880
    }).catch(() => {}); // ignora erro se bucket já existe

    const { error: uploadError } = await supabase.storage
      .from('broker-photos')
      .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('broker-photos')
      .getPublicUrl(fileName);

    res.json({ url: publicUrl });
  } catch (err: any) {
    console.error("Erro upload foto corretor:", err);
    res.status(500).json({ error: err.message });
  }
});
