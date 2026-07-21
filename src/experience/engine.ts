// Registro do rail manual — as 3 personas hoje têm cockpit com dado real
// (ver realData.ts: fetchCorretorLayout/fetchIncorporadoraLayout/
// fetchImobiliariaLayout). O motor mock por persona foi removido daqui.

import type { Persona, AreaItem } from './types';

// Áreas do rail manual. Cada uma é uma tela manual completa (construídas etapa a etapa).
export const AREAS: AreaItem[] = [
  { key: 'hoje',        label: 'Hoje',        personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'conversas',   label: 'Conversas',   personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'assistente-ia', label: 'Assistente IA', personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'carteira',    label: 'Carteira',    personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'negocios',    label: 'CRM',         personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'agenda',      label: 'Agenda',      personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'contatos',    label: 'Contatos',    personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'lembretes',   label: 'Lembretes',   personas: ['corretor', 'imobiliaria', 'incorporadora'] },
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

