# Próxima tarefa

**Objetivo:** concluir a publicação autorizada do hardening e executar o QA
funcional pós-deploy.

**Ordem obrigatória:**

1. **Concluído:** usuário executou manualmente no SQL Editor do Supabase o
   arquivo `supabase/migrations/20260720b_crm_security_hardening.sql`.
2. **Concluído:** consulta de verificação confirmou seis objetos `OK`, sem
   `EXECUTE` para `anon`/`authenticated`, com `service_role` nas RPCs e
   trigger instalado.
3. **Concluído:** `npm ci`, TypeScript, Knip, build, `npm audit` e
   `git diff --check` passaram sobre o estado combinado da branch.
4. **Autorizado:** commit, push em `v2` e acompanhamento do workflow (o push
   aciona deploy automático após o gate de validação).
5. **Próximo após o deploy:** QA autenticado: reorder válido e duplicado,
   troca de padrão, arquivar/excluir etapa com e sem reatribuição, titular
   versus membro e tentativa de mover lead para etapa arquivada.

**Arquivos envolvidos:** migration `20260720b_crm_security_hardening.sql`,
rotas/serviço de CRM e leads, `PipelinesManager.tsx`, lockfile, workflow e
documentação PMP.

**Fora deste escopo:** correções paralelas do Assistente IA/UAZAPI já foram
commitadas separadamente (`22c99a2` e `152dda9`). Não misturar esses commits
com o hardening do CRM ao revisar ou preparar a publicação.

**Critério de conclusão:** workflow/deploy confirmado e QA autenticado sem
regressão.
