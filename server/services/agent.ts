import { supabase } from "../supabase";
import { normalizePhoneBR } from "../lib/crypto";
import { sendUazapiText, resolveOutboundInstanceToken } from "./wppShim";
import { pauseAiForHumanTakeover } from "./followup";
import { isBrokerOwner } from "../middleware/auth";
import { fetchWithTimeout } from "../lib/http";
import { APP_URL } from "../config";
import { recordConversationMessage } from "./conversationTickets";
import { resolveNewLeadStage } from "./crmPipelines";

// ─────────────────────────────────────────────────────────────────────────
// O CÉREBRO REAL (Etapa 13 do UX_MASTERPLAN.md)
// A command bar deixa de ser mock: um agente Gemini lê o estado real da conta
// do corretor e responde/age em linguagem natural sobre os endpoints que já
// existem. A autonomia (Etapa 12) governa de verdade: piloto executa na hora,
// copiloto/manual só propõem e esperam confirmação.
// ─────────────────────────────────────────────────────────────────────────

export type Autonomy = "piloto" | "copiloto" | "manual";

// Fuso de Brasília (America/Sao_Paulo, UTC-3 fixo desde 2019). O servidor Fly
// roda em UTC, então data/hora que o corretor fala precisa ser ancorada no fuso
// do Brasil na hora de GRAVAR (senão "13h" vira 13h UTC = 10h no Brasil), e
// formatada nesse fuso na hora de EXIBIR pro modelo — senão tudo aparece 3h
// deslocado. O frontend (browser no Brasil) já faz isso sozinho; só o servidor
// precisa forçar.
const BR_TZ = "America/Sao_Paulo";
function brDateTimeToISO(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-03:00`);
}

export interface AgentAction {
  type: "answer" | "navigate" | "create_lead" | "create_visit" | "query_agenda" | "send_message"
      | "create_property" | "update_property" | "cancel_visit" | "update_visit" | "end_rental_contract" | "update_unit";
  area?: string;
  // create_lead / create_visit
  name?: string;
  phone?: string;
  property_id?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  // query_agenda — consulta real de visitas fora da janela do snapshot
  // (data específica ou intervalo, passado ou futuro).
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD, opcional — omitido = mesmo dia de date_from
  // send_message — manda uma mensagem REAL pelo WhatsApp (usa phone acima).
  message?: string;
  // create_property / update_property — cadastra ou edita um imóvel.
  // create_property usa location/description/quartos/banheiros/area_m2/piscina/
  // vagas_garagem/tipo_imovel/finalidade/varanda_gourmet também; update_property
  // usa property_id (acima) + qualquer um de price/title/status.
  price?: string;
  title?: string;
  status?: string;
  location?: string;
  description?: string;
  quartos?: string;        // número de quartos, como veio do corretor (ex.: "3")
  banheiros?: string;      // total de banheiros (soma suítes + banheiro social/serviço, se houver)
  area_m2?: string;        // área em m², só o número (NÃO confundir com "area" acima, que é a tela do navigate)
  piscina?: "Sim" | "Não";
  vagas_garagem?: string;
  tipo_imovel?: "residencial" | "comercial";
  finalidade?: "venda" | "aluguel" | "ambos";
  varanda_gourmet?: "Sim" | "Não"; // área/varanda gourmet
  // cancel_visit / update_visit — id vem da lista de "próximas visitas" do snapshot.
  visit_id?: string;
  // end_rental_contract — id vem da lista de contratos ativos (persona imobiliária).
  contract_id?: string;
  // update_unit — id vem da lista de unidades (persona incorporadora).
  unit_id?: string;
  unit_action?: "reservar" | "vender" | "liberar";
  buyer_name?: string;
  buyer_phone?: string;
  // create_property — fotos anexadas na conversa (CommandBar.tsx), já
  // enviadas ao Storage antes de chegar aqui. NUNCA preenchido pelo
  // modelo (não faz parte do JSON_SHAPE_HINT) — é anexado
  // mecanicamente em runAgent() a partir de opts.imageUrls, pra sobreviver
  // tanto ao caminho piloto (executa na hora) quanto ao copiloto/manual
  // (a ação inteira, incluindo isso, volta pro front e é reenviada em
  // /api/agent/execute na confirmação).
  image_urls?: string[];
  // cancel_visit / update_visit — preenchido pelo modelo quando o corretor
  // pede pra AVISAR o cliente junto do cancelamento/remarcação (ex.: "cancela
  // e avisa que tive um imprevisto"). Se presente, executeAction manda essa
  // mensagem de verdade pelo WhatsApp depois de cancelar/remarcar — antes
  // disso a ação só mexia na agenda e nunca avisava ninguém.
  notify_message?: string;
}

export interface AgentTurn {
  role: "user" | "ai";
  text: string;
}

export interface AgentResult {
  reply: string;
  navigate?: string;
  executed?: string;          // resumo do que foi feito (piloto)
  proposedAction?: AgentAction; // precisa de confirmação (copiloto/manual)
  refresh?: boolean;          // pede pro front recarregar a área atual
}

// Áreas navegáveis por persona (espelha engine.ts no front — mantém as duas em sincronia).
const AREAS_BY_PERSONA: Record<string, string[]> = {
  corretor:      ["hoje", "conversas", "assistente-ia", "carteira", "negocios", "agenda", "contatos", "divulgacao", "relatorios", "config"],
  imobiliaria:   ["hoje", "conversas", "assistente-ia", "carteira", "negocios", "agenda", "contatos", "locacao", "financeiro", "equipe", "divulgacao", "relatorios", "config"],
  incorporadora: ["hoje", "conversas", "assistente-ia", "carteira", "negocios", "agenda", "contatos", "lancamentos", "financeiro", "equipe", "divulgacao", "relatorios", "config"],
};

interface Snapshot {
  brokerName: string;
  properties: { id: string; title: string; price: string; status: string }[];
  leadCounts: Record<string, number>;
  leadsTotal: number;
  upcomingVisits: { id: string; when: string; who: string }[];
  visitsThisMonth: { total: number; done: number };
  activeRentals: number;
  contacts: { name: string; phone: string }[];
  rentalContracts: { id: string; tenant_name: string }[];
  units: { id: string; development_name: string; code: string | null; status: string }[];
  conversationsTotal: number;
  conversationCounts: { ia: number; aguardando: number; encerrado: number };
  recentConversations: { phone: string; name: string | null; lastMessage: string | null; hasUpcomingVisit: boolean }[];
}

async function buildSnapshot(brokerId: string, userId: string, persona: string): Promise<Snapshot> {
  // Isolamento por membro: dono da conta vê tudo; membro só o que é dele.
  const owner = await isBrokerOwner(userId, brokerId);

  const propsQuery = supabase.from("imf_properties").select("id, title, price, status").eq("broker_id", brokerId).limit(40);
  if (!owner) propsQuery.eq("owner_user_id", userId);

  const [{ data: broker }, { data: props }] = await Promise.all([
    supabase.from("imf_brokers").select("name").eq("id", brokerId).maybeSingle(),
    propsQuery,
  ]);

  const propIds = (props || []).map((p: any) => p.id);

  const leadCounts: Record<string, number> = {};
  let leadsTotal = 0;
  if (propIds.length > 0) {
    let leadsQuery = supabase.from("leads").select("status").in("property_id", propIds);
    if (!owner) leadsQuery = leadsQuery.eq("owner_user_id", userId);
    const { data: leads } = await leadsQuery;
    for (const l of leads || []) {
      const s = l.status || "new";
      leadCounts[s] = (leadCounts[s] || 0) + 1;
      leadsTotal++;
    }
  }

  const visitsQuery = supabase
    .from("imf_agenda")
    .select("id, scheduled_at, client_name")
    .eq("broker_id", brokerId)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (!owner) visitsQuery.eq("owner_user_id", userId);
  const { data: visits } = await visitsQuery;

  const { data: rentalContractsData, count: activeRentals } = await supabase
    .from("imf_rental_contracts")
    .select("id, tenant_name", { count: "exact" })
    .eq("broker_id", brokerId)
    .eq("status", "ativo")
    .limit(15);

  // Unidades de lançamento — só relevante pra persona incorporadora, evita
  // consulta desnecessária pras outras.
  let unitsData: any[] = [];
  if (persona === "incorporadora") {
    const { data: devs } = await supabase.from("imf_developments").select("id, name").eq("broker_id", brokerId);
    const devIds = (devs || []).map((d: any) => d.id);
    const devNameById = new Map((devs || []).map((d: any) => [d.id, d.name]));
    if (devIds.length > 0) {
      const { data: units } = await supabase
        .from("imf_units")
        .select("id, code, status, development_id")
        .in("development_id", devIds)
        .in("status", ["disponivel", "reservado"])
        .limit(20);
      unitsData = (units || []).map((u: any) => ({ ...u, development_name: devNameById.get(u.development_id) || "Empreendimento" }));
    }
  }

  // Contatos salvos — permite resolver "manda mensagem pro Hunter" pro
  // telefone certo sem o corretor precisar digitar o número.
  const { data: contactsData } = await supabase
    .from("imf_contacts")
    .select("name, phone")
    .eq("broker_id", brokerId)
    .order("name", { ascending: true })
    .limit(200);

  // Conversas de WhatsApp — pessoas que entraram em contato de verdade,
  // categoria idêntica à das abas do Conversas (ConversasArea.tsx::categoryOf):
  // ai_active=true → "ia" (IA atendendo), false → "aguardando" (você), e
  // conversation_status='closed' → "encerrado" (prevalece sobre ai_active).
  // É um dado DIFERENTE de leads (tabela formal, só criada via create_lead) —
  // sem isso a IA achava que "ninguém entrou em contato" mesmo com conversas
  // reais rolando, porque nunca olhava pra essa tabela.
  const convQuery = supabase
    .from("followup_conversations")
    .select("customer_phone, conversation_status, ai_active, assigned_user_id, last_customer_message_at")
    .eq("broker_id", brokerId)
    .order("last_customer_message_at", { ascending: false });
  if (!owner) convQuery.eq("assigned_user_id", userId);
  const { data: convsData } = await convQuery;
  const conversationCounts = { ia: 0, aguardando: 0, encerrado: 0 };
  for (const c of convsData || []) {
    if (c.conversation_status === "closed") conversationCounts.encerrado++;
    else if (c.ai_active) conversationCounts.ia++;
    else conversationCounts.aguardando++;
  }
  const conversationsTotal = convsData?.length || 0;

  // Detalhe por contato (nome + última mensagem + já tem visita marcada) —
  // sem isso a IA só sabia o NÚMERO de conversas, não conseguia dizer quem
  // é quem nem apontar quem está mais perto de fechar. Batido em 3 queries
  // (não N×3) contra os telefones das conversas mais recentes.
  const recentPhones = (convsData || []).slice(0, 10).map((c: any) => c.customer_phone);
  let recentConversations: Snapshot["recentConversations"] = [];
  if (recentPhones.length > 0) {
    const [{ data: contactsForConv }, { data: lastMsgs }, { data: upcomingForConv }] = await Promise.all([
      supabase.from("imf_contacts").select("phone, name").eq("broker_id", brokerId).in("phone", recentPhones),
      supabase.from("imf_conversation_messages").select("customer_phone, body, created_at")
        .eq("broker_id", brokerId).eq("direction", "in").in("customer_phone", recentPhones)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("imf_agenda").select("client_phone").eq("broker_id", brokerId)
        .in("client_phone", recentPhones).gte("scheduled_at", new Date().toISOString()),
    ]);
    const nameByPhone = new Map((contactsForConv || []).map((c: any) => [c.phone, c.name]));
    const lastMsgByPhone = new Map<string, string>();
    for (const m of lastMsgs || []) if (!lastMsgByPhone.has(m.customer_phone)) lastMsgByPhone.set(m.customer_phone, m.body);
    const phonesWithVisit = new Set((upcomingForConv || []).map((v: any) => v.client_phone));
    recentConversations = (convsData || []).slice(0, 10).map((c: any) => ({
      phone: c.customer_phone,
      name: nameByPhone.get(c.customer_phone) || null,
      lastMessage: lastMsgByPhone.get(c.customer_phone) || null,
      hasUpcomingVisit: phonesWithVisit.has(c.customer_phone),
    }));
  }

  // Mesma métrica de "visitas realizadas" que Relatórios já mostra
  // (server/routes/relatorios.ts) — dá pra IA responder "quantas visitas
  // no mês" sem inventar, já que esse dado existe e não é só "próximas".
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthVisitsQuery = supabase
    .from("imf_agenda")
    .select("status")
    .eq("broker_id", brokerId)
    .gte("scheduled_at", monthStart.toISOString());
  if (!owner) monthVisitsQuery.eq("owner_user_id", userId);
  const { data: monthVisits } = await monthVisitsQuery;
  const visitsThisMonth = {
    total: (monthVisits || []).length,
    done: (monthVisits || []).filter((v: any) => v.status === "realizado").length,
  };

  return {
    brokerName: broker?.name || "corretor",
    properties: (props || []).map((p: any) => ({ id: p.id, title: p.title, price: p.price, status: p.status || "disponivel" })),
    leadCounts,
    leadsTotal,
    visitsThisMonth,
    upcomingVisits: (visits || []).map((v: any) => ({
      id: v.id,
      when: new Date(v.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: BR_TZ }),
      who: v.client_name || "cliente",
    })),
    activeRentals: activeRentals || 0,
    contacts: (contactsData || []).map((c: any) => ({ name: c.name, phone: c.phone })),
    rentalContracts: (rentalContractsData || []).map((c: any) => ({ id: c.id, tenant_name: c.tenant_name })),
    units: unitsData.map((u: any) => ({ id: u.id, development_name: u.development_name, code: u.code, status: u.status })),
    conversationsTotal,
    conversationCounts,
    recentConversations,
  };
}

const VISIT_STATUS_LABEL: Record<string, string> = {
  pendente: "pendente",
  confirmado: "confirmado",
  realizado: "realizada",
  cancelado: "cancelada",
};

// Consulta real de visitas fora da janela do snapshot (ação "query_agenda") —
// data específica ou intervalo, passado ou futuro. Formatado direto em código
// (sem 2ª chamada ao LLM) pra número/nome nunca passar por uma "reformulação"
// que poderia inventar algo — mesmo princípio determinístico de Relatórios.
async function queryAgendaRange(brokerId: string, userId: string, dateFrom?: string, dateTo?: string): Promise<string> {
  const isValidDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
  if (!isValidDate(dateFrom)) return "Não consegui entender qual data você quer consultar.";
  const from = dateFrom!;
  const to = isValidDate(dateTo) ? dateTo! : from;

  const query = supabase
    .from("imf_agenda")
    .select("scheduled_at, client_name, status, imf_properties(title)")
    .eq("broker_id", brokerId)
    .gte("scheduled_at", `${from}T00:00:00-03:00`)
    .lte("scheduled_at", `${to}T23:59:59-03:00`)
    .order("scheduled_at", { ascending: true });
  if (!(await isBrokerOwner(userId, brokerId))) query.eq("owner_user_id", userId);
  const { data, error } = await query;
  if (error) return "Não consegui consultar a agenda agora. Pode tentar de novo?";

  const periodo = from === to
    ? new Date(`${from}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : `${new Date(`${from}T12:00:00`).toLocaleDateString("pt-BR")} a ${new Date(`${to}T12:00:00`).toLocaleDateString("pt-BR")}`;

  if (!data || data.length === 0) {
    return `Não há nenhuma visita registrada em ${periodo}.`;
  }

  const linhas = data.map((v: any) => {
    const hora = new Date(v.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: BR_TZ });
    const prop = v.imf_properties?.title ? ` (${v.imf_properties.title})` : "";
    const status = VISIT_STATUS_LABEL[v.status] || v.status;
    return `${hora} — ${v.client_name || "cliente"}${prop}, ${status}`;
  });

  return `Em ${periodo}, ${data.length} visita(s):\n${linhas.join("\n")}`;
}

