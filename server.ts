import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import helmet from "helmet";

import { SUPABASE_URL } from "./server/config";
import "./server/lib/infra"; // side-effect: inicializa Sentry/Redis se configurados
import { prepareOverageBilling, reconcilePendingBillingActions } from "./server/services/billing";
import { runFollowupTick } from "./server/services/followup";
import { runScheduledAgentFollowupsTick } from "./server/services/agentScheduledFollowups";
import { expireDueUnitReservations } from "./server/services/unitReservationBilling";
import { purgeExpiredWebhookLogs } from "./server/services/maintenance";

import { authRouter } from "./server/routes/auth";
import { brokersRouter } from "./server/routes/brokers";
import { propertiesRouter } from "./server/routes/properties";
import { corretoraRouter } from "./server/routes/corretora";
import { aiRouter } from "./server/routes/ai";
import { dashboardRouter } from "./server/routes/dashboard";
import { leadsRouter } from "./server/routes/leads";
import { crmPipelinesRouter } from "./server/routes/crmPipelines";
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
import { agentRouter } from "./server/routes/agent";
import { relatoriosRouter } from "./server/routes/relatorios";
import { vitrineRouter } from "./server/routes/vitrine";
import { contactsRouter } from "./server/routes/contacts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // O Fly.io termina TLS na borda e repassa pro app por um único hop de proxy
  // interno — sem isso, req.ip e o X-Forwarded-For não são confiados, o que
  // quebra o rate limit por IP (express-rate-limit usa req.ip como chave) e
  // faz os logs de IP (ex.: webhook com token inválido) mostrarem o IP do
  // proxy do Fly em vez do cliente real. "1" = confia só no primeiro hop.
  app.set('trust proxy', 1);

  // Coleta violação de CSP (ver política abaixo) — precisa vir ANTES do
  // express.json() global porque o navegador manda o relatório com
  // Content-Type "application/csp-report", que o parser JSON padrão ignora.
  app.post(
    "/api/csp-report",
    express.json({ type: ["application/json", "application/csp-report"] }),
    (req, res) => {
      console.warn("[CSP] violação reportada:", JSON.stringify(req.body?.["csp-report"] || req.body));
      res.status(204).end();
    }
  );

  // Headers de segurança HTTP (HSTS, X-Frame-Options, nosniff, etc.)
  // CSP em modo REPORT-ONLY (não bloqueia nada ainda, só reporta em
  // /api/csp-report) — o SPA nunca foi validado ao vivo contra uma CSP real
  // nesta sessão (sem acesso a browser confiável pra QA completo). Política
  // mapeada por leitura direta do código: sem <script>/<style> inline no HTML
  // de produção (dist/index.html), sem dangerouslySetInnerHTML; origens
  // externas reais confirmadas via grep — Google Fonts (index.css),
  // iframe do Google Maps (PropertyLanding.tsx), imagens do Storage do
  // Supabase + picsum.photos (placeholder). style-src mantém 'unsafe-inline'
  // de propósito (JSX style={{}} é comum no código; script-src NÃO tem
  // unsafe-inline/eval, que é onde está o valor real de defesa contra XSS).
  // Depois de um período sem violação real em /api/csp-report, trocar
  // reportOnly:true → false pra passar a bloquear de verdade.
  app.use(helmet({
    contentSecurityPolicy: {
      reportOnly: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://picsum.photos", SUPABASE_URL],
        connectSrc: ["'self'"],
        frameSrc: ["https://maps.google.com", "https://www.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        reportUri: ["/api/csp-report"],
      },
    },
  }));

  // API nunca deve ser cacheada — respostas são dinâmicas, por corretor
  // autenticado, muitas com dado sensível. Sem isso, cache heurístico de
  // navegador/proxy intermediário poderia reter uma resposta de GET.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Permissions-Policy: helmet não seta esse header sozinho. Nega por padrão
  // as APIs de hardware/privacidade sensíveis que o app não usa — exceto
  // microphone=(self), liberado pro botão de voz do Assistente
  // (CommandBar.tsx, MediaRecorder + POST /api/ai/transcribe). Sem isso o
  // navegador rejeitava getUserMedia({audio:true}) direto, sem nem chegar
  // a pedir permissão ao usuário. Se um dia usar câmera pra foto de imóvel
  // ou geolocalização, precisa liberar aqui primeiro também.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), midi=(), interest-cohort=()'
    );
    next();
  });

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
  app.use(crmPipelinesRouter);
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
  app.use(agentRouter);
  app.use(relatoriosRouter);
  app.use(vitrineRouter);
  app.use(contactsRouter);

  // --- Jobs em background (ver server/services/) ---
  // A inbox/outbox do WhatsApp roda exclusivamente no process group `worker`
  // (webhook-worker.ts). O processo web apenas persiste o evento antes do ACK.
  setInterval(runFollowupTick, 60_000);
  console.log('[Follow-up] scheduler ativo (tick 60s)');

  // Follow-up agendado ad-hoc pelo Assistente IA interno (ação
  // "schedule_followup" em server/services/agent.ts) — distinto do
  // Follow-Up Inteligente acima (régua automática por status de conversa).
  setInterval(runScheduledAgentFollowupsTick, 60_000);
  runScheduledAgentFollowupsTick();
  console.log('[Agent Follow-up] scheduler ativo (tick 60s)');

  // Verifica a cada hora se algum corretor tem renovação amanhã e emite o
  // valor combinado (mensalidade + excedente) na assinatura do Asaas.
  setInterval(prepareOverageBilling, 60 * 60 * 1000);
  prepareOverageBilling(); // executa uma vez ao subir (cobre restarts próximos ao billing)
  console.log('[Billing Prep] scheduler ativo (tick 1h)');

  // Corrige operações monetárias que o Asaas não confirmou na primeira
  // tentativa (por exemplo, restaurar o valor-base após cobrar excedentes).
  setInterval(reconcilePendingBillingActions, 5 * 60 * 1000);
  reconcilePendingBillingActions();
  console.log('[Billing Reconciliation] scheduler ativo (tick 5min)');

  // Expiração de reservas PIX roda fora do GET de unidades. Assim a listagem
  // não espera uma sequência de chamadas de cancelamento ao Asaas.
  setInterval(expireDueUnitReservations, 60 * 1000);
  expireDueUnitReservations();
  console.log('[Reserva PIX] scheduler de expiração ativo (tick 60s)');

  // Retenção de auditoria operacional: mantém 90 dias de webhook_logs.
  setInterval(purgeExpiredWebhookLogs, 24 * 60 * 60 * 1000);
  purgeExpiredWebhookLogs();
  console.log('[Maintenance] purge de webhook_logs ativo (tick 24h, retenção 90d)');

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      // Assets do Vite (dist/assets/*.js|css) levam hash de conteúdo no nome
      // — o arquivo nunca muda sob o mesmo nome, então pode cachear "pra
      // sempre" (immutable). index.html e outros arquivos sem hash (ex.:
      // favicon.svg) referenciam esses nomes com hash — cache curto e sempre
      // revalidando, senão o navegador pode ficar preso numa versão antiga
      // do index.html apontando pra um asset já removido do próximo deploy.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
