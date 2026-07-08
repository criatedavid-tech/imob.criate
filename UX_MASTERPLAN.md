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
- **2026-07-03 — Etapa 2 (Conversas) PARCIAL — ~50%, dentro da iniciativa maior de
  eliminar o Z-PRO (ver [[project_imobiflow_zpro_elimination]] e o plano
  `C:\Users\Criate\.claude\plans\stateless-drifting-turing.md`).
  `src/experience/ConversasArea.tsx` construído (abas ia/aguardando/encerrado,
  thread, resposta manual, toggle de IA), backend em `server/routes/wppShim.ts` +
  `server/services/wppShim.ts` (disfarce que substitui o Z-PRO no envio de
  mensagens). Saída (IA/corretor→cliente) testada de ponta a ponta com envio real
  contra a instância do Hunter. Entrada (cliente→IA) ainda é formato hipotético,
  nunca observado com tráfego real. Nenhum corretor migrado de fato — Hunter
  continua 100% no Z-PRO até a Fase 3 do plano.
- ✅ **Commit feito 2026-07-03 (`8443173`)** — todo o backend modularizado
  (Etapas 0/1/3 desta rodada) + Etapa 2 acima, tudo em `main`. **Ainda NÃO
  deployado** — produção (`imobiflow.fly.dev`) continua no código anterior.
  Achado: `.github/workflows/deploy.yml` faz `flyctl deploy` automático em todo
  `git push` pra `main` — o próximo push já É o deploy.
- **2026-07-06 — Etapa 4 (Negócios) CONCLUÍDA — núcleo real.** Novo
  `src/experience/NegociosArea.tsx`: funil kanban (Novo/Em contato/Visita/Proposta/
  Fechado) sobre os leads já existentes (`GET /api/leads`, mesma fonte do widget
  "leads recentes" do cockpit) — nenhuma tabela nova. Mover de coluna reaproveita
  `PATCH /api/leads/:id/status`, que já existia mas nunca tinha UI nenhuma. Cadastro
  manual de lead (modal "Novo lead") é a primeira forma do corretor adicionar um lead
  direto, sem depender da landing page pública. **Deixado de fora de propósito:**
  previsão de fechamento por IA e alerta de "negócio esfriando" — a lista mestre
  pede isso, mas não existe fonte real pra calcular ainda.
- **2026-07-06 — Etapa 5 (Agenda) CONCLUÍDA — reaproveita 100%.** Novo
  `src/experience/AgendaArea.tsx` é só um cabeçalho em volta do `AgendaCalendar.tsx`
  que já existia (calendário mensal + CRUD de visitas via `/api/agenda/visits`) —
  zero rota nova.
- **2026-07-06 — Correção de telefone (Negócios + Agenda).** Campo de telefone
  aceitava qualquer caractere e qualquer tamanho. Criado `src/lib/phone.ts`
  (`digitsOnly` com limite de 11 dígitos, `normalizePhoneBR` — mesma lógica de
  `server/lib/crypto.ts`) — campo agora só aceita dígitos, trava em 11, e mostra
  prefixo fixo "+55". Valor salvo já sai no formato `55DDDNNNNNNNN`, igual ao que
  N8N/UAZAPI esperam.
- **2026-07-06 — Etapa 6 (Locação) CONCLUÍDA — núcleo real.** Novo
  `server/routes/locacao.ts` (`imf_rental_contracts`, migração
  `20260706_locacao_lancamentos.sql`) + `src/experience/LocacaoArea.tsx`: CRUD de
  contrato de locação (inquilino, proprietário, imóvel opcional, valor do aluguel,
  dia de vencimento, encerrar). **Deixado de fora de propósito** (dependem de
  integração externa que não existe ainda): reajuste automático (precisa de índice
  IGPM/IPCA), repasse ao proprietário (precisa de split de pagamento), boletos
  (precisa de gateway), DIMOB (emissão fiscal real), vistoria (upload de fotos),
  área do locatário/proprietário (portal separado, outra superfície de auth).
