# Guia de Nós — ImobiFlow Workflows
> Explicação simples de cada nó nos 4 workflows. Nós com `[CODE]` têm a explicação do JavaScript logo abaixo.

---

## WF Principal — `JAm0IlPpQYXIxnp5`
> Recebe as mensagens do WhatsApp, faz triagem, chama a IA e envia a resposta.

### Seção 1 — Recepção e validação

**Webhook**
A porta de entrada: fica ouvindo na URL `/ia-atendimento-central`. Toda mensagem que o Z-PRO envia chega aqui primeiro.

**Respond 200**
Responde "recebi!" imediatamente ao Z-PRO antes de processar qualquer coisa — assim o Z-PRO não reenvia por achar que a mensagem se perdeu.

**Normaliza** `[CODE]`
Lê o JSON bruto do Z-PRO e extrai o essencial: quem mandou, o texto, se é imagem/áudio/texto, se foi o atendente ou o cliente, qual instância (tenant).
> *O código examina `body.content.type` para detectar o tipo de mídia pelo prefixo do base64 (iVBOR=PNG, /9j=JPG, T2dn=OGG…). Retorna um objeto limpo com: telefone, mensagem, tipo, instancia, fromMe, ticket_id.*

**Get Tenant**
Busca no banco qual empresa (tenant) é dona dessa instância Z-PRO. Filtra por `instancia` + `ativo=true`.

**Tenant existe?**
Portão: se ninguém cadastrado tem aquela instância, joga a mensagem fora. Só passa quem é cliente.

**Tenant inexistente**
Fim de linha para instâncias desconhecidas. Não faz nada — encerra silenciosamente.

**Get Config**
Busca as configurações específicas daquele cliente: debounce, TTL de cache, URL do estoque, modelo IA, follow-up ativo, etc.

**Get Credentials**
Busca as credenciais de envio: `zpro_link` (URL da API), `zpro_auth` (token) e `uazapi_token`. Precisará delas no final para enviar a resposta.

**Contexto** ⭐
O armário organizador: junta tudo (tenant, config, credenciais) num único objeto `ctx` que todos os nós seguintes consultam.

---

### Seção 2 — Handoff preventivo (atendente mandou)

**fromMe?**
Detecta se foi o atendente humano quem mandou a mensagem pelo painel Z-PRO. Se sim, desvia o fluxo para pausar a IA automaticamente.

**Get client (fromMe)**
Busca o cliente na tabela `ia_clients` para saber se ele já existe.

**Cliente existe (fromMe)?**
Já tem registro para esse telefone?

**Update pausa (fromMe)**
Pausa a IA para aquele cliente (`ia_pausada=true`). Humano assumiu o controle.

**Log pausa_humana**
Registra no log que a IA foi pausada porque um humano respondeu.

**Cria cliente (fromMe)**
Se o cliente não existia ainda, cria o registro e já marca a IA como pausada.

---

### Seção 3 — Cadastro e checagem do cliente

**Pre-registra** ⭐
Insere a mensagem na tabela temporária `ia_historico_msg_temp`. Essa "fila de espera" guarda mensagens enquanto o sistema aguarda ver se chegam mais. **Aqui começa o debounce.**

**É admin?**
Consulta `ia_admins`: esse número de telefone é administrador desse tenant? Admins têm poderes especiais (`@reset`, `n8nStatus`).

**IA ligada (admin)?**
O admin pode desligar a IA do tenant inteiro mandando `n8nStatus=false` pelo Z-PRO. Aqui verifica se está ligada.

**Get Client**
Busca o registro do cliente (usuário final) na tabela `ia_clients`.

**Resolve Client** `[CODE]`
Junta os dados do banco com o contexto. Se o cliente existe: carrega `ia_pausada` e `msgs_totais`. Se não existe: começa com `ia_pausada=false` e `msgs_totais=1`.
> *Verifica se o resultado do Supabase tem um `id` (registro real). Se sim, espalha os dados do banco sobre o ctx. Se não, retorna ctx com valores iniciais — será criado nos próximos nós.*

**Cliente existe?**
Primeiro contato ou cliente recorrente?

**Update client**
Incrementa o contador de mensagens do cliente.

**Cria client**
Cria o registro do cliente no primeiro contato.

**IA ativa?**
A IA está pausada para esse cliente específico? (handoff em andamento ou @pause)

**IA pausada (handoff)**
Encerra silenciosamente. Um humano está atendendo, a IA não interfere.

**Registra (IA off)**
Loga o evento: mensagem recebida mas IA estava pausada.

**Cancela followups pendentes**
Cancela follow-ups agendados para esse cliente — ele está online agora, não precisa mais de follow-up.

