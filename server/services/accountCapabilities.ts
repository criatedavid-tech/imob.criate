import type { NextFunction, Request, Response } from "express";
import { getBrokerId } from "../middleware/auth";
import { supabase } from "../supabase";

export const ACCOUNT_CAPABILITIES = ["rentals", "developments", "finance", "team"] as const;
export type AccountCapability = (typeof ACCOUNT_CAPABILITIES)[number];

export type AccountType = "corretor" | "imobiliaria" | "incorporadora";

export interface AccountCapabilitySnapshot {
  accountType: AccountType;
  plan: string | null;
  isAdmin: boolean;
  enabled: AccountCapability[];
  defaults: AccountCapability[];
  overrides: Partial<Record<AccountCapability, boolean>>;
  migrationReady: boolean;
}

const VALID_ACCOUNT_TYPES = new Set<AccountType>(["corretor", "imobiliaria", "incorporadora"]);

function normalizeAccountType(value: unknown): AccountType {
  return typeof value === "string" && VALID_ACCOUNT_TYPES.has(value as AccountType)
    ? value as AccountType
    : "corretor";
}

export function getDefaultAccountCapabilities(accountType: AccountType): AccountCapability[] {
  if (accountType === "imobiliaria") return ["rentals", "finance", "team"];
  if (accountType === "incorporadora") return ["developments", "finance", "team"];
  return [];
}

function applyCapabilityOverrides(
  defaults: readonly AccountCapability[],
  overrides: Partial<Record<AccountCapability, boolean>>,
): AccountCapability[] {
  const enabled = new Set<AccountCapability>(defaults);
  for (const capability of ACCOUNT_CAPABILITIES) {
    if (overrides[capability] === true) enabled.add(capability);
    if (overrides[capability] === false) enabled.delete(capability);
  }
  return ACCOUNT_CAPABILITIES.filter((capability) => enabled.has(capability));
}

function isMissingCapabilityMigration(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("imf_account_capability_overrides");
}

export async function resolveAccountCapabilities(brokerId: string): Promise<AccountCapabilitySnapshot> {
  const [{ data: broker, error: brokerError }, { data: rows, error: overridesError }] = await Promise.all([
    supabase.from("imf_brokers").select("account_type, plan, is_admin").eq("id", brokerId).maybeSingle(),
    supabase.from("imf_account_capability_overrides").select("capability, enabled").eq("broker_id", brokerId),
  ]);

  if (brokerError) throw brokerError;
  if (!broker) throw new Error("Conta nao encontrada.");

  const accountType = normalizeAccountType(broker.account_type);
  const defaults = getDefaultAccountCapabilities(accountType);
  const overrides: Partial<Record<AccountCapability, boolean>> = {};
  let migrationReady = true;

  if (overridesError) {
    if (!isMissingCapabilityMigration(overridesError)) throw overridesError;
    // Compatibilidade durante o rollout: antes de a migration manual ser
    // aplicada, todas as contas continuam exatamente com as funcoes antigas.
    migrationReady = false;
  } else {
    for (const row of rows || []) {
      if (ACCOUNT_CAPABILITIES.includes(row.capability as AccountCapability)) {
        overrides[row.capability as AccountCapability] = row.enabled === true;
      }
    }
  }

  return {
    accountType,
    plan: broker.plan || null,
    isAdmin: broker.is_admin === true,
    enabled: applyCapabilityOverrides(defaults, overrides),
    defaults,
    overrides,
    migrationReady,
  };
}

export function requireAccountCapability(capability: AccountCapability) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const brokerId = await getBrokerId(userId);
      if (!brokerId) return res.status(403).json({ error: "Conta nao encontrada." });

      const snapshot = await resolveAccountCapabilities(brokerId);
      if (!snapshot.enabled.includes(capability)) {
        return res.status(403).json({ error: "Esta funcionalidade nao esta liberada para sua conta." });
      }
      return next();
    } catch (error: any) {
      console.error(`[Capabilities] falha ao validar ${capability}:`, error?.message);
      return res.status(500).json({ error: "Nao foi possivel validar as funcionalidades da conta." });
    }
  };
}

export function requiredCapabilityForAgentAction(actionType: string): AccountCapability | null {
  if (actionType === "end_rental_contract") return "rentals";
  if (actionType === "update_unit") return "developments";
  return null;
}
