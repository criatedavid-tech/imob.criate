import assert from "node:assert/strict";
import test from "node:test";
import { MUTATING_AGENT_ACTION_TYPES } from "../server/security/agentGuardrails";
import { AGENT_ACTION_PERMISSION } from "../server/services/agent";
import { PERMISSION_MODULES, MODULE_ACTIONS } from "../server/services/permissions";

test("toda ação mutante do agente tem mapeamento de permissão granular", () => {
  for (const type of MUTATING_AGENT_ACTION_TYPES) {
    const permission = (AGENT_ACTION_PERMISSION as Record<string, { module: string; action: string } | undefined>)[type];
    assert.ok(permission, `ação mutante "${type}" sem entrada em AGENT_ACTION_PERMISSION — um membro sem grade nenhuma poderia executá-la sem checagem`);
  }
});

test("todo mapeamento aponta pra um módulo/ação que existe de verdade em permissions.ts", () => {
  for (const [type, permission] of Object.entries(AGENT_ACTION_PERMISSION)) {
    if (!permission) continue;
    assert.ok((PERMISSION_MODULES as readonly string[]).includes(permission.module), `${type}: módulo "${permission.module}" não existe em PERMISSION_MODULES`);
    assert.ok(
      MODULE_ACTIONS[permission.module as keyof typeof MODULE_ACTIONS]?.includes(permission.action as never),
      `${type}: ação "${permission.action}" não é válida pro módulo "${permission.module}"`,
    );
  }
});
