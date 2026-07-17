import express from "express";
import { supabase } from "../supabase";
import { requireUser, getBrokerId, isBrokerOwner } from "../middleware/auth";
import { ensureDefaultPipeline, resyncLeadsOnStage, isStageType, StageType } from "../services/crmPipelines";

export const crmPipelinesRouter = express.Router();

const NAME_MAX_LEN = 80;
const COLOR_MAX_LEN = 32;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > NAME_MAX_LEN) return null;
  return trimmed;
}

function cleanColor(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > COLOR_MAX_LEN) return undefined;
  return trimmed || null;
}

function isUniqueViolation(err: any): boolean {
  return err?.code === "23505";
}

async function pipelineBrokerAccess(brokerId: string, pipelineId: string) {
  const { data } = await supabase.from("imf_crm_pipelines").select("*").eq("id", pipelineId).eq("broker_id", brokerId).maybeSingle();
  return data;
}

async function stageBrokerAccess(brokerId: string, stageId: string) {
  const { data: stage } = await supabase.from("imf_crm_pipeline_stages").select("*").eq("id", stageId).maybeSingle();
  if (!stage) return null;
  const pipeline = await pipelineBrokerAccess(brokerId, stage.pipeline_id);
  if (!pipeline) return null;
  return stage;
}

async function requireOwner(req: any, res: any, brokerId: string): Promise<boolean> {
  const userId = req.userId as string;
  if (!(await isBrokerOwner(userId, brokerId))) {
    res.status(403).json({ error: "Só o titular da conta gerencia pipelines." });
    return false;
  }
  return true;
}