function buildSystemPrompt(snap: Snapshot, persona: string, autonomy: Autonomy): string {
  const areas = AREAS_BY_PERSONA[persona] || AREAS_BY_PERSONA.corretor;
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const isoHoje = new Date().toISOString().split("T")[0];

  const propsList = snap.properties.length
    ? snap.properties.map((p) => `- id=${p.id} · "${p.title}" · ${p.price} · ${p.status}`).join("\n")
    : "(nenhum imóvel cadastrado)";

  const leadsResumo = snap.leadsTotal
    ? Object.entries(snap.leadCounts).map(([k, v]) => `${k}: ${v}`).join(", ")
    : "nenhum lead ainda";

  const visitasResumo = snap.upcomingVisits.length
    ? snap.upcomingVisits.map((v) => `- id=${v.id} · ${v.when} — ${v.who}`).join("\n")
    : "(nenhuma visita agendada)";

  const contatosResumo = snap.contacts.length
    ? snap.contacts.map((c) => `${c.name}: ${c.phone}`).join("; ")
    : "nenhum contato salvo";

  const recentConvsList = snap.recentConversations.length
    ? snap.recentConversations.map((c) =>
        `- ${c.name || "(sem nome salvo)"} · ${c.phone} · última mensagem dele: "${c.lastMessage || "(sem mensagem registrada)"}" · ${c.hasUpcomingVisit ? "JÁ TEM visita agendada" : "sem visita agendada"}`
      ).join("\n")
    : "(nenhuma conversa ainda)";

  const isImobiliaria = persona === "imobiliaria";
  const isIncorporadora = persona === "incorporadora";

  const contractsList = snap.rentalContracts.length
    ? snap.rentalContracts.map((c) => `- id=${c.id} · inquilino: ${c.tenant_name}`).join("\n")
    : "(nenhum contrato ativo)";

  const unitsList = snap.units.length
    ? snap.units.map((u) => `- id=${u.id} · ${u.development_name}${u.code ? ` · unidade ${u.code}` : ""} · ${u.status}`).join("\n")
    : "(nenhuma unidade disponível/reservada)";

  let actionNum = 6;
  const extraActions: string[] = [];
  extraActions.push(`${++actionNum}. "create_property" — cadastrar um imóvel NOVO na carteira (o corretor está descrevendo um imóvel que ainda não existe na lista acima, não editando um existente). Precisa de price e location (bairro/cidade/endereço). title é opcional (se não vier, gere um curto a partir do tipo+localização, ex.: "Apartamento no Setor Oeste"). description é opcional mas recomendado: escreva um texto de venda natural e atraente com TUDO que não couber nos campos estruturados abaixo (andar, detalhes do prédio/condomínio, etc.).
   CAMPOS ESTRUTURADOS — isto NÃO é opcional: sempre que o corretor mencionar qualquer um destes, você TEM que preencher o campo correspondente, MESMO que a mesma informação também apareça em texto na description. Nunca deixe um campo vazio só porque "já está na descrição" — description e os campos estruturados são preenchidos JUNTOS, o campo estruturado é o que alimenta o formulário de verdade, a descrição é só o texto de venda.
   - quartos: quantidade total de quartos/dormitórios.
   - banheiros: conte CADA banheiro mencionado, mesmo quando o corretor não repete a palavra (ex.: "1 banheiro interno e 1 externo" = 2; "2 suítes" = pelo menos 2 banheiros, some com os que não são de suíte).
   - area_m2: metragem em m², só o número (NÃO é o campo "area" de navegação).
   - piscina: "Sim" se mencionar piscina (mesmo com erro de digitação tipo "psicina"), senão "Não".
   - vagas_garagem: número de vagas/carros na garagem.
   - varanda_gourmet: "Sim" se mencionar área/varanda gourmet, senão "Não".
   - tipo_imovel ("residencial"|"comercial", padrão "residencial") e finalidade ("venda"|"aluguel"|"ambos", padrão "venda" — infira do que o corretor disse).
   Exemplo de mapeamento — corretor diz "casa no Jardim América, 4 quartos, sendo duas suítes, 1 banheiro interno e 1 externo, área gourmet, piscina e garagem pra 2 carros, 700 mil": quartos="4", banheiros="4" (2 das suítes + 1 interno + 1 externo), piscina="Sim", varanda_gourmet="Sim", vagas_garagem="2", price="700000".
   O price segue a MESMA regra do update_property abaixo (número em reais, sem "R$"). NUNCA use update_property pra isso — é um imóvel novo, não existe property_id ainda.`);
  extraActions.push(`${++actionNum}. "update_property" — editar um imóvel já cadastrado (preço, título ou status). Precisa de property_id (da lista de imóveis acima) e ao menos um de: price, title, status ("disponivel"|"vendido"|"alugado"). O price deve ser o VALOR EM REAIS como número (ex.: "350 mil" → price "350000"; "1,2 milhão" → "1200000"); o sistema formata o "R$" sozinho. NUNCA invente um property_id — use só um que esteja na lista de imóveis.`);
  extraActions.push(`${++actionNum}. "cancel_visit" — cancelar uma visita já agendada. Precisa de visit_id, tirado EXATAMENTE da lista de "Próximas visitas" acima (nunca invente, nunca use um horário como id). Se a visita que o cliente quer cancelar não estiver na lista, use "answer" e explique que só enxerga as 5 mais próximas — oriente a cancelar direto na Agenda. Se o corretor pedir pra AVISAR/INFORMAR o cliente do cancelamento (ex.: "cancela e avisa que tive um imprevisto"), preencha notify_message com uma mensagem curta, natural e cordial explicando o cancelamento em nome do corretor (ex.: "Oi! Infelizmente precisei cancelar nossa visita de hoje por um imprevisto, mas já podemos remarcar quando for melhor pra você."). Sem pedido explícito de avisar, deixe notify_message vazio — não manda mensagem sem o corretor pedir.`);
  extraActions.push(`${++actionNum}. "update_visit" — remarcar uma visita já agendada pra nova data/horário. Precisa de visit_id (mesma regra do cancel_visit acima), date (YYYY-MM-DD) e time (HH:MM) novos. Mesma regra de notify_message do cancel_visit acima — só preenche se o corretor pedir pra avisar o cliente da mudança.`);
  if (isImobiliaria) {
    extraActions.push(`${++actionNum}. "end_rental_contract" — encerrar um contrato de locação ativo. Precisa de contract_id, tirado EXATAMENTE da lista de "Contratos de locação ativos" abaixo. Nunca invente um contract_id.`);
  }
  if (isIncorporadora) {
    extraActions.push(`${++actionNum}. "update_unit" — reservar, vender ou liberar uma unidade de lançamento. Precisa de unit_id (da lista de "Unidades" abaixo, nunca invente), unit_action ("reservar"|"vender"|"liberar"). Pra "reservar" precisa também de buyer_name (e buyer_phone se tiver). Pra "vender" buyer_name é opcional (mantém o que já estava reservado se não for informado).`);
  }

  return `Você é a assistente de IA do ImobiFlow, trabalhando para ${snap.brokerName}, um corretor de imóveis. Você fala português do Brasil, de forma curta, direta e cordial — como um colega de trabalho competente, nunca robótica.

Hoje é ${hoje} (data ISO: ${isoHoje}).

Você conhece o estado REAL da conta e deve responder com base nele, sem inventar números:
- Imóveis na carteira:
${propsList}
- Leads: ${leadsResumo} (total ${snap.leadsTotal})
- Conversas de WhatsApp — pessoas que JÁ ENTRARAM EM CONTATO de verdade
  (isso é DIFERENTE de "Leads" acima, que só conta quem foi formalmente
  cadastrado como lead; toda conversa de WhatsApp conta aqui, mesmo sem
  virar lead ainda): ${snap.conversationsTotal} conversa(s) no total —
  ${snap.conversationCounts.ia} com a IA atendendo agora, ${snap.conversationCounts.aguardando} aguardando
  você responder, ${snap.conversationCounts.encerrado} encerrada(s). Se
  perguntarem algo como "quantas pessoas entraram em contato" ou "quantos
  clientes falaram com a gente", use ESTE número, não o de Leads.
- Detalhe das conversas mais recentes (até 10, nome/telefone/última
  mensagem do cliente/se já tem visita marcada — use isso pra responder
  QUEM é quem, não só quantos): quando perguntarem qual contato está "mais
  perto de fechar" ou "perto de agendar visita", quem JÁ TEM visita
  agendada é o mais perto disso — cite o nome. Pra "provável comprador",
  dê sua impressão honesta lendo a última mensagem de cada um (interesse
  demonstrado, pergunta sobre preço/visita, etc.), mas deixe claro que é
  uma leitura sua da conversa, não uma pontuação exata do sistema. Nunca
  invente uma mensagem ou visita que não esteja na lista:
${recentConvsList}
- Próximas visitas (só as 5 mais próximas a partir de agora — NÃO é o calendário
  inteiro, não inclui visitas passadas nem além da 5ª; o id de cada uma é o
  identificador real, use-o pra cancelar/remarcar, nunca invente):
${visitasResumo}
- Visitas neste mês: ${snap.visitsThisMonth.total} agendadas, ${snap.visitsThisMonth.done} realizadas
- Contratos de locação ativos (${snap.activeRentals}):
${isImobiliaria ? contractsList : "(veja a lista completa só disponível pra conta de imobiliária)"}
- Contatos salvos (nome: telefone): ${contatosResumo}
${isIncorporadora ? `- Unidades de lançamento disponíveis/reservadas:\n${unitsList}` : ""}

Você pode fazer ${actionNum} coisas, escolhendo uma no campo action.type:
1. "answer" — responder uma pergunta ou conversar, usando SÓ os dados acima (imóveis, leads, contratos). Nunca invente números.
2. "navigate" — levar o corretor até uma área do sistema. Preencha action.area com uma destas: ${areas.join(", ")}. Use quando ele pedir "me mostra X", "abre X", "quero ver X".
3. "create_lead" — cadastrar um lead novo. Precisa de name, phone e property_id (escolha o id do imóvel mais provável da lista acima; se nenhum imóvel combinar ou não houver imóveis, use "answer" pedindo pra ele especificar o imóvel).
4. "create_visit" — agendar uma visita. Precisa de name (cliente), date (YYYY-MM-DD) e time (HH:MM); phone e property_id são opcionais. Resolva datas relativas ("amanhã", "sexta") a partir da data de hoje.
5. "query_agenda" — SEMPRE que perguntarem sobre visitas de uma data ou período que NÃO esteja coberto pelos dados acima (qualquer data específica, passada ou futura, fora das "próximas visitas" listadas, ou fora do mês corrente). Preencha date_from (YYYY-MM-DD, obrigatório) e date_to (YYYY-MM-DD, só se for um intervalo — se for um único dia, omita date_to). Você NÃO tem esse dado agora; o sistema vai buscar de verdade e só depois responder — por isso NUNCA use "answer" pra afirmar que não há nada num período que você não tem na lista acima, use "query_agenda".
6. "send_message" — mandar uma mensagem REAL pelo WhatsApp do cliente. Use SEMPRE que o pedido for claramente "manda/envia uma mensagem pro número X (ou pro [nome do contato]) dizendo/oferecendo Y" — NUNCA confunda isso com "create_lead" (cadastrar é diferente de enviar). Precisa de phone (o número) e message (o texto que você mesmo compõe a partir do que foi pedido, natural e cordial, em nome do corretor). O texto de message NUNCA deve narrar a própria ação pro cliente — nunca escreva "estou fazendo um follow-up", "isto é um lembrete automático", "estou entrando em contato para..." ou qualquer frase que explique o motivo/processo por trás da mensagem; escreva como o corretor mandaria de verdade, direto ao ponto. Ex.: pedido "faça um follow pro Hunter sobre as fotos" → message deve soar como "Oi Hunter, tudo bem? Passando aqui pra saber se você viu as fotos que te mandei — ficou alguma dúvida ou quer marcar uma visita?", NUNCA "Estou fazendo um follow-up sobre as fotos que você pediu". Se o corretor disser um NOME em vez de número (ex.: "manda mensagem pro Hunter"), procure esse nome na lista de Contatos salvos acima e use o telefone de lá — só pergunte o número se o nome não estiver na lista de contatos.
${extraActions.join("\n")}

Regras:
- O campo reply é SEMPRE preenchido, em linguagem natural, confirmando o que você entendeu ou respondendo (exceto em query_agenda, onde reply pode ser um placeholder curto tipo "Deixa eu ver..." — a resposta final vem da consulta real).
- Para ações de criar/editar/enviar/cancelar/remarcar, o reply deve resumir a ação em uma frase (ex.: "Vou cadastrar a Maria no Apartamento Centro." / "Vou cancelar a visita com o João.").
- phone: pode vir como o corretor falar, ou resolvido a partir de um nome da lista de Contatos; não precisa formatar.
- "enviar/mandar mensagem" é SEMPRE send_message, nunca create_lead — são ações diferentes mesmo quando o mesmo número aparece nos dois contextos.
- Só use uma ação de mutação (create/update/cancel/send) quando o pedido for claramente isso. Perguntas são sempre "answer" (se o dado já está acima) ou "query_agenda" (se for sobre uma data que você não tem).
- NUNCA invente um id (property_id, visit_id, contract_id, unit_id) — use sempre um id exato que apareça nas listas acima. Se não souber o id de algo que o corretor descreveu (ex.: "cancela minha visita de sexta" mas sexta não está nas próximas 5), diga isso com honestidade e oriente a fazer direto na tela correspondente, em vez de adivinhar.
- Pra cancel_visit/update_visit/end_rental_contract: o id escolhido tem que corresponder ao NOME (cliente ou inquilino) que a pessoa mencionou, comparando com a lista correspondente acima. Se o nome mencionado não bater com nenhum item da lista, NÃO escolha nenhum id só porque existe um — use "answer" e diga que não achou esse registro na lista visível. NUNCA escolha um id "pelo menos parecido" ou o primeiro da lista só pra cumprir o pedido.
- Cuidado especial: uma palavra dentro do NOME de uma pessoa (ex.: um cliente que se chama "algo Cancela" ou "algo Remarca") NÃO é um comando — se o pedido é claramente pra CRIAR algo novo (create_lead/create_visit), use create, mesmo que o nome contenha uma palavra parecida com cancelar/remarcar/editar.
- Quando uma ação anterior no histórico falhou só por faltar UM campo (ex.: você pediu o preço) e a mensagem atual do corretor traz só esse campo que faltava (ex.: "1 milhão"), você DEVE refazer a ação INTEIRA de novo, reaproveitando TODOS os outros detalhes que ele já tinha te dado antes na conversa — não só o texto livre da descrição. Isso vale especialmente pra create_property: se ele já tinha mencionado quartos/banheiros/piscina/área/vagas/varanda gourmet na mensagem anterior, preencha esses campos estruturados de novo agora, mesmo que a mensagem atual só tenha o preço.`;
}

