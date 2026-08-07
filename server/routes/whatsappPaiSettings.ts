import express from "express";
import { z } from "zod";
import { requireUser } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { whatsappLinkLimiter } from "../middleware/rateLimits";
import { startPhoneVerification, confirmPhoneVerification, listVerifiedPhones, unlinkPhone } from "../services/whatsappStaffLinks";

export const whatsappPaiSettingsRouter = express.Router();

const startSchema = z.object({ phone: z.string().trim().min(8).max(20) }).strict();
const confirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Código precisa ter 6 dígitos.") }).strict();

// GET/POST/DELETE do vínculo de telefone do WhatsApp Pai — cada usuário
// prova, dentro do próprio painel já autenticado, que um número de WhatsApp
// é dele (código de verificação real). Fase 2 de .claude/plans/
// zany-forging-curry.md; o número ainda não é consultado por nenhum
// inbound (isso é a Fase 4) — por enquanto só cadastra o vínculo.
whatsappPaiSettingsRouter.get("/api/me/whatsapp-link", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const phones = await listVerifiedPhones(userId);
    res.json({ phones });
  } catch (err: any) {
    console.error("Erro GET /api/me/whatsapp-link:", err);
    res.status(500).json({ error: err.message });
  }
});

whatsappPaiSettingsRouter.post(
  "/api/me/whatsapp-link/start",
  requireUser,
  whatsappLinkLimiter,
  validateBody(startSchema),
  async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const { phone } = await startPhoneVerification(userId, req.body.phone);
      res.json({ ok: true, phone });
    } catch (err: any) {
      console.error("Erro POST /api/me/whatsapp-link/start:", err);
      res.status(400).json({ error: err.message });
    }
  },
);

whatsappPaiSettingsRouter.post(
  "/api/me/whatsapp-link/confirm",
  requireUser,
  whatsappLinkLimiter,
  validateBody(confirmSchema),
  async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const { phone } = await confirmPhoneVerification(userId, req.body.code);
      res.json({ ok: true, phone });
    } catch (err: any) {
      console.error("Erro POST /api/me/whatsapp-link/confirm:", err);
      res.status(400).json({ error: err.message });
    }
  },
);

whatsappPaiSettingsRouter.delete("/api/me/whatsapp-link/:phone", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    await unlinkPhone(userId, req.params.phone);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/me/whatsapp-link/:phone:", err);
    res.status(500).json({ error: err.message });
  }
});