- **2026-07-06 — Etapa 7 (Lançamentos) CONCLUÍDA — núcleo real.** Novo
  `server/routes/lancamentos.ts` (`imf_developments` + `imf_units`, mesma migração
  acima) + `src/experience/LancamentosArea.tsx`: espelho de vendas (mesma paleta de
  cor do widget mock do cockpit) + reserva com trava por tempo (expira sozinha ao
  recarregar a tela, sem cron novo) + marcar vendida/liberar. **Deixado de fora de
  propósito:** tabela de preço avançada (plano de pagamento), simulador de
  proposta+PIX (precisa de gateway), backoffice de aprovação de documentos.
- **2026-07-06 — Rodada de bugs achados testando ao vivo, todos corrigidos:**
  campo de valor (aluguel/preço) sem limite de tamanho/formatação → máscara
  estilo calculadora de banco (`src/lib/money.ts`); dropdown de imóvel com
  fundo branco no Chrome/Windows → estiliza `<option>` direto; não dava pra
  editar lead depois de criado → `PATCH /api/leads/:id` novo + modal dual
  create/edit; widgets "Leads recentes"/"Próximas visitas" do cockpit não
  levavam a lugar nenhum → agora navegam pra Negócios/Agenda.
- **2026-07-06 — Etapa 8 (Financeiro) CONCLUÍDA — núcleo real, bem mais fino
  que a lista mestre.** Novo `server/routes/financeiro.ts` + `FinanceiroArea.tsx`:
  resumo agregando receita de locação ativa + receita de vendas de lançamentos
  (dado que já existe, nenhuma tabela nova). Carteira (`imf_properties`) fica de
  fora do agregado de propósito — o preço lá é texto livre, não confiável de
  somar. **Deixado de fora** (bloqueado, não é só "não fiz ainda"): fluxo de
  caixa com histórico de movimentos, comissão com pagamento real,
  inadimplência, informe de rendimentos — todos dependem de rastrear
  pagamento de aluguel de verdade, que a Etapa 6 não construiu de propósito.
- **2026-07-06 — Etapa 9 (Equipe) CONCLUÍDA — só a fatia que dava pra
  construir sem inventar dado.** Novo `server/routes/equipe.ts` +
  `EquipeArea.tsx`: meta pessoal do mês vs. negócios fechados de verdade
  (`leads.closed_at`, novo — setado no `PATCH /api/leads/:id/status` quando o
  status vira "fechado"). **Bloqueado por decisão de produto, não construído:**
  cadastro de corretores/equipes, hierarquia/permissões, ranking, distribuição
  de leads — tudo isso pressupõe múltiplos usuários numa mesma conta, e hoje
  o ImobiFlow é 1 conta = 1 corretor. Isso é uma decisão de produto (permitir
  contas com vários corretores? como fica o billing por conta?), não uma tela
  que falta desenhar — precisa ser decidida antes de qualquer código novo aqui.
- ✅ Tudo commitado na branch `v2` (não `main`) — `git push` normal não aciona
  deploy, só push em `main` aciona (`.github/workflows/deploy.yml`). `main` e
  produção continuam intocados de propósito, a pedido do usuário, até decisão
  explícita de dar merge.
- **2026-07-06 — Etapa 13 (cérebro real) + Etapa 12 (autonomia real)
  CONSTRUÍDAS — as duas peças centrais da tese, num golpe só.** A command bar
  deixou de ser mock: `server/services/agent.ts` monta um snapshot REAL da
  conta (imóveis com id/preço/status, contagem de leads por estágio, próximas
  visitas, contratos ativos) e manda pro Gemini com saída estruturada
  (`responseSchema`), que decide entre `answer` / `navigate` / `create_lead` /
  `create_visit`. `server/routes/agent.ts`: `POST /api/agent/command` (interpreta)
  + `POST /api/agent/execute` (confirma ação proposta). `CommandBar.tsx` virou
  um chat de verdade (transcrição, navegação automática, card de confirmação).
  **A autonomia agora GOVERNA de verdade** (antes era só um selo): piloto
  executa a ação na hora; copiloto/manual propõem e esperam o "Confirmar".
  Toda mutação revalida posse do imóvel no backend (`executeAction`), e a
  execução usa os mesmos inserts das telas manuais — a IA não tem atalho
  privilegiado. Ação concluída dá `refresh` → a área atual remonta e mostra o
  resultado na hora.