// Preço no imf_properties é texto livre — o formulário manual sempre grava
// "R$ 350.000,00". O assistente costuma mandar o número cru ("350000"), que
// apareceria sem formatação no card. Normaliza pro mesmo padrão: converte o
// que o modelo mandou (com ou sem "R$"/pontos/vírgula) pra reais inteiros e
// reformata como "R$ 350.000". Se não der pra interpretar, devolve como veio.
function normalizePriceToBRL(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  let reais: number;
  if (s.includes(",")) {
    // Formato brasileiro com centavos: tira tudo menos dígito/vírgula, remove
    // ponto de milhar, troca a vírgula decimal por ponto.
    reais = parseFloat(s.replace(/[^\d,]/g, "").replace(/\./g, "").replace(",", "."));
  } else {
    // Só dígitos (com ou sem ponto de milhar) → reais inteiros.
    reais = parseInt(s.replace(/\D/g, ""), 10);
  }
  if (!Number.isFinite(reais) || reais <= 0) return s;
  // Sempre 2 casas decimais — mesmo formato que maskFromCents() produz no
  // formulário manual (src/lib/money.ts). Divergia antes ("R$ 500.000" vs
  // "R$ 500.000,00"), o que causava valores "diferentes" pro mesmo preço.
  return "R$ " + reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Manda uma mensagem REAL pelo WhatsApp em nome do corretor — mesmo caminho
// de send_message, extraído aqui pra ser reaproveitado por cancel_visit/
// update_visit quando o corretor pede pra AVISAR o cliente junto da ação.
// Nunca lança: notificar é efeito SECUNDÁRIO — se falhar, a ação principal
// (cancelar/remarcar) já aconteceu e não deve ser desfeita por causa disso;
// quem chama decide como reportar a falha no resumo.
async function sendNotification(brokerId: string, phone: string, message: string): Promise<boolean> {
  try {
    const customerPhone = normalizePhoneBR(phone);
    const instanceToken = await resolveOutboundInstanceToken(brokerId, customerPhone);
    if (!instanceToken) return false;
    const sent = await sendUazapiText(instanceToken, customerPhone, message);
    if (!sent.ok) return false;
    await recordConversationMessage({
      brokerId,
      customerPhone,
      direction: "out",
      senderType: "broker_manual",
      body: message,
      initialStatus: "open",
    });
    await pauseAiForHumanTakeover(brokerId, customerPhone).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Executa uma ação de mutação, revalidando que o imóvel é do corretor (e,
// pra membro que não é dono da conta, que o imóvel é dele mesmo).
export async function executeAction(brokerId: string, userId: string, action: AgentAction): Promise<{ summary: string; navigate?: string }> {
  const owner = await isBrokerOwner(userId, brokerId);

  if (action.type === "create_lead") {
    if (!action.name || !action.phone) throw new Error("Nome e telefone são obrigatórios pra cadastrar o lead.");
    if (!action.property_id) throw new Error("Preciso saber a qual imóvel esse lead está ligado.");
    // valida posse do imóvel
    const propQuery = supabase.from("imf_properties").select("id, title").eq("id", action.property_id).eq("broker_id", brokerId);
    if (!owner) propQuery.eq("owner_user_id", userId);
    const { data: prop } = await propQuery.maybeSingle();
    if (!prop) throw new Error("Imóvel não encontrado na sua carteira.");
    const { pipeline_id, pipeline_stage_id } = await resolveNewLeadStage(brokerId);
    const { error } = await supabase.from("leads").insert({
      property_id: action.property_id,
      name: action.name,
      phone: normalizePhoneBR(action.phone),
      status: "new",
      notes: "Criado pela assistente de IA",
      owner_user_id: userId,
      pipeline_id,
      pipeline_stage_id,
      created_at: new Date(),
    });
    if (error) throw error;
    return { summary: `Lead ${action.name} cadastrado em "${prop.title}".`, navigate: "negocios" };
  }

  if (action.type === "create_visit") {
    if (!action.name) throw new Error("Preciso do nome do cliente pra agendar a visita.");
    if (!action.date || !action.time) throw new Error("Preciso da data e do horário da visita.");
    let propertyId: string | null = null;
    if (action.property_id) {
      const propQuery = supabase.from("imf_properties").select("id").eq("id", action.property_id).eq("broker_id", brokerId);
      if (!owner) propQuery.eq("owner_user_id", userId);
      const { data: prop } = await propQuery.maybeSingle();
      propertyId = prop?.id || null;
    }
    const scheduledAt = brDateTimeToISO(action.date, action.time);
    if (isNaN(scheduledAt.getTime())) throw new Error("Não consegui entender a data/horário da visita.");
    const { error } = await supabase.from("imf_agenda").insert({
      broker_id: brokerId,
      owner_user_id: userId,
      property_id: propertyId,
      client_name: action.name,
      client_phone: action.phone ? normalizePhoneBR(action.phone) : null,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: 60,
      status: "pendente",
      source: "ia",
    });
    if (error) throw error;
    const quando = scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: BR_TZ });
    return { summary: `Visita com ${action.name} agendada para ${quando}.`, navigate: "agenda" };
  }

  if (action.type === "send_message") {
    if (!action.phone || !action.message?.trim()) throw new Error("Preciso do telefone e do texto da mensagem.");

    // ⚠️ Envio REAL pelo WhatsApp — mesmo caminho de Conversas (wppShim.ts),
    // incluindo o roteamento por instância própria de membro quando aplicável.
    // Sem instância configurada, falha honesto em vez de fingir que enviou.
    const customerPhone = normalizePhoneBR(action.phone);
    const instanceToken = await resolveOutboundInstanceToken(brokerId, customerPhone);
    if (!instanceToken) {
      throw new Error("Instância de WhatsApp não configurada pra este corretor ainda — não enviei nada.");
    }

    const sent = await sendUazapiText(instanceToken, customerPhone, action.message);
    if (!sent.ok) throw new Error("Falha ao enviar via WhatsApp (UAZAPI). Nada foi entregue.");

    await recordConversationMessage({
      brokerId,
      customerPhone,
      direction: "out",
      senderType: "broker_manual", // é o corretor mandando, só que ditado pra IA — não é a IA de atendimento respondendo sozinha
      body: action.message,
      initialStatus: "open",
    });
    // Mesmo efeito de handover de uma resposta manual em Conversas — evita o
    // atendimento automático (Z-PRO/N8N) responder em cima dessa mensagem.
    await pauseAiForHumanTakeover(brokerId, customerPhone).catch(() => {});

    return { summary: `Mensagem enviada para ${customerPhone}.`, navigate: "conversas" };
  }

  if (action.type === "create_property") {
    if (!action.price) throw new Error("Preciso do valor do imóvel pra cadastrar.");
    if (!action.location) throw new Error("Preciso da localização (bairro/cidade) do imóvel pra cadastrar.");

    const title = action.title?.trim() || `Imóvel em ${action.location}`;

    // Mesma convenção do PropertyForm.tsx/properties.ts: os campos estruturados
    // que não têm coluna própria no banco vão embutidos no description, depois
    // de um separador fixo — GET /api/properties e a tela de edição já sabem
    // desserializar esse formato.
    const toInt = (v: string | undefined) => {
      const n = parseInt((v || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    };
    const details = {
      tipo_imovel: action.tipo_imovel || "residencial",
      finalidade: action.finalidade || "venda",
      quartos: toInt(action.quartos),
      sala: 1,
      cozinha: 1,
      piscina: action.piscina || "Não",
      banheiros: toInt(action.banheiros),
      area: toInt(action.area_m2),
      varanda_gourmet: action.varanda_gourmet || "Não",
      vagas_garagem: toInt(action.vagas_garagem),
      tipo_comercial: "Sala comercial",
    };
    const description = `${(action.description || "").trim()}\n\n---DETALHES-GERADOS---\n${JSON.stringify(details)}`;

    const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
    const slugBase = title.toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "")
      .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
    const link = `${APP_URL}/p/${slug}`;

    const { data: created, error } = await supabase.from("imf_properties").insert({
      title,
      price: normalizePriceToBRL(action.price),
      location: action.location,
      description,
      slug,
      link,
      status: "disponivel",
      broker_id: brokerId,
      owner_user_id: userId,
      ...(action.image_urls?.length ? { image_url: JSON.stringify(action.image_urls) } : {}),
    }).select("id, title").single();
    if (error) throw error;

    const fotosMsg = action.image_urls?.length ? ` com ${action.image_urls.length} foto(s)` : "";
    return { summary: `Imóvel "${created.title}" cadastrado na carteira${fotosMsg}.`, navigate: "carteira" };
  }

  if (action.type === "update_property") {
    if (!action.property_id) throw new Error("Preciso saber qual imóvel editar.");
    const propQuery = supabase.from("imf_properties").select("id, title").eq("id", action.property_id).eq("broker_id", brokerId);
    if (!owner) propQuery.eq("owner_user_id", userId);
    const { data: prop } = await propQuery.maybeSingle();
    if (!prop) throw new Error("Imóvel não encontrado na sua carteira.");

    const updates: Record<string, any> = {};
    if (action.price !== undefined) updates.price = normalizePriceToBRL(action.price);
    if (action.title !== undefined) updates.title = action.title;
    if (action.status !== undefined) updates.status = action.status;
    if (Object.keys(updates).length === 0) throw new Error("Não entendi o que mudar nesse imóvel.");

    const { error } = await supabase.from("imf_properties").update(updates).eq("id", action.property_id);
    if (error) throw error;
    return { summary: `Imóvel "${updates.title || prop.title}" atualizado.`, navigate: "carteira" };
  }

  if (action.type === "cancel_visit") {
    if (!action.visit_id) throw new Error("Preciso saber qual visita cancelar.");
    const visitQuery = supabase.from("imf_agenda").select("id, client_name, client_phone").eq("id", action.visit_id).eq("broker_id", brokerId);
    if (!owner) visitQuery.eq("owner_user_id", userId);
    const { data: visit } = await visitQuery.maybeSingle();
    if (!visit) throw new Error("Não encontrei essa visita.");

    const { error } = await supabase.from("imf_agenda").delete().eq("id", action.visit_id);
    if (error) throw error;

    let notifyMsg = "";
    if (action.notify_message?.trim()) {
      if (!visit.client_phone) notifyMsg = " Não consegui avisar o cliente — sem telefone salvo nessa visita.";
      else notifyMsg = (await sendNotification(brokerId, visit.client_phone, action.notify_message))
        ? " Cliente avisado pelo WhatsApp."
        : " Não consegui avisar o cliente pelo WhatsApp (instância indisponível ou falha no envio).";
    }
    return { summary: `Visita com ${visit.client_name || "cliente"} cancelada.${notifyMsg}`, navigate: "agenda" };
  }

  if (action.type === "update_visit") {
    if (!action.visit_id) throw new Error("Preciso saber qual visita remarcar.");
    if (!action.date || !action.time) throw new Error("Preciso da nova data e horário da visita.");
    const visitQuery = supabase.from("imf_agenda").select("id, client_name, client_phone").eq("id", action.visit_id).eq("broker_id", brokerId);
    if (!owner) visitQuery.eq("owner_user_id", userId);
    const { data: visit } = await visitQuery.maybeSingle();
    if (!visit) throw new Error("Não encontrei essa visita.");

    const scheduledAt = brDateTimeToISO(action.date, action.time);
    if (isNaN(scheduledAt.getTime())) throw new Error("Não consegui entender a nova data/horário.");
    const { error } = await supabase.from("imf_agenda")
      .update({ scheduled_at: scheduledAt.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", action.visit_id);
    if (error) throw error;
    const quando = scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: BR_TZ });

    let notifyMsg = "";
    if (action.notify_message?.trim()) {
      if (!visit.client_phone) notifyMsg = " Não consegui avisar o cliente — sem telefone salvo nessa visita.";
      else notifyMsg = (await sendNotification(brokerId, visit.client_phone, action.notify_message))
        ? " Cliente avisado pelo WhatsApp."
        : " Não consegui avisar o cliente pelo WhatsApp (instância indisponível ou falha no envio).";
    }
    return { summary: `Visita com ${visit.client_name || "cliente"} remarcada para ${quando}.${notifyMsg}`, navigate: "agenda" };
  }

  if (action.type === "end_rental_contract") {
    if (!action.contract_id) throw new Error("Preciso saber qual contrato encerrar.");
    const { data: contract } = await supabase.from("imf_rental_contracts")
      .select("id, tenant_name").eq("id", action.contract_id).eq("broker_id", brokerId).maybeSingle();
    if (!contract) throw new Error("Não encontrei esse contrato de locação.");

    const { error } = await supabase.from("imf_rental_contracts")
      .update({ status: "encerrado", end_date: new Date().toISOString().split("T")[0], updated_at: new Date().toISOString() })
      .eq("id", action.contract_id);
    if (error) throw error;
    return { summary: `Contrato com ${contract.tenant_name} encerrado.`, navigate: "locacao" };
  }

  if (action.type === "update_unit") {
    if (!action.unit_id) throw new Error("Preciso saber qual unidade alterar.");
    if (!["reservar", "vender", "liberar"].includes(action.unit_action || "")) {
      throw new Error("Preciso saber se é pra reservar, vender ou liberar a unidade.");
    }
    const { data: unit } = await supabase.from("imf_units").select("id, code, development_id").eq("id", action.unit_id).maybeSingle();
    if (!unit) throw new Error("Não encontrei essa unidade.");
    const { data: dev } = await supabase.from("imf_developments").select("id").eq("id", unit.development_id).eq("broker_id", brokerId).maybeSingle();
    if (!dev) throw new Error("Unidade não encontrada nos seus empreendimentos.");

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    let actionLabel: string;
    if (action.unit_action === "reservar") {
      if (!action.buyer_name) throw new Error("Preciso do nome do comprador pra reservar a unidade.");
      updates.status = "reservado";
      updates.buyer_name = action.buyer_name;
      updates.buyer_phone = action.buyer_phone ? normalizePhoneBR(action.buyer_phone) : null;
      updates.reserved_until = new Date(Date.now() + 3600_000).toISOString();
      actionLabel = "reservada";
    } else if (action.unit_action === "vender") {
      updates.status = "vendido";
      if (action.buyer_name) updates.buyer_name = action.buyer_name;
      if (action.buyer_phone) updates.buyer_phone = normalizePhoneBR(action.buyer_phone);
      updates.reserved_until = null;
      updates.sold_by_user_id = userId;
      updates.sold_at = updates.updated_at;
      actionLabel = "vendida";
    } else {
      updates.status = "disponivel";
      updates.buyer_name = null;
      updates.buyer_phone = null;
      updates.reserved_until = null;
      updates.sold_by_user_id = null;
      updates.sold_at = null;
      actionLabel = "liberada";
    }

    const { error } = await supabase.from("imf_units").update(updates).eq("id", action.unit_id);
    if (error) throw error;
    return { summary: `Unidade ${unit.code || ""} ${actionLabel}.`.replace("  ", " "), navigate: "lancamentos" };
  }

  throw new Error("Ação não executável.");
}

// Formato exigido do modelo (OpenRouter/json_object não valida schema, só
// garante JSON válido) — reforçado em texto no fim do system prompt também
// (ver buildSystemPrompt).
const JSON_SHAPE_HINT = `Responda SEMPRE em JSON válido, exatamente neste formato:
{"reply": "string", "action": {"type": "answer|navigate|create_lead|create_visit|query_agenda|send_message|create_property|update_property|cancel_visit|update_visit|end_rental_contract|update_unit", "area"?: "string", "name"?: "string", "phone"?: "string", "property_id"?: "string", "date"?: "string", "time"?: "string", "date_from"?: "string", "date_to"?: "string", "message"?: "string", "price"?: "string", "title"?: "string", "status"?: "string", "location"?: "string", "description"?: "string", "quartos"?: "string", "banheiros"?: "string", "area_m2"?: "string", "vagas_garagem"?: "string", "piscina"?: "Sim|Não", "tipo_imovel"?: "residencial|comercial", "finalidade"?: "venda|aluguel|ambos", "varanda_gourmet"?: "Sim|Não", "visit_id"?: "string", "contract_id"?: "string", "unit_id"?: "string", "unit_action"?: "reservar|vender|liberar", "buyer_name"?: "string", "buyer_phone"?: "string", "notify_message"?: "string"}}`;

// A resposta anterior da IA é reduzida ao texto de "reply" (sem o JSON de
// action) — o modelo não precisa reler a própria estrutura de ação, só o que
// disse em linguagem natural, pra manter o fio da conversa.
function replyOnly(text: string): string {
  return text.split("\n✓ ")[0].split("\n(cancelado)")[0].trim();
}

async function callOpenRouter(apiKey: string, systemPrompt: string, message: string, history: AgentTurn[]): Promise<{ reply: string; action: AgentAction }> {
  const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://imobiflow.fly.dev",
      "X-Title": "ImobiFlow",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${JSON_SHAPE_HINT}` },
        ...history.map((h) => ({ role: h.role === "user" ? "user" : "assistant", content: h.role === "user" ? h.text : replyOnly(h.text) })),
        { role: "user", content: message },
      ],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${resp.status}`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta vazia do OpenRouter.");
  return JSON.parse(content);
}

export async function runAgent(opts: {
  brokerId: string;
  userId: string;
  message: string;
  persona: string;
  autonomy: Autonomy;
  history?: AgentTurn[];
  imageUrls?: string[]; // fotos anexadas na conversa (já enviadas ao Storage)
}): Promise<AgentResult> {
  const history = opts.history || [];
  // OpenRouter é a ÚNICA fonte de IA do agente (decisão explícita
  // 2026-07-14) — a chave Gemini pessoal ficava com cota zerada
  // repetidamente (confirmado direto contra a API: "limit: 0" em todos os
  // modelos, texto e áudio), então deixou de valer a pena manter o caminho
  // Gemini como principal ou fallback.
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const hasOpenRouter = !!openRouterKey && openRouterKey.startsWith("sk-or-");
  if (!hasOpenRouter) {
    return { reply: "A assistente de IA não está configurada no servidor (falta a chave da IA)." };
  }

  const snap = await buildSnapshot(opts.brokerId, opts.userId, opts.persona);
  const systemPrompt = buildSystemPrompt(snap, opts.persona, opts.autonomy);

  let parsed: { reply: string; action: AgentAction };
  try {
    parsed = await callOpenRouter(openRouterKey!, systemPrompt, opts.message, history);
  } catch (err: any) {
    const msg = String(err?.message || "");
    console.error("[Agent] erro OpenRouter:", msg);
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("resource_exhausted")) {
      // Cota/limite é um estado operacional, não um bug — mensagem honesta e
      // distinta pra você saber que é a chave da IA, não o código.
      return { reply: "A IA atingiu o limite de uso da chave configurada. Verifique o plano/cota da chave do servidor." };
    }
    return { reply: "Tive um problema pra pensar nisso agora. Pode tentar de novo?" };
  }

  const action = parsed.action || { type: "answer" };
  const reply = parsed.reply || "Certo.";

  // Fotos anexadas na conversa nunca vêm do modelo — anexadas aqui,
  // mecanicamente, só quando a ação é criar um imóvel novo.
  if (action.type === "create_property" && opts.imageUrls?.length) {
    action.image_urls = opts.imageUrls;
  }

  // answer, navigate e query_agenda nunca são mutação — seguem direto, autonomia não se aplica.
  if (action.type === "answer") return { reply };
  if (action.type === "navigate") {
    const areas = AREAS_BY_PERSONA[opts.persona] || AREAS_BY_PERSONA.corretor;
    const area = areas.includes(action.area || "") ? action.area : undefined;
    return { reply, navigate: area };
  }
  if (action.type === "query_agenda") {
    const realReply = await queryAgendaRange(opts.brokerId, opts.userId, action.date_from, action.date_to);
    return { reply: realReply };
  }

  // create_lead / create_visit são mutações — a autonomia decide.
  if (opts.autonomy === "piloto") {
    try {
      const { summary, navigate } = await executeAction(opts.brokerId, opts.userId, action);
      return { reply, executed: summary, navigate, refresh: true };
    } catch (err: any) {
      return { reply: `${reply}\n\nMas não consegui concluir: ${err.message}` };
    }
  }

  // copiloto / manual: propõe e espera confirmação.
  return { reply, proposedAction: action };
}
