import express from "express";
import { supabase } from "../supabase";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nInternalLimiter } from "../middleware/rateLimits";
import { resolveNewLeadStage, findLeadByPhone } from "../services/crmPipelines";

// ─────────────────────────────────────────────────────────────────────────
// Ferramenta de CRM do agente de vendas (chamada pelo fluxo do n8n).
//
// Mesmo principio do agente de locacao (rentalAgent.ts): a IA CONVERSA, o
// backend DECIDE. Esta rota so recebe fatos que a IA ja apurou na conversa
// (nome, telefone, imovel de interesse, resumo da qualificacao) - quem
// decide se cria lead novo, em qual etapa ele entra, e como o dedupe
// funciona e sempre o backend, nunca o modelo.
//
// Fica no caminho de uma conversa real em andamento: nunca responde erro.
// Qualquer falha degrada pra {ok:false}, sem derrubar o atendimento no n8n.
// ─────────────────────────────────────────────────────────────────────────

export const crmSalesAgentRouter = express.Router();

const QUALIFICATION_PREFIX = "Qualificação (IA): ";

// n8n/$fromAI com valor padrao (4 argumentos) as vezes deixa vazar um "="
// literal na frente do valor resolvido (observado em resumo_qualificacao;
// nome_cliente, que usa $fromAI de 3 argumentos sem padrao, nunca apresentou
// o problema). Nao vale a pena depender do node ficar "certo" para sempre -
// limpa na entrada, no mesmo espirito de nunca confiar em valor bruto vindo
// do modelo.
const cleanAiString = (value: unknown): string => String(value ?? "").replace(/^=+/, "").trim();

// POST /api/crm/n8n/sync-lead
// body: { broker_id, phone, client_name, property_id?, qualification_note? }
//
// Chamada pelo agente de vendas sempre que souber o nome do cliente, casar
// um imovel de interesse, ou atualizar o que sabe da qualificacao. Cria o
// lead se ainda nao existir (mesmo dedupe/resolveNewLeadStage usado em
// POST /api/conversas/:ticketId/create-lead); se ja existir, so atualiza o
// que for novo (nunca apaga property_id/nome ja confirmados por outro
// caminho).
crmSalesAgentRouter.post("/api/crm/n8n/sync-lead", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = cleanAiString(req.body?.broker_id);
    const phone = cleanAiString(req.body?.phone);
    const clientName = cleanAiString(req.body?.client_name);
    const propertyIdInput = cleanAiString(req.body?.property_id);
    const propertyId = propertyIdInput || null;
    const qualificationNote = cleanAiString(req.body?.qualification_note).slice(0, 2000);

    if (!brokerId || !phone || !clientName) {
      return res.json({ ok: false, motivo: "broker_id, phone e client_name são obrigatórios" });
    }

    // Nunca confia em property_id vindo do modelo sem validar posse — mesma
    // checagem de POST /api/agenda/n8n/create (agenda.ts). Se o imóvel não
    // for do broker, ignora silenciosamente em vez de recusar a sincronização
    // inteira (o resto do lead ainda vale a pena salvar).
    let validPropertyId: string | null = null;
    if (propertyId) {
      const { data: property } = await supabase
        .from("imf_properties")
        .select("id")
        .eq("id", propertyId)
        .eq("broker_id", brokerId)
        .maybeSingle();
      if (property) validPropertyId = propertyId;
    }

    const existing = await findLeadByPhone(brokerId, phone);
    const notes = qualificationNote ? `${QUALIFICATION_PREFIX}${qualificationNote}` : undefined;

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (validPropertyId && !existing.property_id) updates.property_id = validPropertyId;
      if (notes) updates.notes = notes;
      if (Object.keys(updates).length > 0) {
        await supabase.from("leads").update(updates).eq("id", existing.id);
      }
      return res.json({ ok: true, lead_id: existing.id, created: false });
    }

    const { pipeline_id, pipeline_stage_id } = await resolveNewLeadStage(brokerId);
    const { data: lead, error } = await supabase.from("leads").insert({
      broker_id: brokerId,
      property_id: validPropertyId,
      name: clientName,
      phone,
      status: "new",
      notes: notes || "Lead criado automaticamente pelo agente de WhatsApp",
      pipeline_id,
      pipeline_stage_id,
    }).select("id").single();
    if (error) throw error;

    res.json({ ok: true, lead_id: lead.id, created: true });
  } catch (err: any) {
    console.error("Erro POST /api/crm/n8n/sync-lead (degradando):", err?.message);
    res.json({ ok: false, motivo: "falha ao sincronizar" });
  }
});
