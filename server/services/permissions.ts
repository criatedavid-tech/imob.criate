import { isBrokerOwner, cacheGet, cacheSet } from "../middleware/auth";
import { supabase } from "../supabase";

export const PERMISSION_MODULES = [
  "carteira", "negocios", "contatos", "agenda", "conversas",
  "locacao", "lancamentos", "financeiro", "equipe",
  "whatsapp-conexoes", "relatorios", "integracoes",
  "configuracoes", "assistente-ia",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

const PERMISSION_ACTIONS = ["visualizar", "criar", "editar", "excluir", "gerenciar"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ProfileKey = "administrador" | "gestor" | "corretor" | "atendente" | "financeiro" | "visualizacao";
export const PROFILE_KEYS: ProfileKey[] = ["administrador", "gestor", "corretor", "atendente", "financeiro", "visualizacao"];
export const PROFILE_LABELS: Record<ProfileKey, string> = {
  administrador: "Administrador",
  gestor: "Gestor",
  corretor: "Corretor",
  atendente: "Atendente",
  financeiro: "Financeiro",
  visualizacao: "Só visualização",
};

// Ações válidas por módulo — usado tanto pra validar um PUT quanto pra o
// frontend só renderizar checkboxes que fazem sentido (ex.: financeiro
// nunca mostra Criar/Editar/Excluir, é um resumo agregado read-only).
export const MODULE_ACTIONS: Record<PermissionModule, PermissionAction[]> = {
  carteira: ["visualizar", "criar", "editar", "excluir"],
  negocios: ["visualizar", "criar", "editar", "excluir", "gerenciar"],
  contatos: ["visualizar", "criar", "editar", "excluir"],
  agenda: ["visualizar", "criar", "editar", "excluir"],
  conversas: ["visualizar", "gerenciar"],
  locacao: ["visualizar", "criar", "editar", "excluir", "gerenciar"],
  lancamentos: ["visualizar", "criar", "editar", "excluir", "gerenciar"],
  financeiro: ["visualizar", "gerenciar"],
  equipe: ["visualizar", "criar", "editar", "excluir", "gerenciar"],
  "whatsapp-conexoes": ["criar", "editar", "excluir", "gerenciar"],
  relatorios: ["visualizar", "gerenciar"],
  integracoes: ["visualizar", "gerenciar"],
  configuracoes: ["visualizar", "gerenciar"],
  "assistente-ia": ["visualizar", "gerenciar"],
};

function grant(module: PermissionModule, ...actions: PermissionAction[]): string[] {
  return actions.map((a) => `${module}:${a}`);
}

// Replica exatamente o que um membro sem checagem nenhuma já consegue
// fazer hoje — dia 1 de um membro novo fica idêntico ao de sempre.
// Locação/Lançamentos/Financeiro/Integrações ficam de fora de propósito:
// "funções administrativas, configurações sensíveis e integrações só
// liberadas manualmente" (pedido original).
export const BASIC_ACCESS_DEFAULTS: string[] = [
  ...grant("carteira", "visualizar", "criar", "editar", "excluir"),
  ...grant("negocios", "visualizar", "criar", "editar", "excluir"),
  ...grant("contatos", "visualizar", "criar", "editar", "excluir"),
  ...grant("agenda", "visualizar", "criar", "editar", "excluir"),
  ...grant("conversas", "visualizar"),
  ...grant("whatsapp-conexoes", "criar", "editar", "excluir"),
  ...grant("relatorios", "visualizar"),
  ...grant("equipe", "visualizar"),
  ...grant("assistente-ia", "visualizar"),
  ...grant("configuracoes", "visualizar"),
];

// Os 6 perfis prontos pedidos: Administrador, Gestor, Corretor, Atendente,
// Financeiro, Só visualização. Aplicar um perfil SUBSTITUI toda a grade do
// membro (nunca uma união) — ver imf_replace_member_permissions.
export const BUILT_IN_PROFILES: Record<ProfileKey, string[]> = {
  administrador: [
    ...grant("carteira", "visualizar", "criar", "editar", "excluir"),
    ...grant("negocios", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("contatos", "visualizar", "criar", "editar", "excluir"),
    ...grant("agenda", "visualizar", "criar", "editar", "excluir"),
    ...grant("conversas", "visualizar", "gerenciar"),
    ...grant("locacao", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("lancamentos", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("financeiro", "visualizar", "gerenciar"),
    ...grant("equipe", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("whatsapp-conexoes", "criar", "editar", "excluir", "gerenciar"),
    ...grant("relatorios", "visualizar", "gerenciar"),
    ...grant("integracoes", "visualizar", "gerenciar"),
    ...grant("configuracoes", "visualizar", "gerenciar"),
    ...grant("assistente-ia", "visualizar", "gerenciar"),
  ],
  gestor: [
    ...grant("carteira", "visualizar", "criar", "editar", "excluir"),
    ...grant("negocios", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("contatos", "visualizar", "criar", "editar"),
    ...grant("agenda", "visualizar", "criar", "editar", "excluir"),
    ...grant("conversas", "visualizar", "gerenciar"),
    ...grant("locacao", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("lancamentos", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("financeiro", "visualizar"),
    ...grant("equipe", "visualizar", "criar", "editar", "excluir", "gerenciar"),
    ...grant("whatsapp-conexoes", "criar", "editar", "excluir", "gerenciar"),
    ...grant("relatorios", "visualizar", "gerenciar"),
    ...grant("configuracoes", "visualizar"),
    ...grant("assistente-ia", "visualizar"),
  ],
  corretor: [
    ...grant("carteira", "visualizar", "criar", "editar", "excluir"),
    ...grant("negocios", "visualizar", "criar", "editar", "excluir"),
    ...grant("contatos", "visualizar", "criar", "editar"),
    ...grant("agenda", "visualizar", "criar", "editar", "excluir"),
    ...grant("conversas", "visualizar"),
    ...grant("locacao", "visualizar", "criar", "editar"),
    ...grant("lancamentos", "visualizar", "criar", "editar"),
    ...grant("equipe", "visualizar"),
    ...grant("whatsapp-conexoes", "criar", "editar", "excluir"),
    ...grant("relatorios", "visualizar"),
    ...grant("configuracoes", "visualizar"),
    ...grant("assistente-ia", "visualizar"),
  ],
  atendente: [
    ...grant("carteira", "visualizar"),
    ...grant("negocios", "visualizar", "criar", "editar"),
    ...grant("contatos", "visualizar", "criar", "editar"),
    ...grant("agenda", "visualizar", "criar", "editar", "excluir"),
    ...grant("conversas", "visualizar"),
    ...grant("locacao", "visualizar"),
    ...grant("equipe", "visualizar"),
    ...grant("whatsapp-conexoes", "criar", "editar", "excluir"),
    ...grant("relatorios", "visualizar"),
    ...grant("configuracoes", "visualizar"),
    ...grant("assistente-ia", "visualizar"),
  ],
  financeiro: [
    ...grant("carteira", "visualizar"),
    ...grant("negocios", "visualizar"),
    ...grant("contatos", "visualizar"),
    ...grant("agenda", "visualizar"),
    ...grant("conversas", "visualizar"),
    ...grant("locacao", "visualizar", "editar", "gerenciar"),
    ...grant("lancamentos", "visualizar", "gerenciar"),
    ...grant("financeiro", "visualizar", "gerenciar"),
    ...grant("equipe", "visualizar"),
    ...grant("relatorios", "visualizar"),
    ...grant("integracoes", "visualizar", "gerenciar"),
    ...grant("configuracoes", "visualizar"),
    ...grant("assistente-ia", "visualizar"),
  ],
  visualizacao: PERMISSION_MODULES.flatMap((m) =>
    MODULE_ACTIONS[m].includes("visualizar") ? grant(m, "visualizar") : []
  ),
};

function isValidGrant(key: string): boolean {
  const [module, action] = key.split(":");
  return (PERMISSION_MODULES as readonly string[]).includes(module)
    && (MODULE_ACTIONS[module as PermissionModule] || []).includes(action as PermissionAction);
}

const memberPermissionsCache = new Map<string, { value: Set<string>; expires: number }>();
const PERMISSIONS_TTL_MS = 60_000;

export async function resolveMemberPermissions(brokerId: string, userId: string): Promise<Set<string>> {
  const key = `${brokerId}:${userId}`;
  const cached = cacheGet(memberPermissionsCache, key);
  if (cached !== undefined) return cached;

  const { data, error } = await supabase
    .from("imf_member_permissions")
    .select("module, action")
    .eq("broker_id", brokerId)
    .eq("user_id", userId);
  if (error) {
    console.error("[Permissions] falha ao resolver permissões do membro:", error.message);
    return new Set();
  }

  const grants = new Set((data || []).map((r: any) => `${r.module}:${r.action}`));
  cacheSet(memberPermissionsCache, key, grants, PERMISSIONS_TTL_MS);
  return grants;
}

export function invalidateMemberPermissionsCache(brokerId: string, userId: string) {
  memberPermissionsCache.delete(`${brokerId}:${userId}`);
}

// Titular tem acesso total sempre, implícito, nunca armazenado — só
// consultamos a grade depois de confirmar que NÃO é o titular.
export async function hasPermission(
  userId: string,
  brokerId: string,
  module: PermissionModule,
  action: PermissionAction,
): Promise<boolean> {
  if (await isBrokerOwner(userId, brokerId)) return true;
  const grants = await resolveMemberPermissions(brokerId, userId);
  return grants.has(`${module}:${action}`);
}

export async function setMemberPermission(
  brokerId: string,
  userId: string,
  module: PermissionModule,
  action: PermissionAction,
  granted: boolean,
  actorUserId: string,
): Promise<void> {
  const { error } = await supabase.rpc("imf_set_member_permission", {
    p_broker_id: brokerId,
    p_user_id: userId,
    p_module: module,
    p_action: action,
    p_granted: granted,
    p_actor: actorUserId,
  });
  if (error) throw error;
  invalidateMemberPermissionsCache(brokerId, userId);
}

export async function applyPermissionProfile(
  brokerId: string,
  userId: string,
  profileKey: ProfileKey,
  actorUserId: string,
): Promise<{ added: string[]; removed: string[] }> {
  const grants = BUILT_IN_PROFILES[profileKey];
  if (!grants) throw new Error("Perfil inválido.");

  const before = await resolveMemberPermissions(brokerId, userId);
  const { error } = await supabase.rpc("imf_replace_member_permissions", {
    p_broker_id: brokerId,
    p_user_id: userId,
    p_grants: grants,
    p_actor: actorUserId,
    p_profile_key: profileKey,
  });
  if (error) throw error;
  invalidateMemberPermissionsCache(brokerId, userId);

  const after = new Set(grants);
  const added = grants.filter((g) => !before.has(g));
  const removed = [...before].filter((g) => !after.has(g));
  return { added, removed };
}

export { isValidGrant };
