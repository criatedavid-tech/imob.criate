import { supabase } from "../supabase";
import type { Autonomy } from "./agent";

const VALID_AUTONOMY = new Set<Autonomy>(["piloto", "copiloto", "manual"]);

function isMissingPreferencesTable(message: string): boolean {
  return /imf_agent_preferences|schema cache|does not exist/i.test(message);
}

export async function getAgentAutonomy(
  brokerId: string,
  userId: string,
): Promise<{ autonomy: Autonomy; migrationReady: boolean }> {
  const { data, error } = await supabase
    .from("imf_agent_preferences")
    .select("autonomy")
    .eq("broker_id", brokerId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingPreferencesTable(error.message || "")) {
      // Antes da migration, nunca habilita autoexecucao so porque a interface
      // antiga exibia "Piloto" por padrao.
      return { autonomy: "copiloto", migrationReady: false };
    }
    throw error;
  }
  const autonomy = VALID_AUTONOMY.has(data?.autonomy as Autonomy)
    ? data.autonomy as Autonomy
    : "piloto";
  return { autonomy, migrationReady: true };
}

export async function setAgentAutonomy(
  brokerId: string,
  userId: string,
  autonomy: Autonomy,
): Promise<void> {
  if (!VALID_AUTONOMY.has(autonomy)) throw new Error("Modo de autonomia invalido.");
  const { error } = await supabase.from("imf_agent_preferences").upsert({
    broker_id: brokerId,
    user_id: userId,
    autonomy,
    updated_at: new Date().toISOString(),
  }, { onConflict: "broker_id,user_id" });
  if (error) throw error;
}
