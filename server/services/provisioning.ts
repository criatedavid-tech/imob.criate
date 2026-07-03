import { supabase } from "../supabase";
import {
  PROVISIONING_WEBHOOK_URL, ZPRO_ADMIN_URL, N8N_WEBHOOK_URL,
  UAZAPI_HOST, UAZAPI_TOKEN, ZPRO_JWT_SECRET,
} from "../config";
import { getZproAdminToken, forgeTenantJwt } from "../lib/zproAuth";

export async function fireProvisioningWebhook(payload: any) {
  if (!PROVISIONING_WEBHOOK_URL) return;
  try {
    const resp = await fetch(PROVISIONING_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await supabase.from('webhook_logs').insert({
      source: 'provisioning_webhook',
      event_type: resp.ok ? 'webhook_delivered' : 'webhook_failed',
      payload: { url: PROVISIONING_WEBHOOK_URL, status: resp.status, body: payload },
      status: resp.ok ? 'processed' : 'error',
      broker_id: payload.broker?.id || null
    });
  } catch (err: any) {
    await supabase.from('webhook_logs').insert({
      source: 'provisioning_webhook',
      event_type: 'webhook_failed',
      payload: { url: PROVISIONING_WEBHOOK_URL, error: err.message, body: payload },
      status: 'error',
      broker_id: payload.broker?.id || null
    });
  }
}

// ─── Z-PRO REST API (nova versão — app.criate.online) ────────────────────────
// Endpoint raiz confirmado pelo usuário: POST /tenants
// Todos os endpoints seguem o padrão REST; logs detalhados para cada chamada.

export async function zproPost(path: string, body: any, token?: string): Promise<{ ok: boolean; status: number; raw: string; json: any }> {
  const authToken = token || await getZproAdminToken();
  const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
  try {
    const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
    const raw = await r.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* raw não é JSON */ }
    console.log(`[Z-PRO] POST ${path} → ${r.status} | body=${raw.slice(0, 300)}`);
    return { ok: r.ok, status: r.status, raw, json };
  } catch (e: any) {
    console.error(`[Z-PRO] POST ${path} exception:`, e.message);
    return { ok: false, status: 0, raw: e.message, json: null };
  }
}

export async function zproPut(path: string, body: any, token?: string): Promise<{ ok: boolean; status: number; raw: string }> {
  const authToken = token || await getZproAdminToken();
  const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
  try {
    const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'PUT', headers: hdrs, body: JSON.stringify(body) });
    const raw = await r.text();
    console.log(`[Z-PRO] PUT ${path} → ${r.status} | body=${raw.slice(0, 200)}`);
    return { ok: r.ok, status: r.status, raw };
  } catch (e: any) {
    console.error(`[Z-PRO] PUT ${path} exception:`, e.message);
    return { ok: false, status: 0, raw: e.message };
  }
}

export async function zproGet(path: string, token?: string): Promise<{ ok: boolean; status: number; raw: string; json: any }> {
  const authToken = token || await getZproAdminToken();
  const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
  try {
    const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'GET', headers: hdrs });
    const raw = await r.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* raw não é JSON */ }
    console.log(`[Z-PRO] GET ${path} → ${r.status} | body=${raw.slice(0, 200)}`);
    return { ok: r.ok, status: r.status, raw, json };
  } catch (e: any) {
    console.error(`[Z-PRO] GET ${path} exception:`, e.message);
    return { ok: false, status: 0, raw: e.message, json: null };
  }
}

export async function zproDelete(path: string, token?: string): Promise<{ ok: boolean; status: number; raw: string }> {
  const authToken = token || await getZproAdminToken();
  const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
  try {
    const r = await fetch(`${ZPRO_ADMIN_URL}${path}`, { method: 'DELETE', headers: hdrs });
    const raw = await r.text();
    console.log(`[Z-PRO] DELETE ${path} → ${r.status}`);
    return { ok: r.ok, status: r.status, raw };
  } catch (e: any) {
    console.error(`[Z-PRO] DELETE ${path} exception:`, e.message);
    return { ok: false, status: 0, raw: e.message };
  }
}

