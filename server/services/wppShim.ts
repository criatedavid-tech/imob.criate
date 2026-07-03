import { UAZAPI_HOST } from "../config";
import { normalizePhoneBR } from "../lib/crypto";

// ─── Disfarce UAZAPI (substitui o envio via Z-PRO) ──────────────────────────
// Ver plano "Eliminar o Z-PRO" (C:\Users\Criate\.claude\plans\stateless-drifting-turing.md).
//
// ✅ FORMATO CONFIRMADO AO VIVO (2026-07-03) contra a instância real do Hunter
// (WhatsApp conectado de verdade): POST /send/text — SEM identificador nenhum
// na URL, header "token" = o API Token da própria instância (não o
// UAZAPI_TOKEN de plataforma), body {number, text}. Resposta 200 devolve o
// objeto da mensagem enviada (chatid, id do WhatsApp, messageTimestamp, etc.).
// Diferente da hipótese anterior (que usava /message/text/:id, testada e
// descartada — dava 405 Method Not Allowed pra qualquer valor no path).
export async function sendUazapiText(
  instanceToken: string,
  number: string,
  text: string
): Promise<{ ok: boolean; status: number; raw: string }> {
  try {
    const r = await fetch(`${UAZAPI_HOST}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({ number: normalizePhoneBR(number), text }),
    });
    const raw = await r.text();
    return { ok: r.ok, status: r.status, raw };
  } catch (e: any) {
    console.warn("[WppShim] sendUazapiText exceção:", e.message);
    return { ok: false, status: 0, raw: e.message };
  }
}