**@reset?**
A mensagem é exatamente "@reset"? Só admins podem usar esse comando.

**Limpa memoria**
Deleta TODO o histórico de chat daquela sessão (`ia_chat_histories`). A IA esquece tudo e começa do zero.

**Log reset**
Registra o evento de reset no log.

---

### Seção 4 — Triagem de mídias

**Switch tipo**
O sorting office: desvia o fluxo dependendo do tipo de mensagem (image/audio/video/document/location/text). Cada tipo segue um caminho diferente.

**Data image/audio/video/doc**
Extrai o base64 da mídia do payload do Z-PRO.

**Bin image/audio/video/doc**
Converte o base64 em arquivo binário — como desempacotar um ZIP para poder enviá-lo ao Gemini.

**Gemini image/audio/video/doc** `[AI: Gemini 2.5 Flash]`
Envia o arquivo para o Gemini analisar:
- Imagem → descreve o conteúdo
- Áudio → transcreve a fala
- Vídeo → descreve + transcreve
- Documento → extrai conteúdo relevante

**Msg image/audio/video/doc**
Formata o resultado do Gemini como texto para a IA principal ler. Ex: `[Imagem do cliente: pneu com corte lateral profundo]`.

**Msg location**
Converte as coordenadas GPS em texto: `[Localização do cliente: -23.55, -46.63]`.

**Msg texto**
Texto simples. Passa direto, sem processamento extra.

---

### Seção 5 — Debounce inteligente (sliding window)

**Aggregator**
Ponto de reagrupamento depois do Switch: reúne todos os dados de volta no mesmo objeto, agora com a `mensagem_final` já processada (mídia transcrita).

**Log mensagem_recebida**
Registra a mensagem recebida no log de atendimentos.

**Atualiza temp**
Atualiza o registro temporário com a mensagem processada (ex: áudio já transcrito substituindo o base64 original).

**Calcula tempo** `[CODE]`
Lê `debounce_seg` das configs (padrão: 20s). Limita entre 3s (mínimo) e 180s (máximo).
> *Uma linha só: `Math.min(180, Math.max(3, base))`. Protege contra configs absurdas (0s ou 9999s).*

**Aguarda mais msgs** ⭐
Dorme pelo tempo calculado. Durante essa pausa, outras mensagens do mesmo cliente podem chegar e se acumular na tabela temporária.

**Verifica nova msg**
Ao acordar, busca TODAS as mensagens na fila temporária para aquele tenant+telefone.

**Sliding window check** `[CODE]` ⭐
O detetive anti-duplicata: compara o ID desta execução com o maior ID na fila. Se existe mensagem mais recente, encerra esta execução — só a última responde.
> *Pega `meuId` do Pre-registra. Calcula `maxId` da lista. Se `maxId > meuId` → `return []` (encerra). Só sobrevive a execução com o maior ID. Isso garante que se o cliente mandar 3 mensagens rápidas, apenas uma resposta sai.*

**Consome msgs**
Deleta TODAS as mensagens da fila temporária para aquele cliente de uma vez. Operação atômica: a execução que deletar mais itens é a vencedora.

**Consolida conversa** `[CODE]`
Pega todos os registros deletados, ordena por ID (ordem real de chegada) e junta em uma string única separada por `\n`.
> *Se a lista vier vazia (outra execução paralela já consumiu), retorna `[]` encerrando esta execução. Caso contrário, faz `.sort((a,b) => a.id - b.id)` e `.join("\n")` — garante ordem correta mesmo que mensagens cheguem fora de ordem.*

---

### Seção 6 — Cache de estoque

**Get cache estoque**
Busca o cache de estoque (planilha/catálogo) salvo para esse tenant.

**Cache valido?**
O cache ainda está dentro do prazo de validade (`expira_em > agora`)? Se sim, pula o fetch e usa o que está salvo.

**Prepara fetch** `[CODE]`
Verifica se o cliente tem estoque configurado. Se for Google Sheets, converte a URL para formato CSV exportável.
> *Checa `estoque_modo`: se "none" ou sem URL → `skip_fetch=true`. Se "sheets" → extrai o ID da planilha e monta a URL do endpoint CSV do Google Visualization API (`/gviz/tq?tqx=out:csv`).*

**Sem estoque?**
Cliente sem catálogo configurado? Pula o fetch e segue com tabela vazia.

**Fetch planilha**
HTTP GET na URL do estoque (Google Sheets como CSV). Timeout de 30s.