// Configura n8nUrl no canal via PUT /whatsapp/:id (body mínimo — spread completo causa falha silenciosa).
// Z-PRO retorna 500 mas salva o dado; verificamos com GET para confirmar.
// Requer tenantToken: super admin token não salva n8nUrl neste endpoint.
async function setN8nWebhook(
  tenantId: string | number,
  whatsappId: string | number,
  tenantToken?: string
): Promise<boolean> {
  if (!N8N_WEBHOOK_URL) return false;
  const wId = Number(whatsappId);
  const tId = Number(tenantId);

  const minimalBody = {
    id: wId,
    tenantId: tId,
    n8nUrl: N8N_WEBHOOK_URL,
    disableExternalIntegration: 'disabled',   // Habilitar IA
    waitProcessExternalInteraction: 'enabled' // Habilitar para todos os tickets
  };

  // Tenta com tenant token e super admin; ambos retornam 500 mas salvam — verificar via GET
  const candidates = tenantToken
    ? [{ label: 'tenantToken', tok: tenantToken }, { label: 'superAdmin', tok: await getZproAdminToken() }]
    : [{ label: 'superAdmin', tok: await getZproAdminToken() }];

  for (const { label, tok } of candidates) {
    await zproPut(`/whatsapp/${wId}`, minimalBody, tok); // ignora status — 500 pode salvar
    const check = await zproGet(`/whatsapp/${wId}`, tok);
    if (check.json?.n8nUrl === N8N_WEBHOOK_URL) {
      console.log(`[Z-PRO] n8nUrl+IA configurados via PUT /whatsapp/${wId} (${label})`);
      return true;
    }
  }

  console.warn('[Z-PRO] n8nUrl: não foi possível salvar — configure manualmente no painel Z-PRO');
  return false;
}

// Ativa Bots IA (N8N) no tenant via PUT /settings/:key com {key, value, tenantId}.
// Endpoints confirmados: PUT /settings/n8n e PUT /settings/n8nAllTickets → 200.
async function configureBotIA(tenantId: number, tenantToken: string): Promise<void> {
  for (const key of ['n8n', 'n8nAllTickets']) {
    const r = await zproPut(`/settings/${key}`, { key, value: 'enabled', tenantId }, tenantToken);
    if (r.ok) {
      console.log(`[Z-PRO] Setting ${key}=enabled configurado`);
    } else {
      console.warn(`[Z-PRO] Setting ${key} falhou: ${r.status} ${r.raw.slice(0, 100)}`);
    }
  }
}

// ── UAZAPI: configura webhook da instância apontando ao Z-PRO ─────────────────
// CRÍTICO para o canal funcionar: sem esse webhook, as mensagens chegam na UAZAPI
// mas NUNCA são entregues ao Z-PRO → canal conecta (CONNECTED) porém fica "Não ativado"
// e não recebe mensagens nem direciona para o agente.
// Padrão confirmado em 39/43 instâncias em produção: ${ZPRO_ADMIN_URL}/uazapi-webhook/${instanceId}
// (Z-PRO identifica o canal pelo instanceId na URL, que é o mesmo valor salvo em wppUser.)
// POST /webhook (header token = token da instância) atualiza o webhook existente — retorna 200.
// Decoplado do POST /whatsappSession para NÃO disparar auto-connect (mensagem outbound, não inicia sessão).
export async function setUazapiWebhook(instanceToken: string, instanceId: string): Promise<boolean> {
  if (!UAZAPI_HOST || !ZPRO_ADMIN_URL || !instanceToken || !instanceId) {
    console.warn('[UAZAPI] setUazapiWebhook: parâmetros ausentes — pulando');
    return false;
  }
  const webhookUrl = `${ZPRO_ADMIN_URL}/uazapi-webhook/${instanceId}`;
  try {
    const r = await fetch(`${UAZAPI_HOST}/webhook`, {
      method: 'POST',
      headers: { token: instanceToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        enabled: true,
        events: ['messages', 'connection', 'wasSentByApi', 'messages_update', 'call', 'contacts', 'groups', 'history'],
        excludeMessages: [],
        addUrlEvents: false,
        addUrlTypesMessages: false
      })
    });
    const raw = await r.text();
    const ok = r.ok && raw.includes(webhookUrl);
    console.log(`[UAZAPI] webhook ${ok ? 'configurado ✓' : 'FALHOU'} (${r.status}) → ${webhookUrl}`);
    return ok;
  } catch (e: any) {
    console.warn('[UAZAPI] Exceção ao configurar webhook:', e.message);
    return false;
  }
}

