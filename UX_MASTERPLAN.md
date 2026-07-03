# ImobiFlow — Masterplan de UX & Interface Generativa

> Fonte de verdade do novo paradigma de produto. Complementa `DOCUMENTACAO.md §14`
> (backend/infra). Aqui vive a **experiência**: como a IA molda a interface, a
> lista completa de funções, e o roadmap de execução por etapas.
> Criado em 2026-07-02. Modelo de referência: Opus 4.8.

---

## 1. Paradigma central

**Não é um sistema que você opera — é um funcionário que você supervisiona.**
A pessoa conversa em linguagem natural; a IA entende quem ela é e **compõe a
interface sob medida** (interface generativa), além de **agir sozinha**
(agêntica). Todas as funções continuam acessíveis **manualmente**, num rail
lateral simples e claro. Objetivo sensorial: "tenho um time de pessoas
trabalhando por mim", de forma minimalista e sem fricção.

Diferencial vs. os 6 concorrentes do benchmark (ver [[imobiflow-product-vision]]):
IA de verdade (não cosmética) + core impecável + mobile-first + zero fricção.

## 2. Anatomia da tela (3 camadas, sempre presentes)

1. **Camada de comando (conversa)** — omnibox flutuante "Fale com a IA".
   Entrada primária. Tudo pode ser dito em linguagem natural.
2. **Canvas generativo** — a IA escolhe e organiza *widgets* conforme a pessoa e
   o contexto. É a "tela desenhada pra você". Muda por persona e por momento.
3. **Rail manual** — lateral com TODAS as áreas de função. Um clique abre a tela
   manual completa (CRUD). A IA facilita, nunca prende.

Cross-cutting: **botão de autonomia** (Piloto automático / Copiloto / Manual),
global e por tarefa. **Sua equipe de IA**: indicador do que roda sozinho.

## 3. Princípios de UX (inegociáveis)

- **Sem fricção**: primeiro valor em minutos; nunca um formulário quando uma
  frase resolve.
- **Clareza > densidade**: minimalismo liquid glass; muito respiro; poucos
  elementos por vez; a IA resume, não despeja dados.
- **Dupla via**: tudo que a IA faz, a pessoa também faz manualmente — e o
  caminho manual é óbvio.
- **Progressive disclosure**: cada pessoa vê só o seu mundo (revenda / locação /
  lançamento). O sistema tem tudo; a tela mostra o necessário.
