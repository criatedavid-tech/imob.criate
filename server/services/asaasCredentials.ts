import { supabase } from "../supabase";
import { decryptKey } from "../lib/crypto";
import { ASAAS_WEBHOOK_TOKEN, CLIENT_FINANCIAL_SANDBOX_ONLY, PUBLIC_APP_URL } from "../config";
import { fetchWithTimeout } from "../lib/http";

const ASAAS_PROD_URL = "https://api.asaas.com/v3";
const ASAAS_SANDBOX_URL = "https://api-sandbox.asaas.com/v3";

export interface AsaasCreds {
  baseUrl: string;
  headers: { "Content-Type": string; "User-Agent": string; access_token: string };
  // Operações financeiras dos clientes nunca usam a conta global da Criate.
  ownKey: true;
  hasKey: true;
}

export class ClientAsaasAccountRequiredError extends Error {
  readonly code: string = "CLIENT_ASAAS_ACCOUNT_REQUIRED";

  constructor(message = "Conecte a conta Asaas própria da empresa para gerar esta cobrança.") {
    super(message);
    this.name = "ClientAsaasAccountRequiredError";
  }
}

class ClientAsaasSandboxRequiredError extends ClientAsaasAccountRequiredError {
  readonly code = "CLIENT_ASAAS_SANDBOX_REQUIRED";

  constructor() {
    super("A validação financeira está restrita ao Asaas sandbox. Conecte uma chave de teste desta conta.");
    this.name = "ClientAsaasSandboxRequiredError";
  }
}

class ClientAsaasWebhookRequiredError extends ClientAsaasAccountRequiredError {
  readonly code = "CLIENT_ASAAS_WEBHOOK_REQUIRED";

  constructor(message = "O webhook financeiro não está pronto para acompanhar esta cobrança.") {
    super(message);
    this.name = "ClientAsaasWebhookRequiredError";
  }
}

export function asaasBaseUrlForEnv(env: string | null | undefined): string {
  return env === "production" ? ASAAS_PROD_URL : ASAAS_SANDBOX_URL;
}

export async function assertClientAsaasEnvironmentAllowed(brokerId: string): Promise<void> {
  if (!CLIENT_FINANCIAL_SANDBOX_ONLY) return;
  const { data, error } = await supabase
    .from("imf_brokers")
    .select("asaas_api_key_enc, asaas_env")
    .eq("id", brokerId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível verificar o ambiente financeiro da conta.");
  if (!data?.asaas_api_key_enc || data.asaas_env !== "sandbox") {
    throw new ClientAsaasSandboxRequiredError();
  }
}

function buildOwnCreds(apiKey: string, baseUrl: string): AsaasCreds {
  return {
    baseUrl,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "RealEstate/2.0 (Node.js; client-financial)",
      access_token: apiKey,
    },
    ownKey: true,
    hasKey: true,
  };
}

const CLIENT_PAYMENT_WEBHOOK_EVENTS = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_CHARGEBACK_REQUESTED",
];

// Garante que a mesma conta Asaas que criou a cobrança também notificará o
// PANTUS Real Estate. A operação é idempotente: reutiliza o webhook da URL canônica e
// preserva eventos extras já configurados nessa integração.
export async function ensureClientAsaasPaymentWebhook(creds: AsaasCreds): Promise<void> {
  if (ASAAS_WEBHOOK_TOKEN.length < 32) {
    throw new ClientAsaasWebhookRequiredError(
      "O token seguro do webhook Asaas não está configurado; a cobrança foi bloqueada antes da emissão.",
    );
  }

  const url = `${PUBLIC_APP_URL}/api/webhooks/asaas`;
  const listResponse = await fetchWithTimeout(`${creds.baseUrl}/webhooks?offset=0&limit=100`, {
    headers: creds.headers,
  });
  const list = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) {
    throw new ClientAsaasWebhookRequiredError(
      list?.errors?.[0]?.description || "O Asaas não permitiu verificar o webhook desta conta.",
    );
  }

  const existing = (Array.isArray(list?.data) ? list.data : []).find((item: any) => item?.url === url);
  const events = [...new Set([...(Array.isArray(existing?.events) ? existing.events : []), ...CLIENT_PAYMENT_WEBHOOK_EVENTS])];
  const payload = {
    name: "PANTUS Real Estate - pagamentos de clientes",
    url,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: ASAAS_WEBHOOK_TOKEN,
    sendType: "SEQUENTIALLY",
    events,
  };

  const response = await fetchWithTimeout(
    existing?.id ? `${creds.baseUrl}/webhooks/${existing.id}` : `${creds.baseUrl}/webhooks`,
    { method: existing?.id ? "PUT" : "POST", headers: creds.headers, body: JSON.stringify(payload) },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ClientAsaasWebhookRequiredError(
      result?.errors?.[0]?.description || "O Asaas não confirmou o webhook desta conta.",
    );
  }
}

// Credenciais Asaas para cobranças DO CLIENTE da imobiliária/incorporadora
// (aluguel e sinal PIX de reserva). Exige a conta própria do cliente. Nunca
// existe fallback para a conta global da Criate, que é exclusiva da assinatura
// SaaS do PANTUS Real Estate (billing.ts).
export async function resolveAsaasCredentials(brokerId: string): Promise<AsaasCreds> {
  const { data, error } = await supabase
    .from("imf_brokers")
    .select("asaas_api_key_enc, asaas_env")
    .eq("id", brokerId)
    .maybeSingle();

  if (error) {
    throw new Error("Não foi possível verificar a integração financeira da conta.");
  }

  if (data?.asaas_api_key_enc) {
    try {
      if (CLIENT_FINANCIAL_SANDBOX_ONLY && data.asaas_env !== "sandbox") {
        throw new ClientAsaasSandboxRequiredError();
      }
      const apiKey = decryptKey(data.asaas_api_key_enc);
      if (!apiKey.trim()) throw new Error("chave vazia");
      return buildOwnCreds(apiKey, asaasBaseUrlForEnv(data.asaas_env));
    } catch (error) {
      if (error instanceof ClientAsaasSandboxRequiredError) throw error;
      console.error("[Asaas] chave própria de cliente inválida; cobrança bloqueada.");
      throw new ClientAsaasAccountRequiredError(
        "A integração Asaas própria desta conta precisa ser reconectada antes de gerar cobranças.",
      );
    }
  }

  throw new ClientAsaasAccountRequiredError();
}
