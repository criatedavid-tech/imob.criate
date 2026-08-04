import express from "express";
import { supabase } from "../supabase";
import { requireInternalToken } from "../middleware/internalAuth";
import { n8nInternalLimiter } from "../middleware/rateLimits";
import { normalizePhoneBR } from "../lib/crypto";
import {
  computeLateAmount,
  formatBRL,
  getRentalAiSettings,
  logRentalEvent,
  escalateContractToHuman,
} from "../services/rentalAutopilot";

// ─────────────────────────────────────────────────────────────────────────
// Ferramentas da IA de cobrança de aluguel (chamadas pelo fluxo do n8n).
//
// Princípio: a IA CONVERSA, o backend DECIDE. Nenhuma rota aqui aceita valor,
// desconto ou data vindos do modelo — todos os números são calculados a partir
// do contrato. O que a IA pode fazer é limitado pela alçada da conta
// (imf_rental_ai_settings), não pelo prompt: mesmo que o modelo seja
// convencido a "liberar um desconto", a rota recusa.
// ─────────────────────────────────────────────────────────────────────────

export const rentalAgentRouter = express.Router();

async function findActiveContractByPhone(brokerId: string, phone: string) {
  const normalized = normalizePhoneBR(phone);
  const { data } = await supabase
    .from("imf_rental_contracts")
    .select("id, broker_id, tenant_name, tenant_phone, rent_amount_cents, due_day, status, late_fee_percent, monthly_interest_percent, autopilot_enabled, property_id, end_date, adjustment_index, next_adjustment_date")
    .eq("broker_id", brokerId)
    .eq("status", "ativo")
    .limit(200);
  if (!data?.length) return null;
  return data.find((c: any) => normalizePhoneBR(c.tenant_phone || "") === normalized) || null;
}

async function openPaymentsFor(contractId: string) {
  const { data } = await supabase
    .from("imf_rental_payments")
    .select("id, reference_month, amount_cents, due_date, status, boleto_url, pix_copy_paste, promise_date")
    .eq("contract_id", contractId)
    .in("status", ["pending", "overdue"])
    .order("due_date", { ascending: true })
    .limit(12);
  return data || [];
}

// Contexto completo para o agente iniciar a conversa já sabendo de tudo.
// Devolve texto pronto além dos números: reduz a chance de o modelo montar
// uma frase errada com dado certo.
rentalAgentRouter.get("/api/locacao/n8n/context", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const brokerId = String(req.query.broker_id || "");
    const phone = String(req.query.phone || "");
    if (!brokerId || !phone) return res.status(400).json({ error: "broker_id e phone são obrigatórios." });

    const contract = await findActiveContractByPhone(brokerId, phone);
    if (!contract) return res.json({ is_tenant: false });

    const settings = await getRentalAiSettings(brokerId);
    const payments = await openPaymentsFor(contract.id);
    const now = new Date();

    const abertos = payments.map((p: any) => {
      const late = computeLateAmount(p.amount_cents, p.due_date, contract.late_fee_percent, contract.monthly_interest_percent, now);
      return {
        payment_id: p.id,
        vencimento: p.due_date,
        dias_em_atraso: late.daysLate,
        valor_original: formatBRL(p.amount_cents),
        valor_atualizado: formatBRL(late.totalCents),
        multa: formatBRL(late.lateFeeCents),
        juros: formatBRL(late.interestCents),
        tem_pix: !!p.pix_copy_paste,
        promessa_registrada: p.promise_date,
      };
    });

    res.json({
      is_tenant: true,
      contrato: {
        id: contract.id,
        inquilino: contract.tenant_name,
        aluguel: formatBRL(contract.rent_amount_cents),
        dia_vencimento: contract.due_day,
        fim_contrato: contract.end_date,
        proximo_reajuste: contract.next_adjustment_date,
      },
      cobrancas_em_aberto: abertos,
      // A alçada vai no contexto para o prompt saber o que pode oferecer —
      // mas quem impede de verdade são as rotas de ação abaixo.
      alcada: {
        pode_enviar_segunda_via: settings.can_send_second_copy,
        pode_registrar_promessa: settings.can_register_promise,
        prazo_maximo_promessa_dias: settings.max_promise_days,
        pode_dar_desconto: settings.can_offer_discount,
        desconto_maximo_percent: settings.max_discount_percent,
        pode_parcelar: settings.can_offer_installments,
      },
    });
  } catch (err: any) {
    console.error("Erro GET /api/locacao/n8n/context:", err);
    res.status(500).json({ error: "Falha ao carregar o contexto da locação." });
  }
});

