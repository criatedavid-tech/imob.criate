// O "cérebro" mock da interface generativa.
// Recebe a persona (e no futuro: contexto, hora, dados reais, histórico) e
// devolve um LayoutSpec — quais widgets, em que ordem, com que dados.
// Na Etapa 13 esta função vira uma chamada ao LLM que devolve o mesmo formato.

import type { LayoutSpec, Persona, AreaItem } from './types';

// Áreas do rail manual. Cada uma é uma tela manual completa (construídas etapa a etapa).
export const AREAS: AreaItem[] = [
  { key: 'hoje',        label: 'Hoje',        personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'conversas',   label: 'Conversas',   personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'carteira',    label: 'Carteira',    personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'negocios',    label: 'Negócios',    personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'agenda',      label: 'Agenda',      personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'locacao',     label: 'Locação',     personas: ['imobiliaria'] },
  { key: 'lancamentos', label: 'Lançamentos', personas: ['incorporadora'] },
  { key: 'financeiro',  label: 'Financeiro',  personas: ['imobiliaria', 'incorporadora'] },
  { key: 'equipe',      label: 'Equipe',      personas: ['imobiliaria', 'incorporadora'] },
  { key: 'divulgacao',  label: 'Divulgação',  personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'relatorios',  label: 'Relatórios',  personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'config',      label: 'Config',      personas: ['corretor', 'imobiliaria', 'incorporadora'] },
];

export const PERSONA_LABEL: Record<Persona, string> = {
  corretor: 'Corretor',
  imobiliaria: 'Imobiliária',
  incorporadora: 'Incorporadora',
};

// ── Dados mock por persona (substituídos pelos endpoints reais nas próximas etapas) ──

const CORRETOR: LayoutSpec = {
  persona: 'corretor',
  greeting: 'Bom dia, Carlos.',
  subtitle: 'Enquanto você dormiu, respondi 4 mensagens e marquei 2 visitas. Você só precisa decidir 2 coisas hoje.',
  widgets: [
    { id: 'w-kpis', type: 'kpis', span: 'full', data: [
      { label: 'Leads hoje', value: '6', delta: '+2', tone: 'up' },
      { label: 'Quentes', value: '3', delta: 'agora', tone: 'hot' },
      { label: 'Visitas', value: '2', delta: 'marcadas', tone: 'neutral' },
      { label: 'Perto de fechar', value: 'R$ 890k', delta: '2 negócios', tone: 'up' },
    ]},
    { id: 'w-dec', type: 'decisions', span: 'md', title: 'Precisa de você', data: [
      { icon: 'calendar', text: 'Confirmar a visita do João amanhã, 15h (Apê Rua 14).', primary: 'Confirmar', ghost: 'Remarcar' },
      { icon: 'message', text: 'Respondi a Maria e sugeri 2 imóveis parecidos. Envio agora?', primary: 'Enviar', ghost: 'Ver' },
    ]},
    { id: 'w-conv', type: 'conversations', span: 'md', title: 'Conversas ativas', data: [
      { name: 'Maria Souza', last: 'Adorei! Pode ser sábado?', status: 'ia', tag: 'quente' },
      { name: 'João Pedro', last: 'Qual o valor do condomínio?', status: 'ia', tag: 'quente' },
      { name: 'Rafael Lima', last: 'Vou pensar e te falo.', status: 'voce', tag: 'morno' },
    ]},
    { id: 'w-funnel', type: 'funnel', span: 'md', title: 'Seu funil', data: [
      { stage: 'Novo', count: 12 },
      { stage: 'Em contato', count: 7 },
      { stage: 'Visita', count: 4 },
      { stage: 'Proposta', count: 2 },
      { stage: 'Fechamento', count: 1 },
    ]},
    { id: 'w-ai', type: 'aiteam', span: 'md', title: 'Sua equipe de IA', data: [
      { role: 'Atendente', doing: 'respondendo 3 conversas', on: true },
      { role: 'Follow-up', doing: 'reativando 5 leads frios', on: true },
      { role: 'Analista', doing: 'monitorando seu funil', on: true },
    ]},
  ],
};

