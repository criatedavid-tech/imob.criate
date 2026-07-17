import { supabase } from "../supabase";

export type StageType = "open" | "won" | "lost";

const STAGE_TYPES: StageType[] = ["open", "won", "lost"];
export function isStageType(value: unknown): value is StageType {
  return typeof value === "string" && (STAGE_TYPES as string[]).includes(value);
}

// A migration 20260717b (imf_crm_pipelines/_stages) é aplicada MANUALMENTE.
// Enquanto ela não roda, as tabelas não existem — Postgres devolve 42P01
// (undefined_table). A criação de lead NÃO pode depender disso pra funcionar:
// se o CRM ainda não foi migrado, ela cai no comportamento antigo (lead sem
// pipeline), em vez de quebrar o app inteiro. Assim o deploy do código é
// seguro independentemente da ordem em relação à migration.
function isMissingCrmSchema(err: any): boolean {
  return err?.code === "42P01" || /imf_crm_pipeline/i.test(String(err?.message || ""));
}

const DEFAULT_STAGE_SEEDS: { name: string; color: string; stage_type: StageType }[] = [
  { name: "Novo", color: "#60a5fa", stage_type: "open" },
  { name: "Em contato", color: "#a78bfa", stage_type: "open" },
  { name: "Visita", color: "#f472b6", stage_type: "open" },
  { name: "Proposta", color: "#fb923c", stage_type: "open" },
  { name: "Fechado", color: "#4ade80", stage_type: "won" },
];

// Garante que o broker tem um pipeline padrão com ao menos as etapas seed —
// mesmo espírito de autocura do getBrokerId (middleware/auth.ts). A migration
// 20260717b faz esse backfill pra quem já existia; isso cobre contas criadas
// DEPOIS dela, que nunca passaram pelo backfill.
export async function ensureDefaultPipeline(brokerId: string): Promise<{ pipelineId: string; firstStageId: string | null }> {
  const { data: existing, error: existingError } = await supabase
    .from("imf_crm_pipelines")
    .select("id")
    .eq("broker_id", brokerId)
    .eq("is_default", true)
    .maybeSingle();
  if (existingError) throw existingError;

  let pipelineId = existing?.id as string | undefined;

  if (!pipelineId) {
    const { data: created, error: createError } = await supabase
      .from("imf_crm_pipelines")
      .insert({ broker_id: brokerId, name: "Funil padrão", is_default: true, active: true })
      .select("id")
      .single();
    if (createError) throw createError;
    pipelineId = created.id;

    const rows = DEFAULT_STAGE_SEEDS.map((seed, i) => ({
      pipeline_id: pipelineId,
      name: seed.name,
      position: i + 1,
      color: seed.color,
      stage_type: seed.stage_type,
      active: true,
    }));
    const { error: stagesError } = await supabase.from("imf_crm_pipeline_stages").insert(rows);
    if (stagesError) throw stagesError;
  }

  const { data: firstStage, error: firstStageError } = await supabase
    .from("imf_crm_pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("active", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstStageError) throw firstStageError;

  return { pipelineId: pipelineId as string, firstStageId: firstStage?.id || null };
}

// Resolve pipeline_id/pipeline_stage_id pra um lead novo. Todo caminho de
// criação de lead (POST /api/leads, agente de IA, "criar lead" a partir de
// conversa) passa por aqui — nunca confia em id enviado pelo cliente sem
// validar posse; pipelineIdHint só é usado se pertencer ao broker.
export async function resolveNewLeadStage(
  brokerId: string,
  pipelineIdHint?: string | null,
): Promise<{ pipeline_id: string | null; pipeline_stage_id: string | null }> {
  try {
    if (pipelineIdHint) {
      const { data: pipeline, error: hintError } = await supabase
        .from("imf_crm_pipelines")
        .select("id")
        .eq("id", pipelineIdHint)
        .eq("broker_id", brokerId)
        .maybeSingle();
      if (hintError) throw hintError;
      if (pipeline) {
        const { data: firstStage } = await supabase
          .from("imf_crm_pipeline_stages")
          .select("id")
          .eq("pipeline_id", pipeline.id)
          .eq("active", true)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();
        return { pipeline_id: pipeline.id, pipeline_stage_id: firstStage?.id || null };
      }
    }
    const { pipelineId, firstStageId } = await ensureDefaultPipeline(brokerId);
    return { pipeline_id: pipelineId, pipeline_stage_id: firstStageId };
  } catch (err) {
    // CRM ainda não migrado neste ambiente: cria o lead sem pipeline (fluxo
    // antigo) em vez de derrubar a criação de lead. Qualquer outro erro sobe.
    if (isMissingCrmSchema(err)) return { pipeline_id: null, pipeline_stage_id: null };
    throw err;
  }
}

// Re-sincroniza status/closed_at de todo lead numa etapa após ela mudar de
// stage_type (ex.: corretor edita "Contrato assinado" de open pra won). O
// UPDATE abaixo não muda o valor de pipeline_stage_id (seta pra ele mesmo),
// mas por incluir a coluna no SET ele dispara o trigger
// trg_imf_sync_lead_pipeline_stage (BEFORE UPDATE OF pipeline_stage_id),
// que recalcula status/closed_at a partir do stage_type atual — evita
// duplicar a lógica de derivação em TypeScript.
export async function resyncLeadsOnStage(stageId: string): Promise<void> {
  const { data: leadIds, error: leadIdsError } = await supabase
    .from("leads")
    .select("id")
    .eq("pipeline_stage_id", stageId);
  if (leadIdsError) throw leadIdsError;
  if (!leadIds || leadIds.length === 0) return;

  const { error } = await supabase
    .from("leads")
    .update({ pipeline_stage_id: stageId })
    .eq("pipeline_stage_id", stageId);
  if (error) throw error;
}
