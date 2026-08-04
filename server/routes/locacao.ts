import express from "express";
import { z } from "zod";
import { supabase } from "../supabase";
import { requireUser, getBrokerId } from "../middleware/auth";
import { requireClientFinancialOperations } from "../middleware/clientFinancialOperations";
import { validateBody } from "../middleware/validate";
import { generateRentCharge } from "../services/rentalBilling";
import { getRentalAiSettings, logRentalEvent } from "../services/rentalAutopilot";
import { normalizePhoneBR } from "../lib/crypto";
import { requireAccountCapability } from "../services/accountCapabilities";
import { ClientAsaasAccountRequiredError } from "../services/asaasCredentials";
import {
  buildRentalCompetency,
  effectiveRentalPaymentStatus,
  type RentalPaymentStatus,
} from "../services/rentalLedger";

export const locacaoRouter = express.Router();

// A interface esconder o menu nao e autorizacao. Todas as rotas de locacao
// exigem a funcao efetivamente liberada para a conta.
locacaoRouter.use("/api/locacao", requireUser, requireAccountCapability("rentals"));

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data invalida.");
const percentSchema = z.number().min(0).max(100);
const nonNegativeCentsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableEmail = z.string().trim().email("E-mail invalido.").max(254).nullable().optional();

const tenantFields = {
  full_name: z.string().trim().min(2).max(160),
  phone: nullableText(30),
  email: nullableEmail,
  cpf_cnpj: z.string().regex(/^\d{11}(\d{3})?$/, "CPF/CNPJ invalido.").nullable().optional(),
  birth_date: dateSchema.nullable().optional(),
  emergency_contact_name: nullableText(160),
  emergency_contact_phone: nullableText(30),
  notes: nullableText(2000),
  status: z.enum(["ativo", "inativo"]).default("ativo"),
};

const tenantCreateSchema = z.object(tenantFields);
const tenantUpdateSchema = z.object({
  ...tenantFields,
  status: z.enum(["ativo", "inativo"]),
}).partial();

const contractFields = {
  property_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  tenant_name: z.string().trim().min(2).max(160),
  tenant_phone: nullableText(30),
  tenant_cpf_cnpj: nullableText(18),
  owner_name: z.string().trim().min(2).max(160),
  owner_phone: nullableText(30),
  rent_amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  due_day: z.number().int().min(1).max(28),
  start_date: dateSchema,
  end_date: dateSchema.nullable().optional(),
  notes: nullableText(2000),
  rental_type: z.enum(["residencial", "comercial", "temporada"]),
  administration_fee_percent: percentSchema,
  late_fee_percent: percentSchema,
  monthly_interest_percent: percentSchema,
  guarantee_type: z.enum(["sem_garantia", "caucao_dinheiro", "fiador", "seguro_fianca", "cessao_fiduciaria"]),
  guarantee_amount_cents: nonNegativeCentsSchema,
  guarantee_notes: nullableText(500),
  iptu_amount_cents: nonNegativeCentsSchema,
  iptu_payer: z.enum(["inquilino", "proprietario"]),
  condominium_amount_cents: nonNegativeCentsSchema,
  condominium_payer: z.enum(["inquilino", "proprietario"]),
  fire_insurance_amount_cents: nonNegativeCentsSchema,
  fire_insurance_payer: z.enum(["inquilino", "proprietario"]),
  other_charges_description: nullableText(120),
  other_charges_cents: nonNegativeCentsSchema,
  other_charges_payer: z.enum(["inquilino", "proprietario"]),
  adjustment_index: z.enum(["sem_reajuste", "ipca", "igpm", "outro"]),
  adjustment_interval_months: z.number().int().min(1).max(60),
  next_adjustment_date: dateSchema.nullable().optional(),
};

