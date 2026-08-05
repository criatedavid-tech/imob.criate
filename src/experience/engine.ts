// Registro do rail manual — as 3 personas hoje têm cockpit com dado real.
// Funções especializadas podem ser combinadas por conta sem trocar o tipo
// principal usado no onboarding e no cockpit inicial.

import type { Persona, AreaItem, AccountCapability } from './types';

export const AREAS: AreaItem[] = [
  { key: 'hoje',          label: 'Hoje',          personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'conversas',     label: 'Conversas',     personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'assistente-ia', label: 'Assistente IA', personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'carteira',      label: 'Carteira',      personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'negocios',      label: 'CRM',           personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'agenda',        label: 'Agenda',        personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'contatos',      label: 'Contatos',      personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'lembretes',     label: 'Lembretes',     personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'locacao',       label: 'Locação',       personas: ['imobiliaria'], capability: 'rentals' },
  { key: 'lancamentos',   label: 'Lançamentos',   personas: ['incorporadora'], capability: 'developments' },
  { key: 'financeiro',    label: 'Financeiro',    personas: ['imobiliaria', 'incorporadora'], capability: 'finance' },
  { key: 'equipe',        label: 'Equipe',        personas: ['imobiliaria', 'incorporadora'], capability: 'team' },
  { key: 'desempenho',    label: 'Desempenho',    personas: ['imobiliaria', 'incorporadora'], capability: 'team' },
  { key: 'divulgacao',    label: 'Divulgação',    personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'relatorios',    label: 'Relatórios',    personas: ['corretor', 'imobiliaria', 'incorporadora'] },
  { key: 'config',        label: 'Config',        personas: ['corretor', 'imobiliaria', 'incorporadora'] },
];

export const PERSONA_LABEL: Record<Persona, string> = {
  corretor: 'Corretor',
  imobiliaria: 'Imobiliária',
  incorporadora: 'Incorporadora',
};

export function defaultCapabilitiesForPersona(persona: Persona): AccountCapability[] {
  if (persona === 'imobiliaria') return ['rentals', 'finance', 'team'];
  if (persona === 'incorporadora') return ['developments', 'finance', 'team'];
  return [];
}

export function areasForCapabilities(capabilities: readonly AccountCapability[]): AreaItem[] {
  const enabled = new Set(capabilities);
  return AREAS.filter((area) => !area.capability || enabled.has(area.capability));
}