const IMOBILIARIA: LayoutSpec = {
  persona: 'imobiliaria',
  greeting: 'Bom dia, Ana.',
  subtitle: 'Distribuí 22 leads para a equipe e cobrei um aluguel atrasado. Duas decisões esperam por você.',
  widgets: [
    { id: 'w-kpis', type: 'kpis', span: 'full', data: [
      { label: 'Leads da equipe', value: '22', delta: 'hoje', tone: 'up' },
      { label: 'Conversão', value: '24%', delta: 'meta 68%', tone: 'up' },
      { label: 'Contratos ativos', value: '148', delta: 'locação', tone: 'neutral' },
      { label: 'Inadimplência', value: '3', delta: 'em cobrança', tone: 'down' },
    ]},
    { id: 'w-dec', type: 'decisions', span: 'md', title: 'Precisa de você', data: [
      { icon: 'users', text: 'Bruno tem 8 leads parados há 3 dias. Redistribuo ou cobro ele?', primary: 'Redistribuir', ghost: 'Cobrar' },
      { icon: 'key', text: 'Inquilino do apê 302 atrasou. Já lembrei; abro cobrança formal?', primary: 'Abrir', ghost: 'Esperar' },
    ]},
    { id: 'w-team', type: 'team', span: 'md', title: 'Sua equipe', data: [
      { name: 'Bruno', leads: 8, conv: '12%', on: true },
      { name: 'Carla', leads: 5, conv: '31%', on: true },
      { name: 'Diego', leads: 6, conv: '22%', on: false },
      { name: 'Elaine', leads: 3, conv: '40%', on: true },
    ]},
    { id: 'w-rank', type: 'ranking', span: 'md', title: 'Ranking do mês', data: [
      { name: 'Elaine', value: 40 },
      { name: 'Carla', value: 31 },
      { name: 'Diego', value: 22 },
      { name: 'Bruno', value: 12 },
    ]},
    { id: 'w-ai', type: 'aiteam', span: 'md', title: 'Sua equipe de IA', data: [
      { role: 'Atendente', doing: 'atendendo 9 conversas', on: true },
      { role: 'Distribuidor', doing: 'roteando leads à equipe', on: true },
      { role: 'Cobrança', doing: 'monitorando aluguéis', on: true },
    ]},
  ],
};

const INCORPORADORA: LayoutSpec = {
  persona: 'incorporadora',
  greeting: 'Bom dia, Roberto.',
  subtitle: 'O Lançamento Jardins está 40% vendido. Avisei os corretores sobre 3 reservas que expiram em 1h.',
  widgets: [
    { id: 'w-kpis', type: 'kpis', span: 'full', data: [
      { label: 'VGV vendido', value: 'R$ 18,4M', delta: '40%', tone: 'up' },
      { label: 'Unidades vendidas', value: '48/120', delta: 'Jardins', tone: 'up' },
      { label: 'Reservas ativas', value: '7', delta: '3 expiram', tone: 'hot' },
      { label: 'Leads no plantão', value: '31', delta: 'hoje', tone: 'neutral' },
    ]},
    { id: 'w-mirror', type: 'salesmirror', span: 'lg', title: 'Espelho de vendas — Jardins', data: {
      units: Array.from({ length: 40 }, (_, i) => ({
        n: 100 + i,
        status: i % 7 === 0 ? 'reservado' : i % 3 === 0 ? 'vendido' : 'disponivel',
      })),
    }},
    { id: 'w-dec', type: 'decisions', span: 'sm', title: 'Precisa de você', data: [
      { icon: 'clock', text: 'Reserva da unidade 801 expira em 1h. Estendo mais 30min?', primary: 'Estender', ghost: 'Liberar' },
      { icon: 'message', text: 'Unidade 1204 teve 3 interessados. Abro disputa de proposta?', primary: 'Abrir', ghost: 'Não' },
    ]},
    { id: 'w-ai', type: 'aiteam', span: 'md', title: 'Sua equipe de IA', data: [
      { role: 'Plantão', doing: 'atendendo 31 leads', on: true },
      { role: 'Reservas', doing: 'controlando travas de tempo', on: true },
      { role: 'Analista', doing: 'prevendo ritmo de vendas', on: true },
    ]},
    { id: 'w-agenda', type: 'agenda', span: 'md', title: 'Próximas visitas ao stand', data: [
      { time: '10:30', who: 'Família Andrade', unit: 'Cobertura 1201' },
      { time: '14:00', who: 'Sr. Mendes', unit: '2 quartos, torre B' },
      { time: '16:30', who: 'Dra. Lopes', unit: 'Garden 04' },
    ]},
  ],
};

const LAYOUTS: Record<Persona, LayoutSpec> = {
  corretor: CORRETOR,
  imobiliaria: IMOBILIARIA,
  incorporadora: INCORPORADORA,
};

// Ponto único que o Canvas consome. Trocar por chamada ao LLM na Etapa 13.
export function buildLayout(persona: Persona): LayoutSpec {
  return LAYOUTS[persona];
}
