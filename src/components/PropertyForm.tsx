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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-2xl rounded-[40px] overflow-hidden shadow-2xl relative my-8"
      >
        <button 
          onClick={onClose}
          className="absolute top-8 right-8 text-[#9CA3AF] hover:text-black transition-colors z-10"
        >
          <X size={24} />
        </button>

        <div className="p-8 md:p-12">
          {successData ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-10 text-center space-y-6"
            >
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <Check className="text-green-600 w-10 h-10" />
              </div>
              <h2 className="text-3xl font-bold text-[#1A1A1A]">
                Sucesso!
              </h2>
              <p className="text-[#6B7280] text-lg max-w-md">
                Imóvel {successData.isEdit ? 'atualizado' : 'cadastrado'} com sucesso. Sua landing page já está no ar!
              </p>
              
              <div className="bg-[#F3F4F6] w-full p-4 rounded-2xl flex items-center justify-between mt-4">
                <span className="text-sm text-[#4B5563] truncate mr-4">{successData.url}</span>
                <a 
                  href={successData.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="bg-black text-white px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap hover:bg-[#333] transition-colors"
                >
                  Abrir
                </a>
              </div>

              <div className="w-full pt-8">
                <button 
                  onClick={onClose}
                  className="w-full bg-[#E5E7EB] text-black py-4 rounded-2xl font-bold text-lg hover:bg-[#D1D5DB] transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-12 h-12 bg-[#F8F9FA] rounded-2xl flex items-center justify-center">
                  <Home className="text-black" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{initialData ? 'Editar Imóvel' : 'Novo Imóvel'}</h2>
                  <p className="text-[#6B7280] text-sm">Preencha os dados e gere a landing page automaticamente.</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {errorMsg && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium">
                    {errorMsg}
                  </div>
                )}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Título do Anúncio</label>
                  <input 
                    type="text" 
                    value={formData.title || ''}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    placeholder="Ex: Casa de Luxo no Jardins" 
                    className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Preço (R$)</label>
                  <input 
                    type="text" 
                    value={formData.price || ''}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="Ex: 4.500.000" 
                    className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                    required
                  />
                </div>
             </div>

             <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Localização</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
                <input 
                  type="text" 
                  value={formData.location || ''}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  placeholder="Cidade, UF ou Endereço" 
                  className="w-full pl-12 pr-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Quartos</label>
                <input 
                  type="number" 
                  value={formData.quartos || ''}
                  onChange={(e) => setFormData({...formData, quartos: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Banheiros</label>
                <input 
                  type="number" 
                  value={formData.banheiros || ''}
                  onChange={(e) => setFormData({...formData, banheiros: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Área (m²)</label>
                <input 
                  type="number" 
                  value={formData.area || ''}
                  onChange={(e) => setFormData({...formData, area: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Salas</label>
                <input 
                  type="number" 
                  value={formData.sala || ''}
                  onChange={(e) => setFormData({...formData, sala: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Cozinhas</label>
                <input 
                  type="number" 
                  value={formData.cozinha || ''}
                  onChange={(e) => setFormData({...formData, cozinha: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Piscina</label>
                <select 
                  value={formData.piscina}
                  onChange={(e) => setFormData({...formData, piscina: e.target.value})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                  <option value="Privativa">Privativa</option>
                  <option value="Compartilhada">Compartilhada</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Varanda Gourmet</label>
                <select 
                  value={formData.varanda_gourmet}
                  onChange={(e) => setFormData({...formData, varanda_gourmet: e.target.value})}
                  className="w-full px-5 py-3 bg-[#F3F4F6] border-none rounded-2xl focus:ring-2 focus:ring-black outline-none"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 relative">
              <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF] flex justify-between items-center">
                <span>Descrição Detalhada</span>
              </label>
              <MagicWandTextarea 
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                onApply={(text) => setFormData({...formData, description: text})}
                placeholder="Descreva os pontos fortes, acabamentos e diferenciais do imóvel..." 
                className="w-full px-5 py-4 bg-[#F3F4F6] border-none rounded-3xl focus:ring-2 focus:ring-black outline-none min-h-[120px] resize-none"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#9CA3AF]">Fotos (Máx 15)</label>
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
                  <div key={idx} className="relative group rounded-xl overflow-hidden aspect-square border border-[#E5E7EB]">
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
                    className="border-2 border-dashed border-[#E5E7EB] rounded-xl flex flex-col items-center justify-center gap-2 text-[#9CA3AF] hover:border-black hover:text-black transition-all cursor-pointer aspect-square bg-[#F9FAFB]"
                  >
                    <Camera size={24} />
                    <span className="font-semibold text-[10px] uppercase tracking-wider">Adicionar</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-[#9CA3AF] italic mt-1">{(formData.images?.length || 0)} / 15 fotos adicionadas.</p>
            </div>

            <div className="pt-4">
              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-black text-white py-4 rounded-2xl font-bold text-lg hover:bg-[#333] disabled:bg-gray-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
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