// ── UAZAPI: cria instância e vincula ao canal Z-PRO ───────────────────────────
// Fluxo descoberto via inspeção da API UAZAPI (criate.uazapi.com):
//   1. POST /instance/create (header: admintoken) + body {name}
//      → retorna { id: instanceId, token: instanceToken, instance: { id, token } }
//   2a. PUT /whatsapp/:id com { tokenAPI } → salva "API Token" no painel (retorna 500 mas persiste)
//   2b. PUT /whatsapp/:id com { wppUser }  → salva "Number ID (Instance ID)" (PUT separado — combinado não salva wppUser)
//   3.  POST /webhook (UAZAPI) → registra webhook Z-PRO para entrega de mensagens (setUazapiWebhook)
//   NOTA: NÃO chamamos POST /whatsappSession/:id aqui — chamá-lo no provisionamento
//   causa auto-connect indesejado (canal fica em OPENING sem o usuário ter iniciado).
//   O webhook é configurado direto na UAZAPI (não dispara connect), e o Z-PRO inicia
//   a sessão automaticamente quando o usuário acessa o canal no painel e lê o QR.
export async function createUazapiInstanceForChannel(
  whatsappId: string | number, channelName: string, tenantToken?: string
): Promise<string | null> {
  if (!UAZAPI_HOST || !UAZAPI_TOKEN) {
    console.warn('[UAZAPI] UAZAPI_HOST ou UAZAPI_TOKEN ausente — pulando criação de instância');
    return null;
  }

  // 1. Cria instância UAZAPI — extrai token e id da instância
  let instanceToken: string | null = null;
  let instanceId: string | null = null;
  try {
    const res = await fetch(`${UAZAPI_HOST}/instance/create`, {
      method: 'POST',
      headers: { 'admintoken': UAZAPI_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: channelName })
    });
    const json: any = await res.json().catch(() => null);
    instanceToken = json?.token ?? json?.instance?.token ?? null;
    instanceId    = json?.instance?.id ?? json?.id ?? null;
    console.log(`[UAZAPI] POST /instance/create "${channelName}": status=${res.status} instanceToken=${instanceToken?.slice(0,8) ?? 'null'} instanceId=${instanceId ?? 'null'}`);
    if (!instanceToken) {
      console.warn(`[UAZAPI] Criação de instância falhou: ${res.status} ${JSON.stringify(json)?.slice(0,200)}`);
      return null;
    }
  } catch (e: any) {
    console.warn('[UAZAPI] Exceção ao criar instância:', e.message);
    return null;
  }

  // 2a. Salva tokenAPI no canal Z-PRO (PUT retorna 500 mas persiste — padrão confirmado)
  // tokenAPI = "API Token" no painel Z-PRO UazApi
  await zproPut(`/whatsapp/${whatsappId}`, { tokenAPI: instanceToken }, tenantToken);
  const check1 = await zproGet(`/whatsapp/${whatsappId}`, tenantToken);
  const savedToken = check1.json?.tokenAPI;
  if (savedToken === instanceToken) {
    console.log(`[Z-PRO] tokenAPI salvo no canal ${whatsappId} ✓`);
  } else {
    console.warn(`[Z-PRO] tokenAPI NÃO confirmado — check=${savedToken?.slice(0,8)} esperado=${instanceToken.slice(0,8)}`);
  }

  // 2b. Salva o Number ID (Instance ID) no canal Z-PRO.
  // DESCOBERTA 2026-05-22 (via diff do PUT real do painel): o campo "Number ID (Instance ID)"
  // do painel Z-PRO UazApi grava na coluna `wabaId` — NÃO em `wppUser`.
  // Por isso o painel sempre mostrava vazio (escrevíamos em wppUser, a coluna errada).
  // wabaId é também o identificador que o Z-PRO usa p/ casar os eventos do webhook UAZAPI ao canal.
  // PUTs separados (envio combinado com tokenAPI não persiste de forma confiável — bug Z-PRO).
  if (instanceId) {
    // wabaId = "Number ID (Instance ID)" do painel — CRÍTICO p/ ativação e entrega de mensagens
    let wabaOk = false;
    for (const tok of [tenantToken, undefined]) { // tenta tenant token; fallback super admin
      await zproPut(`/whatsapp/${whatsappId}`, { wabaId: instanceId }, tok);
      const c = await zproGet(`/whatsapp/${whatsappId}`, tenantToken);
      if (c.json?.wabaId === instanceId) { wabaOk = true; break; }
    }
    console.log(`[Z-PRO] wabaId (Number ID=${instanceId}) ${wabaOk ? 'salvo ✓' : 'NÃO salvo ✗'} no canal ${whatsappId}`);

    // wppUser também (best-effort) — alguns fluxos internos do Z-PRO referenciam esse campo
    await zproPut(`/whatsapp/${whatsappId}`, { wppUser: instanceId }, tenantToken);
  } else {
    console.warn(`[Z-PRO] instanceId nulo — Number ID não pode ser salvo para canal ${whatsappId}. Verificar resposta UAZAPI.`);
  }

  // 3. Configura webhook UAZAPI → Z-PRO (entrega de mensagens).
  // Sem isso o canal conecta mas fica "Não ativado" e não recebe mensagens.
  if (instanceId) {
    await setUazapiWebhook(instanceToken, instanceId);
  }

  return instanceToken;
}