const contractCreateSchema = z.object({
  ...contractFields,
  rental_type: contractFields.rental_type.default("residencial"),
  administration_fee_percent: contractFields.administration_fee_percent.default(0),
  late_fee_percent: contractFields.late_fee_percent.default(2),
  monthly_interest_percent: contractFields.monthly_interest_percent.default(1),
  guarantee_type: contractFields.guarantee_type.default("sem_garantia"),
  guarantee_amount_cents: contractFields.guarantee_amount_cents.default(0),
  iptu_amount_cents: contractFields.iptu_amount_cents.default(0),
  iptu_payer: contractFields.iptu_payer.default("proprietario"),
  condominium_amount_cents: contractFields.condominium_amount_cents.default(0),
  condominium_payer: contractFields.condominium_payer.default("inquilino"),
  fire_insurance_amount_cents: contractFields.fire_insurance_amount_cents.default(0),
  fire_insurance_payer: contractFields.fire_insurance_payer.default("proprietario"),
  other_charges_cents: contractFields.other_charges_cents.default(0),
  other_charges_payer: contractFields.other_charges_payer.default("inquilino"),
  adjustment_index: contractFields.adjustment_index.default("sem_reajuste"),
  adjustment_interval_months: contractFields.adjustment_interval_months.default(12),
});
const contractUpdateSchema = z.object(contractFields).partial().extend({
  status: z.enum(["ativo", "encerrado"]).optional(),
});

const competencyCreateSchema = z.object({
  reference_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competencia invalida."),
});

const externalReceiptSchema = z.object({
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  payment_method: z.enum(["pix", "transferencia", "boleto", "dinheiro", "cartao", "outro"]),
  received_at: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(500).optional().default(""),
});

function contractBusinessError(contract: Record<string, any>): string | null {
  if (contract.end_date && contract.end_date < contract.start_date) {
    return "A data final nao pode ser anterior ao inicio do contrato.";
  }
  if (
    contract.guarantee_type === "caucao_dinheiro"
    && contract.guarantee_amount_cents > contract.rent_amount_cents * 3
  ) {
    return "A caucao em dinheiro nao pode ultrapassar tres meses de aluguel.";
  }
  return null;
}

async function findTenantForBroker(brokerId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("imf_rental_tenants")
    .select("id, full_name, phone, email, cpf_cnpj, status")
    .eq("id", tenantId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ownsProperty(brokerId: string, propertyId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("imf_properties")
    .select("id")
    .eq("id", propertyId)
    .eq("broker_id", brokerId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

function tenantSnapshot(tenant: Record<string, any>) {
  return {
    tenant_id: tenant.id,
    tenant_name: tenant.full_name,
    tenant_phone: tenant.phone || null,
    tenant_cpf_cnpj: tenant.cpf_cnpj || null,
  };
}

// Contratos completos + competências e recebimentos externos declaratórios.
// A integração histórica de boleto/PIX continua atrás da trava de produto.
// Vistoria, documentos, manutenção, DIMOB e portal ficam para outras etapas.

// Cadastro reutilizavel de inquilinos. O historico contratual e montado a
// partir dos contratos vinculados e nunca e aceito um broker_id do cliente.
locacaoRouter.get("/api/locacao/tenants", async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.json([]);

    const { data: tenants, error: tenantsError } = await supabase
      .from("imf_rental_tenants")
      .select("*")
      .eq("broker_id", brokerId)
      .order("full_name", { ascending: true });
    if (tenantsError) throw tenantsError;

    const ids = (tenants || []).map((tenant: any) => tenant.id);
    let contracts: any[] = [];
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("imf_rental_contracts")
        .select("id, tenant_id, property_id, tenant_name, rent_amount_cents, start_date, end_date, status, imf_properties(title)")
        .eq("broker_id", brokerId)
        .in("tenant_id", ids)
        .order("start_date", { ascending: false });
      if (error) throw error;
      contracts = data || [];
    }

    const historyByTenant = new Map<string, any[]>();
    for (const contract of contracts) {
      const history = historyByTenant.get(contract.tenant_id) || [];
      history.push({
        id: contract.id,
        property_id: contract.property_id,
        property: contract.imf_properties?.title || null,
        rent_amount_cents: contract.rent_amount_cents,
        start_date: contract.start_date,
        end_date: contract.end_date,
        status: contract.status,
      });
      historyByTenant.set(contract.tenant_id, history);
    }

    return res.json((tenants || []).map((tenant: any) => ({
      ...tenant,
      contract_history: historyByTenant.get(tenant.id) || [],
    })));
  } catch (err: any) {
    console.error("Erro GET /api/locacao/tenants:", err);
    return res.status(500).json({ error: "Nao foi possivel carregar os inquilinos." });
  }
});

locacaoRouter.post(
  "/api/locacao/tenants",
  validateBody(tenantCreateSchema),
  async (req, res) => {
    try {
      const brokerId = await getBrokerId((req as any).userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });

      const { data, error } = await supabase
        .from("imf_rental_tenants")
        .insert({ broker_id: brokerId, ...req.body })
        .select()
        .single();
      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({ error: "Ja existe um inquilino com este CPF/CNPJ." });
        }
        throw error;
      }
      return res.status(201).json({ ...data, contract_history: [] });
    } catch (err: any) {
      console.error("Erro POST /api/locacao/tenants:", err);
      return res.status(500).json({ error: "Nao foi possivel cadastrar o inquilino." });
    }
  },
);

