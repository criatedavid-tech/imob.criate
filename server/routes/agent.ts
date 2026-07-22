import express from "express";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { runAgent, executeAction, type Autonomy, type AgentAction } from "../services/agent";
import { supabase } from "../supabase";
import { parseConfirmedAgentAction } from "../security/agentGuardrails";

export const agentRouter = express.Router();

// Histórico do Assistente IA — antes vivia só no estado local do React
// (CommandBar.tsx), sumia ao fechar o chat ou recarregar a página.
// Best-effort: nunca deixa o log quebrar a resposta real da IA.
async function logTurn(brokerId: string, userId: string, role: "user" | "ai", text: string, actionType?: string) {
  await supabase.from("imf_agent_log").insert({
    broker_id: brokerId, user_id: userId, role, text: text.slice(0, 4000), action_type: actionType || null,
  }).then(({ error }) => { if (error) console.warn("[Agent] log turn falhou:", error.message); });
}

// GET /api/agent/history — últimos turnos do assistente pra esse usuário,
// pra reabrir o chat (ou recarregar a página) sem perder o que já foi
// conversado/pedido.
agentRouter.get("/api/agent/history", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data, error } = await supabase
      .from("imf_agent_log")
      .select("role, text, created_at")
      .eq("broker_id", brokerId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    res.json((data || []).reverse().map((t: any) => ({ role: t.role, text: t.text })));
  } catch (err: any) {
    console.error("Erro GET /api/agent/history:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agent/history — "Nova conversa": apaga o histórico salvo pra
// esse usuário e começar do zero. É uma ferramenta pessoal de trabalho, não
// um registro de auditoria — não faz sentido guardar conversa antiga que o
// próprio corretor pediu pra esquecer, nem existe hoje uma tela pra navegar
// entre "conversas antigas" (só a mais recente é exibida), então manter as
// linhas apagadas no banco seria só lixo inacessível.
agentRouter.delete("/api/agent/history", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { error } = await supabase.from("imf_agent_log").delete().eq("broker_id", brokerId).eq("user_id", userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/agent/history:", err);
    res.status(500).json({ error: err.message });
  }
});

// Cérebro real da command bar (ver server/services/agent.ts).
// POST /api/agent/command — interpreta a fala do corretor e responde/age.
agentRouter.post("/api/agent/command", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { message, persona, autonomy, history, imageUrls } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: "Mensagem vazia." });

    // Histórico curto (últimos turnos da própria tela) — sem isso a IA esquece
    // o que já foi dito 1 mensagem atrás (ex.: nome do cliente dado antes da
    // data/horário da visita).
    const cleanHistory = Array.isArray(history)
      ? history
          .filter((h: any) => h && (h.role === "user" || h.role === "ai") && typeof h.text === "string")
          .slice(-8)
          .map((h: any) => ({ role: h.role as "user" | "ai", text: String(h.text).slice(0, 1000) }))
      : [];

    // Fotos já enviadas ao Storage pelo front (CommandBar.tsx) antes desta
    // chamada — só URLs públicas do nosso bucket, nunca base64 aqui.
    const cleanImageUrls = Array.isArray(imageUrls)
      ? imageUrls.filter((u: any) => typeof u === "string" && u.startsWith("http")).slice(0, 15)
      : undefined;

    const result = await runAgent({
      brokerId,
      userId,
      message: String(message).slice(0, 1000),
      persona: typeof persona === "string" ? persona : "corretor",
      // Falha segura: valor ausente/inválido nunca habilita execução automática.
      autonomy: (["piloto", "copiloto", "manual"].includes(autonomy) ? autonomy : "copiloto") as Autonomy,
      history: cleanHistory,
      imageUrls: cleanImageUrls,
    });

    logTurn(brokerId, userId, "user", String(message).slice(0, 1000)).catch(() => {});
    logTurn(brokerId, userId, "ai", result.executed ? `${result.reply}\n✓ ${result.executed}` : result.reply, result.proposedAction?.type).catch(() => {});

    res.json(result);
  } catch (err: any) {
    console.error("Erro POST /api/agent/command:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agent/execute — confirma uma ação proposta (modo copiloto/manual).
// Revalida posse no executeAction; o cliente só devolve a ação que recebeu.
agentRouter.post("/api/agent/execute", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const action = parseConfirmedAgentAction(req.body?.action) as AgentAction;
    // Whitelist de tudo que passa por executeAction (mutações reais) — ficou
    // desatualizada quando as ações 4-12 foram adicionadas (só create_lead/
    // create_visit/send_message estavam aqui), então confirmar qualquer uma
    // delas em modo copiloto/manual sempre dava 400 "não precisa de
    // confirmação", mesmo precisando. Achado lendo o código, não relatado
    // pelo usuário — não confirmado ao vivo ainda.
    const CONFIRMABLE_ACTIONS = [
      "create_lead", "create_visit", "send_message", "create_property",
      "update_property", "cancel_visit", "update_visit", "end_rental_contract", "update_unit",
      "create_reminder", "schedule_followup",
    ];
    if (!CONFIRMABLE_ACTIONS.includes(action.type)) {
      return res.status(400).json({ error: "Essa ação não precisa de confirmação." });
    }

    const { summary, navigate } = await executeAction(brokerId, userId, action);
    logTurn(brokerId, userId, "ai", `✓ ${summary}`, action.type).catch(() => {});
    res.json({ executed: summary, navigate, refresh: true });
  } catch (err: any) {
    console.error("Erro POST /api/agent/execute:", err);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/agent/scheduled-followups — lista os follow-ups agendados pela
// ação "schedule_followup" (server/services/agent.ts), pra exibir na aba
// Lembretes. Dono vê tudo da conta; membro só o que ele mesmo pediu.
agentRouter.get("/api/agent/scheduled-followups", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    let query = supabase
      .from("imf_agent_scheduled_followups")
      .select("id, contact_name, contact_phone, message, due_at, status, sent_at, last_error, created_at")
      .eq("broker_id", brokerId)
      .order("due_at", { ascending: true })
      .limit(100);
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq("owner_user_id", userId);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    console.error("Erro GET /api/agent/scheduled-followups:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agent/scheduled-followups/:id — cancela um follow-up agendado
// ainda pendente. Nunca cancela um que já foi enviado (status != 'pending'
// não bate no WHERE, então a linha simplesmente não é afetada e a resposta
// vira 404, honesto em vez de fingir sucesso).
agentRouter.delete("/api/agent/scheduled-followups/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { id } = req.params;
    let query = supabase
      .from("imf_agent_scheduled_followups")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("broker_id", brokerId)
      .eq("status", "pending");
    if (!(await isBrokerOwner(userId, brokerId))) query = query.eq("owner_user_id", userId);

    const { data, error } = await query.select("id");
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: "Follow-up não encontrado ou já processado." });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/agent/scheduled-followups/:id:", err);
    res.status(400).json({ error: err.message });
  }
});
