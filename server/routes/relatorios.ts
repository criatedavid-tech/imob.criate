import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { hasPermission } from "../services/permissions";

export const relatoriosRouter = express.Router();

const BR_TIME_ZONE = "America/Sao_Paulo";
const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 100;
const REPORT_STAGES = new Set(["new", "contato", "visita", "proposta", "fechado"]);

type PageResult = { data: any[] | null; error: any };

// Exportados pra server/routes/equipe.ts reaproveitar (GET /api/equipe/
// performance) sem duplicar paginação/janela de período.
export async function collectPages(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
  context: string,
): Promise<any[]> {
  const rows: any[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${context}: ${error.message || "falha na consulta"}`);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

export async function collectForIds(
  ids: string[],
  fetchChunk: (idsChunk: string[], from: number, to: number) => PromiseLike<PageResult>,
  context: string,
): Promise<any[]> {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
    rows.push(...await collectPages((from, to) => fetchChunk(chunk, from, to), context));
  }
  return rows;
}

function brYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BR_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month) };
}

export function reportPeriod(months: number, now = new Date()) {
  const current = brYearMonth(now);
  // São Paulo está em UTC-3. O início fica em 00:00 BRT do primeiro mês
  // incluído; o fim é o instante atual, portanto visitas futuras não entram.
  const start = new Date(Date.UTC(current.year, current.month - months, 1, 3, 0, 0, 0));
  return { start, end: now };
}

function monthKey(date: Date): string {
  const parts = brYearMonth(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function makeMonthBuckets(start: Date, months: number) {
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = 0; i < months; i++) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 15, 12));
    buckets.push({
      key: monthKey(date),
      label: date.toLocaleDateString("pt-BR", { month: "short", timeZone: BR_TIME_ZONE }),
      count: 0,
    });
  }
  return buckets;
}

function emptySummary(months: number, start: Date, end: Date) {
  return {
    months,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    scope: "personal",
    totalLeads: 0,
    closedLeads: 0,
    convertedLeads: 0,
    conversionRate: 0,
    byStage: {},
    byMonth: makeMonthBuckets(start, months).map(({ label, count }) => ({ label, count })),
    revenueCents: 0,
    rentalPaidCents: 0,
    rentalPaymentsCount: 0,
    rentalMonthlyCents: 0,
    salesTotalCents: 0,
    salesCount: 0,
    visitsDone: 0,
    visitsScheduled: 0,
    visitsCancelled: 0,
    visitsTotal: 0,
  };
}

// Relatório determinístico: cada número vem do Supabase e usa a mesma janela
// de calendário (3/6/12 meses) quando representa fluxo. Carteira mensal ativa
// é explicitamente um snapshot atual, não uma receita acumulada do período.
// Extraída pra função pura (Fase 6 do WhatsApp Pai) pra ser reaproveitada
// pela ação "query_report" do agente de IA — mesmo cálculo, resposta
// byte-idêntica à rota HTTP, que virou um wrapper fino em cima.
export async function buildRelatoriosSummary(
  brokerId: string,
  months: number,
  owner: boolean,
  targetUserId: string | null,
  scope: "account" | "personal" | "member",
) {
    const { start, end } = reportPeriod(months);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const properties = await collectPages(
      (from, to) => supabase.from("imf_properties").select("id").eq("broker_id", brokerId).order("id").range(from, to),
      "Falha ao consultar os imóveis do relatório",
    );
    const propertyIds = properties.map((property: any) => property.id as string);

    // Coorte captada no período: alimenta total, gráfico mensal, funil atual e
    // conversão. Fechamentos do período são consultados separadamente por
    // closed_at, incluindo leads captados antes da janela.
    const leads = await collectForIds(propertyIds, (ids, from, to) => {
      let query = supabase.from("leads")
        .select("id, status, created_at, closed_at")
        .in("property_id", ids)
        .gte("created_at", startIso)
        .lte("created_at", endIso);
      if (targetUserId) query = query.eq("owner_user_id", targetUserId);
      return query.order("created_at").order("id").range(from, to);
    }, "Falha ao consultar os leads captados");

    const closedDeals = await collectForIds(propertyIds, (ids, from, to) => {
      let query = supabase.from("leads")
        .select("id, closed_at")
        .in("property_id", ids)
        .not("closed_at", "is", null)
        .gte("closed_at", startIso)
        .lte("closed_at", endIso);
      if (targetUserId) query = query.eq("owner_user_id", targetUserId);
      return query.order("closed_at").order("id").range(from, to);
    }, "Falha ao consultar os negócios fechados");

    const byStage: Record<string, number> = {};
    for (const lead of leads) {
      const rawStatus = lead.status || "new";
      const status = REPORT_STAGES.has(rawStatus) ? rawStatus : "new";
      byStage[status] = (byStage[status] || 0) + 1;
    }

    const totalLeads = leads.length;
    const convertedLeads = leads.filter((lead: any) => {
      if (!lead.closed_at) return false;
      const closedAt = new Date(lead.closed_at).getTime();
      return closedAt >= start.getTime() && closedAt <= end.getTime();
    }).length;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    const buckets = makeMonthBuckets(start, months);
    const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    for (const lead of leads) {
      const bucket = bucketByKey.get(monthKey(new Date(lead.created_at)));
      if (bucket) bucket.count++;
    }

    const developments = await collectPages(
      (from, to) => supabase.from("imf_developments").select("id").eq("broker_id", brokerId).order("id").range(from, to),
      "Falha ao consultar os empreendimentos do relatório",
    );
    const developmentIds = developments.map((development: any) => development.id as string);

    const soldUnits = await collectForIds(developmentIds, (ids, from, to) => {
      let query = supabase.from("imf_units")
        .select("id, price_cents, sold_at")
        .in("development_id", ids)
        .eq("status", "vendido")
        .not("sold_at", "is", null)
        .gte("sold_at", startIso)
        .lte("sold_at", endIso);
      if (targetUserId) query = query.eq("sold_by_user_id", targetUserId);
      return query.order("sold_at").order("id").range(from, to);
    }, "Falha ao consultar as unidades vendidas");
    const salesTotalCents = soldUnits.reduce((sum: number, unit: any) => sum + Number(unit.price_cents || 0), 0);

    // Locação é financeira e hoje não possui autoria por membro. Para não
    // vazar o consolidado da empresa, só aparece na visão de CONTA do titular
    // (nunca num drill-down de um membro específico, que mostraria o caixa
    // inteiro da empresa como se fosse daquela pessoa).
    let rentalMonthlyCents = 0;
    let rentalPaidCents = 0;
    let rentalPaymentsCount = 0;
    if (owner && !targetUserId) {
      const contracts = await collectPages(
        (from, to) => supabase.from("imf_rental_contracts")
          .select("id, status, rent_amount_cents")
          .eq("broker_id", brokerId)
          .order("id")
          .range(from, to),
        "Falha ao consultar os contratos de locação",
      );
      rentalMonthlyCents = contracts
        .filter((contract: any) => contract.status === "ativo")
        .reduce((sum: number, contract: any) => sum + Number(contract.rent_amount_cents || 0), 0);

      const contractIds = contracts.map((contract: any) => contract.id as string);
      const paidRentals = await collectForIds(contractIds, (ids, from, to) => supabase
        .from("imf_rental_payments")
        .select("id, amount_cents, paid_at")
        .in("contract_id", ids)
        .eq("status", "paid")
        .not("paid_at", "is", null)
        .gte("paid_at", startIso)
        .lte("paid_at", endIso)
        .order("paid_at")
        .order("id")
        .range(from, to), "Falha ao consultar os aluguéis recebidos");
      rentalPaidCents = paidRentals.reduce((sum: number, payment: any) => sum + Number(payment.amount_cents || 0), 0);
      rentalPaymentsCount = paidRentals.length;
    }

    const visitsQueryFactory = (from: number, to: number) => {
      let query = supabase.from("imf_agenda")
        .select("id, status, scheduled_at")
        .eq("broker_id", brokerId)
        .eq("event_type", "visita")
        .gte("scheduled_at", startIso)
        .lte("scheduled_at", endIso);
      if (targetUserId) query = query.eq("owner_user_id", targetUserId);
      return query.order("scheduled_at").order("id").range(from, to);
    };
    const visits = await collectPages(visitsQueryFactory, "Falha ao consultar as visitas");
    const visitsCancelled = visits.filter((visit: any) => visit.status === "cancelado").length;
    const visitsDone = visits.filter((visit: any) => visit.status === "realizado").length;
    const visitsScheduled = visits.length - visitsCancelled;

    return {
      months,
      periodStart: startIso,
      periodEnd: endIso,
      scope,
      totalLeads,
      closedLeads: closedDeals.length,
      convertedLeads,
      conversionRate,
      byStage,
      byMonth: buckets.map(({ label, count }) => ({ label, count })),
      // Compatibilidade: revenueCents agora significa valor efetivamente
      // recebido de locação. VGV permanece separado em salesTotalCents.
      revenueCents: rentalPaidCents,
      rentalPaidCents,
      rentalPaymentsCount,
      rentalMonthlyCents,
      salesTotalCents,
      salesCount: soldUnits.length,
      visitsDone,
      visitsScheduled,
      visitsCancelled,
      visitsTotal: visitsScheduled,
    };
}

relatoriosRouter.get("/api/relatorios/summary", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const requestedMonths = Number(req.query.months);
    const months = [3, 6, 12].includes(requestedMonths) ? requestedMonths : 6;
    const { start, end } = reportPeriod(months);

    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.json(emptySummary(months, start, end));
    const owner = await isBrokerOwner(userId, brokerId);

    // Drill-down: só o titular pode pedir o relatório de OUTRO membro
    // específico (member_user_id). Sem esse parâmetro, titular continua
    // vendo o consolidado da conta e um membro comum vê só o próprio -
    // exatamente como já era antes desta extensão.
    const requestedMember = typeof req.query.member_user_id === "string" ? req.query.member_user_id : null;
    if (requestedMember && !(await hasPermission(userId, brokerId, "relatorios", "gerenciar"))) {
      return res.status(403).json({ error: "Você não tem permissão para ver o relatório de outro membro." });
    }
    let targetUserId: string | null = null;
    if (requestedMember) {
      const { data: memberRow } = await supabase.from("imf_broker_members").select("user_id").eq("broker_id", brokerId).eq("user_id", requestedMember).maybeSingle();
      if (!memberRow) return res.status(404).json({ error: "Membro não encontrado nesta conta." });
      targetUserId = requestedMember;
    } else if (!owner) {
      targetUserId = userId;
    }

    const scope = requestedMember ? "member" : (owner ? "account" : "personal");
    const summary = await buildRelatoriosSummary(brokerId, months, owner, targetUserId, scope);
    res.json(summary);
  } catch (err: any) {
    console.error("Erro GET /api/relatorios/summary:", err);
    res.status(500).json({ error: "Não foi possível carregar o relatório agora." });
  }
});
