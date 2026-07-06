import express from "express";
import { requireUser, getBrokerId } from "../middleware/auth";
import { runAgent, executeAction, type Autonomy, type AgentAction } from "../services/agent";

export const agentRouter = express.Router();

// Cérebro real da command bar (ver server/services/agent.ts).
// POST /api/agent/command — interpreta a fala do corretor e responde/age.
agentRouter.post("/api/agent/command", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const { message, persona, autonomy } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ error: "Mensagem vazia." });

    const result = await runAgent({
      brokerId,
      message: String(message).slice(0, 1000),
      persona: typeof persona === "string" ? persona : "corretor",
      autonomy: (["piloto", "copiloto", "manual"].includes(autonomy) ? autonomy : "piloto") as Autonomy,
    });
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
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    const action = req.body?.action as AgentAction;
    if (!action || !action.type) return res.status(400).json({ error: "Ação inválida." });
    if (!["create_lead", "create_visit"].includes(action.type)) {
      return res.status(400).json({ error: "Essa ação não precisa de confirmação." });
    }

    const { summary, navigate } = await executeAction(brokerId, action);
    res.json({ executed: summary, navigate, refresh: true });
  } catch (err: any) {
    console.error("Erro POST /api/agent/execute:", err);
    res.status(400).json({ error: err.message });
  }
});
