import { supabase } from "../supabase";
import { ASAAS_API_KEY, ASAAS_BASE_URL } from "../config";
import { decryptKey } from "../lib/crypto";

const ASAAS_PROD_URL = "https://api.asaas.com/v3";
const ASAAS_SANDBOX_URL = "https://sandbox.asaas.com/api/v3";

export interface AsaasCreds {
  baseUrl: string;
  headers: { "Content-Type": string; access_token: string };
  // true = chave própria da imobiliária; false = conta global da Criate.
  ownKey: boolean;
  hasKey: boolean;
}

export function asaasBaseUrlForEnv(env: string | null | undefined): string {
  return env === "production" ? ASAAS_PROD_URL : ASAAS_SANDBOX_URL;
}

function buildCreds(apiKey: string, baseUrl: string, ownKey: boolean): AsaasCreds {
  return {
    baseUrl,
    headers: { "Content-Type": "application/json", access_token: apiKey },
    ownKey,
    hasKey: !!apiKey,
  };
}

// Credenciais Asaas para cobranças DO CLIENTE da imobiliária (aluguel, sinal
// PIX de reserva). Usa a chave própria do broker se configurada; senão cai na
// conta global da Criate (comportamento atual). NUNCA usar isto para a
// assinatura do ImobiFlow — essa é sempre a conta da Criate (billing.ts).
export async function resolveAsaasCredentials(brokerId: string): Promise<AsaasCreds> {
  const { data } = await supabase
    .from("imf_brokers")
    .select("asaas_api_key_enc, asaas_env")
    .eq("id", brokerId)
    .maybeSingle();

  if (data?.asaas_api_key_enc) {
    try {
      const apiKey = decryptKey(data.asaas_api_key_enc);
      return buildCreds(apiKey, asaasBaseUrlForEnv(data.asaas_env), true);
    } catch (err: any) {
      // Chave corrompida/indecifrável não deve derrubar a cobrança de forma
      // opaca — cai na conta global e loga, igual ao caso "sem chave".
      console.error(`[Asaas] falha ao decifrar a chave do broker ${brokerId}, usando conta global:`, err?.message);
    }
  }
  return buildCreds(ASAAS_API_KEY, ASAAS_BASE_URL, false);
}
