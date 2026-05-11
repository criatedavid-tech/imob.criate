# ImobiFlow AI - MVP

Este é o seu MVP automatizado para corretores.

## Como funciona o fluxo:
1. **Cadastro**: O corretor preenche o formulário no Dashboard.
2. **Backend**: O servidor processa os dados, gera o link único da Landing Page.
3. **Gatilho**: O sistema envia os dados para o seu **n8n** via Webhook.
4. **IA (WhatsApp)**: O n8n recebe o link e aciona o agente de IA para começar a prospecção.
5. **Conversão**: O cliente acessa a Landing Page exclusiva e agenda a visita.

## Para rodar Localmente:
### Frontend + Hub (Node.js)
1. `npm install`
2. `npm run dev`

### Backend Java (Spring Boot)
1. Certifique-se de ter o Java 17 instalado.
2. `./gradlew bootRun`

## Variáveis de Ambiente Necessárias:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `N8N_WEBHOOK_URL`
- `GEMINI_API_KEY` (Já configurado no AI Studio)