**Formata tabela** `[CODE]`
Parser de CSV completo: lê linha por linha, trata aspas, vírgulas dentro de campos, e converte tudo para uma tabela Markdown que a IA consegue ler.
> *Implementa parser CSV do zero para tratar casos como `"valor, com vírgula"` e `"campo com ""aspas"""`. Gera tabela Markdown com header + separador + linhas. Calcula hash do conteúdo para detectar mudanças futuras e evitar salvar cache idêntico.*

**Cache row existe?**
Já existe um registro de cache no banco para esse tenant?

**Update cache / Cria cache**
Salva o cache com tabela formatada + hash + nova data de expiração. Atualiza se já existe, cria se é novo.

**Merge estoque**
Pega a `tabela_formatada` — seja do cache válido ou do recém-buscado — e coloca no contexto.

---

### Seção 7 — Guard Rails e IA

**Guard Rails** `[CODE]` ⭐
O segurança: verifica se a mensagem tem prompt injection, dados sensíveis ou spam ANTES de chamar a IA cara.
> *Testa regex para:*
> *1. Prompt injection: "ignore as instruções", "jailbreak", "DAN", "pretend to be"...*
> *2. Dados sensíveis: CPF (xxx.xxx.xxx-xx), cartão (16 dígitos), CVV, senha:, API keys (sk-...)*
> *3. Spam: caractere repetido 15x+*
> *Detectando algo, marca evento no log mas permite continuar (ação=warn) — a IA ainda responde.*

**Prepara input IA**
Monta o payload final para o subworkflow: `tenant_id`, `telefone`, `conversa` consolidada, tabela de estoque, credenciais, config de follow-up e muito mais.

**Parse OpenRouter** `[Chama subworkflow WF IA]` ⭐
Chama o subworkflow `wGSLzbJRjKVvA1SZ` e aguarda a resposta da IA. É aqui que a "mágica" acontece.

---

### Seção 8 — Persistência e saída

**Salva user msg**
Grava a mensagem do cliente no histórico de chat (`ia_chat_histories`) com `role=user`.

**Salva assistant msg**
Grava a resposta da IA no histórico com `role=assistant`.

**Atualiza historico cliente**
Atualiza `ia_clients` com timestamp da última interação.

**Log resposta_ia**
Registra `tokens_in`, `tokens_out`, latência e outros metadados da resposta.

**Switch acao**
A IA retorna uma ação:
- `continuar` → responde e segue normalmente
- `transferir` → passa para humano (handoff)
- `transferir_agente` → muda para outro agente IA

---

### Saída: continuar

**Quebra blocos (continuar)** `[CODE]`
Limpa a resposta da IA: remove tags `[bloco]`/`[/bloco]`, asteriscos, aspas e espaços extras. Retorna uma mensagem limpa.
> *Remove `[bloco]` e `[/bloco]` com regex. Limpa `['"•*#]+` (asteriscos, bullet points, aspas). Colapsa espaços duplos. Retorna objeto com `line`, `telefone` e tokens uazapi.*

**Loop continuar → Envia uazapi → Wait 4s → Fim continuar**
Processa as mensagens uma a uma. Envia via UAZAPI, pausa 4 segundos entre mensagens (simula digitação humana).

**Precisa followup?**
A IA marcou `precisa_followup=true`? Agenda um follow-up.

**Agenda followup**
INSERT em `ia_followups` com telefone, tenant e mensagem sugerida.

---

### Saída: transferir para humano

**Aplica rota** `[CODE]`
Encontra qual rota de handoff usar baseado na categoria que a IA retornou (ex: "financeiro", "suporte").
> *Busca em `ia_tenant_handoff_routes` a rota cuja categoria bate com a da IA. Se não encontrar exata, pega a de menor número de prioridade. Se não houver nenhuma, usa defaults genéricos.*

**Gera resumo**
HTTP POST ao OpenRouter (GPT-4o-mini) pedindo um resumo da conversa para virar nota interna no Z-PRO.

**Extrai resumo** `[CODE]`
Extrai o texto do resumo da resposta da API e formata como `[NOTA INTERNA HANDOFF]\nResumo...`.
> *Mergulha em `r.choices[0].message.content` com try/catch. Se falhar, usa texto padrão. Prepende o cabeçalho de nota interna.*

**Nota + tag + fila (painel)**
HTTP POST à API Z-PRO: adiciona a nota interna no ticket, aplica tag e move para a fila do atendente responsável.

**WhatsApp interno**
Envia mensagem diretamente para o WhatsApp do atendente humano informando que um cliente precisa de atenção.

**Pausa IA (handoff)**
Atualiza `ia_clients` com `ia_pausada=true`. IA silencia para aquele cliente.

**Log handoff**
Registra o evento de handoff.

