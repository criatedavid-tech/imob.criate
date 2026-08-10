import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { makeRedisStore } from "../lib/infra";

// Em dev (NODE_ENV != production) todo o tráfego sai do mesmo IP (localhost),
// então cadastro+login de teste estouram o limite rápido. Fora de produção o
// limitador é ignorado; em produção continua valendo integralmente.
const skipInDev = () => process.env.NODE_ENV !== 'production';
const AI_WINDOW_MS = 15 * 60 * 1000;
const authenticatedUserKey = (req: any) => `user:${req.userId || 'unknown'}`;
const internalBrokerKey = (req: any) => {
  const brokerScope = req.body?.broker_id
    || req.query?.broker_id
    || req.params?.id
    || req.params?.brokerPhone
    || 'unknown';
  return `broker:${String(brokerScope).slice(0, 100)}`;
};

// --- RATE LIMITERS ---
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' },
  store: makeRedisStore('auth', 15 * 60 * 1000),
  skip: skipInDev,
});

export const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de cadastros por IP atingido. Tente novamente em 1 hora.' },
  store: makeRedisStore('checkout', 60 * 60 * 1000),
  skip: skipInDev,
});

// Gera customer/payment na Asaas. Aplicado depois de requireUser para que o
// limite seja por conta autenticada, e não pelo IP compartilhado da equipe.
export const reservationPaymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: { error: 'Muitas tentativas de gerar PIX. Aguarde 1 hora e tente novamente.' },
  store: makeRedisStore('reservation-payment', 60 * 60 * 1000),
  skip: skipInDev,
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  // 600/min: o Asaas envia de poucos IPs fixos, então o limite por IP é
  // compartilhado por TODOS os corretores. Com 120/min, um dia de cobrança em
  // massa estourava o limite e o Asaas passava a receber 429 — atrasando
  // eventos de pagamento reais. A rota já valida o token do Asaas.
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' },
  store: makeRedisStore('webhook', 60 * 1000),
});

// Webhook de entrada do WhatsApp: a chave é a INSTÂNCIA, não o IP — a UAZAPI
// sai de poucos IPs, então limitar por IP puniria todos os corretores juntos.
// 600/min por instância é ~10 msg/s de um único número: muito acima do uso
// real e ainda assim um teto que impede um laço de retry de saturar o app.
export const inboundWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `instance:${String(req.params?.instanceId || 'unknown').slice(0, 100)}`,
  message: { error: 'Rate limit exceeded.' },
  store: makeRedisStore('wpp-inbound', 60 * 1000),
});

// Formulário público da vitrine (POST /api/leads). Sem limite, um laço trivial
// polui o CRM de todos os corretores com leads falsos e ainda satura o app —
// o property_id é público por definição, já que a landing é divulgada em
// anúncios. Generoso o bastante para uma família preenchendo do mesmo IP.
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos envios deste IP. Tente novamente mais tarde.' },
  store: makeRedisStore('public-form', 60 * 60 * 1000),
  skip: skipInDev,
});

// Leitura pública (vitrine e landing de imóvel). São as rotas divulgadas em
// anúncio, então precisam absorver pico legítimo — o teto existe só para
// impedir raspagem agressiva de um único IP.
export const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
  store: makeRedisStore('public-read', 60 * 1000),
  skip: skipInDev,
});

// Automações internas usam um token compartilhado, então o limite precisa
// ser por conta/corretor e persistido no Redis para continuar correto quando o
// grupo web tiver várias instâncias.
export const n8nInternalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: internalBrokerKey,
  message: { error: 'Limite de automações excedido para este corretor.' },
  store: makeRedisStore('n8n-internal', 60 * 1000),
  skip: skipInDev,
});

export const n8nLlmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: internalBrokerKey,
  message: { error: { message: 'Limite de IA excedido para este corretor.', type: 'rate_limit' } },
  store: makeRedisStore('n8n-llm', 60 * 1000),
  skip: skipInDev,
});

// Aplicados depois de requireUser: a chave vem do JWT validado, não de um
// header controlado pelo cliente. Limites separados evitam que transcrição,
// mais cara, consuma toda a janela das melhorias curtas de texto.
export const aiTextLimiter = rateLimit({
  windowMs: AI_WINDOW_MS,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: { error: 'Muitas solicitações de texto com IA. Aguarde alguns minutos e tente novamente.' },
  store: makeRedisStore('ai-text', AI_WINDOW_MS),
  skip: skipInDev,
});

export const aiTranscriptionLimiter = rateLimit({
  windowMs: AI_WINDOW_MS,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: { error: 'Muitas transcrições de áudio. Aguarde alguns minutos e tente novamente.' },
  store: makeRedisStore('ai-audio', AI_WINDOW_MS),
  skip: skipInDev,
});

// Vínculo de telefone do WhatsApp Pai — cada chamada de start manda uma
// mensagem REAL pelo WhatsApp da plataforma; sem limite, um usuário
// poderia martelar números alheios com códigos de verificação indesejados.
export const whatsappLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: { error: 'Muitas tentativas de vínculo. Aguarde 15 minutos e tente novamente.' },
  store: makeRedisStore('whatsapp-link', 15 * 60 * 1000),
  skip: skipInDev,
});

// Google/Apple costumam buscar calendários assinados a partir de poucos IPs
// compartilhados. Limitar por IP faria uma conta prejudicar outra; por isso a
// chave é o hash do token da própria assinatura (o segredo nunca vai ao Redis).
export const calendarFeedReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `feed:${createHash('sha256').update(String(req.params?.token || 'invalid')).digest('hex')}`,
  message: 'Muitas atualizações deste calendário. Tente novamente em instantes.',
  store: makeRedisStore('calendar-feed', 60 * 1000),
  skip: skipInDev,
});

// Teste explícito do canal de cobrança: envia uma única mensagem identificada
// ao telefone do inquilino, sem criar boleto/PIX nem avançar a régua.
export const rentalTestDispatchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: { error: 'Limite de testes de WhatsApp atingido. Aguarde 15 minutos.' },
  store: makeRedisStore('rental-test-dispatch', 15 * 60 * 1000),
  skip: skipInDev,
});

// Envio manual de uma cobranca real. A trava e separada do teste de canal
// porque esta rota inclui boleto/PIX e nao pode virar ferramenta de disparo.
export const rentalBillingDispatchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedUserKey,
  message: { error: 'Limite de envios de cobranca atingido. Aguarde 15 minutos.' },
  store: makeRedisStore('rental-billing-dispatch', 15 * 60 * 1000),
  skip: skipInDev,
});
