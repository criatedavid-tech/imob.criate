import React, { useState } from 'react';
import { Loader2, Sparkles, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authService } from '../services/auth';

type MagicWandTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  onApply: (text: string) => void;
  onEnhance?: () => void;
};

/**
 * Textarea com botão de melhoria via IA (Gemini).
 * O painel de sugestão é renderizado em fluxo normal (não absolute)
 * para evitar clipping pelo overflow-hidden do modal pai.
 */
export default function MagicWandTextarea({
  value,
  onApply,
  className,
  onChange,
  ...props
}: MagicWandTextareaProps) {
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [suggestedText, setSuggestedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeValue = value || '';

  const handleEnhance = async () => {
    if (!safeValue.trim()) return;
    setIsEnhancing(true);
    setSuggestedText(null);
    setError(null);
    try {
      const response = await fetch('/api/ai/enhance-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authService.getAuthHeaders(),
        },
        body: JSON.stringify({ text: safeValue }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao gerar sugestão');
      setSuggestedText(data.suggestedText);
    } catch (err: any) {
      setError(err.message || 'Não foi possível gerar a sugestão.');
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Textarea + botão ✨ */}
      <div className="relative">
        <textarea
          value={safeValue}
          onChange={onChange}
          className={`${className} pb-12`}
          {...props}
        />
        <div className="absolute bottom-3 right-3">
          <button
            type="button"
            onClick={handleEnhance}
            disabled={isEnhancing || !safeValue.trim()}
            title="Melhorar texto com IA ✨"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all
              ${isEnhancing || !safeValue.trim()
                ? 'bg-[var(--surface-glass)] text-[var(--text-low)] cursor-not-allowed border border-[var(--hairline)]'
                : 'bg-violet-500/30 hover:bg-violet-500/50 text-violet-200 border border-violet-400/40 hover:scale-105 active:scale-95'
              }`}
          >
            {isEnhancing
              ? <><Loader2 size={14} className="animate-spin" /> Gerando...</>
              : <><Sparkles size={14} /> IA</>
            }
          </button>
        </div>
      </div>

      {/* Erro inline */}
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-500/15 border border-red-400/25">
          <p className="text-xs text-red-300 leading-snug">{error}</p>
          <button
            type="button"
            onClick={handleEnhance}
            disabled={isEnhancing}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold
              bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-mid)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-all"
          >
            {isEnhancing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Tentar novamente
          </button>
        </div>
      )}

      {/* Painel de sugestão — em fluxo normal, não absolute */}
      <AnimatePresence>
        {suggestedText && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="rounded-2xl overflow-hidden
              backdrop-blur-2xl bg-[var(--control-fill)] border border-[var(--glass-border-strong)]
              shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.3)]"
          >
            {/* Header do painel */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--hairline)]">
              <div className="flex items-center gap-2 text-violet-300">
                <Sparkles size={14} />
                <span className="text-xs font-bold uppercase tracking-wider">Sugestão da IA</span>
              </div>
              <button
                type="button"
                onClick={() => setSuggestedText(null)}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill)] transition-all"
              >
                <X size={14} />
              </button>
            </div>

            {/* Texto sugerido */}
            <div className="px-5 py-4 max-h-48 overflow-y-auto">
              <p className="text-sm text-[var(--text-hi)] leading-relaxed whitespace-pre-wrap">{suggestedText}</p>
            </div>

            {/* Ações */}
            <div className="flex border-t border-[var(--hairline)]">
              <button
                type="button"
                onClick={() => { onApply(suggestedText); setSuggestedText(null); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold text-emerald-300
                  hover:bg-emerald-500/15 transition-colors border-r border-[var(--hairline)]"
              >
                <Check size={14} /> Aplicar
              </button>
              <button
                type="button"
                onClick={() => setSuggestedText(null)}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold text-[var(--text-mid)]
                  hover:bg-[var(--control-fill)] transition-colors"
              >
                <X size={14} /> Descartar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