// GET /api/crm/pipelines — qualquer membro autenticado vê a lista (com
// etapas aninhadas); só o titular cria/edita/exclui. Autocura: garante que
// o pipeline padrão exista antes de listar, cobrindo contas criadas depois
// da migration 20260717b.
crmPipelinesRouter.get("/api/crm/pipelines", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });

    await ensureDefaultPipeline(brokerId);

    const { data: pipelines, error } = await supabase
      .from("imf_crm_pipelines")
      .select("*")
      .eq("broker_id", brokerId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;

    const pipelineIds = (pipelines || []).map((p: any) => p.id);
    const { data: stages, error: stagesError } = pipelineIds.length
      ? await supabase.from("imf_crm_pipeline_stages").select("*").in("pipeline_id", pipelineIds).order("position", { ascending: true })
      : { data: [] as any[], error: null };
    if (stagesError) throw stagesError;

    const stagesByPipeline = new Map<string, any[]>();
    for (const s of stages || []) {
      if (!stagesByPipeline.has(s.pipeline_id)) stagesByPipeline.set(s.pipeline_id, []);
      stagesByPipeline.get(s.pipeline_id)!.push(s);
    }

    res.json((pipelines || []).map((p: any) => ({ ...p, stages: stagesByPipeline.get(p.id) || [] })));
  } catch (err: any) {
    console.error("Erro GET /api/crm/pipelines:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.post("/api/crm/pipelines", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: `Nome é obrigatório (até ${NAME_MAX_LEN} caracteres).` });

    await ensureDefaultPipeline(brokerId);

    const { data, error } = await supabase
      .from("imf_crm_pipelines")
      .insert({ broker_id: brokerId, name, is_default: false, active: true })
      .select("*")
      .single();
    if (error) throw error;
    res.status(201).json({ ...data, stages: [] });
  } catch (err: any) {
    console.error("Erro POST /api/crm/pipelines:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.patch("/api/crm/pipelines/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const pipeline = await pipelineBrokerAccess(brokerId, req.params.id);
    if (!pipeline) return res.status(404).json({ error: "Pipeline não encontrado." });

    const updates: Record<string, any> = {};
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name);
      if (!name) return res.status(400).json({ error: `Nome inválido (até ${NAME_MAX_LEN} caracteres).` });
      updates.name = name;
    }
    if (req.body?.active !== undefined) {
      if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "active deve ser booleano." });
      if (req.body.active === false && pipeline.is_default) {
        return res.status(409).json({ error: "Defina outro pipeline como padrão antes de arquivar este." });
      }
      updates.active = req.body.active;
    }
    if (req.body?.is_default !== undefined) {
      if (typeof req.body.is_default !== "boolean") return res.status(400).json({ error: "is_default deve ser booleano." });
      if (req.body.is_default === false && pipeline.is_default) {
        return res.status(409).json({ error: "Defina outro pipeline como padrão em vez de remover este — sempre precisa haver um padrão." });
      }
      if (req.body.is_default === true) {
        const { error: unsetError } = await supabase
          .from("imf_crm_pipelines")
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq("broker_id", brokerId)
          .eq("is_default", true)
          .neq("id", pipeline.id);
        if (unsetError) throw unsetError;
        updates.is_default = true;
        updates.active = true; // pipeline padrão nunca fica arquivado
      }
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nada para atualizar." });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from("imf_crm_pipelines").update(updates).eq("id", pipeline.id).select("*").maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/crm/pipelines/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.delete("/api/crm/pipelines/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const pipeline = await pipelineBrokerAccess(brokerId, req.params.id);
    if (!pipeline) return res.status(404).json({ error: "Pipeline não encontrado." });
    if (pipeline.is_default) return res.status(409).json({ error: "Defina outro pipeline como padrão antes de excluir este." });

    const { count, error: countError } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("pipeline_id", pipeline.id);
    if (countError) throw countError;
    if ((count || 0) > 0) {
      return res.status(409).json({ error: `Este pipeline tem ${count} lead(s). Mova-os ou arquive o pipeline em vez de excluí-lo.`, leads_count: count });
    }

    const { error: stagesError } = await supabase.from("imf_crm_pipeline_stages").delete().eq("pipeline_id", pipeline.id);
    if (stagesError) throw stagesError;
    const { error } = await supabase.from("imf_crm_pipelines").delete().eq("id", pipeline.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/crm/pipelines/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.post("/api/crm/pipelines/:id/stages", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const pipeline = await pipelineBrokerAccess(brokerId, req.params.id);
    if (!pipeline) return res.status(404).json({ error: "Pipeline não encontrado." });

    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: `Nome é obrigatório (até ${NAME_MAX_LEN} caracteres).` });
    const stageType: StageType = isStageType(req.body?.stage_type) ? req.body.stage_type : "open";
    const color = cleanColor(req.body?.color) ?? null;

    const { data: maxRow } = await supabase
      .from("imf_crm_pipeline_stages")
      .select("position")
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (maxRow?.position || 0) + 1;

    const { data, error } = await supabase
      .from("imf_crm_pipeline_stages")
      .insert({ pipeline_id: pipeline.id, name, position: nextPosition, color, stage_type: stageType, active: true })
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: "Conflito de posição ao criar a etapa — tente novamente." });
      throw error;
    }
    res.status(201).json(data);
  } catch (err: any) {
    console.error("Erro POST /api/crm/pipelines/:id/stages:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.patch("/api/crm/stages/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const stage = await stageBrokerAccess(brokerId, req.params.id);
    if (!stage) return res.status(404).json({ error: "Etapa não encontrada." });

    const updates: Record<string, any> = {};
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name);
      if (!name) return res.status(400).json({ error: `Nome inválido (até ${NAME_MAX_LEN} caracteres).` });
      updates.name = name;
    }
    if (req.body?.color !== undefined) {
      const color = cleanColor(req.body.color);
      if (color === undefined) return res.status(400).json({ error: `Cor inválida (até ${COLOR_MAX_LEN} caracteres).` });
      updates.color = color;
    }
    if (req.body?.stage_type !== undefined) {
      if (!isStageType(req.body.stage_type)) return res.status(400).json({ error: "stage_type deve ser open, won ou lost." });
      updates.stage_type = req.body.stage_type;
    }

    let reassignToStageId: string | null = null;
    if (req.body?.active === false) {
      if (typeof req.body.reassign_to_stage_id === "string" && req.body.reassign_to_stage_id) {
        const target = await stageBrokerAccess(brokerId, req.body.reassign_to_stage_id);
        if (!target || target.pipeline_id !== stage.pipeline_id) {
          return res.status(400).json({ error: "Etapa de destino inválida para mover os leads." });
        }
        if (target.id === stage.id) return res.status(400).json({ error: "Escolha uma etapa de destino diferente." });
        reassignToStageId = target.id;
      }
      const { count, error: countError } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_stage_id", stage.id);
      if (countError) throw countError;
      if ((count || 0) > 0 && !reassignToStageId) {
        return res.status(409).json({
          error: `Esta etapa tem ${count} lead(s). Informe reassign_to_stage_id pra movê-los antes de arquivar, ou mova-os manualmente.`,
          leads_count: count,
        });
      }
      updates.active = false;
    } else if (req.body?.active === true) {
      updates.active = true;
    }

    if (Object.keys(updates).length === 0 && !reassignToStageId) return res.status(400).json({ error: "Nada para atualizar." });
    updates.updated_at = new Date().toISOString();

    if (reassignToStageId) {
      const { error: moveError } = await supabase.from("leads").update({ pipeline_stage_id: reassignToStageId }).eq("pipeline_stage_id", stage.id);
      if (moveError) throw moveError;
    }

    const { data, error } = await supabase.from("imf_crm_pipeline_stages").update(updates).eq("id", stage.id).select("*").maybeSingle();
    if (error) throw error;

    // stage_type mudou: ressincroniza status/closed_at de quem ainda está nesta etapa.
    if (updates.stage_type !== undefined) await resyncLeadsOnStage(stage.id);

    res.json(data);
  } catch (err: any) {
    console.error("Erro PATCH /api/crm/stages/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.delete("/api/crm/stages/:id", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const stage = await stageBrokerAccess(brokerId, req.params.id);
    if (!stage) return res.status(404).json({ error: "Etapa não encontrada." });

    const reassignParam = typeof req.query.reassign_to_stage_id === "string" ? req.query.reassign_to_stage_id : null;
    let reassignToStageId: string | null = null;
    if (reassignParam) {
      const target = await stageBrokerAccess(brokerId, reassignParam);
      if (!target || target.pipeline_id !== stage.pipeline_id) {
        return res.status(400).json({ error: "Etapa de destino inválida para mover os leads." });
      }
      if (target.id === stage.id) return res.status(400).json({ error: "Escolha uma etapa de destino diferente." });
      reassignToStageId = target.id;
    }

    const { count, error: countError } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("pipeline_stage_id", stage.id);
    if (countError) throw countError;
    if ((count || 0) > 0 && !reassignToStageId) {
      return res.status(409).json({
        error: `Esta etapa tem ${count} lead(s). Informe ?reassign_to_stage_id= pra movê-los antes de excluir, ou mova-os manualmente.`,
        leads_count: count,
      });
    }

    if (reassignToStageId) {
      const { error: moveError } = await supabase.from("leads").update({ pipeline_stage_id: reassignToStageId }).eq("pipeline_stage_id", stage.id);
      if (moveError) throw moveError;
    }

    const { error } = await supabase.from("imf_crm_pipeline_stages").delete().eq("id", stage.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Erro DELETE /api/crm/stages/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

crmPipelinesRouter.patch("/api/crm/pipelines/:id/stages/reorder", requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const brokerId = await getBrokerId(userId);
    if (!brokerId) return res.status(403).json({ error: "Corretor não encontrado." });
    if (!(await requireOwner(req, res, brokerId))) return;

    const pipeline = await pipelineBrokerAccess(brokerId, req.params.id);
    if (!pipeline) return res.status(404).json({ error: "Pipeline não encontrado." });

    const stageIds = req.body?.stage_ids;
    if (!Array.isArray(stageIds) || stageIds.length === 0 || !stageIds.every((id: any) => typeof id === "string")) {
      return res.status(400).json({ error: "stage_ids deve ser uma lista de ids." });
    }

    const { error } = await supabase.rpc("imf_crm_reorder_stages", {
      p_pipeline_id: pipeline.id,
      p_broker_id: brokerId,
      p_stage_ids: stageIds,
    });
    if (error) return res.status(400).json({ error: error.message || "Falha ao reordenar etapas." });

    const { data: stages, error: stagesError } = await supabase
      .from("imf_crm_pipeline_stages")
      .select("*")
      .eq("pipeline_id", pipeline.id)
      .order("position", { ascending: true });
    if (stagesError) throw stagesError;
    res.json(stages);
  } catch (err: any) {
    console.error("Erro PATCH /api/crm/pipelines/:id/stages/reorder:", err.message);
    res.status(500).json({ error: err.message });
  }
});