locacaoRouter.patch(
  "/api/locacao/tenants/:id",
  validateBody(tenantUpdateSchema),
  async (req, res) => {
    try {
      const brokerId = await getBrokerId((req as any).userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });

      const allowed = [
        "full_name", "phone", "email", "cpf_cnpj", "birth_date",
        "emergency_contact_name", "emergency_contact_phone", "notes", "status",
      ];
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      const { data, error } = await supabase
        .from("imf_rental_tenants")
        .update(updates)
        .eq("id", req.params.id)
        .eq("broker_id", brokerId)
        .select()
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({ error: "Ja existe um inquilino com este CPF/CNPJ." });
        }
        throw error;
      }
      if (!data) return res.status(404).json({ error: "Inquilino nao encontrado." });
      return res.json(data);
    } catch (err: any) {
      console.error("Erro PATCH /api/locacao/tenants/:id:", err);
      return res.status(500).json({ error: "Nao foi possivel atualizar o inquilino." });
    }
  },
);

locacaoRouter.delete("/api/locacao/tenants/:id", async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    const tenant = await findTenantForBroker(brokerId, req.params.id);
    if (!tenant) return res.status(404).json({ error: "Inquilino nao encontrado." });

    const { count, error: countError } = await supabase
      .from("imf_rental_contracts")
      .select("id", { count: "exact", head: true })
      .eq("broker_id", brokerId)
      .eq("tenant_id", req.params.id);
    if (countError) throw countError;
    if ((count || 0) > 0) {
      return res.status(409).json({
        error: "Este inquilino possui historico contratual. Marque-o como inativo em vez de apaga-lo.",
      });
    }

    const { error } = await supabase
      .from("imf_rental_tenants")
      .delete()
      .eq("id", req.params.id)
      .eq("broker_id", brokerId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/locacao/tenants/:id:", err);
    return res.status(500).json({ error: "Nao foi possivel apagar o inquilino." });
  }
});

