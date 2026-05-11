import React, { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Definições de propriedades para o componente MagicWandTextarea.
 * Utilizamos a interseção (&) para garantir que todos os atributos padrão de um textarea 
 * (como placeholder, rows, required, etc) sejam aceitos.
 */
type MagicWandTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  onApply: (text: string) => void;
  onEnhance?: () => void;
};

/**
 * Componente de Textarea Inteligente ("Varinha Mágica").
 * Integra com a rota /api/ai/enhance-text para melhorar descrições usando IA.
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

  const safeValue = value || '';

  /**
   * Envia o conteúdo atual para o backend para ser reescrito pela IA.
   */
  const handleEnhanceContent = async () => {
    if (!safeValue.trim()) return;
    setIsEnhancing(true);
    setSuggestedText(null);
    try {
      // Chama a rota do servidor que integra com o Gemini
      const response = await fetch('/api/ai/enhance-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: safeValue })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Falha ao gerar sugestão');
      }
      setSuggestedText(data.suggestedText);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Não foi possível gerar a sugestão. Tente novamente.');
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="relative">
      <textarea 
        value={safeValue}
        onChange={onChange}
        className={`${className} pb-12`}
        {...props}
      />
      <div className="absolute bottom-4 right-4 flex items-center">
        <button
          type="button"
          onClick={handleEnhanceContent}
          disabled={isEnhancing || !safeValue.trim()}
          className={`flex items-center justify-center p-2 rounded-full transition-all ${
            isEnhancing || !safeValue.trim() 
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
              : 'bg-black text-white hover:bg-[#333333] hover:scale-105'
          }`}
          title="Melhorar texto com IA ✨"
        >
          {isEnhancing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
        </button>
      </div>
      
      <AnimatePresence>
        {suggestedText && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute z-50 top-full left-0 right-0 mt-2 p-6 bg-white border border-[#E5E7EB] rounded-3xl shadow-xl space-y-4 max-h-[300px] overflow-y-auto"
          >
            <div className="flex items-center gap-2 text-black mb-2">
              <Sparkles size={16} />
              <span className="font-bold text-xs uppercase tracking-wider">Sugestão da IA</span>
            </div>
            <p className="text-sm text-[#333333] leading-relaxed whitespace-pre-wrap">{suggestedText}</p>
            <div className="flex gap-3 pt-2">
              <button 
                type="button"
                onClick={() => {
                  onApply(suggestedText);
                  setSuggestedText(null);
                }}
                className="flex-1 bg-black text-white py-3 rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-80 transition-opacity"
              >
                Aplicar
              </button>
              <button 
                type="button"
                onClick={() => setSuggestedText(null)}
                className="flex-1 bg-[#F3F4F6] text-black py-3 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-[#E5E7EB] transition-colors"
              >
                Descartar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
