import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { SUPABASE_URL } from "./server/config";
import {
  closeInfra,
  sentryHttp5xxMonitor,
  setupSentryExpressErrorHandler,
} from "./server/lib/infra"; // o import também inicializa Sentry/Redis se configurados

import { authRouter } from "./server/routes/auth";
import { brokersRouter } from "./server/routes/brokers";
import { propertiesRouter } from "./server/routes/properties";
import { aiRouter } from "./server/routes/ai";
import { dashboardRouter } from "./server/routes/dashboard";
import { leadsRouter } from "./server/routes/leads";
import { crmPipelinesRouter } from "./server/routes/crmPipelines";
import { agendaRouter } from "./server/routes/agenda";
import { billingRouter } from "./server/routes/billing";
import { llmProxyRouter } from "./server/routes/llmProxy";
import { adminRouter } from "./server/routes/admin";
import { followupRouter } from "./server/routes/followup";
import { conversationsRouter } from "./server/routes/conversations";
import { locacaoRouter } from "./server/routes/locacao";
import { rentalAgentRouter } from "./server/routes/rentalAgent";
import { crmSalesAgentRouter } from "./server/routes/crmSalesAgent";
import { salesAgentRouter } from "./server/routes/salesAgent";
import { getPropertyPageMeta, injectPageMeta, injectAboveFold } from "./server/services/publicPageMeta";
import { lancamentosRouter } from "./server/routes/lancamentos";
import { financeiroRouter } from "./server/routes/financeiro";
import { equipeRouter } from "./server/routes/equipe";
import { agentRouter } from "./server/routes/agent";
import { relatoriosRouter } from "./server/routes/relatorios";
import { vitrineRouter } from "./server/routes/vitrine";
import { contactsRouter } from "./server/routes/contacts";
import { whatsappPaiSettingsRouter } from "./server/routes/whatsappPaiSettings";
import { whatsappPaiRouter } from "./server/routes/whatsappPai";
import { systemLogsRouter } from "./server/routes/systemLogs";
import { injectPublicAboutPage } from "./server/services/publicAboutPage";

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
    express.json({ type: ["application/json", "application/csp-report"], limit: "64kb" }),
    (req, res) => {
      // Truncado: a rota é pública e sem autenticação — logar o corpo inteiro
      // permitia inflar volume de log de graça.
      const raw = JSON.stringify(req.body?.["csp-report"] || req.body) || "";
      console.warn("[CSP] violação reportada:", raw.slice(0, 500));
      res.status(204).end();
    }
  );

  // Headers de segurança HTTP (HSTS, X-Frame-Options, nosniff, etc.)
  // CSP AGORA BLOQUEIA (reportOnly: false, 2026-09-02). Antes era só relatório.
  // Antes de ligar, cada origem externa foi levantada no código e duas lacunas
  // que quebrariam o app foram corrigidas — as duas passavam despercebidas em
  // report-only justamente porque report-only não bloqueia nada:
  //   1. media-src não existia. Os <audio> de Conversas e do Assistente
  //      (ConversasArea.tsx, CommandBar.tsx) tocam de `getPublicUrl` do Storage
  //      do Supabase; sem a diretiva eles caíam em default-src 'self' e o áudio
  //      das conversas seria bloqueado.
  //   2. frame-src não tinha 'self'. A prévia da vitrine (DivulgacaoArea.tsx)
  //      é um iframe de `${window.location.origin}/vitrine/:id` — mesma origem,
  //      mas frame-src não herda de default-src quando declarada.
  // Verificado por grep que NÃO há: fetch/XHR para origem externa, Web Worker,
  // Sentry no front, EventSource/WebSocket (o WS de HMR é só dev), blob: ou
  // createObjectURL. style-src mantém 'unsafe-inline' de propósito (JSX
  // style={{}} é comum aqui); script-src NÃO tem unsafe-inline/eval, que é
  // onde mora o valor real contra XSS.
  // Nonce por requisição: a vitrine de imóvel (/p/:slug) injeta o imóvel no
  // próprio HTML como <script> inline (server/services/publicPageMeta.ts) pra
  // a página pintar sem esperar a API. Conteúdo dinâmico não permite hash
  // fixo, então cada resposta ganha um nonce e só o script com aquele nonce
  // executa — mantendo script-src estrito, sem 'unsafe-inline'.
  app.use((_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString("base64");
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      reportOnly: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (_req, res) => `'nonce-${(res as any).locals.cspNonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        // picsum saiu: não é usado em lugar nenhum do app (só existia aqui).
        // As fotos reais vêm do Storage do Supabase.
        imgSrc: ["'self'", "data:", SUPABASE_URL],
        mediaSrc: ["'self'", SUPABASE_URL],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", "https://maps.google.com", "https://www.google.com"],
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

  // Liveness barata e sem dependências externas. Usada pelo Fly e pelo
  // harness de carga para medir apenas a capacidade HTTP do process group
  // `web`, sem criar ou alterar dados de clientes.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "web" });
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

  // Limites de corpo por rota ANTES do global: body-parser ignora a requisição
  // que já foi parseada, então o parser específico vence. As rotas públicas de
  // alto volume (webhook a dezenas por segundo, formulário da vitrine) não
  // precisam de payload grande e eram o vetor natural de exaustão de memória —
  // 10 MB × concorrência não cabe numa VM de 1 GB. As rotas de upload
  // (foto de imóvel, mídia da conversa, documento, áudio) continuam no limite
  // grande do parser global logo abaixo.
  app.use("/api/wpp-shim/inbound", express.json({ limit: "512kb" }));
  app.use("/api/wpp-pai/inbound", express.json({ limit: "512kb" }));
  app.use("/api/leads", express.json({ limit: "64kb" }));

  // 10mb: suficiente para upload individual de foto em base64 (~7MB de imagem real).
  // Limite anterior de 50mb era vetor de DoS por exaustão de memória.
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Registra respostas 5xx tratadas pelas próprias rotas. Não coleta body,
  // query, headers, parâmetros concretos nem conteúdo da resposta.
  app.use(sentryHttp5xxMonitor);

  // --- Rotas — uma por domínio, cada uma em server/routes/ (ver UX_MASTERPLAN.md) ---
  app.use(authRouter);
  app.use(brokersRouter);
  app.use(propertiesRouter);
  app.use(aiRouter);
  app.use(dashboardRouter);
  app.use(leadsRouter);
  app.use(crmPipelinesRouter);
  app.use(agendaRouter);
  app.use(billingRouter);
  app.use(llmProxyRouter);
  app.use(adminRouter);
  app.use(followupRouter);
  app.use(conversationsRouter);
  app.use(locacaoRouter);
  app.use(rentalAgentRouter);
  app.use(crmSalesAgentRouter);
  app.use(salesAgentRouter);
  app.use(lancamentosRouter);
  app.use(financeiroRouter);
  app.use(equipeRouter);
  app.use(agentRouter);
  app.use(relatoriosRouter);
  app.use(vitrineRouter);
  app.use(contactsRouter);
  app.use(whatsappPaiSettingsRouter);
  app.use(whatsappPaiRouter);
  app.use(systemLogsRouter);

  // Jobs recorrentes não rodam na API. O process group singleton `scheduler`
  // executa scheduler-worker.ts; assim o grupo `web` pode ser escalado sem
  // duplicar follow-ups, alertas, billing ou manutenção.

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      // Evita que o loader "bundle" do esbuild percorra diretórios acima do
      // checkout (bloqueados no ambiente local do Codex). O build já usa o
      // mesmo loader via package.json.
      configLoader: "runner",
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
    // Um asset com hash deixa de existir depois de um novo deploy. Ele nunca
    // pode cair no fallback da SPA e receber index.html com status 200: o
    // navegador espera JavaScript/CSS, rejeita o MIME text/html e o React
    // desmonta a tela. O 404 explícito permite ao cliente reconhecer a versão
    // antiga e fazer uma única recarga de recuperação.
    app.use("/assets", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.status(404).type("text/plain").send("Asset not found");
    });
    // Rota de API inexistente devolve JSON 404 em vez do HTML da SPA. Sem
    // isso, um GET /api/errado respondia 200 + index.html: erro de front e
    // varredura de bot viravam "sucesso" nas métricas, cada um custando uma
    // leitura de arquivo.
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "Not found" });
    });

    // Vitrine do imóvel: o HTML sai com título, descrição e foto do imóvel.
    // Sem isto, o robô do WhatsApp (que não executa JavaScript) só via a casca
    // da SPA — e todo link compartilhado aparecia como "Criate", sem imagem.
    // O `preload` da foto principal também adianta a primeira pintura.
    app.get("/p/:slug", async (req, res, next) => {
      try {
        const meta = await getPropertyPageMeta(String(req.params.slug || ""));
        if (!meta) return next();
        const html = await readFile(path.join(distPath, "index.html"), "utf8");
        // NUNCA cachear o HTML no navegador, mesmo com a consulta embutida:
        // ele referencia assets com hash no nome, e o deploy seguinte apaga os
        // antigos. Um HTML guardado por 60s vira tela branca depois do deploy
        // (o navegador pede um .js que nao existe mais e recebe HTML de volta).
        // A consulta ao banco ja e evitada pelo cache em memoria de 60s em
        // getPropertyPageMeta — o cache HTTP aqui nao economizava nada e
        // quebrava tudo.
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Content-Type", "text/html; charset=UTF-8");
        return res.send(injectAboveFold(injectPageMeta(html, meta), meta, res.locals.cspNonce));
      } catch {
        // Qualquer falha aqui cai no fallback normal da SPA: a página abre
        // igual a antes, só sem a prévia enriquecida.
        return next();
      }
    });

    // O Google valida a página inicial do OAuth sem garantir execução de
    // JavaScript. Entregamos nome, finalidade, uso do Google Agenda e links
    // institucionais já no HTML inicial; o React substitui esse conteúdo assim
    // que o bundle carrega. Isso também mantém /sobre útil sem JavaScript.
    app.get("/sobre", async (_req, res, next) => {
      try {
        const html = await readFile(path.join(distPath, "index.html"), "utf8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Content-Type", "text/html; charset=UTF-8");
        return res.send(injectPublicAboutPage(html));
      } catch {
        return next();
      }
    });

    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Precisa vir depois de todas as rotas e antes do handler padrão do Express.
  // Exceções que chegam via next(error) preservam o stack trace no Sentry.
  setupSentryExpressErrorHandler(app);

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Timeouts: o default do Node é 300s de requestTimeout. Atrás de um proxy
  // que corta em algumas centenas de conexões, uma requisição presa num
  // Supabase lento segurava um slot por 5 minutos. keepAlive acima do
  // idle timeout do proxy do Fly (60s) evita corrida de conexão reaproveitada.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 30_000;

  // Graceful shutdown: sem isso o Node encerra IMEDIATAMENTE no SIGTERM, e os
  // 30s de kill_timeout do Fly nunca eram usados. Toda requisição em voo
  // morria no meio a cada deploy — incluindo INSERT de lead e checkout entre
  // duas chamadas ao Asaas. Os process groups worker/scheduler já faziam isso;
  // o `web`, que é justamente quem atende usuário, era o único sem.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[web] ${signal} recebido; drenando conexões.`);
    const forced = setTimeout(() => {
      console.warn("[web] drenagem excedeu o limite; encerrando à força.");
      process.exit(1);
    }, 25_000);
    forced.unref();
    server.close(async () => {
      clearTimeout(forced);
      try { await closeInfra(); } catch { /* encerrando de qualquer forma */ }
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

startServer();