- ⚠️ **NÃO testado ao vivo — bloqueio de credencial, não de código.** `tsc` +
  `vite build` limpos, servidor sobe, rotas respondem 401 (autenticadas). Mas
  as DUAS chaves de LLM deste ambiente estão inutilizáveis: `GEMINI_API_KEY`
  local está com cota free-tier = 0 (429 em qualquer chamada, os dois modelos),
  e `OPENROUTER_API_KEY` local não é uma chave OpenRouter válida (39 chars, sem
  prefixo `sk-or-`). O agente usa `gemini-2.0-flash-lite`, o MESMO modelo do
  `enhance-text` (`ai.ts`) que já roda em produção — então a chave Gemini de
  PRODUÇÃO (no Fly) provavelmente tem cota e faz funcionar lá. Erro de cota
  agora devolve mensagem honesta e distinta ("a IA atingiu o limite de uso da
  chave"), não some como bug genérico. **Decisão do operador antes de confiar:**
  confirmar que a chave Gemini de produção tem cota pra esse uso a mais, ou
  fornecer uma chave com billing pra teste local.
- **2026-07-06 — Sobre o agente: chave de IA sem cota (bloqueio de credencial,
  confirmado 2x).** Duas chaves Gemini distintas devolveram `free_tier ...
  limit: 0` — a conta Google não tem cota de free-tier de Gemini (região/projeto
  sem grant, ou sem billing). A `OPENROUTER_API_KEY` local também é inválida
  (sem prefixo `sk-or-`). O print do usuário provou que TODO o encanamento da
  command bar funciona ponta a ponta (só a chamada ao modelo falha, com a
  mensagem honesta de cota). Usuário optou por **pausar o teste ao vivo** do
  agente — fica construído e commitado, acende quando houver chave com cota
  (OpenRouter free ou billing Gemini). ⚠️ Implicação: se a chave Gemini de
  produção for dessa mesma conta, o "melhorar texto" (`ai.ts`) também está
  quebrado em prod — vale confirmar.
- **2026-07-06 — Etapa 11 (Relatórios) CONSTRUÍDA — dado real determinístico,
  sem depender de LLM (testável já).** `server/routes/relatorios.ts`
  (`GET /api/relatorios/summary?months=N`) + `RelatoriosArea.tsx`: métricas de
  conversão (lead→fechado via `closed_at`), leads por mês (gráfico de barras
  CSS, sem lib nova), distribuição no funil, receita do período (locação +
  vendas), visitas realizadas/agendadas, e um resumo em linguagem natural
  montado dos números reais. A versão "a IA escreve o relatório" pluga no mesmo
  agente (`server/services/agent.ts`) quando a chave tiver cota — por ora o
  resumo é determinístico e honesto sobre isso.
- **2026-07-06 — Etapa 10 (Divulgação, vitrine pública) CONSTRUÍDA — testada
  de ponta a ponta, é pública (sem auth).** Novo `GET /api/vitrine/:brokerId`
  (`server/routes/vitrine.ts`) + página `/vitrine/:brokerId`
  (`src/pages/Vitrine.tsx`) reaproveitando o landing individual `/p/:slug` já
  existente — cada card leva pro imóvel, onde já vive contato/agendamento.
  `DivulgacaoArea.tsx` (rail "Divulgação") mostra o link, copiar/abrir, e
  contagem de imóveis no ar. **Bug real achado testando ao vivo, corrigido:**
  `imf_brokers.broker_address` do Hunter tinha um JSON de outra origem
  (`{"title":"Principal Broker",...}`) em vez de endereço — a vitrine pública
  ia mostrar esse JSON cru. Corrigido com uma guarda (endereço que começa com
  `{` não é exibido) tanto no endpoint público quanto no Config. **Deixado de
  fora:** portais (OLX/ZAP/Viva Real, cada um exige integração própria) e
  disparo de campanha em massa (depende do envio direto por WhatsApp, RESOLVE
  junto com a eliminação do Z-PRO).
- **2026-07-06 — Etapa 14 (Conta/Config) CONSTRUÍDA, incluindo faturas +
  termos.** `ConfigArea.tsx` (rail "Config") reaproveita 100% endpoints que já
  existiam — zero rota nova: perfil (`brokers/me|settings`), plano/status,
  **histórico de faturas de excedente + uso do ciclo** (`billing/usage`, já
  existia mas nunca tinha UI), **status dos Termos aceitos** (`terms/status`,
  idem), e instruções da IA (`brokers/my-agent`). **Deixado de fora:**
  documentos/assinatura eletrônica (precisa de serviço externo de e-sign),
  preferências de notificação, mudar plano/forma de pagamento pela tela nova
  (checkout completo só existe no sistema antigo).
- **Estado do teste:** vitrine pública testada de ponta a ponta (é pública,
  sem auth — deu pra confirmar sozinho). Config e Divulgação (as partes atrás
  de login) só passaram por `tsc`/`build`/boot limpos — ainda sem confirmação
  do usuário ao vivo.
- **2026-07-07 — Cobrança real de aluguel (boleto/PIX) CONSTRUÍDA, mesmo
  padrão da assinatura — código completo, NÃO testada ao vivo de propósito.**
  Nova migração `20260707_locacao_boleto_pix.sql` (`imf_rental_payments` +
  `tenant_cpf_cnpj`/`asaas_customer_id` em `imf_rental_contracts`). Novo
  `server/services/rentalBilling.ts` (`generateRentCharge` — cria cliente Asaas
  do inquilino se não existir, gera boleto+PIX, idempotente por mês —, e
  `handleRentalPaymentWebhook`, plugado em `server/routes/billing.ts` ANTES da
  cadeia de assinatura, pra pagamento de aluguel nunca ser confundido com
  pagamento de assinatura). Novo `POST /api/locacao/contracts/:id/charge` e
  `GET /api/locacao/contracts/:id/payments`. `GET /api/locacao/contracts`
  agora devolve `current_month_payment_status` por contrato (com enforcement
  preguiçoso: `pending` com `due_date` vencido já mostra `overdue` na hora,
  mesmo padrão do `grace_until` da assinatura), base real de inadimplência
  usada no cockpit da Imobiliária. **⚠️ Bloqueio de credencial, não de
  código:** `.env` local aponta `ASAAS_ENV=production` e a chave sandbox já foi
  retirada — não existe ambiente seguro pra disparar uma chamada de teste
  daqui. Fica construído e revisado (segue o padrão comprovado de
  `services/billing.ts`), mas nunca invocado neste ambiente. **Requer rodar a
  migração no Supabase antes de qualquer teste.**
- **2026-07-07 — Cockpits de Imobiliária e Incorporadora deixaram de ser mock
  — agora 100% dado real, igual ao do Corretor.** `engine.ts` teve o motor
  mock inteiro removido (`buildLayout`/`LAYOUTS` e os 3 `LayoutSpec` literais —
  confirmado por grep que nada mais referenciava). Novo em `realData.ts`:
  `fetchIncorporadoraLayout()` (KPIs de VGV vendido/unidades vendidas/reservas
  ativas/leads do dia — reaproveita `financeiro/summary` pro VGV, sem resomar
  preço; espelho de vendas real; decisão real quando uma reserva está a <3h de
  expirar, com "Estender"/"Liberar" agindo de verdade via `PATCH
  /api/lancamentos/units/:id`) e `fetchImobiliariaLayout()` (KPIs de leads/
  conversão/contratos ativos/inadimplência — usa o `current_month_payment_status`
  acima; decisão real "Ver contrato" nos até 2 primeiros contratos em atraso,
  navega pra Locação). `ExperienceShell.tsx` agora chama as 3 fetchers reais
  sem fallback pra mock. Nova ação `estender` em `PATCH
  /api/lancamentos/units/:id` (recalcula `reserved_until` a partir de AGORA,
  só se a unidade estiver `reservado`). `Decisions` (`widgets.tsx`) deixou de
  ser decorativo — aceita `onPrimary`/`onGhost` (closures reais montadas em
  `realData.ts`), com spinner e disabled durante a ação. **Deixado de fora de
  propósito:** "Sua equipe"/ranking/distribuição de leads pra Imobiliária —
  mesmo bloqueio de decisão de produto já registrado na Etapa 9 (1 conta = 1
  corretor hoje). **Estado do teste:** `tsc`/`vite build` limpos, servidor
  sobe limpo, todas as rotas novas/alteradas respondem 401 (autenticadas, não
  404/500) — ainda sem confirmação ao vivo do usuário (preciso da sessão dele
  pra ver dado real na tela).
- **2026-07-07 — DEPLOY + ROLLBACK + correções de auth/perfil (episódio real).**
  Sequência: mergeamos `v2`→`main` e demos push → deploy automático no Fly OK
  (release v100, ~9min). Usuário testou `imobiflow.fly.dev/app` com 2 perfis do
  Chrome e caiu direto em contas de outros corretores (Diego/David) sem tela de
  login. **Revertemos produção NA HORA** via `fly deploy -i <imagem da v99>`
  (redeploy da imagem anterior, sem passar pelo Git/CI — mais rápido). Produção
  voltou pro código antigo (v99 = commit `9be41c1`); confirmado por curl (rotas
  novas voltaram a dar 404). ⚠️ **Drift consciente:** `main` no GitHub segue em
  `8311af1` (código novo), mas o que RODA em produção é a imagem da v99 — logo,
  qualquer push em `main` REFAZ o deploy do código novo e desfaz o rollback.
  Diagnóstico da causa raiz: **não era vazamento de auth** — o backend valida o
  JWT de verdade (`requireUser`/`verifyAccessToken`) e isola tudo por `broker_id`
  derivado do token, sem OAuth Google nem fallback compartilhado. Eram DUAS
  lacunas de UX no `/app`: (1) não existia botão de "Sair" em lugar nenhum →
  sessão antiga salva no localStorage de cada perfil do Chrome ficava presa;
  (2) a barra não mostrava em qual conta você estava. Corrigido: botão "Sair da
  conta" no Config (commit `41c9401`) + indicador de conta logada na barra.
- **2026-07-07 — Tipo de conta REAL (corretor/imobiliaria/incorporadora) —
  commit `6ee1c6e` na `v2`.** Auditoria pedida pelo usuário antes de re-deployar
  revelou que a "persona" era 100% um toggle no front ("ver como") que qualquer
  logado clicava — não havia coluna de tipo em `imf_brokers`, o cadastro nunca
  perguntava, e o backend lia a persona do corpo do request sem verificar.
  Decisões do usuário: tipo **escolhido no cadastro**; "ver como" **só pra
  admin**. Construído: migração `20260707_account_type.sql` (coluna
  `account_type`, default `corretor`, CHECK na lista fechada, backfill das
  contas existentes); seletor "Você é" no passo 1 do signup (grava o tipo);
  `/api/auth/signup` valida+grava, `/api/brokers/me` devolve `account_type` +
  `is_admin`; `ExperienceShell` trava a persona no `account_type` da conta e só
  mostra o seletor "ver como" pra `is_admin` (usuário normal vê o mundo dele
  como label fixo). **Isolamento de dados não mudou (já era sólido).**
  **⚠️ Requer rodar `20260707_account_type.sql` no Supabase ANTES de testar** —
  o `/api/brokers/me` já seleciona `account_type`; sem a coluna, dá 500.
  Gap conhecido não-bloqueante (dado já é isolado): rotas de feature específica
  (ex.: `/api/locacao/*` pra imobiliária) ainda não checam `account_type` no
  backend — um corretor que chamasse a rota direto veria só os PRÓPRIOS dados
  (provavelmente vazios), não de outra conta. Trava de UI cobre o visível;
  gating por tipo no backend fica como refino futuro.
- **2026-07-07 — Correções pós-teste: `/app` vira destino padrão pós-login +
  acesso ao admin de dentro do 2.0 (commits `8bce481`, `9c9b087`).** Testando
  as 3 contas de tipo, achamos que login/pós-pagamento ainda mandavam pra `/`
  (dashboard antigo) e que `/app` não tinha checagem de assinatura nenhuma
  (dava pra acessar o 2.0 sem pagar). Corrigido: `Login`/`PaymentSuccess` agora
  redirecionam pra `/app`; `/app` passou a ser embrulhado pelo mesmo
  `PrivateRoute` do dashboard antigo (login + assinatura ativa + `TermsGate`).
  Também: o 2.0 não tinha nenhuma entrada pro painel admin do 1.0 — adicionado
  botão "Admin" na barra superior (só `is_admin`) que abre `/admin` (reusa
  100% do painel existente, não reconstruído); o "voltar" de lá agora aponta
  pro `/app`. De quebra: rate limiter de auth/checkout (`max: 10/15min`)
  estourava rápido em dev (todo tráfego de teste sai do mesmo IP) — agora é
  ignorado fora de produção (`commit 05c7511`), produção não muda.
- **2026-07-07 — 🎉 Agente/cérebro real validado AO VIVO pela primeira vez
  (commit `d4cf59c`).** Bloqueio de credencial que travava as Etapas 12+13
  desde 2026-07-06 foi destravado: usuário forneceu uma chave OpenRouter
  (`sk-or-v1-612d...` — **a mesma chave já marcada em memória como exposta/
  pendente de revogação num node N8N antigo; usuário optou conscientemente por
  usá-la mesmo assim por agora, revogação/troca continua pendente**).
  `runAgent()` (`server/services/agent.ts`) ganhou um segundo caminho via
  OpenRouter (`openai/gpt-4o-mini`, `response_format: json_object`): usado
  quando não há chave Gemini configurada, OU como fallback automático se a
  chamada Gemini falhar por cota (o 429 já esperado — confirmado nos logs,
  `RESOURCE_EXHAUSTED`, cota free-tier 0). Gemini continua preferido quando
  configurado — nenhuma mudança em produção. **Testado ao vivo contra a conta
  de teste real** (`corretor.teste@imobiflow.test`): pergunta (answer) sobre
  leads respondeu correto com dado real (zero leads); navegação
  ("me mostra a agenda") resolveu `navigate:"agenda"` certo; criação de lead
  via IA (autonomia piloto = executa na hora) tentou e falhou HONESTAMENTE
  porque a conta de teste não tem imóvel na carteira — prova que a validação
  de posse (`executeAction`) funciona mesmo vindo da IA, sem atalho.
  **Esta é a primeira confirmação end-to-end da tese central do produto**
  ("funcionário que você supervisiona") funcionando de verdade.
- **⚠️ Pendência de segurança em aberto (não resolvida, não bloqueante pro
  teste):** a chave OpenRouter usada acima precisa ser **revogada e trocada**
  assim que possível — ela esteve exposta em texto puro num workflow N8N
  (`Gera resumo`) e está listada pra revogação em pelo menos 3 memórias
  diferentes há semanas. Usar ela pro agente é aceitável como teste temporário,
  mas não deve ir pra produção sem antes rotacionar.
- **2026-07-08 — 2 bugs reais achados testando o agente ao vivo, corrigidos.**
  (1) **Sem memória de conversa**: `runAgent()` tratava cada mensagem como
  isolada — o front (`CommandBar.tsx`) guardava o histórico na tela mas nunca
  mandava pro backend, então pedir "agenda visita com José Maria" e depois só
  "09/07 às 9h" fazia a IA esquecer o nome já dado. Corrigido: `POST
  /api/agent/command` agora aceita `history` (últimos turnos), repassado como
  conversa multi-turno pros dois provedores (`contents` do Gemini,
  `messages` do OpenRouter). (2) **Falso "não há nada"**: perguntado sobre uma
  data fora da janela de "próximas 5 visitas" que o snapshot carrega, a IA
  respondia "não há visita agendada" como se tivesse certeza — mas o snapshot
  nunca teve visibilidade sobre datas passadas/distantes pra começo de
  conversa. Prompt ajustado pra IA dizer honestamente "não tenho visibilidade
  sobre isso" quando a pergunta sai da janela que ela recebe, em vez de
  inferir ausência a partir de dado que nunca existiu no contexto dela.
  **Validado ao vivo**: com histórico, "qual o nome dela mesmo?" respondeu
  certo; sem histórico, respondeu "não tenho visibilidade" em vez de inventar.
- **2026-07-08 — Agente ganha 5ª ação, `query_agenda` (commit `2c08d4a`).**
  Pedido explícito do usuário ("isso é muito importante") depois do gap
  descoberto acima. A IA agora consulta QUALQUER data/período sob demanda
  (`date_from`/`date_to`) em vez de só saber responder "não tenho
  visibilidade" pra tudo fora das próximas 5 visitas / mês corrente. A
  resposta final é formatada direto em código (`queryAgendaRange`, sem 2ª
  chamada ao LLM) — mesmo princípio determinístico de Relatórios, hora/nome/
  status nunca passam por uma "reformulação" que poderia inventar algo.
  **Validado ao vivo**: visita real numa data passada (fora da janela do
  snapshot) foi encontrada e formatada certo; período vazio respondeu
  corretamente que não há nada. Um falso alarme no caminho: dado de teste
  criado via curl direto (bypassando o fluxo normal do app) ficou salvo com
  fuso ambíguo, mostrando hora errada — não era bug de código, era o dado de
  teste malformado (corrigido recriando com offset explícito `-03:00`).
- **2026-07-08 — Agente ganha 6ª ação, `send_message` (envio real de
  WhatsApp) — commits `79ae753` + `8556623`.** Achado ao vivo: pedir "envie
  uma mensagem pro número X oferecendo Y" fazia a IA cadastrar um LEAD em vez
  de enviar mensagem nenhuma — não existia ação de envio, só as 5 anteriores,
  então o LLM escolhia a mais parecida (create_lead). Nova ação reaproveita o
  MESMO caminho real de Conversas (`sendUazapiText` + insert em
  `imf_conversation_messages` sender_type `broker_manual` +
  `pauseAiForHumanTakeover`) — é mutação como create_lead/create_visit,
  autonomia governa. **Bug encontrado e corrigido na sequência**: esqueci de
  adicionar `send_message` na whitelist de `/api/agent/execute` (só aceitava
  create_lead/create_visit) — no modo copiloto, "Confirmar" sempre falhava
  com um erro genérico enganoso. Corrigido e revalidado.
- **2026-07-08 — Episódio real: teste de entrada UAZAPI desconectou o
  WhatsApp real do Hunter, reconectado com sucesso.** Tentativa de validar o
  payload real de entrada (`/api/wpp-shim/inbound/:instanceId`, ainda em modo
  sombra) usando uma instância UAZAPI isolada de teste + ngrok. **Causa raiz
  do incidente**: o "número reserva" usado pra conectar a instância de teste
  era, sem querer, o MESMO número real do Hunter — WhatsApp não permite duas
  sessões "principais" simultâneas pro mesmo número em instâncias/servidores
  diferentes, então cada nova conexão derruba a anterior. A instância real do
  Hunter (`rf925ed61e05cb0`) ficou `disconnected`; **reconectada com sucesso**
  via código de pareamento por telefone (mais confiável que QR, que expirava
  antes de escanear). Instância de teste isolada apagada, túnel ngrok
  encerrado. **Decisão:** validar o payload real de entrada fica pra uma
  sessão futura, com um número reserva GENUINAMENTE separado (não o do
  Hunter) — sem isso, qualquer teste de entrada arrisca derrubar o
  atendimento real dele de novo. Lição registrada: publicar QR/pairing code
  de uma instância REAL via link público (mesmo "privado por padrão") foi
  bloqueado pelo classificador de segurança — código de pareamento por
  WhatsApp é uma credencial de acesso à conta, nunca deve virar link
  compartilhável; mostrar sempre inline na conversa.
- **2026-07-08 — Varredura completa de validação funcional nas 3 personas —
  tudo passou, zero bugs de código novos.** Testado via API com as 3 contas
  de teste (login → perfil → todos os endpoints → CRUD real → agente):
  **Corretor** (dashboard/leads/agenda/carteira/billing/termos/relatórios/
  conversas/vitrine, todos 200 com dado real); **Imobiliária** (+ contrato de
  Locação criado→listado→encerrado de verdade, Financeiro refletindo o
  valor, meta de Equipe salva); **Incorporadora** (+ empreendimento+unidade
  criados de verdade, reservar→vender, Financeiro capturando a venda).
  **O mais importante: as 6 ações do agente testadas cruzado entre personas**
  (ex.: corretor pedindo "financeiro", imobiliária pedindo "lançamentos",
  incorporadora pedindo "locação") — em TODOS os casos o agente recusou
  `navigate` pra área fora do tipo de conta, respondendo honesto em vez de
  navegar errado (a separação por `account_type` está reforçada até no
  system prompt da IA, não só no menu visual). 2 falsos alarmes descartados
  (não eram bugs): rota `/api/equipe/summary` testada errada (a real é
  `/api/equipe/goal`, funciona); acento corrompido ("Goiânia"→"Goi�nia") era
  o terminal Windows/Git Bash mangling o argumento do curl, não o app —
  confirmado via `fetch` direto no Node que o UTF-8 é salvo perfeitamente.
- **Estado atual (2026-07-08, fim de sessão):** `v2` no commit `8556623`,
  árvore de trabalho limpa, tudo commitado. `main`/produção seguem no código
  ANTERIOR (revertido manualmente no Fly após o incidente de sessão/logout —
  ver entrada de deploy/rollback acima); `main` no GitHub já tem o código
  novo (`8311af1`), então um push refaz o deploy automaticamente.
- **Próximo:** rodar as migrações pendentes no Supabase (`20260707_account_type.sql`
  já confirmada; `20260706_financeiro_equipe_metas.sql` e
  `20260707_locacao_boleto_pix.sql` — confirmar se já rodaram, senão rodar
  antes do deploy). Revogar/trocar a chave OpenRouter exposta (`sk-or-v1-
  612d...`, em uso temporário no agente — ver nota de segurança). Decidir
  quando fazer o deploy de tudo (merge já está pronto em `main`) — sabendo
  que login/logout/tipo de conta/agente já foram validados localmente com as
  3 personas. Entrada real de WhatsApp (Fase 3-5 da eliminação do Z-PRO)
  continua pendente, precisa de um número de teste genuinamente separado do
  Hunter antes de tentar de novo.
