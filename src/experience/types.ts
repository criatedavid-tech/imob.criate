// Contrato da interface generativa.
// O "cérebro" (engine mock hoje, LLM na Etapa 13) devolve um LayoutSpec.
// O renderizador (Canvas) apenas desenha — não conhece regra de negócio.

export type Persona = 'corretor' | 'imobiliaria' | 'incorporadora';

export type WidgetType =
  | 'briefing'
  | 'decisions'
  | 'kpis'
  | 'funnel'
  | 'conversations'
  | 'leadsList'
  | 'aiteam'
  | 'team'
  | 'ranking'
  | 'salesmirror'
  | 'agenda'
  | 'emptyState';

// Largura no grid de 12 colunas.
export type Span = 'sm' | 'md' | 'lg' | 'full';

export interface WidgetSpec {
  id: string;
  type: WidgetType;
  span: Span;
  title?: string;
  // Dados já resolvidos para o widget (mock hoje, backend nas próximas etapas).
  data?: any;
}

export interface LayoutSpec {
  persona: Persona;
  greeting: string;   // voz humana da IA ("Bom dia, Carlos.")
  subtitle: string;   // resumo do que a IA fez / o que precisa de você
  widgets: WidgetSpec[];
  // true = dados reais da conta logada; false/undefined = demonstração (mock).
  // A UI precisa deixar isso claro — nunca fingir que mock é dado real.
  isRealData?: boolean;
}

export type Autonomy = 'piloto' | 'copiloto' | 'manual';

// Áreas do rail manual — acesso a TODAS as funções à mão.
export interface AreaItem {
  key: string;
  label: string;
  // personas que enxergam esta área (progressive disclosure por mundo)
  personas: Persona[];
}
