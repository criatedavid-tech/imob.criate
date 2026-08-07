import { supabase } from "../supabase";
import { resolveOutboundInstanceToken, sendUazapiText } from "./uazapi";
import { ensureConversationTicket, recordConversationMessage } from "./conversationTickets";
import { isOfficialWhatsappPaiPhone } from "./whatsappPaiIdentity";

// ─── Motor do Follow-Up (tick 60s) ──────────────────────────────────────────
// claim_due_followups_v2() faz o claim ATÔMICO (seleciona+marca+avança numa só
// instrução) → multi-máquina safe (Fly roda 2 VMs). Envia via UAZAPI nativo
// (mesmo caminho de Conversas/agente — resolveOutboundInstanceToken decide
// entre instância própria de um membro ou compartilhada da conta). Em falha
// de envio, reverte o claim p/ retry no próximo tick (nada se perde).
//
// Se a última
// mensagem da conversa foi o corretor respondendo manualmente (não a IA, não
// o cliente), ele já assumiu o atendimento — não manda follow-up por cima.
async function wasRepliedManually(brokerId: string, customerPhone: string): Promise<boolean> {
  const { data } = await supabase
    .from("imf_conversation_messages")
    .select("sender_type")
    .eq("broker_id", brokerId)
    .eq("customer_phone", customerPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.sender_type === "broker_manual";
}

// Handover humano: pausa a IA e os follow-ups pra uma conversa. Usado tanto
// pelo endpoint que o N8N chama (POST /api/followup/broker-reply, quando
// detecta o corretor digitando manual) quanto pela resposta manual
// direto na tela Conversas — mesma ação, mesmo efeito, um só lugar de verdade.
export async function pauseAiForHumanTakeover(brokerId: string, customerPhone: string) {
  const updatedAt = new Date().toISOString();
  const ticket = await ensureConversationTicket({
    brokerId,
    customerPhone,
    initialStatus: 'open',
    aiActive: false,
    lastActivityAt: updatedAt,
  });
  const { data: current } = await supabase.from('followup_conversations').upsert({
    broker_id: brokerId,
    customer_phone: customerPhone,
    ticket_id: ticket.id,
    ai_active: false,
    human_takeover_at: updatedAt,
    follow_sent: true, // pausa follow-ups enquanto o humano atende
    updated_at: updatedAt
  }, { onConflict: 'broker_id,customer_phone' }).select('ticket_id').maybeSingle();

  if (current?.ticket_id) {
    await supabase.from('imf_conversation_tickets').update({
      ai_active: false,
      human_takeover_at: updatedAt,
      updated_at: updatedAt,
    }).eq('id', current.ticket_id).eq('broker_id', brokerId);
  }
}

export async function runFollowupTick() {
  try {
    const { data: due, error } = await supabase.rpc('claim_due_followups_v2');
    if (error) { console.error('[Follow-up] claim erro:', error.message); return; }
    if (!due?.length) return;
    for (const row of due as any[]) {
      if (isOfficialWhatsappPaiPhone(row.customer_phone)) {
        await supabase.from('followup_conversations').update({
          ai_active: false,
          follow_sent: true,
          updated_at: new Date().toISOString(),
        }).eq('id', row.conversation_id);
        console.warn('[Follow-up] numero interno do Assistente IA ignorado.');
        continue;
      }
      // Mensagem vazia = follow não configurado → avança sem enviar (evita loop infinito)
      if (!row.message?.trim()) {
        console.warn(`[Follow-up] follow #${row.message_index} sem mensagem configurada — pulando → ${row.customer_phone}`);
        continue;
      }
      if (await wasRepliedManually(row.broker_id, row.customer_phone)) {
        console.log(`[Follow-up] conversa já respondida manualmente — pulando ${row.customer_phone}`);
        continue;
      }
      const instanceToken = await resolveOutboundInstanceToken(row.broker_id, row.customer_phone);
      const sent = instanceToken
        ? await sendUazapiText(
            instanceToken,
            row.customer_phone,
            // Prefixo ​ (zero-width space, invisível): marca mensagem do SISTEMA
            // — marcador invisível reconhecido pelo fluxo de automação.
            String.fromCharCode(0x200B) + row.message
          )
        : null;
      const ok = !!sent?.ok;
      if (ok) {
        console.log(`[Follow-up] follow #${row.message_index} → ${row.customer_phone} (broker ${row.broker_id})`);
        try {
          await recordConversationMessage({
            brokerId: row.broker_id,
            customerPhone: row.customer_phone,
            direction: "out",
            senderType: "ai",
            body: row.message,
            initialStatus: "open",
          });
        } catch (err: any) {
          // A mensagem já foi entregue. Falha de persistência não pode causar
          // reenvio e duplicidade no WhatsApp; fica registrada no log operacional.
          console.error(`[Follow-up] enviado, mas não persistido no ticket: ${err.message}`);
        }
        // Após cada follow (exceto o último configurado), reseta follow_sent para
        // que o próximo dispare automaticamente após o delay correspondente
        // (contado a partir de follow_sent_at, gravado pela RPC). O último follow
        // configurado (index=follow_count) mantém follow_sent=true — sequência encerrada.
        if (row.message_index < row.follow_count) {
          await supabase.from('followup_conversations').update({
            follow_sent: false,
            updated_at: new Date().toISOString()
          }).eq('id', row.conversation_id);
        }
      } else {
        // Falha de envio (sem instância configurada, ou rede/API) → reverte
        // claim para retry no próximo tick.
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
