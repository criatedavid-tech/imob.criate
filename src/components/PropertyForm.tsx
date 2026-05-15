import React, { useState, useRef } from 'react';
import { X, Upload, Home, MapPin, DollarSign, Camera, Check, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { authService } from '../services/auth';

import MagicWandTextarea from './MagicWandTextarea';

interface PropertyData {
  id?: string;
  title: string;
  price: string;
  location: string;
  description: string;
  images?: string[];
  imageUrl?: string; // Para compatibilidade
  quartos?: number;
  sala?: number;
  cozinha?: number;
  piscina?: string;
  banheiros?: number;
  area?: number;
  varanda_gourmet?: string;
}

export default function PropertyForm({ 
  onClose, 
  onSuccess,
  initialData 
}: { 
  onClose: () => void; 
  onSuccess?: () => void;
  initialData?: PropertyData 
}) {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<PropertyData>(initialData || {
    title: '',
    price: '',
    location: '',
    description: '',
    images: [],
    imageUrl: '',
    quartos: 0,
    sala: 0,
    cozinha: 0,
    piscina: 'Não',
    banheiros: 0,
    area: 0,
    varanda_gourmet: 'Não',
  });
  const [successData, setSuccessData] = useState<{isEdit: boolean, url: string} | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialData) {
      let baseData = { ...initialData };
      
      // Deserialize extra data from description if present
      if (initialData.description && initialData.description.includes('---DETALHES-GERADOS---')) {
        const parts = initialData.description.split('---DETALHES-GERADOS---');
        baseData.description = parts[0].trim();
        try {
          const extraData = JSON.parse(parts[1].trim());
          baseData = { ...baseData, ...extraData };
        } catch (e) {
          console.error("Erro ao parsear detalhes extras:", e);
        }
      }

      if (typeof initialData.imageUrl === 'string' && !initialData.images) {
        try {
          const parsed = JSON.parse(initialData.imageUrl);
          if (Array.isArray(parsed)) {
            baseData.images = parsed;
          } else {
            baseData.images = [initialData.imageUrl as string];
          }
        } catch {
          if (initialData.imageUrl) {
            baseData.images = [initialData.imageUrl as string];
          }
        }
      }
      
      setFormData(prev => ({...prev, ...baseData}));
    }
  }, [initialData]);

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;

    const currentImages = formData.images || [];
    
    // Limite de 15 fotos
    if (currentImages.length + files.length > 15) {
      setErrorMsg("Você pode enviar no máximo 15 fotos.");
      return;
    }

    const compressImage = (file: File): Promise<string> => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const MAX_HEIGHT = 800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_WIDTH) {
                height = Math.round((height *= MAX_WIDTH / width));
                width = MAX_WIDTH;
              }
            } else {
              if (height > MAX_HEIGHT) {
                width = Math.round((width *= MAX_HEIGHT / height));
                height = MAX_HEIGHT;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      });
    };

    files.forEach(async (file) => {
      const compressed = await compressImage(file);
      setFormData(prev => ({
        ...prev, 
        images: [...(prev.images || []), compressed]
      }));
    });
  };

  const removeImage = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFormData(prev => ({
      ...prev,
      images: (prev.images || []).filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds timeout

    try {
      setErrorMsg(null);
      
      // Serialize extra fields into description to avoid schema changes
      const extraData = {
        quartos: formData.quartos,
        sala: formData.sala,
        cozinha: formData.cozinha,
        piscina: formData.piscina,
        banheiros: formData.banheiros,
        area: formData.area,
        varanda_gourmet: formData.varanda_gourmet
      };
      
      const cleanDescription = formData.description.split('---DETALHES-GERADOS---')[0].trim();
      
      // Prepare final submission payload
      // We strip out the extra fields that don't exist as columns in the DB
      // to avoid "column does not exist" errors.
      const { 
        quartos, sala, cozinha, piscina, banheiros, area, varanda_gourmet,
        images, imageUrl, ...basePayload 
      } = formData;

      const submissionData = {
        ...basePayload,
        description: `${cleanDescription}\n\n---DETALHES-GERADOS---\n${JSON.stringify(extraData)}`,
        imageUrl: formData.images && formData.images.length > 0 ? JSON.stringify(formData.images) : formData.imageUrl
      };

      const response = await fetch('/api/properties', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authService.getAuthHeaders()
        },
        body: JSON.stringify(submissionData),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Erro no servidor');
      }

      const result = await response.json();
      
      if (onSuccess) {
        onSuccess();
      }
      
      const landingPageUrl = `${window.location.origin}/p/${result.slug}`;
      setSuccessData({ isEdit: !!initialData, url: landingPageUrl });
    } catch (error: any) {
      console.error("Erro ao salvar imóvel:", error);
      if (error.name === 'AbortError') {
        setErrorMsg("A requisição demorou demais e foi cancelada. O banco de dados pode estar lento ou mal configurado.");
      } else {
        setErrorMsg(`Erro: ${error.message || "Não foi possível conectar com o servidor"}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
      {/* Backdrop clicável para fechar */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-2xl my-auto rounded-[32px] overflow-hidden
          backdrop-blur-2xl bg-white/12 border border-white/20
          shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]"
      >
        {/* Header sticky — sempre visível */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-8 py-5
          backdrop-blur-xl bg-white/8 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center
              backdrop-blur-md bg-white/15 border border-white/20">
              <Home className="text-white w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">
                {initialData ? 'Editar Imóvel' : 'Novo Imóvel'}
              </h2>
              <p className="text-white/50 text-xs">Preencha os dados e gere a landing page automaticamente.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center
              text-white/50 hover:text-white hover:bg-white/15 transition-all"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-8 md:p-10">
          {successData ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-10 text-center space-y-6"
            >
              <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4
                backdrop-blur-md bg-emerald-500/20 border border-emerald-400/30">
                <Check className="text-emerald-300 w-10 h-10" />
              </div>
              <h2 className="text-3xl font-bold text-white">Sucesso!</h2>
              <p className="text-white/60 text-lg max-w-md">
                Imóvel {successData.isEdit ? 'atualizado' : 'cadastrado'} com sucesso. Sua landing page já está no ar!
              </p>

              <div className="w-full p-4 rounded-2xl flex items-center justify-between mt-4
                backdrop-blur-md bg-white/10 border border-white/15">
                <span className="text-sm text-white/70 truncate mr-4">{successData.url}</span>
                <a
                  href={successData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap text-white transition-all
                    backdrop-blur-md bg-white/15 border border-white/25 hover:bg-white/25"
                >
                  Abrir
                </a>
              </div>

              <div className="w-full pt-4">
                <button
                  onClick={onClose}
                  className="w-full py-4 rounded-2xl font-bold text-lg text-white transition-all
                    backdrop-blur-md bg-white/10 border border-white/15 hover:bg-white/20"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          ) : (
            <>

              <form onSubmit={handleSubmit} className="space-y-6">
                {errorMsg && (
                  <div className="bg-red-500/20 border border-red-400/30 text-red-300 p-4 rounded-xl text-sm font-medium">
                    {errorMsg}
                  </div>
                )}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/50">Título do Anúncio</label>
                  <input 
                    type="text" 
                    value={formData.title || ''}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    placeholder="Ex: Casa de Luxo no Jardins" 
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/50">Preço (R$)</label>
                  <input 
                    type="text" 
                    value={formData.price || ''}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="Ex: 4.500.000" 
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25"
                    required
                  />
                </div>
             </div>

             <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-white/50">Localização</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  placeholder="Cidade, UF ou Endereço"
                  className="w-full pl-12 pr-5 py-3 rounded-2xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Quartos</label>
                <input
                  type="number"
                  value={formData.quartos || ''}
                  onChange={(e) => setFormData({...formData, quartos: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Banheiros</label>
                <input
                  type="number"
                  value={formData.banheiros || ''}
                  onChange={(e) => setFormData({...formData, banheiros: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Área (m²)</label>
                <input
                  type="number"
                  value={formData.area || ''}
                  onChange={(e) => setFormData({...formData, area: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Salas</label>
                <input
                  type="number"
                  value={formData.sala || ''}
                  onChange={(e) => setFormData({...formData, sala: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Cozinhas</label>
                <input
                  type="number"
                  value={formData.cozinha || ''}
                  onChange={(e) => setFormData({...formData, cozinha: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Piscina</label>
                <select
                  value={formData.piscina}
                  onChange={(e) => setFormData({...formData, piscina: e.target.value})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                  <option value="Privativa">Privativa</option>
                  <option value="Compartilhada">Compartilhada</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-white/50">Varanda Gourmet</label>
                <select
                  value={formData.varanda_gourmet}
                  onChange={(e) => setFormData({...formData, varanda_gourmet: e.target.value})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-slate-800/90 border border-white/15 text-white focus:ring-2 focus:ring-white/25 [color-scheme:dark]"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 relative">
              <label className="text-xs font-bold uppercase tracking-wider text-white/50 flex justify-between items-center">
                <span>Descrição Detalhada</span>
              </label>
              <MagicWandTextarea 
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                onApply={(text) => setFormData({...formData, description: text})}
                placeholder="Descreva os pontos fortes, acabamentos e diferenciais do imóvel..." 
                className="w-full px-5 py-4 rounded-3xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 min-h-[120px] resize-none"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-white/50">Fotos (Máx 15)</label>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*"
                multiple
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(formData.images || []).map((img, idx) => (
                  <div key={idx} className="relative group rounded-xl overflow-hidden aspect-square border border-white/20">
                    <img src={img} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                    <button 
                      type="button"
                      onClick={(e) => removeImage(idx, e)}
                      className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                
                {(!formData.images || formData.images.length < 15) && (
                  <div
                    onClick={handleImageClick}
                    className="border-2 border-dashed border-white/20 rounded-xl flex flex-col items-center justify-center gap-2 text-white/40 hover:border-white/50 hover:text-white/70 transition-all cursor-pointer aspect-square bg-white/5"
                  >
                    <Camera size={24} />
                    <span className="font-semibold text-[10px] uppercase tracking-wider">Adicionar</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-white/40 italic mt-1">{(formData.images?.length || 0)} / 15 fotos adicionadas.</p>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 rounded-2xl font-bold text-lg text-white transition-all flex items-center justify-center gap-2
                  backdrop-blur-md bg-white/15 border border-white/25
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.25)]
                  hover:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {loading ? <Loader2 className="animate-spin" /> : (initialData ? 'Salvar Edição' : 'Cadastrar Imóvel')}
                {!loading && <Check size={20} />}
              </button>
            </div>
          </form>
          </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
