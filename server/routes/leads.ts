import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";

export const leadsRouter = express.Router();

leadsRouter.get("/api/leads/recent", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: propIds, error: idsError } = await supabase
      .from('imf_properties')
      .select('id, title')
      .eq('broker_id', brokerId);

    if (idsError) throw idsError;

    const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
    const ids = Array.from(propertiesMap.keys());

    let leads: any[] = [];
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .in('property_id', ids)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      leads = data || [];
    }

    const formattedLeads = leads.map((l: any) => ({
      id: l.id,
      name: l.name || l.client_name || 'Sem nome',
      property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido',
      time: l.created_at,
      status: l.status
    }));

    res.json(formattedLeads);
  } catch (err: any) {
    console.error("Erro GET /api/leads/recent:", err);
    res.json([]);
  }
});

// --- FLUXO DE CAPTURA DE LEADS (30/04/2026) ---
/**
 * Endpoint aprimorado para salvar leads e disparar integrações automáticas.
 */
leadsRouter.post("/api/leads", async (req, res) => {
  try {
    const { property_id, name, phone, email, status, notes } = req.body;

    // 1. Validação básica
    if (!name || !phone || !property_id) {
      return res.status(400).json({ error: "Nome, telefone e ID do imóvel são obrigatórios." });
    }

    // 2. Inserir na tabela leads
    const { data: lead, error: insertError } = await supabase.from('leads').insert([
      {
        property_id,
        name,
        phone,
        email: email || '',
        status: status || 'new',
        notes: notes || 'Lead via Landing Page',
        created_at: new Date()
      }
    ]).select().single();

    if (insertError) throw insertError;

    // 3. Roteamento (Chatbot Webhook ou E-mail)
    const webhookUrl = process.env.CHATBOT_WEBHOOK_URL;
    let integrationStatus = "none";

    if (webhookUrl) {
      // Envio assíncrono para o Webhook (Fire and Forget)
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          name,
          phone,
          property_id,
          origin: 'Landing Page',
          timestamp: new Date().toISOString()
        })
      }).catch(err => console.error("Erro ao disparar Webhook:", err));
      integrationStatus = "chatbot";
    } else {
      integrationStatus = "none";
    }

    // 4. Log (Opcional - usando console para não criar novas tabelas se não existirem)
    console.log(`// FLUXO ENVIAR LEAD 30/04/2026: Lead ID ${lead.id} enviado. Chatbot: ${webhookUrl ? 'sim' : 'nao'}`);

    res.status(201).json({ ...lead, integrationStatus });
  } catch (err: any) {
    console.error("Erro no fluxo de envio de lead:", err);
    res.status(500).json({ error: "Falha ao processar contato. Por favor, use o WhatsApp." });
  }
});

leadsRouter.get("/api/leads", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data: propIds, error: idsError } = await supabase
      .from('imf_properties')
      .select('id, title')
      .eq('broker_id', brokerId);

    if (idsError) throw idsError;

    const propertiesMap = new Map((propIds || []).map((p: any) => [p.id, p.title]));
    const ids = Array.from(propertiesMap.keys());

    let leads: any[] = [];
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .in('property_id', ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      leads = data || [];
    }

    res.json(leads.map((l: any) => ({
      ...l,
      name: l.name || l.client_name || 'Sem nome',
      phone: l.phone || l.client_phone || '',
      property: propertiesMap.get(l.property_id) || 'Imóvel desconhecido'
    })));
  } catch (err: any) {
    console.error("Erro GET /api/leads:", err);
    res.status(500).json({ error: err.message });
  }
});

// Atualiza o status de um lead
leadsRouter.patch("/api/leads/:id/status", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status é obrigatório." });

    // Escopo multi-tenant: só atualiza lead cujo imóvel pertence ao corretor autenticado
    const { data: propIds } = await supabase
      .from('imf_properties')
      .select('id')
      .eq('broker_id', brokerId);
    const ids = (propIds || []).map((p: any) => p.id);
    if (!ids.length) return res.status(403).json({ error: 'Acesso negado.' });

    const { data, error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', req.params.id)
      .in('property_id', ids)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: 'Acesso negado.' });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/leads/:id/status:", err);
    res.status(500).json({ error: err.message });
  }
});
