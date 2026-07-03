import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";
import { TERMS_VERSION, INTERNAL_PROXY_TOKEN } from "../config";

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
      'id, user_id, name, email, phone, ai_name, broker_address, status, plan, ' +
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
