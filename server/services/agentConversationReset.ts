import { supabase } from "../supabase";

const AGENT_RESET_COMMAND = "@reset";

export function isAgentResetCommand(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === AGENT_RESET_COMMAND;
}

export interface AgentConversationResetResult {
  ok: boolean;
  reason?: "action_in_progress";
  historyDeleted?: number;
  pendingActionsDeleted?: number;
  stagedMediaDeleted?: number;
  stagedDocumentsDeleted?: number;
}

// O reset e atomico no banco: historico web/WhatsApp, proposta ainda nao
// executada e anexos temporarios pertencem ao mesmo contexto do Assistente IA.
// A RPC recusa apagar o marcador de uma mutacao em execucao/recuperacao, pois
// remove-lo poderia permitir que um retry repetisse uma acao real.
export async function resetAgentConversation(
  userId: string,
  brokerId: string,
): Promise<AgentConversationResetResult> {
  const { data, error } = await supabase.rpc("imf_reset_agent_conversation", {
    p_user_id: userId,
    p_broker_id: brokerId,
  });
  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as AgentConversationResetResult | null;
  if (!result || typeof result.ok !== "boolean") {
    throw new Error("O banco não confirmou a limpeza do histórico do Assistente IA.");
  }
  return result;
}

export function resetReply(result: AgentConversationResetResult): string {
  if (!result.ok && result.reason === "action_in_progress") {
    return "Ainda existe uma ação em processamento. Aguarde a resposta final e envie @reset novamente.";
  }
  return "Histórico e contexto do Assistente IA zerados. As mensagens antigas continuam visíveis no seu WhatsApp, mas não serão mais usadas pela IA.";
}