locacaoRouter.get("/api/locacao/contracts", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json([]);

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .select("*, imf_properties(title), imf_rental_tenants(id, full_name, phone, email, cpf_cnpj, status)")
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
        paymentByContract[p.contract_id] = effectiveRentalPaymentStatus(
          p.status as RentalPaymentStatus,
          p.due_date,
          today,
        );
      }
    }

    res.json(contracts.map((c: any) => ({
      ...c,
      property: c.imf_properties?.title || null,
      tenant_profile: c.imf_rental_tenants || null,
      current_month_payment_status: paymentByContract[c.id] || null,
    })));
  } catch (err: any) {
    console.error("Erro GET /api/locacao/contracts:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.post("/api/locacao/contracts", requireUser, validateBody(contractCreateSchema), async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const {
      property_id, tenant_id, tenant_name, tenant_phone, tenant_cpf_cnpj, owner_name, owner_phone,
      rent_amount_cents, due_day, start_date, end_date, notes,
    } = req.body;

    if (property_id && !(await ownsProperty(brokerId, property_id))) {
      return res.status(400).json({ error: "Imovel invalido para esta conta." });
    }

    let linkedTenant: Record<string, any> | null = null;
    if (tenant_id) {
      linkedTenant = await findTenantForBroker(brokerId, tenant_id);
      if (!linkedTenant) return res.status(400).json({ error: "Inquilino invalido para esta conta." });
      if (linkedTenant.status !== "ativo") {
        return res.status(409).json({ error: "Reative o inquilino antes de criar um novo contrato." });
      }
    }

    const businessError = contractBusinessError(req.body);
    if (businessError) return res.status(400).json({ error: businessError });

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
        ...req.body,
        ...(linkedTenant ? tenantSnapshot(linkedTenant) : {}),
        property_id: property_id || null,
        tenant_name: linkedTenant?.full_name || tenant_name,
        tenant_phone: linkedTenant?.phone || tenant_phone || null,
        tenant_cpf_cnpj: linkedTenant?.cpf_cnpj || tenant_cpf_cnpj || null,
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

locacaoRouter.patch("/api/locacao/contracts/:id", requireUser, validateBody(contractUpdateSchema), async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: current, error: currentError } = await supabase
      .from("imf_rental_contracts")
      .select("*")
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return res.status(403).json({ error: "Acesso negado." });

    const businessError = contractBusinessError({ ...current, ...req.body });
    if (businessError) return res.status(400).json({ error: businessError });

    if (req.body.property_id && !(await ownsProperty(brokerId, req.body.property_id))) {
      return res.status(400).json({ error: "Imovel invalido para esta conta." });
    }

    let linkedTenant: Record<string, any> | null = null;
    if (req.body.tenant_id) {
      linkedTenant = await findTenantForBroker(brokerId, req.body.tenant_id);
      if (!linkedTenant) return res.status(400).json({ error: "Inquilino invalido para esta conta." });
    }

    const allowed = [
      "property_id", "tenant_id", "tenant_name", "tenant_phone", "tenant_cpf_cnpj", "owner_name", "owner_phone",
      "rent_amount_cents", "due_day", "start_date", "end_date", "status", "notes", "rental_type",
      "administration_fee_percent", "late_fee_percent", "monthly_interest_percent",
      "guarantee_type", "guarantee_amount_cents", "guarantee_notes",
      "iptu_amount_cents", "iptu_payer", "condominium_amount_cents", "condominium_payer",
      "fire_insurance_amount_cents", "fire_insurance_payer", "other_charges_description",
      "other_charges_cents", "other_charges_payer", "adjustment_index",
      "adjustment_interval_months", "next_adjustment_date",
    ];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (linkedTenant) Object.assign(updates, tenantSnapshot(linkedTenant));

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

// Exclusão definitiva existe somente enquanto não há histórico financeiro.
// Depois da primeira competência, preservar o histórico e encerrar o contrato.
locacaoRouter.delete("/api/locacao/contracts/:id", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    if (!(await ownsContract(brokerId, req.params.id))) return res.status(403).json({ error: "Acesso negado." });

    const { count: paymentCount, error: paymentCountError } = await supabase
      .from("imf_rental_payments")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", req.params.id);
    if (paymentCountError) throw paymentCountError;
    if ((paymentCount || 0) > 0) {
      return res.status(409).json({
        error: "Este contrato possui historico financeiro. Encerre o contrato em vez de apaga-lo.",
      });
    }

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

    const paymentIds = (data || []).map((payment: any) => payment.id);
    let receipts: any[] = [];
    if (paymentIds.length > 0) {
      const { data: receiptRows, error: receiptError } = await supabase
        .from("imf_rental_payment_receipts")
        .select("id, payment_id, amount_cents, payment_method, received_at, notes, created_at")
        .in("payment_id", paymentIds)
        .order("received_at", { ascending: false });
      if (receiptError) throw receiptError;
      receipts = receiptRows || [];
    }

    const receiptsByPayment = new Map<string, any[]>();
    for (const receipt of receipts) {
      const current = receiptsByPayment.get(receipt.payment_id) || [];
      current.push(receipt);
      receiptsByPayment.set(receipt.payment_id, current);
    }
    const today = new Date().toISOString().slice(0, 10);
    res.json((data || []).map((payment: any) => ({
      ...payment,
      status: effectiveRentalPaymentStatus(payment.status as RentalPaymentStatus, payment.due_date, today),
      remaining_cents: Math.max(0, payment.amount_cents - (payment.amount_paid_cents || 0)),
      receipts: receiptsByPayment.get(payment.id) || [],
    })));
  } catch (err: any) {
    console.error("Erro GET /api/locacao/contracts/:id/payments:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.post(
  "/api/locacao/contracts/:id/payments",
  requireUser,
  validateBody(competencyCreateSchema),
  async (req, res) => {
    try {
      const brokerId = await getBrokerId((req as any).userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });

      const { data: contract, error: contractError } = await supabase
        .from("imf_rental_contracts")
        .select("*")
        .eq("id", req.params.id)
        .eq("broker_id", brokerId)
        .maybeSingle();
      if (contractError) throw contractError;
      if (!contract) return res.status(403).json({ error: "Acesso negado." });

      let competency;
      try {
        competency = buildRentalCompetency(contract, req.body.reference_month);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }

      const { data: existing, error: existingError } = await supabase
        .from("imf_rental_payments")
        .select("id")
        .eq("contract_id", contract.id)
        .eq("reference_month", competency.reference_month)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return res.status(409).json({ error: "Esta competencia ja foi criada." });

      const { data, error } = await supabase
        .from("imf_rental_payments")
        .insert({
          contract_id: contract.id,
          ...competency,
          source: "external",
          billing_type: "EXTERNAL",
          status: "pending",
        })
        .select()
        .single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ error: "Esta competencia ja foi criada." });
        throw error;
      }

      res.status(201).json({
        ...data,
        status: effectiveRentalPaymentStatus(data.status, data.due_date),
        remaining_cents: data.amount_cents,
        receipts: [],
      });
    } catch (err: any) {
      console.error("Erro POST competencia de locacao:", err);
      res.status(500).json({ error: "Nao foi possivel criar a competencia." });
    }
  },
);