// Cria API Config vinculada ao canal do corretor (endpoint do painel api-service).
// POST /api-config → retorna uuid (para URL externa) + plainToken (bearer token).
// URL externa: ${ZPRO_ADMIN_URL}/v2/api/external/${uuid}
async function createApiConfig(
  tenantId: number, whatsappId: number, brokerName: string, tenantToken: string
): Promise<{ uuid: string; plainToken: string; apiUrl: string } | null> {
  const r = await zproPost('/api-config', { name: brokerName, sessionId: whatsappId, tenantId }, tenantToken);
  if (r.ok && r.json?.plainToken) {
    const uuid = r.json.id as string;
    const apiUrl = `${ZPRO_ADMIN_URL}/v2/api/external/${uuid}`;
    console.log(`[Z-PRO] API Config criada — uuid=${uuid}`);
    return { uuid, plainToken: r.json.plainToken, apiUrl };
  }
  console.warn(`[Z-PRO] Criação de api-config falhou: ${r.status} ${r.raw.slice(0, 100)}`);
  return null;
}

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd + 'A1!';
}

function buildZproUsername(broker: any): string {
  const base = (broker.email || broker.id || 'corretor')
    .split('@')[0]
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 16);
  const suffix = String(broker.id || '').replace(/-/g, '').slice(0, 4);
  return `${base}${suffix}`;
}

