import React, { useState } from 'react';
import { Sparkles, ArrowUp, Mic } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

// Camada de comando: entrada primária em linguagem natural.
// Etapa 0: reconhece o envio e responde de forma provisória. Etapa 13: executa de verdade via IA.
export function CommandBar() {
  const [value, setValue] = useState('');
  const [ack, setAck] = useState<string | null>(null);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    setAck(`Entendi: "${v}". Nas próximas etapas eu executo isso de verdade.`);
    setValue('');
    setTimeout(() => setAck(null), 4000);
  };

  return (
    <div className="pointer-events-none fixed bottom-6 inset-x-0 z-30 flex justify-center px-4">
      <div className="w-full max-w-2xl pointer-events-auto">
        <AnimatePresence>
          {ack && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="mb-3 mx-auto w-fit rounded-2xl px-4 py-2.5 text-[13px] text-white/80
                backdrop-blur-2xl bg-violet-500/20 border border-violet-300/25 flex items-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-200 shrink-0" /> {ack}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 rounded-[22px] px-3 py-2.5
          backdrop-blur-2xl bg-white/[0.09] border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_16px_40px_-12px_rgba(0,0,0,0.6)]">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0
            bg-gradient-to-br from-violet-400/40 to-indigo-500/40 border border-white/20">
            <Sparkles className="w-4 h-4 text-violet-100" />
          </div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Fale com a IA…  ex: cadastra um imóvel · quem devo ligar hoje?"
            className="flex-1 bg-transparent outline-none text-[14px] text-white placeholder:text-white/35"
          />
          <button className="w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white/70 transition-colors">
            <Mic className="w-4 h-4" />
          </button>
          <button onClick={submit}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white
              bg-violet-500/40 border border-violet-300/30 hover:bg-violet-500/60 transition-colors">
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