locacaoRouter.post(
  "/api/locacao/contracts/:contractId/payments/:paymentId/receipts",
  requireUser,
  validateBody(externalReceiptSchema),
  async (req, res) => {
    try {
      const userId = (req as any).userId as string;
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(403).json({ error: "Broker not found" });
      if (!(await ownsContract(brokerId, req.params.contractId))) {
        return res.status(403).json({ error: "Acesso negado." });
      }

      const receivedAt = new Date(req.body.received_at);
      if (receivedAt.getTime() > Date.now() + 5 * 60_000) {
        return res.status(400).json({ error: "A data do recebimento nao pode estar no futuro." });
      }

      const { data, error } = await supabase.rpc("imf_record_external_rental_receipt", {
        p_broker_id: brokerId,
        p_contract_id: req.params.contractId,
        p_payment_id: req.params.paymentId,
        p_amount_cents: req.body.amount_cents,
        p_payment_method: req.body.payment_method,
        p_received_at: req.body.received_at,
        p_notes: req.body.notes,
        p_actor_user_id: userId,
      });
      if (error) {
        const safeMessage = /valor recebido|saldo da competencia|nao aceita|nao podem ser confirmados/i.test(error.message)
          ? error.message
          : "Nao foi possivel registrar o pagamento.";
        return res.status(409).json({ error: safeMessage });
      }
      res.status(201).json(data);
    } catch (err: any) {
      console.error("Erro POST recebimento externo de locacao:", err);
      res.status(500).json({ error: "Nao foi possivel registrar o pagamento." });
    }
  },
);

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
    if (err instanceof ClientAsaasAccountRequiredError) {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    res.status(400).json({ error: err.message });
  }
  },
);