// 2ª via: devolve o PIX/boleto que JÁ existe. Não gera cobrança nova (gerar
// cobrança é decisão do motor, não da conversa).
rentalAgentRouter.post("/api/locacao/n8n/second-copy", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const { broker_id, phone } = req.body || {};
    if (!broker_id || !phone) return res.status(400).json({ error: "broker_id e phone são obrigatórios." });

    const settings = await getRentalAiSettings(broker_id);
    if (!settings.can_send_second_copy) return res.status(403).json({ error: "Envio de 2ª via não está liberado para esta conta." });

    const contract = await findActiveContractByPhone(broker_id, phone);
    if (!contract) return res.status(404).json({ error: "Contrato de locação não encontrado para este telefone." });

    const payments = await openPaymentsFor(contract.id);
    if (!payments.length) return res.json({ tem_cobranca_aberta: false });

    const p: any = payments[0];
    const late = computeLateAmount(p.amount_cents, p.due_date, contract.late_fee_percent, contract.monthly_interest_percent);

    await logRentalEvent({
      brokerId: broker_id,
      contractId: contract.id,
      paymentId: p.id,
      type: "segunda_via_enviada",
      actor: "ia",
      description: `2ª via enviada pela IA — ${formatBRL(late.totalCents)}, vencimento ${p.due_date}.`,
    });

    res.json({
      tem_cobranca_aberta: true,
      vencimento: p.due_date,
      valor_atualizado: formatBRL(late.totalCents),
      dias_em_atraso: late.daysLate,
      pix_copia_e_cola: p.pix_copy_paste,
      boleto_url: p.boleto_url,
    });
  } catch (err: any) {
    console.error("Erro POST /api/locacao/n8n/second-copy:", err);
    res.status(500).json({ error: "Falha ao obter a 2ª via." });
  }
});

// Promessa de pagamento: pausa a régua até a data combinada. A data é validada
// contra a alçada — a IA não pode "dar" 60 dias porque foi convencida.
rentalAgentRouter.post("/api/locacao/n8n/promise", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const { broker_id, phone, promise_date } = req.body || {};
    if (!broker_id || !phone || !promise_date) {
      return res.status(400).json({ error: "broker_id, phone e promise_date são obrigatórios." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(promise_date))) {
      return res.status(400).json({ error: "promise_date deve estar no formato AAAA-MM-DD." });
    }

    const settings = await getRentalAiSettings(broker_id);
    if (!settings.can_register_promise) return res.status(403).json({ error: "Registro de promessa não está liberado para esta conta." });

    const today = new Date();
    const promise = new Date(`${promise_date}T12:00:00-03:00`);
    const days = Math.ceil((promise.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return res.status(400).json({ error: "A data combinada não pode ser no passado." });
    if (days > settings.max_promise_days) {
      return res.status(403).json({
        error: `Prazo acima da alçada (máximo ${settings.max_promise_days} dias). Transfira para um responsável.`,
        max_dias: settings.max_promise_days,
      });
    }

    const contract = await findActiveContractByPhone(broker_id, phone);
    if (!contract) return res.status(404).json({ error: "Contrato não encontrado." });
    const payments = await openPaymentsFor(contract.id);
    if (!payments.length) return res.json({ ok: false, motivo: "Não há cobrança em aberto." });

    const p: any = payments[0];
    await supabase.from("imf_rental_payments")
      .update({ promise_date, promise_registered_at: new Date().toISOString() })
      .eq("id", p.id);

    await logRentalEvent({
      brokerId: broker_id,
      contractId: contract.id,
      paymentId: p.id,
      type: "promessa_registrada",
      actor: "ia",
      description: `Inquilino se comprometeu a pagar em ${promise_date.split("-").reverse().join("/")}. Cobrança pausada até lá.`,
      metadata: { promise_date },
    });

    res.json({ ok: true, promessa_ate: promise_date });
  } catch (err: any) {
    console.error("Erro POST /api/locacao/n8n/promise:", err);
    res.status(500).json({ error: "Falha ao registrar a promessa." });
  }
});

// A IA reconhece que o caso saiu do alcance dela (contestação, rescisão, tom
// jurídico, pedido fora da alçada) e passa para o humano.
rentalAgentRouter.post("/api/locacao/n8n/escalate", requireInternalToken, n8nInternalLimiter, async (req, res) => {
  try {
    const { broker_id, phone, reason } = req.body || {};
    if (!broker_id || !phone) return res.status(400).json({ error: "broker_id e phone são obrigatórios." });

    const contract = await findActiveContractByPhone(broker_id, phone);
    if (!contract) return res.status(404).json({ error: "Contrato não encontrado." });

    await escalateContractToHuman(
      contract as any,
      null,
      `Transferido pela IA: ${String(reason || "sem motivo informado").slice(0, 300)}`,
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro POST /api/locacao/n8n/escalate:", err);
    res.status(500).json({ error: "Falha ao transferir para atendimento humano." });
  }
});
