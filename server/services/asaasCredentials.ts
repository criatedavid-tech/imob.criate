import { supabase } from "../supabase";
import { decryptKey } from "../lib/crypto";

const ASAAS_PROD_URL = "https://api.asaas.com/v3";
const ASAAS_SANDBOX_URL = "https://sandbox.asaas.com/api/v3";

export interface AsaasCreds {
  baseUrl: string;
  headers: { "Content-Type": string; access_token: string };
  // Operações financeiras dos clientes nunca usam a conta global da Criate.
  ownKey: true;
  hasKey: true;
}

export class ClientAsaasAccountRequiredError extends Error {
  readonly code = "CLIENT_ASAAS_ACCOUNT_REQUIRED";

  constructor(message = "Conecte a conta Asaas própria da empresa para gerar esta cobrança.") {
    super(message);
    this.name = "ClientAsaasAccountRequiredError";
  }
}

export function asaasBaseUrlForEnv(env: string | null | undefined): string {
  return env === "production" ? ASAAS_PROD_URL : ASAAS_SANDBOX_URL;
}

function buildOwnCreds(apiKey: string, baseUrl: string): AsaasCreds {
  return {
    baseUrl,
    headers: { "Content-Type": "application/json", access_token: apiKey },
    ownKey: true,
    hasKey: true,
  };
}

// Credenciais Asaas para cobranças DO CLIENTE da imobiliária/incorporadora
// (aluguel e sinal PIX de reserva). Exige a conta própria do cliente. Nunca
// existe fallback para a conta global da Criate, que é exclusiva da assinatura
// SaaS do ImobiFlow (billing.ts).
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
      const apiKey = decryptKey(data.asaas_api_key_enc);
      if (!apiKey.trim()) throw new Error("chave vazia");
      return buildOwnCreds(apiKey, asaasBaseUrlForEnv(data.asaas_env));
    } catch {
      console.error("[Asaas] chave própria de cliente inválida; cobrança bloqueada.");
      throw new ClientAsaasAccountRequiredError(
        "A integração Asaas própria desta conta precisa ser reconectada antes de gerar cobranças.",
      );
    }
  }

  throw new ClientAsaasAccountRequiredError();
}