// ═════════════════════════════════════════════════════════════════════════
// PILOTO AUTOMÁTICO, DIÁRIO, CHAVES E DISPONÍVEIS
// Tudo escopado por broker_id do usuário autenticado — nunca por id vindo
// do cliente (mesma regra do resto do app).
// ═════════════════════════════════════════════════════════════════════════

// Painel da aba "Alugados": indicadores + série para os gráficos.
locacaoRouter.get("/api/locacao/dashboard", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: contracts } = await supabase
      .from("imf_rental_contracts")
      .select("id, status, rent_amount_cents, administration_fee_percent, autopilot_enabled, tenant_name, due_day, next_adjustment_date")
      .eq("broker_id", brokerId)
      .limit(1000);
    const ativos = (contracts || []).filter((c: any) => c.status === "ativo");
    const contractIds = ativos.map((c: any) => c.id);

    const hoje = new Date();
    const seisMesesAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1).toISOString().slice(0, 10);

    const { data: payments } = contractIds.length
      ? await supabase
          .from("imf_rental_payments")
          .select("id, contract_id, amount_cents, amount_paid_cents, due_date, status, paid_at, reference_month, dunning_step, promise_date, escalated_at")
          .in("contract_id", contractIds)
          .gte("reference_month", seisMesesAtras)
          .limit(2000)
      : { data: [] as any[] };

    const hojeIso = hoje.toISOString().slice(0, 10);
    const abertos = (payments || []).filter((p: any) => ["pending", "overdue"].includes(p.status));
    const atrasados = abertos.filter((p: any) => p.due_date < hojeIso);

    const receitaPrevista = ativos.reduce((s: number, c: any) => s + (c.rent_amount_cents || 0), 0);
    const taxaAdmin = ativos.reduce(
      (s: number, c: any) => s + Math.round((c.rent_amount_cents || 0) * (Number(c.administration_fee_percent) || 0) / 100), 0);

    // Série dos últimos 6 meses: previsto x recebido (para o gráfico).
    const serie: { mes: string; previsto: number; recebido: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const doMes = (payments || []).filter((p: any) => String(p.reference_month || "").slice(0, 7) === key);
      serie.push({
        mes: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        previsto: doMes.reduce((s: number, p: any) => s + (p.amount_cents || 0), 0),
        recebido: doMes.filter((p: any) => p.status === "paid")
          .reduce((s: number, p: any) => s + (p.amount_paid_cents || p.amount_cents || 0), 0),
      });
    }

    const totalMes = serie[serie.length - 1];
    const inadimplencia = totalMes && totalMes.previsto > 0
      ? Math.round(((totalMes.previsto - totalMes.recebido) / totalMes.previsto) * 100)
      : 0;

    res.json({
      contratos_ativos: ativos.length,
      contratos_total: (contracts || []).length,
      autopilot_ativos: ativos.filter((c: any) => c.autopilot_enabled).length,
      receita_mensal_cents: receitaPrevista,
      taxa_admin_mensal_cents: taxaAdmin,
      em_aberto_qtd: abertos.length,
      em_aberto_cents: abertos.reduce((s: number, p: any) => s + (p.amount_cents || 0), 0),
      atrasados_qtd: atrasados.length,
      atrasados_cents: atrasados.reduce((s: number, p: any) => s + (p.amount_cents || 0), 0),
      com_promessa_qtd: abertos.filter((p: any) => p.promise_date).length,
      escalados_qtd: abertos.filter((p: any) => p.escalated_at).length,
      inadimplencia_percent: inadimplencia,
      serie_6_meses: serie,
      reajustes_proximos: ativos
        .filter((c: any) => c.next_adjustment_date && c.next_adjustment_date <= new Date(hoje.getTime() + 60 * 86400000).toISOString().slice(0, 10))
        .map((c: any) => ({ id: c.id, tenant_name: c.tenant_name, next_adjustment_date: c.next_adjustment_date })),
    });
  } catch (err: any) {
    console.error("Erro GET /api/locacao/dashboard:", err);
    res.status(500).json({ error: err.message });
  }
});

