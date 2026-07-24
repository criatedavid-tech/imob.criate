import React, { useState, useRef } from 'react';
import { X, Upload, Home, MapPin, DollarSign, Camera, Check, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { authService } from '../services/auth';
import { maskFromCents, centsFromMaskInput, parseLegacyPriceToCents } from '../lib/money';

import MagicWandTextarea from './MagicWandTextarea';

interface PropertyData {
  id?: string;
  title: string;
  price: string;
  location: string;
  description: string;
  images?: string[];
  imageUrl?: string; // Para compatibilidade
  tipo_imovel?: 'residencial' | 'comercial';
  finalidade?: 'venda' | 'aluguel' | 'ambos';
  quartos?: number;
  sala?: number;
  cozinha?: number;
  piscina?: string;
  banheiros?: number;
  area?: number;
  varanda_gourmet?: string;
  vagas_garagem?: number;
  tipo_comercial?: string;
}

const TIPO_COMERCIAL_OPTIONS = ['Sala comercial', 'Galpão', 'Loja', 'Terreno'];

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
  const [priceCents, setPriceCents] = useState(() => parseLegacyPriceToCents(initialData?.price || ''));
  const [formData, setFormData] = useState<PropertyData>(initialData || {
    title: '',
    price: '',
    location: '',
    description: '',
    images: [],
    imageUrl: '',
    tipo_imovel: 'residencial',
    finalidade: 'venda',
    quartos: 0,
    sala: 0,
    cozinha: 0,
    piscina: 'Não',
    banheiros: 0,
    area: 0,
    varanda_gourmet: 'Não',
    vagas_garagem: 0,
    tipo_comercial: 'Sala comercial',
  });
  const [successData, setSuccessData] = useState<{isEdit: boolean, url: string} | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  React.useEffect(() => {
    if (initialData) {
      let baseData = { ...initialData };
      setPriceCents(parseLegacyPriceToCents(initialData.price || ''));

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

    // Sobe cada foto direto pro Supabase Storage e guarda APENAS a URL
    // pública no estado — nunca o base64. Isso mantém o payload do
    // POST /api/properties minúsculo e elimina o pico de memória/OOM.
    files.forEach(async (file) => {
      setUploadingCount(c => c + 1);
      try {
        const compressed = await compressImage(file);
        const res = await fetch('/api/properties/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({ imageData: compressed })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Falha ao enviar a imagem.');
        }
        const { url } = await res.json();
        setFormData(prev => ({
          ...prev,
          images: [...(prev.images || []), url]
        }));
      } catch (err: any) {
        setErrorMsg(err.message || 'Não foi possível enviar uma das imagens.');
      } finally {
        setUploadingCount(c => Math.max(0, c - 1));
      }
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

    if (priceCents <= 0) {
      setErrorMsg('Informe um preço válido.');
      return;
    }

    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds timeout

    try {
      setErrorMsg(null);
      
      // Serialize extra fields into description to avoid schema changes
      const extraData = {
        tipo_imovel: formData.tipo_imovel,
        finalidade: formData.finalidade,
        quartos: formData.quartos,
        sala: formData.sala,
        cozinha: formData.cozinha,
        piscina: formData.piscina,
        banheiros: formData.banheiros,
        area: formData.area,
        varanda_gourmet: formData.varanda_gourmet,
        vagas_garagem: formData.vagas_garagem,
        tipo_comercial: formData.tipo_comercial,
      };
      
      const cleanDescription = formData.description.split('---DETALHES-GERADOS---')[0].trim();
      
      // Prepare final submission payload
      // We strip out the extra fields that don't exist as columns in the DB
      // to avoid "column does not exist" errors.
      const {
        tipo_imovel, finalidade, quartos, sala, cozinha, piscina, banheiros, area, varanda_gourmet,
        vagas_garagem, tipo_comercial, images, imageUrl, ...basePayload
      } = formData;

      const submissionData = {
        ...basePayload,
        price: `R$ ${maskFromCents(priceCents)}`,
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
          backdrop-blur-2xl bg-[var(--bg-elevated)] border border-[var(--glass-border-strong)]
          shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]"
      >
        {/* Header sticky — sempre visível */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-8 py-5
          backdrop-blur-xl bg-[var(--control-fill)] border-b border-[var(--hairline-strong)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center
              backdrop-blur-md bg-[var(--control-fill-hover)] border border-[var(--glass-border-strong)]">
              <Home className="text-[var(--text-hi)] w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--text-hi)] leading-tight">
                {initialData ? 'Editar Imóvel' : 'Novo Imóvel'}
              </h2>
              <p className="text-[var(--text-low)] text-xs">Preencha os dados e gere a landing page automaticamente.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center
              text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-all"
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
              <h2 className="text-3xl font-bold text-[var(--text-hi)]">Sucesso!</h2>
              <p className="text-[var(--text-mid)] text-lg max-w-md">
                Imóvel {successData.isEdit ? 'atualizado' : 'cadastrado'} com sucesso. Sua landing page já está no ar!
              </p>

              <div className="w-full p-4 rounded-2xl flex items-center justify-between mt-4
                backdrop-blur-md bg-[var(--control-fill)] border border-[var(--glass-border)]">
                <span className="text-sm text-[var(--text-mid)] truncate mr-4">{successData.url}</span>
                <a
                  href={successData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap text-[var(--text-hi)] transition-all
                    backdrop-blur-md bg-[var(--control-fill-hover)] border border-[var(--glass-border-strong)] hover:bg-[var(--control-fill-hover)]"
                >
                  Abrir
                </a>
              </div>

              <div className="w-full pt-4">
                <button
                  onClick={onClose}
                  className="w-full py-4 rounded-2xl font-bold text-lg text-[var(--text-hi)] transition-all
                    backdrop-blur-md bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)]"
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
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Título do Anúncio</label>
                  <input 
                    type="text" 
                    value={formData.title || ''}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    placeholder="Ex: Casa de Luxo no Jardins" 
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)]"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Preço (R$)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={maskFromCents(priceCents)}
                    onChange={(e) => setPriceCents(centsFromMaskInput(e.target.value))}
                    placeholder="0,00"
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)]"
                    required
                  />
                </div>
             </div>

             <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Localização</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-low)]" size={18} />
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  placeholder="Cidade, UF ou Endereço"
                  className="w-full pl-12 pr-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)]"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Tipo de imóvel</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setFormData({...formData, tipo_imovel: 'residencial'})}
                  className={`flex-1 py-2.5 rounded-2xl text-[13px] font-semibold transition-colors border ${
                    (formData.tipo_imovel || 'residencial') === 'residencial'
                      ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] border-[var(--glass-border-strong)]' : 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline-strong)] hover:text-[var(--text-mid)]'
                  }`}>Residencial (casa/apê)</button>
                <button type="button" onClick={() => setFormData({...formData, tipo_imovel: 'comercial'})}
                  className={`flex-1 py-2.5 rounded-2xl text-[13px] font-semibold transition-colors border ${
                    formData.tipo_imovel === 'comercial'
                      ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] border-[var(--glass-border-strong)]' : 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline-strong)] hover:text-[var(--text-mid)]'
                  }`}>Comercial (sala/galpão/loja)</button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Finalidade</label>
              <div className="flex gap-2">
                {([
                  ['venda', 'Venda'],
                  ['aluguel', 'Aluguel'],
                  ['ambos', 'Venda e aluguel'],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setFormData({...formData, finalidade: value})}
                    className={`flex-1 py-2.5 rounded-2xl text-[13px] font-semibold transition-colors border ${
                      (formData.finalidade || 'venda') === value
                        ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)] border-[var(--glass-border-strong)]' : 'bg-[var(--control-fill)] text-[var(--text-low)] border-[var(--hairline-strong)] hover:text-[var(--text-mid)]'
                    }`}>{label}</button>
                ))}
              </div>
            </div>

            {formData.tipo_imovel === 'comercial' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Tipo de espaço</label>
                  <select
                    value={formData.tipo_comercial}
                    onChange={(e) => setFormData({...formData, tipo_comercial: e.target.value})}
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                  >
                    {TIPO_COMERCIAL_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Área (m²)</label>
                  <input
                    type="number"
                    value={formData.area || ''}
                    onChange={(e) => setFormData({...formData, area: parseInt(e.target.value) || 0})}
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Banheiros</label>
                  <input
                    type="number"
                    value={formData.banheiros || ''}
                    onChange={(e) => setFormData({...formData, banheiros: parseInt(e.target.value) || 0})}
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Vagas de garagem</label>
                  <input
                    type="number"
                    value={formData.vagas_garagem || ''}
                    onChange={(e) => setFormData({...formData, vagas_garagem: parseInt(e.target.value) || 0})}
                    className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                  />
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Quartos</label>
                <input
                  type="number"
                  value={formData.quartos || ''}
                  onChange={(e) => setFormData({...formData, quartos: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Banheiros</label>
                <input
                  type="number"
                  value={formData.banheiros || ''}
                  onChange={(e) => setFormData({...formData, banheiros: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Área (m²)</label>
                <input
                  type="number"
                  value={formData.area || ''}
                  onChange={(e) => setFormData({...formData, area: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Salas</label>
                <input
                  type="number"
                  value={formData.sala || ''}
                  onChange={(e) => setFormData({...formData, sala: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Cozinhas</label>
                <input
                  type="number"
                  value={formData.cozinha || ''}
                  onChange={(e) => setFormData({...formData, cozinha: parseInt(e.target.value) || 0})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Piscina</label>
                <select
                  value={formData.piscina}
                  onChange={(e) => setFormData({...formData, piscina: e.target.value})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                  <option value="Privativa">Privativa</option>
                  <option value="Compartilhada">Compartilhada</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Varanda Gourmet</label>
                <select
                  value={formData.varanda_gourmet}
                  onChange={(e) => setFormData({...formData, varanda_gourmet: e.target.value})}
                  className="w-full px-5 py-3 rounded-2xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] focus:ring-2 focus:ring-[var(--glass-border-strong)] [color-scheme:dark]"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
            </div>
            )}

            <div className="space-y-2 relative">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)] flex justify-between items-center">
                <span>Descrição Detalhada</span>
              </label>
              <MagicWandTextarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                onApply={(text) => setFormData({...formData, description: text})}
                placeholder="Descreva os pontos fortes, acabamentos e diferenciais do imóvel..." 
                className="w-full px-5 py-4 rounded-3xl outline-none transition-all bg-[var(--control-fill)] border border-[var(--glass-border)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] focus:ring-2 focus:ring-[var(--glass-border-strong)] min-h-[120px] resize-none"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-low)]">Fotos (Máx 15)</label>
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
                  <div key={idx} className="relative group rounded-xl overflow-hidden aspect-square border border-[var(--glass-border-strong)]">
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
                
                {Array.from({ length: uploadingCount }).map((_, i) => (
                  <div key={`up-${i}`} className="rounded-xl flex flex-col items-center justify-center gap-2 text-[var(--text-low)] aspect-square bg-[var(--control-fill)] border border-[var(--glass-border)]">
                    <Loader2 size={22} className="animate-spin" />
                    <span className="font-semibold text-[10px] uppercase tracking-wider">Enviando…</span>
                  </div>
                ))}

                {(!formData.images || formData.images.length < 15) && (
                  <div
                    onClick={handleImageClick}
                    className="border-2 border-dashed border-[var(--glass-border-strong)] rounded-xl flex flex-col items-center justify-center gap-2 text-[var(--text-low)] hover:border-[var(--hairline)]0 hover:text-[var(--text-mid)] transition-all cursor-pointer aspect-square bg-[var(--control-fill)]"
                  >
                    <Camera size={24} />
                    <span className="font-semibold text-[10px] uppercase tracking-wider">Adicionar</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-low)] italic mt-1">{(formData.images?.length || 0)} / 15 fotos adicionadas.</p>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading || uploadingCount > 0}
                className="w-full py-4 rounded-2xl font-bold text-lg text-[var(--text-hi)] transition-all flex items-center justify-center gap-2
                  backdrop-blur-md bg-[var(--control-fill-hover)] border border-[var(--glass-border-strong)]
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.25)]
                  hover:bg-[var(--control-fill-hover)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
              >
                {uploadingCount > 0
                  ? <><Loader2 className="animate-spin" /> Enviando fotos…</>
                  : loading
                    ? <Loader2 className="animate-spin" />
                    : <>{initialData ? 'Salvar Edição' : 'Cadastrar Imóvel'} <Check size={20} /></>}
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