- **Voz humana**: a IA se comunica como colega ("respondi a Maria, sugeri 2
  imóveis"), reforçando a sensação de time.
- **Confiabilidade como marca**: estados de carregamento/erro tratados, nada de
  "tela quebrada".

## 4. Lista mestre de funções → como cada uma vive na nova UX

Legenda: **W** = widget no canvas generativo · **M** = tela manual no rail.

### A. Núcleo / IA
| Função | W (generativo) | M (manual) |
|---|---|---|
| Onboarding conversacional (descobre vertical + autonomia + 1º valor) | fluxo de boas-vindas | — |
| Configuração do agente (persona, tom, base de conhecimento) | card "ajustar IA" | Config › Agente |
| Botão de autonomia (piloto/copiloto/manual) | pill sempre visível | Config › Autonomia |
| Sua equipe de IA (o que roda sozinho) | widget "equipe de IA" | Config › Automações |

### B. Conversas / Atendimento
| Função | W | M |
|---|---|---|
| Inbox unificada (WhatsApp) | widget "conversas ativas" | Conversas |
| IA atende 24/7 | badge "IA atendendo" | Conversas |
| Handover humano (assumir/devolver) | botão no card | Conversas › thread |
| Qualificação automática | selo "lead quente/frio" | Conversas / Leads |
| Histórico e contexto do cliente | resumo IA | Conversas › perfil |
| Mídia/áudio/imagem, respostas rápidas | — | Conversas › thread |

### C. Leads / CRM
| Função | W | M |
|---|---|---|
| Captura multicanal (WhatsApp/portal/site/manual) | KPI "leads hoje" | Leads |
| Cadastro/edição de lead | — | Leads › novo |
| Qualificação (score/intenção) | selo no card | Leads |
| Distribuição / roleta (agência) | card decisão | Equipe › distribuição |
| Drop de lead (entrega no momento quente) | notificação | Leads |
| Matching imóvel↔lead | card "sugeri 2 imóveis" | Leads › match |
| Follow-up automático (3 timers) | widget "equipe de IA" | Config › Follow-up |

### D. Imóveis / Carteira
| Função | W | M |
|---|---|---|
| Cadastro por foto (IA preenche) | ação "novo imóvel" | Carteira › novo |
| Cadastro/edição manual | — | Carteira › novo/editar |
| Busca/filtro | — | Carteira |
| Landing page por imóvel | link "divulgar" | Carteira › imóvel |
| Status (disponível/reservado/vendido) | selo | Carteira |
| Marca d'água em fotos | automático | Divulgação |
| Importar estoque de incorporadora | card | Carteira › importar |

### E. Negócios / Funil
| Função | W | M |
|---|---|---|
| Pipeline visual (kanban) | widget "funil" | Negócios |
| Etapas configuráveis | — | Negócios › config |
| Propostas | card decisão | Negócios › proposta |
| Movimentação automática pela IA | funil se atualiza | Negócios |
| Previsão de fechamento (IA) | selo "% fechar" | Negócios |
| Alerta de negócio esfriando | card decisão | Negócios |

### F. Agenda / Visitas
| Função | W | M |
|---|---|---|
| Agendamento (IA marca) | card "confirmar visita" | Agenda |
| Calendário | widget "próximas visitas" | Agenda |
| Confirmação/lembrete automático | automático | Agenda |
| Reagendar/cancelar | botão no card | Agenda › visita |

### G. Locação (ERP) — mundo "imobiliária"
| Função | W | M |
|---|---|---|
| Contrato de locação | card | Locação › contratos |
| Reajuste automático | alerta | Locação |
| Repasse ao proprietário | card decisão | Locação › repasses |
| Boletos | automático | Locação › financeiro |
| DIMOB | ação anual | Locação › fiscal |
| Vistoria (fotos via app) | — | Locação › vistoria |
| Área do locatário/proprietário | — | Locação › portais |
| Inadimplência/cobrança | card "inquilino atrasou" | Locação |

### H. Lançamentos — mundo "incorporadora"
| Função | W | M |
|---|---|---|
| Espelho de vendas (mapa de unidades) | widget "espelho" | Lançamentos › espelho |
| Reserva com trava por tempo | card "reserva expira" | Lançamentos |
| Tabela de preço por empreendimento | — | Lançamentos › tabela |
| Simulador de preço/proposta | — | Lançamentos › proposta |
| Proposta + PIX no fluxo | fluxo mobile | Lançamentos › proposta |
| Backoffice (aprovação de pastas/docs) | card decisão | Lançamentos › backoffice |
| Repasse de comissão | card | Financeiro › comissões |

### I. Financeiro
| Função | W | M |
|---|---|---|
| Fluxo de caixa | widget "financeiro" | Financeiro |
| Comissões (cálculo + pagamento) | card decisão | Financeiro › comissões |
| Inadimplência | alerta | Financeiro |
| Informe de rendimentos (proprietário) | ação | Financeiro › fiscal |

### J. Equipe / Gestão — mundo "agência/incorporadora"
| Função | W | M |
|---|---|---|
| Cadastro de corretores/equipes | — | Equipe |
| Hierarquia/permissões | — | Equipe › permissões |
| Metas | KPI "meta do mês" | Equipe › metas |
| Performance / ranking | widget "ranking" | Equipe |
| Distribuição de leads | card decisão | Equipe › distribuição |

### K. Divulgação
| Função | W | M |
|---|---|---|
| Site imobiliário próprio | — | Divulgação › site |
| Landing por imóvel | link | Carteira › imóvel |
| Integração com portais (OLX/ZAP/Viva) | card | Divulgação › portais |
| Publicação automática (IA) | automático | Divulgação |
| Disparo de novos imóveis (e-mail/WhatsApp) | card | Divulgação › campanhas |

### L. Documentos
| Função | W | M |
|---|---|---|
| Assinatura eletrônica | card "assinar" | Documentos |
| Geração de contrato | ação IA | Documentos › contratos |
| Pastas digitais | — | Documentos |

### M. Relatórios / BI
| Função | W | M |
|---|---|---|
| Relatório em linguagem natural (IA escreve) | widget "resumo do mês" | Relatórios |
| Dashboards / conversão | KPIs | Relatórios |
| Exportação | — | Relatórios › exportar |

### N. Conta / Config
| Função | W | M |
|---|---|---|
| Perfil | — | Conta |
| Plano / billing / faturas | — | Conta › plano |
| Termos / aceite | modal | Conta › legal |
| Notificações | — | Conta › notificações |

## 5. Arquitetura da interface generativa

- **Widget registry** (`experience/widgets.tsx`): mapa `WidgetType → componente`.
  Cada função vira um ou mais widgets reutilizáveis.
- **Layout schema** (`experience/types.ts`): `LayoutSpec { persona, greeting,
  subtitle, widgets: WidgetSpec[] }`; `WidgetSpec { id, type, span, title, data }`.
- **Renderer** (`experience/Canvas.tsx`): grid 12-col; lê o spec e monta os
  widgets com o span de cada um. Não sabe regra de negócio — só desenha.
- **O "cérebro"**: hoje um **motor mock** determinístico (`experience/engine.ts`)
  que produz o spec por persona/contexto. Na Etapa 13 é substituído por uma
  chamada real ao LLM que devolve o mesmo formato `LayoutSpec` — o renderer não
  muda. Essa separação (cérebro ↔ renderizador) é o coração da arquitetura.
- **Dados**: hoje mock; cada etapa liga o widget aos endpoints reais do
  `server.ts` (properties, leads, agenda, dashboard/metrics, etc.).

## 6. Sensação "time de pessoas"

- A IA fala como colega no **Briefing** e nos cards de **Decisão**.
- Widget **Sua equipe de IA**: "Atendente", "Analista", "Follow-up" como membros
  com status (ativo, o que estão fazendo agora) — reforça o time.
- Cada ação autônoma é atribuída ("marquei", "respondi", "sugeri").
- Autonomia visível: a pessoa sente que comanda o time (piloto/copiloto/manual).

## 7. Inventário de telas

Shell (comando + canvas + rail) · Onboarding conversacional · **Hoje** (cockpit
generativo) · Conversas · Carteira (lista/detalhe/novo) · Negócios (funil) ·
Agenda · Locação · Lançamentos (espelho) · Financeiro · Equipe · Divulgação ·
Documentos · Relatórios · Config (Agente/Autonomia/Automações) · Conta.

## 8. Roadmap de execução (pedaço a pedaço)

- **Etapa 0 — Fundação** *(EM EXECUÇÃO)*: shell 3 camadas, tokens liquid glass,
  renderer + registry + engine mock, command bar, rail manual, persona switch.
- **Etapa 1 — Cockpit "Hoje"** *(EM EXECUÇÃO)*: widgets briefing, decisões, KPIs,
  funil, conversas, equipe-de-IA; variações por persona (corretor/imobiliária/
  incorporadora) provando a interface generativa.
- **Etapa 2 — Conversas** ligadas ao backend (inbox, handover, qualificação).
- **Etapa 3 — Carteira** *(CONCLUÍDA)*: lista/cria/edita/exclui reaproveitando
  `/api/properties` + `PropertyForm.tsx` existentes. Detalhe dedicado e landing
  pública já existiam antes desta rodada.
- **Etapa 4 — Negócios** (funil kanban, propostas, previsão de fechamento).
- **Etapa 5 — Agenda** (calendário, confirmação automática).
- **Etapa 6 — Locação** (contratos, reajuste, repasse, boleto, DIMOB, inadimpl.).
- **Etapa 7 — Lançamentos** (espelho, reserva com trava, tabela, proposta+PIX).
- **Etapa 8 — Financeiro** (fluxo de caixa, comissões, informe rendimentos).
- **Etapa 9 — Equipe/Gestão** (roster, metas, ranking, distribuição de leads).
- **Etapa 10 — Divulgação** (site, portais, campanhas).
- **Etapa 11 — Relatórios/BI** (IA escreve o relatório).
- **Etapa 12 — Onboarding conversacional + Autonomia** completos.
- **Etapa 13 — Cérebro real** (LLM gera o `LayoutSpec`) substituindo o mock.
- **Etapa 14 — Documentos/Assinatura**, Conta/Billing, mobile, a11y, performance.

Cada etapa é vendável e testável isolada; a Etapa 0/1 já mostra o paradigma.

## 9. Estado de execução

- **2026-07-02 — Etapa 0 CONCLUÍDA + Etapa 1 (cockpit) CONSTRUÍDA e verificada no
  preview.** Entregue em `src/experience/`:
  - `types.ts` (contrato `LayoutSpec`/`WidgetSpec`), `engine.ts` (cérebro mock +
    `AREAS` do rail), `ui.tsx` (`GlassCard`), `widgets.tsx` (10 widgets +
    `REGISTRY`), `Canvas.tsx` (renderer grid 12-col), `CommandBar.tsx` (omnibox),
    `ManualRail.tsx` (rail por persona), `ExperienceShell.tsx` (shell 3 camadas +
    troca de persona + botão de autonomia).
  - Página `src/pages/Experiencia.tsx`, rota **`/app`** (pública, mock data, não
    substitui o Dashboard atual).
  - Verificado: `tsc` limpo, build ok, sem erros de console. As 3 personas geram
    canvas diferente (interface generativa provada); rail muda por persona
    (progressive disclosure); espelho de vendas, KPIs, decisões, funil, conversas,
    equipe-de-IA renderizando; áreas manuais com empty state didático (dupla via).
  - Widgets faltantes p/ completar Etapa 1 (opcional): variação de conversas/funil
    por persona já coberta; próximos widgets nascem junto com os dados reais.
- **2026-07-02 — Cockpit do Corretor ligado a dados reais.** `/app` agora exige
  login (`ExperienceShell` redireciona pra `/login` se não houver sessão —
  pendência resolvida). Novo `src/experience/realData.ts`:
  `fetchCorretorLayout()` busca `/api/brokers/me`, `/api/dashboard/metrics`,
  `/api/leads/recent`, `/api/agenda/visits`, `/api/billing/usage` em paralelo e
  monta o `LayoutSpec` só com o que é real — nada de widget fictício (Decisões/
  Funil/Equipe-de-IA/Conversas ficaram de fora do caminho real porque não têm
  fonte de dado ainda). Saudação com hora real do dia + primeiro nome; se tudo
  zerado, mostra estado vazio honesto ("cadastre seu primeiro imóvel") em vez
  de inventar número. Novos widgets `leadsList` (leads reais, não confundir com
  "conversas de WhatsApp") e `emptyState`. Imobiliária/Incorporadora continuam
  mock (sem backend de Locação/Lançamentos ainda) — agora com selo visível
  **"prévia · dados de demonstração"** na barra superior sempre que
  `layout.isRealData !== true`, pra nunca confundir mock com dado da conta.
  Verificado: tsc/build limpos, sessão inválida cai no fallback vazio sem
  crash, troca de persona mostra/esconde o selo corretamente.
- **2026-07-02 — Etapa 3 (Carteira) CONCLUÍDA.** Novo `src/experience/CarteiraArea.tsx`,
  ligado à área "carteira" do rail em `ExperienceShell.tsx`. Reaproveita 100% do
  backend e do `PropertyForm.tsx` já existentes (nenhuma rota nova): lista
  `GET /api/properties`, cria/edita via `PropertyForm`, exclui (`DELETE`), alterna
  disponível/vendido (`PATCH .../status`), copia link da landing pública. Corrigido
  antes de finalizar: `PropertyForm` já renderiza seu próprio modal (não pode ser
  envolvido por outro); os campos estruturados (quartos/banheiros/área/etc.) vêm
  separados em `details` pela API e precisam ser remesclados em `initialData` antes
  de editar, senão o próximo salvamento apaga esses campos. Verificado: `tsc`
  limpo, `vite build` ok, e teste ao vivo com a conta real do usuário — Carteira
  mostra os 4 imóveis reais (bate com o KPI do cockpit), "Editar" abre o formulário
  com todos os campos (quartos, banheiros, área, garagem, descrição, fotos) já
  preenchidos corretamente a partir do dado real.
- **Próximo:** nenhuma etapa nova aprovada ainda — aguardando o usuário decidir a
  próxima (Etapa 2 completa/Conversas, Etapa 4/Negócios, ou deploy do que já existe).