// Diário do contrato: tudo que aconteceu, do sistema, da IA e do humano.
locacaoRouter.get("/api/locacao/contracts/:id/events", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    const { data, error } = await supabase
      .from("imf_rental_events")
      .select("id, event_type, actor, description, metadata, created_at")
      .eq("broker_id", brokerId)
      .eq("contract_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Liga/desliga o piloto automático de UM contrato (kill-switch individual —
// é o que permite pilotar um contrato antes de liberar a carteira toda).
locacaoRouter.patch("/api/locacao/contracts/:id/autopilot", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    const enabled = !!req.body?.enabled;

    const { data, error } = await supabase
      .from("imf_rental_contracts")
      .update({ autopilot_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .select("id, autopilot_enabled")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Contrato não encontrado." });

    await logRentalEvent({
      brokerId,
      contractId: req.params.id,
      type: enabled ? "autopilot_ligado" : "autopilot_desligado",
      actor: "humano",
      description: enabled
        ? "Piloto automático ligado: cobrança e régua passam a rodar sozinhas."
        : "Piloto automático desligado: nenhuma cobrança automática será enviada.",
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Alçada da IA de cobrança (o que ela pode fazer sem perguntar).
locacaoRouter.get("/api/locacao/ai-settings", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    res.json(await getRentalAiSettings(brokerId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.patch("/api/locacao/ai-settings", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const allowed = [
      "enabled", "charge_generation_enabled", "dunning_enabled", "can_send_second_copy",
      "can_register_promise", "max_promise_days", "can_offer_discount", "max_discount_percent",
      "can_offer_installments", "escalate_after_silent_steps", "quiet_hours_start", "quiet_hours_end",
    ] as const;
    const payload: Record<string, any> = { broker_id: brokerId, updated_at: new Date().toISOString() };
    for (const key of allowed) if (req.body?.[key] !== undefined) payload[key] = req.body[key];

    const { data, error } = await supabase
      .from("imf_rental_ai_settings")
      .upsert(payload, { onConflict: "broker_id" })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Aba "Disponíveis": funil do imóvel vago ────────────────────────────────
locacaoRouter.get("/api/locacao/available", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { data: properties } = await supabase
      .from("imf_properties")
      .select("id, title, location, price, status, image_url, created_at, slug")
      .eq("broker_id", brokerId)
      .eq("status", "disponivel")
      .order("created_at", { ascending: false })
      .limit(200);
    const list = properties || [];
    if (!list.length) return res.json([]);

    const ids = list.map((p: any) => p.id);
    const nowIso = new Date().toISOString();

    const [{ data: leads }, { data: visits }, { data: keys }] = await Promise.all([
      supabase.from("leads").select("id, property_id, name, phone, status, created_at").in("property_id", ids).limit(2000),
      supabase.from("imf_agenda").select("id, property_id, client_name, scheduled_at, status")
        .in("property_id", ids).gte("scheduled_at", nowIso).limit(500),
      supabase.from("imf_property_keys").select("id, property_id, holder_name, holder_phone, due_at, taken_at, purpose")
        .in("property_id", ids).is("returned_at", null).limit(200),
    ]);

    const byProp = (rows: any[] | null): Map<string, any[]> => {
      const m = new Map<string, any[]>();
      for (const r of rows || []) {
        const arr = m.get(r.property_id) || [];
        arr.push(r);
        m.set(r.property_id, arr);
      }
      return m;
    };
    const leadsMap = byProp(leads as any);
    const visitsMap = byProp(visits as any);
    const keysMap = byProp(keys as any);

    res.json(list.map((p: any) => {
      const propLeads = leadsMap.get(p.id) || [];
      const propVisits = (visitsMap.get(p.id) || []).sort(
        (a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
      const key = (keysMap.get(p.id) || [])[0] || null;
      const diasVago = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000);
      const ultimoLead = propLeads.length
        ? propLeads.map((l: any) => l.created_at).sort().reverse()[0]
        : null;

      return {
        id: p.id,
        title: p.title,
        location: p.location,
        price: p.price,
        slug: p.slug,
        image_url: p.image_url,
        dias_vago: diasVago,
        interessados: propLeads.length,
        dias_sem_lead: ultimoLead ? Math.floor((Date.now() - new Date(ultimoLead).getTime()) / 86_400_000) : null,
        visitas_agendadas: propVisits.length,
        proxima_visita: propVisits[0]
          ? { quando: propVisits[0].scheduled_at, cliente: propVisits[0].client_name }
          : null,
        chave: key
          ? {
              id: key.id,
              com: key.holder_name,
              telefone: key.holder_phone,
              finalidade: key.purpose,
              retirada_em: key.taken_at,
              prevista_para: key.due_at,
              atrasada: !!key.due_at && key.due_at < nowIso,
            }
          : null,
      };
    }));
  } catch (err: any) {
    console.error("Erro GET /api/locacao/available:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Controle de chaves ─────────────────────────────────────────────────────
locacaoRouter.post("/api/locacao/keys", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });

    const { property_id, holder_name, holder_phone, purpose, due_at, notes } = req.body || {};
    if (!property_id || !holder_name?.trim()) {
      return res.status(400).json({ error: "Informe o imóvel e com quem está a chave." });
    }
    const { data: property } = await supabase
      .from("imf_properties").select("id").eq("id", property_id).eq("broker_id", brokerId).maybeSingle();
    if (!property) return res.status(404).json({ error: "Imóvel não encontrado." });

    const { data, error } = await supabase.from("imf_property_keys").insert({
      broker_id: brokerId,
      property_id,
      holder_name: String(holder_name).trim().slice(0, 120),
      holder_phone: holder_phone ? normalizePhoneBR(String(holder_phone)) : null,
      purpose: ["visita", "vistoria", "obra", "outro"].includes(purpose) ? purpose : "visita",
      due_at: due_at || null,
      notes: notes ? String(notes).slice(0, 500) : null,
    }).select().single();

    if (error) {
      // O índice único garante uma chave em aberto por imóvel: sem isso, dois
      // registros simultâneos fariam a chave "estar" em dois lugares.
      if ((error as any).code === "23505") {
        return res.status(409).json({ error: "Já existe uma chave em aberto para este imóvel. Registre a devolução antes." });
      }
      throw error;
    }
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/locacao/keys:", err);
    res.status(500).json({ error: err.message });
  }
});

locacaoRouter.patch("/api/locacao/keys/:id/return", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    const { data, error } = await supabase
      .from("imf_property_keys")
      .update({ returned_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("broker_id", brokerId)
      .is("returned_at", null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Registro de chave não encontrado ou já devolvido." });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Histórico de chaves de um imóvel (quem teve acesso, quando).
locacaoRouter.get("/api/locacao/keys", requireUser, async (req, res) => {
  try {
    const brokerId = await getBrokerId((req as any).userId);
    if (!brokerId) return res.status(403).json({ error: "Broker not found" });
    let query = supabase.from("imf_property_keys")
      .select("id, property_id, holder_name, holder_phone, purpose, taken_at, due_at, returned_at, notes")
      .eq("broker_id", brokerId);
    if (typeof req.query.property_id === "string") query = query.eq("property_id", req.query.property_id);
    const { data, error } = await query.order("taken_at", { ascending: false }).limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
