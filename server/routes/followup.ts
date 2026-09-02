import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { normalizePhoneBR } from "../lib/crypto";
import { pauseAiForHumanTakeover } from "../services/followup";
import { ensureConversationTicket } from "../services/conversationTickets";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nInternalLimiter } from "../middleware/rateLimits";

export const followupRouter = express.Router();

// ─── FOLLOW-UP IA ───────────────────────────────────────────────────────────
// Reativação automática de lead: após X minutos sem o cliente responder, envia
// UMA mensagem de follow (progressivo 1→2→3, para após o 3º). Handover humano:
// se o corretor responde manualmente, o agente é interrompido (ai_active=false)
// e os follow-ups param naquela conversa.
// Tabelas: followup_config (1 por corretor) + followup_conversations (por conversa).

// [Corretor] Carrega a config de follow-up do corretor logado
followupRouter.get('/api/followup/config', requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: 'Perfil não encontrado.' });
    const { data } = await supabase.from('followup_config').select('*').eq('broker_id', brokerId).maybeSingle();
    res.json(data || {
      broker_id: brokerId, enabled: false,
      follow_count: 3,
      delay_minutes_1: 30, delay_minutes_2: 120, delay_minutes_3: 1440,
      delay_minutes_4: 20160, delay_minutes_5: 30240, delay_minutes_6: 40320,
      delay_minutes_7: 50400, delay_minutes_8: 60480,
      message_1: '', message_2: '', message_3: '', message_4: '', message_5: '',
      message_6: '', message_7: '', message_8: '',
      strategy: 'progressive'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// [Corretor] Salva a config de follow-up (toggle + tempo + 3 mensagens)
followupRouter.post('/api/followup/config', requireUser, async (req, res) => {
  const userId = (req as any).userId as string;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(404).json({ error: 'Perfil não encontrado.' });
    const {
      enabled, follow_count,
      delay_minutes_1, delay_minutes_2, delay_minutes_3, delay_minutes_4,
      delay_minutes_5, delay_minutes_6, delay_minutes_7, delay_minutes_8,
      message_1, message_2, message_3, message_4, message_5, message_6, message_7, message_8,
      strategy
    } = req.body || {};
    const payload: any = {
      broker_id: brokerId,
      enabled: !!enabled,
      follow_count: Math.min(8, Math.max(1, Number(follow_count) || 3)),
      delay_minutes_1: Math.max(1, Number(delay_minutes_1) || 30),
      delay_minutes_2: Math.max(1, Number(delay_minutes_2) || 120),
      delay_minutes_3: Math.max(1, Number(delay_minutes_3) || 1440),
      delay_minutes_4: Math.max(1, Number(delay_minutes_4) || 20160),
      delay_minutes_5: Math.max(1, Number(delay_minutes_5) || 30240),
      delay_minutes_6: Math.max(1, Number(delay_minutes_6) || 40320),
      delay_minutes_7: Math.max(1, Number(delay_minutes_7) || 50400),
      delay_minutes_8: Math.max(1, Number(delay_minutes_8) || 60480),
      message_1: message_1 ?? null,
      message_2: message_2 ?? null,
      message_3: message_3 ?? null,
      message_4: message_4 ?? null,
      message_5: message_5 ?? null,
      message_6: message_6 ?? null,
      message_7: message_7 ?? null,
      message_8: message_8 ?? null,
      strategy: strategy || 'progressive',
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('followup_config')
      .upsert(payload, { onConflict: 'broker_id' }).select().single();
    if (error) throw error;
    res.json({ success: true, config: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// [N8N] Cliente enviou mensagem → re-arma o timer; retorna { respond }.
// Se respond=false (handover humano ativo), o agente N8N deve PARAR de responder.
// Auth: Bearer INTERNAL_PROXY_TOKEN. Body: { broker_phone, customer_phone }.
followupRouter.post('/api/followup/inbound', requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const customerPhone = normalizePhoneBR(String(req.body?.customer_phone || '').split(':')[0]);
    if (!customerPhone) {
      return res.status(400).json({ error: 'customer_phone é obrigatório.' });
    }
    // Aceita broker_id direto (estável) ou fallback para broker_phone (quebra se trocar número)
    let _brokerId: string | null = req.body?.broker_id || null;
    if (!_brokerId) {
      const brokerPhone = normalizePhoneBR(String(req.body?.broker_phone || '').split(':')[0]);
      if (brokerPhone) {
        const { data: b } = await supabase.from('imf_brokers').select('id').eq('phone', brokerPhone).maybeSingle();
        _brokerId = b?.id || null;
      }
    }
    if (!_brokerId) return res.json({ respond: true }); // corretor não encontrado: não bloqueia o agente
    const broker = { id: _brokerId };

    const incomingTicketId = String(req.body?.ticket_id || '').trim() || null;
    const activityAt = new Date().toISOString();

    const { data: conv } = await supabase.from('followup_conversations')
      .select('ai_active, human_takeover_at, source_ticket_id')
      .eq('broker_id', broker.id).eq('customer_phone', customerPhone).maybeSingle();

    // Reativação automática opcional após handover (config.reactivate_after_minutes; null = nunca)
    let aiActive = conv?.ai_active ?? true;
    let reactivated = false;
    if (conv && aiActive === false) {
      const { data: cfg } = await supabase.from('followup_config')
        .select('reactivate_after_minutes').eq('broker_id', broker.id).maybeSingle();
      const mins = cfg?.reactivate_after_minutes;
      if (mins && conv.human_takeover_at &&
          (Date.now() - new Date(conv.human_takeover_at).getTime()) >= mins * 60000) {
        aiActive = true;
        reactivated = true;
      }
    }

    // Novo ticket = zera a contagem de follows. Mesma conversa = mantém o índice.
    // Regra: máximo 3 follows por ticket. O índice (follow_message_index) é o
    // contador absoluto e NÃO reseta quando o cliente responde — só reseta em
    // novo ticket. Assim: Follow 1 → 2 → 3 → para, independente de respostas.
    const isNewTicket = incomingTicketId && conv?.source_ticket_id &&
                        incomingTicketId !== conv.source_ticket_id;

    // O identificador recebido pode ser o ID legado do provedor. O ticket
    // nativo do PANTUS Real Estate sempre usa UUID próprio: ele permanece enquanto o
    // atendimento está pending/open e muda depois que o anterior é encerrado.
    const nativeTicket = await ensureConversationTicket({
      brokerId: broker.id,
      customerPhone,
      initialStatus: 'pending',
      aiActive,
      lastActivityAt: activityAt,
    });

    if (reactivated) {
      await supabase.from('imf_conversation_tickets').update({
        ai_active: true,
        human_takeover_at: null,
        updated_at: activityAt,
      }).eq('id', nativeTicket.id).eq('broker_id', broker.id);
    }

    await supabase.from('followup_conversations').upsert({
      broker_id: broker.id,
      customer_phone: customerPhone,
      ticket_id: nativeTicket.id,
      last_customer_message_at: activityAt,
      follow_sent: false, // re-arma o timer (permite próximo follow disparar)
      ai_active: aiActive,
      ...(incomingTicketId ? { source_ticket_id: incomingTicketId } : {}),
      ...(isNewTicket ? { follow_message_index: 0, human_takeover_at: null } : {}),
      updated_at: activityAt
    }, { onConflict: 'broker_id,customer_phone' });

    // Contabiliza atendimento: cada ticket_id único = 1 atendimento no ciclo de billing.
    // ON CONFLICT (broker_id, source_ticket_id) garante idempotência.
    if (incomingTicketId) {
      await supabase.from('imf_ticket_events').upsert({
        broker_id: broker.id,
        source_ticket_id: incomingTicketId,
        customer_phone: customerPhone,
      }, { onConflict: 'broker_id,source_ticket_id', ignoreDuplicates: true });
    }

    res.json({ respond: aiActive });
  } catch (err: any) {
    console.error('[Follow-up] inbound erro:', err.message);
    res.json({ respond: true }); // em erro, nunca bloqueia o agente
  }
});

// [N8N] Corretor respondeu manualmente → handover humano: interrompe o agente
// e pausa follow-ups naquela conversa. Auth: Bearer INTERNAL_PROXY_TOKEN.
followupRouter.post('/api/followup/broker-reply', requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const customerPhone = normalizePhoneBR(String(req.body?.customer_phone || '').split(':')[0]);
    if (!customerPhone) {
      return res.status(400).json({ error: 'customer_phone é obrigatório.' });
    }
    // Aceita broker_id direto (estável) ou fallback para broker_phone (quebra se trocar número)
    let _brokerId: string | null = req.body?.broker_id || null;
    if (!_brokerId) {
      const brokerPhone = normalizePhoneBR(String(req.body?.broker_phone || '').split(':')[0]);
      if (brokerPhone) {
        const { data: b } = await supabase.from('imf_brokers').select('id').eq('phone', brokerPhone).maybeSingle();
        _brokerId = b?.id || null;
      }
    }
    if (!_brokerId) return res.json({ success: true });

    await pauseAiForHumanTakeover(_brokerId, customerPhone);

    res.json({ success: true, paused: true });
  } catch (err: any) {
    console.error('[Follow-up] broker-reply erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});
