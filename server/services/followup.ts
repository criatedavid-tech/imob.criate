import { supabase } from "../supabase";
import { ZPRO_ADMIN_URL } from "../config";
import { getZproAdminToken } from "../lib/zproAuth";
import { normalizePhoneBR } from "../lib/crypto";

// ─── Motor do Follow-Up (tick 60s) ──────────────────────────────────────────
// claim_due_followups() faz o claim ATÔMICO (seleciona+marca+avança numa só
// instrução) → multi-máquina safe (Fly roda 2 VMs). Envia via API externa Z-PRO.
// Em falha de envio, reverte o claim p/ retry no próximo tick (nada se perde).
// Envia via API externa Z-PRO no MESMO formato do agente N8N (comprovado em produção):
// POST na URL base (zpro_api_url, sem sufixo) · header "Authorization: Token <token>"
// · body { body, number, externalKey, isClosed:false }.
async function checkTicketOpen(ticketId: string | null): Promise<boolean | null> {
  if (!ticketId || !ZPRO_ADMIN_URL) return null;
  try {
    const token = await getZproAdminToken();
    const r = await fetch(`${ZPRO_ADMIN_URL}/api/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return null; // falha na consulta → não bloqueia envio
    const d = await r.json();
    const status = d?.ticket?.status ?? d?.status;
    return status === 'open' || status === 'pending';
  } catch {
    return null;
  }
}

async function sendFollowMessage(apiUrl: string, apiToken: string, customerPhone: string, message: string): Promise<boolean> {
  if (!apiUrl || !apiToken || !message) return false;
  try {
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${apiToken}` },
      body: JSON.stringify({
        // Prefixo ​ (zero-width space, invisível): marca mensagem do SISTEMA.
        // O nó de handover no N8N só dispara quando a msg fromMe NÃO tem esse marcador
        // (= corretor digitou manual). Assim o follow-up não causa auto-handover.
        body: String.fromCharCode(0x200B) + message, // ZWSP: marca msg do sistema
        number: normalizePhoneBR(customerPhone),
        externalKey: 'imobiflow-followup',
        isClosed: false
      })
    });
    return r.ok;
  } catch (e: any) {
    console.warn('[Follow-up] sendFollowMessage exceção:', e.message);
    return false;
  }
}

// Handover humano: pausa a IA e os follow-ups pra uma conversa. Usado tanto
// pelo endpoint que o N8N chama (POST /api/followup/broker-reply, quando
// detecta o corretor digitando manual no Z-PRO) quanto pela resposta manual
// direto na tela Conversas — mesma ação, mesmo efeito, um só lugar de verdade.
export async function pauseAiForHumanTakeover(brokerId: string, customerPhone: string) {
  await supabase.from('followup_conversations').upsert({
    broker_id: brokerId,
    customer_phone: customerPhone,
    ai_active: false,
    human_takeover_at: new Date().toISOString(),
    follow_sent: true, // pausa follow-ups enquanto o humano atende
    updated_at: new Date().toISOString()
  }, { onConflict: 'broker_id,customer_phone' });
}

export async function runFollowupTick() {
  try {
    const { data: due, error } = await supabase.rpc('claim_due_followups');
    if (error) { console.error('[Follow-up] claim erro:', error.message); return; }
    if (!due?.length) return;
    for (const row of due as any[]) {
      // Mensagem vazia = follow não configurado → avança sem enviar (evita loop infinito)
      if (!row.message?.trim()) {
        console.warn(`[Follow-up] follow #${row.message_index} sem mensagem configurada — pulando → ${row.customer_phone}`);
        continue;
      }
      // Verifica se o ticket ainda está aberto no Z-PRO antes de enviar
      const ticketOpen = await checkTicketOpen(row.zpro_ticket_id);
      if (ticketOpen === false) {
        console.log(`[Follow-up] ticket ${row.zpro_ticket_id} fechado — pulando ${row.customer_phone}`);
        continue;
      }
      const ok = await sendFollowMessage(row.zpro_api_url, row.zpro_api_token, row.customer_phone, row.message);
      if (ok) {
        console.log(`[Follow-up] follow #${row.message_index} → ${row.customer_phone} (broker ${row.broker_id})`);
        // Após Follow 1 ou 2, reseta follow_sent para que o próximo dispare automaticamente
        // após o delay correspondente (contado a partir de follow_sent_at, gravado pela RPC).
        // Follow 3 (index=3) mantém follow_sent=true — sequência encerrada.
        if (row.message_index < 3) {
          await supabase.from('followup_conversations').update({
            follow_sent: false,
            updated_at: new Date().toISOString()
          }).eq('id', row.conversation_id);
        }
      } else {
        // Falha de envio (rede/API) → reverte claim para retry no próximo tick
        await supabase.from('followup_conversations').update({
          follow_sent: false,
          follow_sent_at: null,
          follow_message_index: Math.max(0, (row.message_index || 1) - 1),
          updated_at: new Date().toISOString()
        }).eq('id', row.conversation_id);
        console.warn(`[Follow-up] envio falhou, claim revertido → ${row.customer_phone}`);
      }
    }
  } catch (err: any) {
    console.error('[Follow-up] tick erro:', err.message);
  }
}
