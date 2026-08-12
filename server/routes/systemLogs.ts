import express from "express";
import { requireUser, getBrokerId } from "../middleware/auth";
import { supabase } from "../supabase";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nInternalLimiter } from "../middleware/rateLimits";
import {
  recordSystemError,
  type SystemErrorCategory,
  type SystemErrorChannel,
} from "../services/systemErrorLogs";

export const systemLogsRouter = express.Router();

const VALID_STATUS = new Set(["pendente", "em_analise", "resolvido"]);
const VALID_CHANNEL = new Set(["whatsapp_pai", "painel_interno", "integracao", "worker", "sistema"]);
const VALID_CATEGORY = new Set([
  "execution_error", "integration_failure", "agent_unhandled",
  "tool_failure", "validation_error", "queue_failure",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireSystemAdmin(req: express.Request, res: express.Response) {
  const userId = (req as any).userId as string;
  const brokerId = await getBrokerId(userId);
  if (!brokerId) {
    res.status(403).json({ error: "Conta nao encontrada." });
    return null;
  }
  const { data: broker, error } = await supabase.from("imf_brokers")
    .select("is_admin")
    .eq("id", brokerId)
    .maybeSingle();
  if (error || !broker?.is_admin) {
    res.status(403).json({ error: "Somente o administrador do sistema pode acessar os logs tecnicos." });
    return null;
  }
  return { userId, brokerId };
}

// Entrada exclusiva para a observabilidade do workflow N8N. O endpoint não
// aceita status nem campos de resolução: o fluxo apenas cria um incidente e o
// administrador decide seu tratamento no painel. recordSystemError faz a
// sanitização final de tokens, telefone, e-mail e documentos.
systemLogsRouter.post("/api/system-logs/n8n", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  const brokerId = String(req.body?.broker_id || "").trim();
  const channel = String(req.body?.channel || "integracao");
  const category = String(req.body?.category || "execution_error");
  const stage = String(req.body?.stage || "n8n_workflow").trim();
  if (!UUID.test(brokerId)) return res.status(400).json({ error: "broker_id inválido." });
  if (!VALID_CHANNEL.has(channel)) return res.status(400).json({ error: "Canal inválido." });
  if (!VALID_CATEGORY.has(category)) return res.status(400).json({ error: "Categoria inválida." });
  if (!stage || stage.length > 160) return res.status(400).json({ error: "Etapa inválida." });

  await recordSystemError({
    brokerId,
    channel: channel as SystemErrorChannel,
    category: category as SystemErrorCategory,
    requestedAction: req.body?.requested_action || null,
    stage,
    publicMessage: req.body?.public_message || null,
    technicalMessage: req.body?.technical_message || "Falha não detalhada pelo workflow.",
    context: {
      event_id: req.body?.event_id || null,
      ticket_id: req.body?.ticket_id || null,
      workflow_id: req.body?.workflow_id || null,
    },
  });
  res.status(202).json({ ok: true });
});

systemLogsRouter.get("/api/system-logs", requireUser, async (req, res) => {
  try {
    const access = await requireSystemAdmin(req, res);
    if (!access) return;
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const channel = typeof req.query.channel === "string" ? req.query.channel : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

    let query = supabase
      .from("imf_system_error_logs")
      .select("id, broker_id, user_id, channel, category, requested_action, stage, public_message, technical_message, status, context, occurred_at, updated_at, resolved_at")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (VALID_STATUS.has(status)) query = query.eq("status", status);
    if (VALID_CHANNEL.has(channel)) query = query.eq("channel", channel);
    if (search) {
      const escaped = search.replace(/[%_,()]/g, " ");
      query = query.or(`requested_action.ilike.%${escaped}%,stage.ilike.%${escaped}%,technical_message.ilike.%${escaped}%`);
    }
    const { data, error } = await query;
    if (error) throw error;

    const brokerIds = [...new Set((data || []).map((row: any) => row.broker_id).filter(Boolean))].slice(0, 100) as string[];
    let brokers: any[] = [];
    if (brokerIds.length > 0) {
      const { data: brokerRows, error: brokersError } = await supabase
        .from("imf_brokers")
        .select("id, name, email, user_id")
        .in("id", brokerIds);
      if (brokersError) throw brokersError;
      brokers = brokerRows || [];
    }
    const brokerById = new Map((brokers || []).map((broker: any) => [broker.id, broker]));
    const userIds = [...new Set((data || []).map((row: any) => row.user_id).filter(Boolean))].slice(0, 100) as string[];
    const userLabels = new Map<string, string>();
    await Promise.all(userIds.map(async (id) => {
      const ownerBroker = (brokers || []).find((broker: any) => broker.user_id === id);
      if (ownerBroker) {
        userLabels.set(id, ownerBroker.name || ownerBroker.email || "Titular");
        return;
      }
      const { data: authData } = await supabase.auth.admin.getUserById(id)
        .catch(() => ({ data: { user: null } } as any));
      const user = authData?.user;
      userLabels.set(id, user?.user_metadata?.full_name || user?.email?.split("@")[0] || `Usuario ${id.slice(0, 8)}`);
    }));

    res.json({
      scope: "system_admin",
      items: (data || []).map((row: any) => ({
        ...row,
        account_label: brokerById.get(row.broker_id)?.name || brokerById.get(row.broker_id)?.email || `Conta ${String(row.broker_id).slice(0, 8)}`,
        user_label: row.user_id ? userLabels.get(row.user_id) || `Usuario ${row.user_id.slice(0, 8)}` : "Sistema",
      })),
    });
  } catch (error: any) {
    console.error("Erro GET /api/system-logs:", error?.message || error);
    res.status(500).json({ error: "Nao foi possivel carregar os logs do sistema." });
  }
});

systemLogsRouter.patch("/api/system-logs/:id/status", requireUser, async (req, res) => {
  try {
    const access = await requireSystemAdmin(req, res);
    if (!access) return;
    const status = String(req.body?.status || "");
    if (!VALID_STATUS.has(status)) return res.status(400).json({ error: "Status invalido." });
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("imf_system_error_logs").update({
      status,
      updated_at: now,
      resolved_at: status === "resolvido" ? now : null,
      resolved_by: status === "resolvido" ? access.userId : null,
    }).eq("id", req.params.id).select("id, status, updated_at, resolved_at").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Log nao encontrado." });
    res.json(data);
  } catch (error: any) {
    console.error("Erro PATCH /api/system-logs/:id/status:", error?.message || error);
    res.status(500).json({ error: "Nao foi possivel atualizar o log." });
  }
});