**Quebra blocos (handoff)** `[CODE]`
Extrai a mensagem de despedida para o cliente. Suporta tags `[bloco]` para múltiplas mensagens separadas.
> *Usa regex `/\[bloco\]([\s\S]*?)\[\/bloco\]/g` para extrair blocos. Texto fora dos blocos é dividido por frases (`.!?`). Cada parte vira um item separado para o loop de envio.*

**Loop handoff → Envia uazapi (handoff) → Wait 4s → Fim handoff**
Envia a mensagem de despedida ao cliente em blocos, com pausa de 4s entre cada um.

---

### Saída: trocar agente IA

**Troca agente**
UPDATE em `ia_clients` com `agente_atual=<slug_do_novo_agente>`. Na próxima mensagem do cliente, o subworkflow carregará o novo agente especialista.

---

## WF IA Sub — `wGSLzbJRjKVvA1SZ`
> Chamado pelo WF Principal. Busca contexto, monta o prompt, chama o modelo IA e parseia a resposta.

**Execute Workflow Trigger** ⭐
A campainha do subworkflow. Recebe TODOS os dados do WF Principal (contexto, conversa, credenciais) e os expõe como `$input`.

**Get chat history**
Busca as últimas 20 mensagens da sessão no `ia_chat_histories`, filtrando por `session_id = tenant_id::telefone`.

**Get rotas handoff**
Busca todas as rotas de handoff configuradas para o tenant (`ia_tenant_handoff_routes`).

**Get agente**
Busca o agente ativo para o tenant e o slug atual (ex: "default"). O agente contém o `system_prompt` personalizado do cliente.

**Dedup (chat history)** `[CODE]`
Garante que mesmo que o Supabase retorne múltiplos itens, só 1 passa para frente. Evita que o n8n multiplique execuções dos nós seguintes.
> *Uma linha: `return [$input.all()[0] || { json: {} }]`. O n8n cria 1 execução por item retornado — isso "espreme" de volta para 1.*

**Dedup (rotas handoff)** `[CODE]`
Mesmo mecanismo para as rotas de handoff.
> *Idêntico ao Dedup acima: força a lista de saída para exatamente 1 item.*

**Prepara contexto IA** `[CODE]` ⭐
O chef que monta o prato: junta system prompt do cliente, horário atual (SP), saudação correta, histórico formatado, catálogo, regras e rotas num único prompt mestre.
> *1. Calcula hora em São Paulo com `Intl.DateTimeFormat` → define saudação (Bom dia 6-12h, Boa tarde 12-18h, Boa noite resto)*
> *2. Formata histórico como "Cliente: xxx\nAtendente: yyy" (últimas 20 msgs)*
> *3. Concatena em sysMsg: prompt do cliente + horário crítico + histórico + estoque + regras gerais + rotas de handoff + instruções de formato `[bloco]`*

**Agente IA Principal** `[AI Agent]`
O cérebro principal: recebe `system_prompt` + `user_message` e chama o modelo de linguagem.

**Model Principal** `[Gemini 2.5 Flash]`
Modelo padrão: `google/gemini-2.5-flash` via OpenRouter. Modo JSON obrigatório (`responseFormat: json_object`). Temperatura 0.7.

**Agente IA Fallback** `[AI Agent]`
Plano B: se o Principal falhar (timeout, erro de API), tenta com o modelo de fallback.

**Model Fallback** `[GPT-4o-mini]`
`openai/gpt-4o-mini` como reserva. Temperatura 0.5 (mais conservador). Mesmo formato JSON.

**Emergencia IA** `[CODE]`
Último recurso: se tudo falhar, retorna uma mensagem amigável hardcoded.
> *Retorna objeto fixo com `resposta="Desculpe, estou com uma instabilidade técnica..."` + `precisa_followup=true`. O cliente recebe uma mensagem humana mesmo sem IA funcionando.*

**Parse OpenRouter** `[CODE]` ⭐
O alfandegário: desembrulha a resposta crua da IA (pode vir aninhada em vários níveis de `.output`) e extrai os campos estruturados.
> *Vai desaninhando `.output` até 3 níveis (a IA pode retornar string JSON dentro de objeto dentro de string...). Extrai: `resposta`, `acao`, `categoria`, `intencao`, `precisa_followup`, `followup_msg`, `transferir_para_agente`. Estima tokens por comprimento ÷ 4 chars. Calcula latência em ms. Retorna objeto limpo e padronizado.*

---

## WF Follow-up 1h — `gWkN0PmjQ7EH8Mpg`
> Dispara a cada 5 minutos. Envia mensagem personalizada pela IA para clientes que ficaram sem resposta há 1h.