export async function createZproTenantAndChannel(broker: any) {
  const brokerName = broker.name || `Corretor ${broker.id}`;

  // Gera credenciais ANTES — persistidas no Supabase imediatamente
  const tenantPassword = broker.zpro_password || generateSecurePassword();
  const tenantUsername = broker.zpro_username || buildZproUsername(broker);
  // Usa o email real do broker como login no Z-PRO (melhor UX — o corretor loga com o email que cadastrou).
  // Fallback @imobiflow.local só se a criação falhar por conflito de email (email já existe no Z-PRO global).
  // let (não const) para permitir fallback para @imobiflow.local se necessário.
  let tenantEmail = broker.zpro_user_email || broker.email || `${tenantUsername}@imobiflow.local`;

  await supabase.from('imf_brokers').update({
    zpro_password: tenantPassword,
    zpro_username: tenantUsername,
    zpro_user_email: tenantEmail,
    provisioning_status: broker.zpro_tenant_id ? 'tenant_created' : 'pending',
    provisioning_error: null
  }).eq('id', broker.id);

  // Dias da semana padrão para o usuário admin do tenant.
  // Z-PRO ignora hr1-hr4 no POST /userTenants — usa apenas 'type'.
  // 'O' = Aberto (Open), 'C' = Fechado (Closed). 'W' é convertido para 'O' pelo Z-PRO.
  // restrictedUser: false garante que essas horas não bloqueiam login.
  const defaultBusinessHours = [
    { day: 0, label: 'Domingo',    type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
    { day: 1, label: 'Segunda',    type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
    { day: 2, label: 'Terça',      type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
    { day: 3, label: 'Quarta',     type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
    { day: 4, label: 'Quinta',     type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
    { day: 5, label: 'Sexta',      type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' },
    { day: 6, label: 'Sábado',     type: 'O', hr1: '07:00', hr2: '19:00', hr3: '', hr4: '' }
  ];
  const defaultMenuPermissions = {
    massa: true, grupo: true, chatPrivado: true, kanban: true, funil: true,
    agenda: true, campanhas: true, relatorios: true, financeiro: true,
    contatos: true, helpdesk: true, filas: true, tags: true, quickAnswers: true
  };

  try {
    let tenantId: number | string | undefined = broker.zpro_tenant_id && broker.zpro_tenant_id !== 'undefined'
      ? broker.zpro_tenant_id
      : undefined;
    let adminUserId: number | string | undefined;

    // ── 1. Cria tenant ────────────────────────────────────────────────────────
    // POST /tenants (super-admin JWT) — inclui uazapiHost+Token para evitar step extra.
    // Tenant API (/tenantApiStoreTenant) retorna 401 sem restart do Z-PRO — não usar.
    if (!tenantId) {
      const tenantBody = {
        name: brokerName,
        email: tenantEmail,
        password: tenantPassword,
        userName: tenantUsername,
        username: tenantUsername,
        status: 'active',
        maxUsers: 5,
        maxConnections: 1,
        acceptTerms: true,
        profile: 'user',
        uazapiHost: UAZAPI_HOST,
        uazapiToken: UAZAPI_TOKEN
      };

      const res = await zproPost('/tenants', tenantBody);
      if (!res.ok) throw new Error(`Z-PRO criar tenant → ${res.status}: ${res.raw.slice(0, 500)}`);

      const t = res.json;
      tenantId = t?.id ?? t?.tenant_id ?? t?.tenantId ?? t?.data?.id ?? t?.tenant?.id ?? t?.result?.id;
      if (!tenantId) throw new Error(`Z-PRO tenant ID ausente no response: ${JSON.stringify(t)}`);
      console.log(`[Z-PRO] Tenant criado: id=${tenantId}`);

      // ── 1a. Cria usuário admin isolado no tenant via POST /userTenants ────────
      // POST /users cria o user no tenant 1 (tenant do super-admin) — errado.
      // POST /userTenants aceita tenantId no body e cria o user corretamente isolado.
      // Verificado: login após esse endpoint retorna tenantId correto.
      const buildUserBody = (email: string) => ({
        name: brokerName,
        email,
        password: tenantPassword,
        profile: 'admin',
        tenantId: Number(tenantId),
        phone: '',
        status: 'active',      // obrigatório — Z-PRO retorna OUT_RANGE se status for null
        inactive: false,
        businessHours: defaultBusinessHours,
        menuPermissions: defaultMenuPermissions,
        restrictedUser: false  // false (boolean) — string 'disabled' é truthy em JS, ativa check de horário
      });

      let userRes = await zproPost('/userTenants', buildUserBody(tenantEmail));

      // Se falhou por conflito de email (email já existe no Z-PRO), tenta com @imobiflow.local
      if (!userRes.ok && tenantEmail !== `${tenantUsername}@imobiflow.local`) {
        const fallbackEmail = `${tenantUsername}@imobiflow.local`;
        console.warn(`[Z-PRO] /userTenants com email real falhou (${userRes.status}) — tentando ${fallbackEmail}`);
        userRes = await zproPost('/userTenants', buildUserBody(fallbackEmail));
        if (userRes.ok && userRes.json?.id) {
          tenantEmail = fallbackEmail;  // atualiza para o resto do fluxo (login, webhook)
          await supabase.from('imf_brokers').update({ zpro_user_email: fallbackEmail }).eq('id', broker.id);
        }
      }

      if (userRes.ok && userRes.json?.id) {
        adminUserId = userRes.json.id;
        const usedEmail = userRes.json.email ?? tenantEmail;
        console.log(`[Z-PRO] Usuário admin criado via /userTenants — id=${adminUserId} email=${usedEmail} tenant=${tenantId}`);
      } else {
        console.warn(`[Z-PRO] /userTenants falhou: ${userRes.status} ${userRes.raw.slice(0, 200)}`);
        // Não é fatal — login tenta mesmo assim
      }

      await supabase.from('imf_brokers').update({
        zpro_tenant_id: String(tenantId),
        provisioning_status: 'tenant_created'
      }).eq('id', broker.id);
    } else {
      console.log(`[Z-PRO] Tenant ${tenantId} já existe — pulando criação`);
    }

    // ── 1b. Login como user do tenant para obter token de sessão ─────────────
    // Com /userTenants o login sempre retorna tenantId correto (verificado).
    let tenantToken: string | undefined;
    try {
      const loginRes = await zproPost('/auth/login', { email: tenantEmail, password: tenantPassword });
      if (loginRes.ok && loginRes.json) {
        const rawToken = loginRes.json.token ?? loginRes.json.access_token ?? loginRes.json.accessToken
          ?? loginRes.json.data?.token;
        if (rawToken) {
          let jwtTenantId = 0;
          try {
            const p = JSON.parse(Buffer.from(rawToken.split('.')[1], 'base64url').toString());
            jwtTenantId  = Number(p.tenantId || 0);
            adminUserId  = adminUserId ?? p.id;
          } catch {}
          if (jwtTenantId === Number(tenantId)) {
            tenantToken = rawToken;
            console.log(`[Z-PRO] Login user-tenant OK — tenantId=${tenantId} ✓`);
          } else {
            console.warn(`[Z-PRO] Login retornou tenantId=${jwtTenantId} (esperado ${tenantId})`);
          }
        }
      } else {
        console.warn(`[Z-PRO] Login user-tenant falhou (${loginRes.status})`);
      }
    } catch (e: any) {
      console.warn('[Z-PRO] Login exception:', e.message);
    }

    // Fallback: forja JWT de tenant se login falhou e temos JWT_SECRET + userId
    if (!tenantToken && ZPRO_JWT_SECRET && tenantId && adminUserId) {
      tenantToken = forgeTenantJwt(Number(tenantId), Number(adminUserId), tenantEmail);
      console.log(`[Z-PRO] JWT forjado para tenant ${tenantId} (user ${adminUserId})`);
    }

    // ── 2. Cria canal WhatsApp uazapi ─────────────────────────────────────────
    // POST /whatsappTenants com type=uazapi — verificado: cria canal isolado no tenant,
    // status DISCONNECTED, sem herdar template Baileys.
    // Tenant API (/tenantApiCreateSession) retorna 401 — não usar.
    let whatsappId: number | string | undefined = broker.zpro_channel_id && broker.zpro_channel_id !== 'undefined'
      ? broker.zpro_channel_id
      : undefined;

    if (!whatsappId) {
      const channelBody = {
        tenant: Number(tenantId),
        tenantId: Number(tenantId),
        name: `WhatsApp - ${brokerName}`,
        status: 'DISCONNECTED',
        type: 'uazapi',
        isActive: true,
        // uazapiHost + uazapiToken são obrigatórios para Z-PRO comunicar com UAZAPI
        // Sem eles o canal fica DISCONNECTED e nunca gera QR Code
        uazapiHost: UAZAPI_HOST,
        uazapiToken: UAZAPI_TOKEN
      };

      const channelRes = await zproPost('/whatsappTenants', channelBody);
      if (!channelRes.ok) throw new Error(`Z-PRO criar canal: ${channelRes.status}: ${channelRes.raw.slice(0, 500)}`);

      const s = channelRes.json;
      whatsappId = s?.id ?? s?.whatsappId ?? s?.data?.id ?? s?.whatsapp?.id;
      if (!whatsappId) throw new Error(`Z-PRO whatsappId ausente: ${JSON.stringify(s)}`);
      console.log(`[Z-PRO] Canal uazapi criado — id=${whatsappId} name="WhatsApp - ${brokerName}"`);
    } else {
      console.log(`[Z-PRO] Canal ${whatsappId} já existe — pulando criação`);
    }

    await supabase.from('imf_brokers').update({
      zpro_channel_id: String(whatsappId),
      zpro_channel_name: `WhatsApp - ${brokerName}`,
      provisioning_status: 'session_created'
    }).eq('id', broker.id);

    // ── 2b. Cria instância UAZAPI e vincula ao canal (tokenAPI) ───────────────
    // Sem esse passo, Z-PRO exibe "Aguardando QR Code" indefinidamente.
    // createUazapiInstanceForChannel: POST /instance/create (UAZAPI) + PUT /whatsapp/:id + POST /whatsappSession/:id
    // Só cria se o canal é novo (não existia antes); se já existia, assume que a instância já foi criada.
    if (!broker.zpro_channel_id || broker.zpro_channel_id === 'undefined') {
      await createUazapiInstanceForChannel(whatsappId, `WhatsApp - ${brokerName}`, tenantToken);
    } else {
      console.log(`[UAZAPI] Canal ${whatsappId} pré-existente — pulando criação de instância UAZAPI`);
    }

    // ── 3. Cria API Config vinculada ao canal (POST /api-config) ──────────────
    let apiPlainToken: string | null = null;
    let apiUuid: string | null = null;
    let apiExternalUrl: string | null = null;
    if (tenantToken) {
      const apiResult = await createApiConfig(Number(tenantId), Number(whatsappId), brokerName, tenantToken);
      if (apiResult) {
        apiPlainToken = apiResult.plainToken;
        apiUuid = apiResult.uuid;
        apiExternalUrl = apiResult.apiUrl;
        await supabase.from('imf_brokers').update({
          zpro_api_key: apiUuid,
          zpro_api_token: apiPlainToken,
          zpro_api_url: apiExternalUrl
        }).eq('id', broker.id);
      }
    }

    // ── 4. Ativa Bots IA (N8N) no tenant ─────────────────────────────────────
    // PUT /settings/n8n e PUT /settings/n8nAllTickets com {key, value, tenantId}.
    // Equivalente a: Configurações > Bots IA > IA > Habilitar IA + Habilitar para todos os tickets.
    if (tenantToken) await configureBotIA(Number(tenantId), tenantToken);

    // ── 5. Configura N8N webhook URL no canal ─────────────────────────────────
    // PUT /whatsapp/:id com body mínimo {n8nUrl, disableExternalIntegration, waitProcessExternalInteraction}.
    // Body mínimo é obrigatório — spread do canal completo causa falha silenciosa (não salva n8nUrl).
    // Z-PRO retorna 500 mas salva; verificamos com GET para confirmar.
    if (N8N_WEBHOOK_URL) await setN8nWebhook(tenantId, whatsappId, tenantToken);

    await supabase.from('imf_brokers').update({
      provisioning_status: 'api_created'
    }).eq('id', broker.id);

    const completedAt = new Date().toISOString();
    await supabase.from('imf_brokers').update({
      provisioning_status: 'completed',
      provisioning_completed_at: completedAt
    }).eq('id', broker.id);

    await supabase.from('webhook_logs').insert({
      source: 'zpro',
      event_type: 'tenant_created',
      payload: { tenant_id: tenantId, whatsapp_id: whatsappId, broker_id: broker.id },
      status: 'processed',
      broker_id: broker.id
    });

    console.log(`✅ Z-PRO: tenant=${tenantId} | canal=${whatsappId} | api=${apiUuid} — corretor ${broker.id}`);

    // ── 4. Webhook provisionamento → N8N entrega credenciais ao corretor ──────
    const loginUrl = `${ZPRO_ADMIN_URL.replace('appback.', 'app.')}/login`;
    await fireProvisioningWebhook({
      event: 'broker_provisioned',
      provisioned_at: completedAt,
      broker: {
        id: broker.id,
        name: broker.name,
        email: broker.email,
        phone: broker.phone
      },
      zpro_login: {
        url: loginUrl,
        email: tenantEmail,
        username: tenantUsername,
        password: tenantPassword
      },
      zpro: {
        admin_url: ZPRO_ADMIN_URL,
        tenant_id: String(tenantId),
        channel_id: String(whatsappId),
        channel_name: `WhatsApp - ${brokerName}`,
        channel_type: 'uazapi',
        api_uuid: apiUuid,
        url: apiExternalUrl,
        bearerToken: apiPlainToken
      },
      asaas: {
        customer_id: broker.asaas_customer_id || null,
        subscription_id: broker.asaas_subscription_id || null
      }
    });

  } catch (err: any) {
    console.error("Erro ao criar Z-PRO tenant/canal:", err);
    await supabase.from('imf_brokers').update({
      provisioning_status: 'failed',
      provisioning_error: err.message
    }).eq('id', broker.id);
    await supabase.from('webhook_logs').insert({
      source: 'zpro',
      event_type: 'tenant_creation_failed',
      payload: { error: err.message, broker_id: broker.id },
      status: 'error',
      broker_id: broker.id
    });
  }
}
