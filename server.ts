import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import helmet from "helmet";

import "./server/lib/infra"; // side-effect: inicializa Sentry/Redis se configurados
import { prepareOverageBilling } from "./server/services/billing";
import { runFollowupTick } from "./server/services/followup";

import { authRouter } from "./server/routes/auth";
import { brokersRouter } from "./server/routes/brokers";
import { propertiesRouter } from "./server/routes/properties";
import { corretoraRouter } from "./server/routes/corretora";
import { aiRouter } from "./server/routes/ai";
import { dashboardRouter } from "./server/routes/dashboard";
import { leadsRouter } from "./server/routes/leads";
import { agendaRouter } from "./server/routes/agenda";
import { billingRouter } from "./server/routes/billing";
import { whatsappRouter } from "./server/routes/whatsapp";
import { llmProxyRouter } from "./server/routes/llmProxy";
import { adminRouter } from "./server/routes/admin";
import { followupRouter } from "./server/routes/followup";
import { wppShimRouter } from "./server/routes/wppShim";
import { locacaoRouter } from "./server/routes/locacao";
import { lancamentosRouter } from "./server/routes/lancamentos";
import { financeiroRouter } from "./server/routes/financeiro";
import { equipeRouter } from "./server/routes/equipe";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Headers de segurança HTTP (HSTS, X-Frame-Options, nosniff, etc.)
  // CSP desativado: o SPA Vite usa inline styles/scripts que o CSP padrão bloquearia.
  app.use(helmet({ contentSecurityPolicy: false }));

  // 10mb: suficiente para upload individual de foto em base64 (~7MB de imagem real).
  // Limite anterior de 50mb era vetor de DoS por exaustão de memória.
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // --- Rotas — uma por domínio, cada uma em server/routes/ (ver UX_MASTERPLAN.md) ---
  app.use(authRouter);
  app.use(brokersRouter);
  app.use(propertiesRouter);
  app.use(corretoraRouter);
  app.use(aiRouter);
  app.use(dashboardRouter);
  app.use(leadsRouter);
  app.use(agendaRouter);
  app.use(billingRouter);
  app.use(whatsappRouter);
  app.use(llmProxyRouter);
  app.use(adminRouter);
  app.use(followupRouter);
  app.use(wppShimRouter);
  app.use(locacaoRouter);
  app.use(lancamentosRouter);
  app.use(financeiroRouter);
  app.use(equipeRouter);

  // --- Jobs em background (ver server/services/) ---
  setInterval(runFollowupTick, 60_000);
  console.log('[Follow-up] scheduler ativo (tick 60s)');

  // Verifica a cada hora se algum corretor tem renovação amanhã e emite o
  // valor combinado (mensalidade + excedente) na assinatura do Asaas.
  setInterval(prepareOverageBilling, 60 * 60 * 1000);
  prepareOverageBilling(); // executa uma vez ao subir (cobre restarts próximos ao billing)
  console.log('[Billing Prep] scheduler ativo (tick 1h)');

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
