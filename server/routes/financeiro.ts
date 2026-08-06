import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { requireAccountCapability } from "../services/accountCapabilities";
import { hasPermission } from "../services/permissions";
import { effectiveRentalPaymentStatus, type RentalPaymentStatus } from "../services/rentalLedger";

export const financeiroRouter = express.Router();

financeiroRouter.use("/api/financeiro", requireUser, requireAccountCapability("finance"));

// Etapa 8 do UX_MASTERPLAN.md — núcleo real: resumo agregando o que já existe
// (contratos de locação ativos + unidades vendidas em lançamentos + registros
// de recebimentos externos; Asaas de clientes permanece desligado). Carteira
// (imf_properties) fica de fora do agregado de propósito — o preço lá é
// texto livre digitado pelo corretor (ex.: "R$ 450.000"), não um número
// confiável de somar. Comissão e informe de rendimentos seguem de fora —
// dependem de um cadastro de comissão/regra fiscal que ainda não existe.
financeiroRouter.get("/api/financeiro/summary", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) {
      return res.json({
        rental_monthly_cents: 0, rental_active_count: 0,
        rental_overdue_count: 0, rental_overdue_cents: 0, rental_paid_this_month_cents: 0,
        sales_total_cents: 0, sales_count: 0, sales_by_development: [], recent_payments: [],
      });
    }

    const owner = await hasPermission(userId, brokerId, "financeiro", "gerenciar");

    // Aluguel (contrato/inadimplência/recebimento) não tem autor por
    // corretor — é caixa da empresa inteira, igual ao restante de Locação
    // (achado 2026-08-05, mesma trava aplicada lá: agora é financeiro:gerenciar
    // em vez de titularidade fixa). Venda de lançamento continua liberada
    // pro corretor que fechou (bloco abaixo).
    const { data: contracts, error: contractsError } = owner
      ? await supabase
          .from("imf_rental_contracts")
          .select("id, rent_amount_cents")
          .eq("broker_id", brokerId)
          .eq("status", "ativo")
      : { data: [] as { id: string; rent_amount_cents: number }[], error: null };
    if (contractsError) throw contractsError;

    const { data: developments, error: devError } = await supabase
      .from("imf_developments")
      .select("id, name")
      .eq("broker_id", brokerId);
    if (devError) throw devError;
    const devIds = (developments || []).map((d: any) => d.id);
    const devNameById = new Map((developments || []).map((d: any) => [d.id, d.name]));

    let soldUnits: any[] = [];
    if (devIds.length > 0) {
      // Catálogo de unidades é compartilhado com a equipe, mas a receita
      // atribuída só conta pra quem fechou a venda — dono vê o total da
      // conta, corretor só a própria.
      let unitsQuery = supabase.from("imf_units").select("price_cents, development_id").in("development_id", devIds).eq("status", "vendido");
      if (!owner) unitsQuery = unitsQuery.eq("sold_by_user_id", userId);
      const { data, error } = await unitsQuery;
      if (error) throw error;
      soldUnits = data || [];
    }

    // Quebra por empreendimento — só aparece quem tem venda (empreendimento
    // sem nenhuma unidade vendida ainda fica de fora, pra não poluir a lista).
    const byDevMap = new Map<string, { id: string; name: string; sales_total_cents: number; sales_count: number }>();
    for (const u of soldUnits) {
      const entry = byDevMap.get(u.development_id) || { id: u.development_id, name: devNameById.get(u.development_id) || "Empreendimento", sales_total_cents: 0, sales_count: 0 };
      entry.sales_total_cents += u.price_cents || 0;
      entry.sales_count += 1;
      byDevMap.set(u.development_id, entry);
    }
    const salesByDevelopment = Array.from(byDevMap.values()).sort((a, b) => b.sales_total_cents - a.sales_total_cents);

    // Inadimplência e fluxo declarado — a partir das competências de aluguel
    // e recebimentos registrados em Locação. Enforcement lazy de "overdue"
    // (mesmo padrão do locacao.ts): pending com vencimento passado conta como
    // atrasado mesmo que o webhook do Asaas ainda não tenha confirmado.
    const contractIds = (contracts || []).map((c: any) => c.id);
    let overdueCount = 0;
    let overdueCents = 0;
    let paidThisMonthCents = 0;
    let recentPayments: any[] = [];

    if (contractIds.length > 0) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthIso = monthStart.toISOString().split("T")[0];
      const today = new Date().toISOString().split("T")[0];

      const { data: monthPayments } = await supabase
        .from("imf_rental_payments")
        .select("status, due_date, amount_cents, amount_paid_cents")
        .in("contract_id", contractIds)
        .eq("reference_month", monthIso);

      for (const p of monthPayments || []) {
        const effectiveStatus = effectiveRentalPaymentStatus(p.status as RentalPaymentStatus, p.due_date, today);
        if (effectiveStatus === "overdue") {
          overdueCount++;
          overdueCents += Math.max(0, (p.amount_cents || 0) - (p.amount_paid_cents || 0));
        }
      }

      const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).toISOString();
      const { data: monthReceipts, error: receiptsError } = await supabase
        .from("imf_rental_payment_receipts")
        .select("amount_cents")
        .in("contract_id", contractIds)
        .gte("received_at", monthStart.toISOString())
        .lt("received_at", nextMonth);
      if (receiptsError) throw receiptsError;
      paidThisMonthCents = (monthReceipts || []).reduce(
        (total: number, receipt: any) => total + (receipt.amount_cents || 0),
        0,
      );

      // Preserva o histórico legado que foi confirmado pelo webhook da conta
      // própria antes da trava de produto. Nunca mistura registros externos,
      // que já foram somados pelos recibos acima.
      const { data: legacyAsaasPaid, error: legacyAsaasError } = await supabase
        .from("imf_rental_payments")
        .select("amount_cents")
        .in("contract_id", contractIds)
        .eq("source", "asaas")
        .eq("status", "paid")
        .gte("paid_at", monthStart.toISOString())
        .lt("paid_at", nextMonth);
      if (legacyAsaasError) throw legacyAsaasError;
      paidThisMonthCents += (legacyAsaasPaid || []).reduce(
        (total: number, payment: any) => total + (payment.amount_cents || 0),
        0,
      );

      const { data: recent } = await supabase
        .from("imf_rental_payments")
        .select("id, status, due_date, paid_at, amount_cents, amount_paid_cents, reference_month, imf_rental_contracts(tenant_name)")
        .in("contract_id", contractIds)
        .order("reference_month", { ascending: false })
        .limit(12);

      recentPayments = (recent || []).map((p: any) => ({
        id: p.id,
        tenant_name: p.imf_rental_contracts?.tenant_name || null,
        amount_cents: p.amount_cents,
        amount_paid_cents: p.amount_paid_cents || 0,
        status: effectiveRentalPaymentStatus(p.status as RentalPaymentStatus, p.due_date, today),
        due_date: p.due_date,
        paid_at: p.paid_at,
        reference_month: p.reference_month,
      }));
    }

    res.json({
      rental_monthly_cents: (contracts || []).reduce((sum: number, c: any) => sum + (c.rent_amount_cents || 0), 0),
      rental_active_count: (contracts || []).length,
      rental_overdue_count: overdueCount,
      rental_overdue_cents: overdueCents,
      rental_paid_this_month_cents: paidThisMonthCents,
      sales_total_cents: soldUnits.reduce((sum: number, u: any) => sum + (u.price_cents || 0), 0),
      sales_count: soldUnits.length,
      sales_by_development: salesByDevelopment,
      recent_payments: recentPayments,
    });
  } catch (err: any) {
    console.error("Erro GET /api/financeiro/summary:", err);
    res.status(500).json({ error: err.message });
  }
});