**Cron 5min**
Despertador automático: dispara a cada 5 minutos, 24/7. É a "batida de coração" deste workflow.

**Horário Comercial**
Só age entre 7h e 18h, segunda a sábado (horário de São Paulo). Fora desse período, o n8n acorda, verifica, e volta a dormir.

**Busca Candidatos 1h** ⭐
Busca na view `vw_followup_1h` todos os clientes que: ficaram mais de 1h sem responder + não receberam follow-up 1h ainda + tenant ativo. A view já une todos os dados necessários (incluindo `zpro_link` e `zpro_auth` por tenant).

**Loop Candidatos 1h**
Processa um candidato por vez. Se houver 10 clientes elegíveis, cada um recebe sua mensagem individualmente, em sequência.

**Gera Follow 1h** `[AI Agent Gemini 2.5 Flash]`
Analisa o histórico da conversa e gera uma mensagem personalizada: máximo 2 frases, tom amigável, menciona algo da conversa anterior.

**Google Gemini**
Gemini 2.5 Flash conectado ao agente acima. O modelo que gera a mensagem personalizada.

**Registra Follow 1h** ⭐
INSERT em `ia_followups` com `status='enviando'`. Registra ANTES de enviar — se o envio falhar, o status "enviando" fica e não tenta de novo desnecessariamente. **(Fail-safe)**

**Envia Follow UAZAPI**
HTTP POST à API Z-PRO do tenant específico. `zpro_link` e `zpro_auth` vêm da view — cada cliente tem os seus próprios, garantindo isolamento entre tenants.

**Atualiza Follow 1h**
UPDATE em `ia_followups` para `status='enviado'`. Só atualiza depois que o envio foi confirmado.

---

## WF Follow-up 24h — `G8k2iaD6AVncDk2v`
> Dispara a cada 30 minutos. Envia mensagem fixa de reengajamento para clientes sem resposta há 24h.

**Cron 30min**
Despertador a cada 30 minutos — menos frequente que o de 1h porque é mais raro ter candidatos.

**Horário Comercial**
Mesma regra: só age entre 7h e 18h (São Paulo), de segunda a sábado.

**Busca Candidatos 24h** ⭐
View `vw_followup_24h`: clientes sem resposta há 24h + que já receberam follow-up 1h + não receberam o de 24h ainda. Retorna `zpro_link` e `zpro_auth` por tenant.

**Loop Candidatos 24h**
Processa um por vez.

**Mensagem Fixa 24h**
Ao contrário do follow-up 1h (que gera mensagem personalizada com IA), aqui usa uma mensagem fixa pré-definida:
> *"Oi! Tudo bem? 😊 Percebi que faz um tempinho que não nos falamos. Caso queira continuar buscando o imóvel ideal, estou aqui para ajudar! Quando quiser, é só falar."*

**Registra Follow 24h** ⭐
INSERT com `status='enviando'` antes de enviar. Mesmo padrão fail-safe do Follow 1h.

**Envia Follow UAZAPI**
HTTP POST à API Z-PRO do tenant, usando `zpro_link` e `zpro_auth` que vêm da view por linha — isolamento total entre tenants.

**Atualiza Follow 24h**
UPDATE para `status='enviado'` após confirmação de envio.

---

## Pontos críticos para lembrar

| Conceito | Onde acontece | Por quê importa |
|---|---|---|
| Sliding Window | WF Principal — `Sliding window check` | Se o cliente mandar 3 msgs rápidas, só 1 resposta sai |
| Debounce | `Calcula tempo` + `Aguarda mais msgs` | Aguarda N segundos para ver se chegam mais msgs |
| Dedup n8n | WF IA — `Dedup (chat history/rotas)` | O Supabase retorna N itens → n8n criaria N execuções |
| Fail-safe | Follow-up 1h e 24h — `Registra` antes de `Envia` | Garante que status fique consistente mesmo se envio falhar |
| Isolamento multi-tenant | Views `vw_followup_*` | Cada linha da view já traz `zpro_link`/`zpro_auth` do tenant correto |
| Prompt mestre | WF IA — `Prepara contexto IA` | É aqui que o prompt do cliente + horário + histórico + catálogo viram 1 system prompt |
| Parse cascata | WF IA — `Parse OpenRouter` | A IA pode retornar JSON dentro de string dentro de objeto — o código desembrulha até 3 níveis |

---

*Gerado em: 2026-06-11 | Workflows: JAm0IlPpQYXIxnp5 · wGSLzbJRjKVvA1SZ · gWkN0PmjQ7EH8Mpg · G8k2iaD6AVncDk2v*
