import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { requireClientFinancialOperations } from "../middleware/clientFinancialOperations";
import { generateRentCharge } from "../services/rentalBilling";
import { requireAccountCapability } from "../services/accountCapabilities";

export const locacaoRouter = express.Router();

// A interface esconder o menu nao e autorizacao. Todas as rotas de locacao
// exigem a funcao efetivamente liberada para a conta.
locacaoRouter.use(requireUser, requireAccountCapability("rentals"));

// Etapa 6 do UX_MASTERPLAN.md — núcleo real: contrato de locação (CRUD +
// encerrar) + cobrança real de boleto/PIX via Asaas (mesmo padrão da
// assinatura). Reajuste/repasse/DIMOB/vistoria/portal ficam para depois.

locacaoRouter.get("/api/locacao/contracts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .select("*, imf_properties(title)")
      .eq("broker_id", brokerId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const contracts = data || [];
    const ids = contracts.map((c: any) => c.id);
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthIso = monthStart.toISOString().split("T")[0];

    // Status do pagamento do mês atual, por contrato — base real de
    // inadimplência (usada no cockpit da Imobiliária). null = ainda não gerou cobrança.
    // Enforcement lazy: se está "pending" mas o vencimento já passou, mostra
    // "overdue" na hora — não depende só do webhook do Asaas ter chegado
    // (mesmo padrão do grace_until em billing.ts).
    const today = new Date().toISOString().split("T")[0];
    const paymentByContract: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: payments } = await supabase
        .from("imf_rental_payments")
        .select("contract_id, status, due_date")
        .in("contract_id", ids)
        .eq("reference_month", monthIso);
      for (const p of payments || []) {
        paymentByContract[p.contract_id] = (p.status === "pending" && p.due_date < today) ? "overdue" : p.status;
      }
    }

    res.json(contracts.map((c: any) => ({
      ...c,
      property: c.imf_properties?.title || null,
      current_month_payment_status: paymentByContract[c.id] || null,
    })));
  } catch (err: any) {
    console.error("Erro GET /api/locacao/contracts:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.post("/api/locacao/contracts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const {
      property_id, tenant_name, tenant_phone, tenant_cpf_cnpj, owner_name, owner_phone,
      rent_amount_cents, due_day, start_date, end_date, notes,
    } = req.body;

    if (!tenant_name || !owner_name) {
      return res.status(400).json({ error: "tenant_name e owner_name são obrigatórios." });
    }
    if (!rent_amount_cents || !due_day || !start_date) {
      return res.status(400).json({ error: "rent_amount_cents, due_day e start_date são obrigatórios." });
    }

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .insert({
        broker_id: brokerId,
        property_id: property_id || null,
        tenant_name, tenant_phone: tenant_phone || null,
        tenant_cpf_cnpj: tenant_cpf_cnpj || null,
        owner_name, owner_phone: owner_phone || null,
        rent_amount_cents, due_day, start_date,
        end_date: end_date || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/locacao/contracts:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.patch("/api/locacao/contracts/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const allowed = [
      "tenant_name", "tenant_phone", "tenant_cpf_cnpj", "owner_name", "owner_phone",
      "rent_amount_cents", "due_day", "start_date", "end_date", "status", "notes",
    ];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .update(updates)
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(403).json({ error: "Acesso negado." });
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/locacao/contracts/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

async function ownsContract(brokerId: string, contractId: string): Promise<boolean> {
  const { data } = await supabase.from("imf_rental_contracts").select("id").eq("id", contractId).eq("broker_id", brokerId).maybeSingle();
  return !!data;
}

// Exclusão de verdade (não é só marcar "encerrado") — remove também as
// cobranças (imf_rental_payments) geradas pra esse contrato, senão ficam
// órfãs no banco.
locacaoRouter.delete("/api/locacao/contracts/:id", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsContract(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    await supabase.from("imf_rental_payments").delete().eq("contract_id", req.params.id);
    const { error } = await supabase.from("imf_rental_contracts").delete().eq("id", req.params.id).eq("broker_id", brokerId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/locacao/contracts/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.get("/api/locacao/contracts/:id/payments", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsContract(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    const { data, error } = await supabase
      .from("imf_rental_payments")
      .select("*")
      .eq("contract_id", req.params.id)
      .order("reference_month", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    console.error("Erro GET /api/locacao/contracts/:id/payments:", err);
    res.status(500).json({ error: err.message });
  }
});

// Gera boleto/PIX do mês atual pra esse contrato — chama a Asaas de verdade
// (ver server/services/rentalBilling.ts). Idempotente: se já existe cobrança
// pro mês, devolve a mesma em vez de duplicar.
locacaoRouter.post(
  "/api/locacao/contracts/:id/charge",
  requireUser,
  requireClientFinancialOperations,
  async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsContract(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    const result = await generateRentCharge(req.params.id, new Date());
    res.json(result.payment);
  } catch (err: any) {
    console.error("Erro POST /api/locacao/contracts/:id/charge:", err);
    res.status(400).json({ error: err.message });
  }
  },
);
