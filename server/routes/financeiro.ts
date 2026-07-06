import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";

export const financeiroRouter = express.Router();

// Etapa 8 do UX_MASTERPLAN.md — núcleo real: resumo agregando o que já existe
// (contratos de locação ativos + unidades vendidas em lançamentos). Carteira
// (imf_properties) fica de fora do agregado de propósito — o preço lá é
// texto livre digitado pelo corretor (ex.: "R$ 450.000"), não um número
// confiável de somar. Fluxo de caixa com data de cada movimento, comissão com
// pagamento real, inadimplência e informe de rendimentos ficam de fora —
// dependem de rastrear pagamento de aluguel de verdade, que a Etapa 6 não
// construiu de propósito (ver LocacaoArea.tsx).
financeiroRouter.get("/api/financeiro/summary", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) {
      return res.json({ rental_monthly_cents: 0, rental_active_count: 0, sales_total_cents: 0, sales_count: 0 });
    }

    const { data: contracts, error: contractsError } = await supabase
      .from("imf_rental_contracts")
      .select("rent_amount_cents")
      .eq("broker_id", brokerId)
      .eq("status", "ativo");
    if (contractsError) throw contractsError;

    const { data: developments, error: devError } = await supabase
      .from("imf_developments")
      .select("id")
      .eq("broker_id", brokerId);
    if (devError) throw devError;
    const devIds = (developments || []).map((d: any) => d.id);

    let soldUnits: any[] = [];
    if (devIds.length > 0) {
      const { data, error } = await supabase
        .from("imf_units")
        .select("price_cents")
        .in("development_id", devIds)
        .eq("status", "vendido");
      if (error) throw error;
      soldUnits = data || [];
    }

    res.json({
      rental_monthly_cents: (contracts || []).reduce((sum: number, c: any) => sum + (c.rent_amount_cents || 0), 0),
      rental_active_count: (contracts || []).length,
      sales_total_cents: soldUnits.reduce((sum: number, u: any) => sum + (u.price_cents || 0), 0),
      sales_count: soldUnits.length,
    });
  } catch (err: any) {
    console.error("Erro GET /api/financeiro/summary:", err);
    res.status(500).json({ error: err.message });
  }
});
