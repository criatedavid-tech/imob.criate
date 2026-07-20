# Próxima tarefa

**Situação:** o prompt mais recente pedia para implementar o CRM com
pipelines neste checkout, mas essa feature já existe em produção
(release v94/v95) — chegou junto na sincronização deste checkout com
`origin/v2` (estava 20 commits atrás). Não há implementação pendente da
v1 do CRM.

**Objetivo real ainda em aberto:** aguardar o usuário confirmar o que
fazer a seguir. Duas frentes prováveis, nenhuma confirmada ainda:

1. Auditoria do Codex sobre o CRM já implementado — o prompt original
   mencionava "o usuário executará o SQL manualmente somente depois da
   auditoria do Codex", mas o SQL das duas migrations do CRM já foi
   executado e verificado pelo Claude nesta sessão. Confirmar se a
   auditoria do Codex ainda se aplica (revisão retroativa) ou se era
   sobre outra coisa.
2. Decidir o destino de `HANDOFF.md` — descreve arquitetura antiga
   (V1/Z-PRO, `server.ts` monolítico, deploy `--app imobiflow`), está
   superseded por `DOCUMENTACAO.md`. O protocolo pede analisar antes de
   decidir se ainda tem função própria; não apagar/duplicar sem
   autorização explícita.

**Arquivos envolvidos:** nenhum a alterar até confirmação do usuário.
Referência: `DOCUMENTACAO.md` §14-15 (arquitetura do CRM e pendências),
`HANDOFF.md` (candidato a obsoleto).

**Dependências:** decisão do usuário sobre qual das duas frentes (ou
outra) é a prioridade real.

**Critério de conclusão:** usuário aponta a próxima tarefa concreta; este
arquivo é atualizado com objetivo, arquivos envolvidos e critério de
aceite específicos.
