import React from 'react';
import type { LayoutSpec, Span } from './types';
import { REGISTRY, WidgetMotion } from './widgets';

// Span → classes estáticas (Tailwind 4 não pode purgar classes montadas dinamicamente).
const SPAN_CLASS: Record<Span, string> = {
  sm: 'col-span-12 md:col-span-4',
  md: 'col-span-12 md:col-span-6',
  lg: 'col-span-12 md:col-span-8',
  full: 'col-span-12',
};

// O Canvas não conhece regra de negócio — só desenha o LayoutSpec que o cérebro entrega.
export function Canvas({ layout, onAreaClick }: { layout: LayoutSpec; onAreaClick?: (area: string) => void }) {
  const Briefing = REGISTRY.briefing;
  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* Briefing (voz humana da IA) sempre abre o canvas */}
      <WidgetMotion index={0}>
        <div className="mb-5">
          <Briefing spec={{ id: 'briefing', type: 'briefing', span: 'full', data: { greeting: layout.greeting, subtitle: layout.subtitle } }} />
        </div>
      </WidgetMotion>

      <div className="grid grid-cols-12 gap-5">
        {layout.widgets.map((w, i) => {
          const Comp = REGISTRY[w.type];
          if (!Comp) return null;
          return (
            <div key={w.id} className={SPAN_CLASS[w.span]}>
              <WidgetMotion index={i + 1}>
                <Comp spec={w} onAreaClick={onAreaClick} />
              </WidgetMotion>
            </div>
          );
        })}
      </div>
    </div>
  );
}
