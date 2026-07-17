import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, X, Building2, User, Phone, Clock, Pencil, Trash2, Camera, Calculator, Copy, QrCode, Check, FileText, Upload, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';
import { centsFromMaskInput, maskFromCents, centsToReais, formatCentsBR } from '../lib/money';
import { simulateFinancing } from '../lib/financing';
import { maskCpfCnpj } from '../lib/document';
import { CLIENT_FINANCIAL_OPERATIONS_ENABLED } from '../lib/features';

interface Development {
  id: string;
  name: string;
  location?: string;
  tipo: 'vertical' | 'horizontal';
  subtipo?: 'loteamento' | 'condominio_casas' | null;
  amenities: string[];
  images?: string[];
  total_units: number;
  disponivel: number;
  reservado: number;
  vendido: number;
}

// Mesma compressão client-side já usada em PropertyForm.tsx — evita subir
// fotos gigantes de celular e mantém o payload pequeno.
function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let { width, height } = img;
        if (width > height) {
          if (width > MAX) { height = Math.round(height * (MAX / width)); width = MAX; }
        } else {
          if (height > MAX) { width = Math.round(width * (MAX / height)); height = MAX; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface Unit {
  id: string;
  code: string;
  price_cents?: number;
  status: 'disponivel' | 'reservado' | 'vendido';
  reserved_until?: string;
  buyer_name?: string;
  buyer_phone?: string;
  quartos?: number;
  vagas_garagem?: number;
  area_m2?: number;
  orientacao?: 'nascente' | 'poente';
  andar?: number;
  area_lote_m2?: number;
  testada_m?: number;
}

interface UnitReservationPayment {
  id: string;
  unit_id: string;
  request_key: string;
  buyer_name: string;
  buyer_phone: string | null;
  buyer_document_last4: string;
  signal_amount_cents: number;
  status: 'creating' | 'pending' | 'paid' | 'overdue' | 'payment_failed';
  reserved_until: string | null;
  due_date: string | null;
  pix_qr_code: string | null;
  pix_copy_paste: string | null;
  payment_id: string | null;
}

interface ReservationDocument {
  id: string;
  label: string;
  status: 'pendente' | 'enviado' | 'aprovado' | 'rejeitado';
  rejection_reason: string | null;
  requested_at: string;
  uploaded_at: string | null;
  reviewed_at: string | null;
  file_mime_type: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null;
  file_size_bytes: number | null;
}

const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Arquivo invalido.'));
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

const AMENITY_OPTIONS = [
  'Piscina', 'Piscina rooftop', 'Área de lazer', 'Churrasqueira', 'Salão de festas',
  'Academia', 'Playground', 'Portaria 24h', 'Elevador', 'Espaço gourmet',
  'Coworking', 'Quadra poliesportiva', 'Pet place',
];

const ORIENTACAO_LABEL: Record<string, string> = {
  nascente: 'Nascente (sol da manhã)',
  poente: 'Poente (sol da tarde)',
};

function unitDetails(u: Unit): string {
  const parts: string[] = [];
  if (u.quartos) parts.push(`${u.quartos} quarto${u.quartos > 1 ? 's' : ''}`);
  if (u.vagas_garagem) parts.push(`${u.vagas_garagem} vaga${u.vagas_garagem > 1 ? 's' : ''}`);
  if (u.area_m2) parts.push(`${u.area_m2}m²`);
  if (u.area_lote_m2) parts.push(`lote de ${u.area_lote_m2}m²`);
  if (u.testada_m) parts.push(`testada ${u.testada_m}m`);
  if (u.orientacao) parts.push(ORIENTACAO_LABEL[u.orientacao] || u.orientacao);
  if (u.andar != null) parts.push(`${u.andar}º andar`);
  return parts.join(' · ');
}

// Mesma paleta do widget mock "espelho de vendas" do cockpit (engine.ts/
// widgets.tsx) — consistência visual entre a prévia e o dado real.
const mirrorColor: Record<string, string> = {
  disponivel: 'bg-emerald-400/25 border-emerald-300/30 text-emerald-100',
  reservado: 'bg-amber-400/25 border-amber-300/30 text-amber-100',
  vendido: 'bg-white/[0.04] border-white/10 text-white/30',
};

function hoursLeft(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expirando...';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

function NewDevelopmentModal({ initial, onClose, onCreated }: { initial?: Development | null; onClose: () => void; onCreated: () => void }) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [tipo, setTipo] = useState<'vertical' | 'horizontal'>(initial?.tipo || 'vertical');
  const [subtipo, setSubtipo] = useState<'loteamento' | 'condominio_casas'>(initial?.subtipo === 'condominio_casas' ? 'condominio_casas' : 'loteamento');
  const initialKnown = (initial?.amenities || []).filter(a => AMENITY_OPTIONS.includes(a));
  const initialOther = (initial?.amenities || []).filter(a => !AMENITY_OPTIONS.includes(a));
  const [amenities, setAmenities] = useState<Set<string>>(new Set(initialKnown));
  const [otherAmenity, setOtherAmenity] = useState(initialOther.join(', '));
  const [images, setImages] = useState<string[]>(initial?.images || []);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleAmenity(a: string) {
    setAmenities(prev => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a); else next.add(a);
      return next;
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;
    if (images.length + files.length > 15) { setError('Você pode enviar no máximo 15 fotos.'); return; }
    files.forEach(async (file) => {
      setUploadingCount((c) => c + 1);
      try {
        const compressed = await compressImage(file);
        const res = await fetch('/api/properties/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({ imageData: compressed }),
        });
        if (!res.ok) throw new Error('Falha ao enviar a imagem.');
        const { url } = await res.json();
        setImages((prev) => [...prev, url]);
      } catch (err: any) {
        setError(err.message || 'Não foi possível enviar uma das fotos.');
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    });
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!name.trim()) { setError('Nome do empreendimento é obrigatório.'); return; }
    setSaving(true);
    setError('');
    try {
      const finalAmenities = [...amenities, ...(otherAmenity.trim() ? otherAmenity.split(',').map(s => s.trim()).filter(Boolean) : [])];
      const res = await fetch(isEdit ? `/api/lancamentos/developments/${initial!.id}` : '/api/lancamentos/developments', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ name, location: location || null, tipo, subtipo: tipo === 'horizontal' ? subtipo : undefined, amenities: finalAmenities, images }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Falha ao ${isEdit ? 'salvar' : 'criar'} empreendimento.`);
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || `Falha ao ${isEdit ? 'salvar' : 'criar'} empreendimento.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 shrink-0">
          <h3 className="text-lg font-bold text-white">{isEdit ? 'Editar empreendimento' : 'Novo empreendimento'}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">{error}</div>}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Residencial Jardins"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Localização (opcional)</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bairro, cidade"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Fotos/renders (opcional)</label>
            <div className="grid grid-cols-4 gap-2">
              {images.map((url, idx) => (
                <div key={url} className="relative aspect-square rounded-xl overflow-hidden border border-white/12 group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeImage(idx)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={12} />
                  </button>
                </div>
              ))}
              {images.length + uploadingCount < 15 && (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-xl border border-dashed border-white/20 flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/40 transition-colors">
                  {uploadingCount > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Tipo</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setTipo('vertical')}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
                  tipo === 'vertical' ? 'bg-white/[0.16] text-white border border-white/25' : 'bg-white/[0.04] text-white/45 border border-white/10 hover:text-white/70'
                }`}>Prédio (vertical)</button>
              <button type="button" onClick={() => setTipo('horizontal')}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
                  tipo === 'horizontal' ? 'bg-white/[0.16] text-white border border-white/25' : 'bg-white/[0.04] text-white/45 border border-white/10 hover:text-white/70'
                }`}>Horizontal (lote/casas)</button>
            </div>
          </div>
          {tipo === 'horizontal' && (
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Qual tipo de horizontal?</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSubtipo('loteamento')}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
                    subtipo === 'loteamento' ? 'bg-white/[0.16] text-white border border-white/25' : 'bg-white/[0.04] text-white/45 border border-white/10 hover:text-white/70'
                  }`}>Loteamento (lote vazio)</button>
                <button type="button" onClick={() => setSubtipo('condominio_casas')}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors ${
                    subtipo === 'condominio_casas' ? 'bg-white/[0.16] text-white border border-white/25' : 'bg-white/[0.04] text-white/45 border border-white/10 hover:text-white/70'
                  }`}>Condomínio de casas prontas</button>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Benefícios (opcional)</label>
            <div className="grid grid-cols-2 gap-2">
              {AMENITY_OPTIONS.map((a) => (
                <button key={a} type="button" onClick={() => toggleAmenity(a)}
                  className={`px-3 py-2 rounded-xl text-[12px] font-semibold text-left transition-colors border ${
                    amenities.has(a) ? 'bg-violet-500/20 border-violet-300/30 text-violet-100' : 'bg-white/[0.04] border-white/10 text-white/50 hover:text-white/75'
                  }`}>{a}</button>
              ))}
            </div>
            <input value={otherAmenity} onChange={(e) => setOtherAmenity(e.target.value)} placeholder="Outro benefício (opcional)"
              className="w-full mt-2 rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} {isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewUnitModal({ developmentId, developmentTipo, developmentSubtipo, onClose, onCreated }: {
  developmentId: string;
  developmentTipo: 'vertical' | 'horizontal';
  developmentSubtipo?: 'loteamento' | 'condominio_casas' | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [priceCents, setPriceCents] = useState(0);
  const [quartos, setQuartos] = useState('');
  const [vagas, setVagas] = useState('');
  const [areaM2, setAreaM2] = useState('');
  const [areaLoteM2, setAreaLoteM2] = useState('');
  const [testadaM, setTestadaM] = useState('');
  const [orientacao, setOrientacao] = useState<'' | 'nascente' | 'poente'>('');
  const [andar, setAndar] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Loteamento (lote vazio) usa área do lote + testada; prédio e condomínio
  // de casas prontas usam quartos/vagas/área construída — só o prédio tem andar.
  const isLoteamento = developmentTipo === 'horizontal' && developmentSubtipo !== 'condominio_casas';
  const isVertical = developmentTipo === 'vertical';

  async function handleSave() {
    if (!code.trim()) { setError('Código da unidade é obrigatório.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/developments/${developmentId}/units`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          code,
          price_cents: priceCents || undefined,
          quartos: !isLoteamento && quartos ? Number(quartos) : undefined,
          vagas_garagem: !isLoteamento && vagas ? Number(vagas) : undefined,
          area_m2: !isLoteamento && areaM2 ? Number(areaM2.replace(',', '.')) : undefined,
          andar: isVertical && andar ? Number(andar) : undefined,
          area_lote_m2: isLoteamento && areaLoteM2 ? Number(areaLoteM2.replace(',', '.')) : undefined,
          testada_m: isLoteamento && testadaM ? Number(testadaM.replace(',', '.')) : undefined,
          orientacao: orientacao || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao criar unidade.');
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar unidade.');
    } finally {
      setSaving(false);
    }
  }

  const numInputClass = "w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25 focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 shrink-0">
          <h3 className="text-lg font-bold text-white">Nova unidade</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">{error}</div>}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Código</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 801 ou Cobertura 1201"
              className={numInputClass} />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Preço (opcional)</label>
            <div className="flex items-stretch gap-2">
              <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-white/50 bg-white/5 border border-white/12">R$</span>
              <input value={maskFromCents(priceCents)} onChange={(e) => setPriceCents(centsFromMaskInput(e.target.value))}
                placeholder="0,00" inputMode="numeric"
                className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
          </div>
          {!isLoteamento ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Quartos</label>
                <input value={quartos} onChange={(e) => setQuartos(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  inputMode="numeric" placeholder="0" className={numInputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Vagas garagem</label>
                <input value={vagas} onChange={(e) => setVagas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  inputMode="numeric" placeholder="0" className={numInputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Área construída (m²)</label>
                <input value={areaM2} onChange={(e) => setAreaM2(e.target.value.replace(/[^\d,]/g, ''))}
                  inputMode="decimal" placeholder="0" className={numInputClass} />
              </div>
              {isVertical && (
                <div>
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Andar</label>
                  <input value={andar} onChange={(e) => setAndar(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    inputMode="numeric" placeholder="0" className={numInputClass} />
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Área do lote (m²)</label>
                <input value={areaLoteM2} onChange={(e) => setAreaLoteM2(e.target.value.replace(/[^\d,]/g, ''))}
                  inputMode="decimal" placeholder="0" className={numInputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Testada (m)</label>
                <input value={testadaM} onChange={(e) => setTestadaM(e.target.value.replace(/[^\d,]/g, ''))}
                  inputMode="decimal" placeholder="0" className={numInputClass} />
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Orientação solar (opcional)</label>
            <div className="flex gap-2">
              {(['nascente', 'poente'] as const).map((o) => (
                <button key={o} type="button" onClick={() => setOrientacao(orientacao === o ? '' : o)}
                  className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors border ${
                    orientacao === o ? 'bg-white/[0.16] text-white border-white/25' : 'bg-white/[0.04] text-white/45 border-white/10 hover:text-white/70'
                  }`}>{ORIENTACAO_LABEL[o]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-white/10 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Criar
          </button>
        </div>
      </div>
    </div>
  );
}

function UnitActionModal({ unit, developmentTipo, developmentSubtipo, onClose, onChanged }: {
  unit: Unit;
  developmentTipo: 'vertical' | 'horizontal';
  developmentSubtipo?: 'loteamento' | 'condominio_casas' | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [buyerName, setBuyerName] = useState(unit.buyer_name || '');
  const [buyerPhone, setBuyerPhone] = useState(stripDDI(unit.buyer_phone || ''));
  const [holdHours, setHoldHours] = useState('1');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [buyerDocument, setBuyerDocument] = useState('');
  const [signalAmountCents, setSignalAmountCents] = useState(0);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [reservation, setReservation] = useState<UnitReservationPayment | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);
  const [financialAccess, setFinancialAccess] = useState(false);
  const [documents, setDocuments] = useState<ReservationDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentLabel, setDocumentLabel] = useState('');
  const [documentAction, setDocumentAction] = useState<string | null>(null);
  const [rejectingDocumentId, setRejectingDocumentId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const isLoteamento = developmentTipo === 'horizontal' && developmentSubtipo !== 'condominio_casas';
  const isVertical = developmentTipo === 'vertical';

  const [priceCents, setPriceCents] = useState(unit.price_cents || 0);
  const [quartos, setQuartos] = useState(unit.quartos != null ? String(unit.quartos) : '');
  const [vagas, setVagas] = useState(unit.vagas_garagem != null ? String(unit.vagas_garagem) : '');
  const [areaM2, setAreaM2] = useState(unit.area_m2 != null ? String(unit.area_m2) : '');
  const [andar, setAndar] = useState(unit.andar != null ? String(unit.andar) : '');
  const [areaLoteM2, setAreaLoteM2] = useState(unit.area_lote_m2 != null ? String(unit.area_lote_m2) : '');
  const [testadaM, setTestadaM] = useState(unit.testada_m != null ? String(unit.testada_m) : '');
  const [orientacao, setOrientacao] = useState<'' | 'nascente' | 'poente'>(unit.orientacao || '');
  const [entryMode, setEntryMode] = useState<'percent' | 'amount'>('percent');
  const [entryPercent, setEntryPercent] = useState('20');
  const [entryAmountCents, setEntryAmountCents] = useState(Math.round((unit.price_cents || 0) * 0.2));
  const [installmentCount, setInstallmentCount] = useState('36');

  const parsedPercent = entryPercent.trim() ? Number(entryPercent.replace(',', '.')) : Number.NaN;
  const parsedInstallments = Number(installmentCount);
  const simulation = simulateFinancing(
    unit.price_cents || 0,
    entryMode === 'percent'
      ? { mode: 'percent', percent: parsedPercent }
      : { mode: 'amount', amountCents: entryAmountCents },
    parsedInstallments,
  );

  useEffect(() => {
    let cancelled = false;
    async function loadReservation() {
      try {
        const res = await fetch(`/api/lancamentos/units/${unit.id}/reservation`, {
          headers: authService.getAuthHeaders(),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || 'Falha ao carregar a reserva financeira.');
        }
        const body = await res.json();
        if (!cancelled) setFinancialAccess(body?.financial_access === true);
        if (cancelled || !body?.reservation) return;
        const current = body.reservation as UnitReservationPayment;
        setReservation(current);
        setRequestKey(current.request_key);
        setBuyerName(current.buyer_name || '');
        setBuyerPhone(stripDDI(current.buyer_phone || ''));
        setSignalAmountCents(current.signal_amount_cents || 0);
        setDocumentsLoading(true);
        try {
          const documentsRes = await fetch(`/api/lancamentos/units/${unit.id}/documents`, {
            headers: authService.getAuthHeaders(),
          });
          const documentsBody = await documentsRes.json().catch(() => ({}));
          if (!documentsRes.ok) throw new Error(documentsBody?.error || 'Falha ao carregar documentos.');
          if (!cancelled) setDocuments(Array.isArray(documentsBody?.documents) ? documentsBody.documents : []);
        } finally {
          if (!cancelled) setDocumentsLoading(false);
        }
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || 'Falha ao carregar a reserva financeira.');
      }
    }
    loadReservation();
    return () => { cancelled = true; };
  }, [unit.id]);

  async function loadDocuments() {
    setDocumentsLoading(true);
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}/documents`, {
        headers: authService.getAuthHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao carregar documentos.');
      setDocuments(Array.isArray(body?.documents) ? body.documents : []);
    } catch (documentsError: any) {
      setError(documentsError?.message || 'Falha ao carregar documentos.');
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function reserveWithPix() {
    const documentDigits = buyerDocument.replace(/\D/g, '');
    if (!buyerName.trim()) { setError('Nome do comprador é obrigatório.'); return; }
    if (![11, 14].includes(documentDigits.length)) { setError('Informe um CPF ou CNPJ completo.'); return; }
    if (!Number.isSafeInteger(signalAmountCents) || signalAmountCents <= 0) { setError('Informe um valor de sinal maior que zero.'); return; }
    if (unit.price_cents && signalAmountCents > unit.price_cents) { setError('O sinal não pode superar o preço da unidade.'); return; }

    setSaving('pix');
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          request_key: requestKey,
          buyer_name: buyerName.trim(),
          buyer_phone: buyerPhone ? normalizePhoneBR(buyerPhone) : '',
          buyer_cpf_cnpj: documentDigits,
          signal_amount_cents: signalAmountCents,
          hold_hours: Math.min(168, Math.max(1, Number(holdHours) || 1)),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao gerar o PIX da reserva.');
      if (!body?.reservation) throw new Error('A reserva foi criada sem os dados do PIX.');
      setReservation(body.reservation);
      setBuyerDocument('');
      await loadDocuments();
      onChanged();
    } catch (reserveError: any) {
      setError(reserveError?.message || 'Falha ao gerar o PIX da reserva.');
    } finally {
      setSaving(null);
    }
  }

  async function copyPixCode() {
    if (!reservation?.pix_copy_paste) return;
    try {
      await navigator.clipboard.writeText(reservation.pix_copy_paste);
      setCopiedPix(true);
      window.setTimeout(() => setCopiedPix(false), 1800);
    } catch {
      setError('Não foi possível copiar o PIX automaticamente.');
    }
  }

  async function requestDocument() {
    if (documentLabel.trim().length < 2) { setError('Informe o nome do documento.'); return; }
    setDocumentAction('request');
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ label: documentLabel.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao solicitar documento.');
      setDocumentLabel('');
      await loadDocuments();
    } catch (requestError: any) {
      setError(requestError?.message || 'Falha ao solicitar documento.');
    } finally {
      setDocumentAction(null);
    }
  }

  async function uploadDocument(documentId: string, file: File | undefined) {
    if (!file) return;
    if (!DOCUMENT_MIME_TYPES.includes(file.type)) {
      setError('Envie um arquivo PDF, JPEG, PNG ou WebP.');
      return;
    }
    if (!file.size || file.size > MAX_DOCUMENT_BYTES) {
      setError('O documento deve ter no maximo 6 MB.');
      return;
    }

    setDocumentAction(`upload:${documentId}`);
    setError('');
    try {
      const fileData = await readFileAsDataUrl(file);
      const res = await fetch(`/api/lancamentos/reservation-documents/${documentId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ file_data: fileData }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao enviar documento.');
      await loadDocuments();
    } catch (uploadError: any) {
      setError(uploadError?.message || 'Falha ao enviar documento.');
    } finally {
      setDocumentAction(null);
    }
  }

  async function reviewDocument(documentId: string, status: 'aprovado' | 'rejeitado') {
    const reason = rejectionReason.trim();
    if (status === 'rejeitado' && reason.length < 2) {
      setError('Informe o motivo da rejeicao.');
      return;
    }

    setDocumentAction(`${status}:${documentId}`);
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/reservation-documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify(status === 'rejeitado'
          ? { status, rejection_reason: reason }
          : { status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Falha ao revisar documento.');
      setRejectingDocumentId(null);
      setRejectionReason('');
      await loadDocuments();
    } catch (reviewError: any) {
      setError(reviewError?.message || 'Falha ao revisar documento.');
    } finally {
      setDocumentAction(null);
    }
  }

  async function openDocument(documentId: string) {
    const previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) previewWindow.opener = null;
    setDocumentAction(`view:${documentId}`);
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/reservation-documents/${documentId}/signed-url`, {
        headers: authService.getAuthHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.signed_url) throw new Error(body?.error || 'Falha ao abrir documento.');
      if (previewWindow) {
        previewWindow.location.replace(body.signed_url);
      } else {
        const link = window.document.createElement('a');
        link.href = body.signed_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
      }
    } catch (viewError: any) {
      previewWindow?.close();
      setError(viewError?.message || 'Falha ao abrir documento.');
    } finally {
      setDocumentAction(null);
    }
  }

  async function act(action: 'reservar' | 'vender' | 'liberar') {
    if (action === 'reservar' && !buyerName.trim()) { setError('Nome do interessado é obrigatório pra reservar.'); return; }
    setSaving(action);
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ action, buyer_name: buyerName || undefined, buyer_phone: buyerPhone ? normalizePhoneBR(buyerPhone) : undefined, hold_hours: Number(holdHours) || 1 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao atualizar unidade.');
      }
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao atualizar unidade.');
    } finally {
      setSaving(null);
    }
  }

  async function saveEdits() {
    setSaving('editar');
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({
          price_cents: priceCents || null,
          quartos: !isLoteamento && quartos ? Number(quartos) : null,
          vagas_garagem: !isLoteamento && vagas ? Number(vagas) : null,
          area_m2: !isLoteamento && areaM2 ? Number(areaM2.replace(',', '.')) : null,
          andar: isVertical && andar ? Number(andar) : null,
          area_lote_m2: isLoteamento && areaLoteM2 ? Number(areaLoteM2.replace(',', '.')) : null,
          testada_m: isLoteamento && testadaM ? Number(testadaM.replace(',', '.')) : null,
          orientacao: orientacao || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao salvar alterações.');
      }
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao salvar alterações.');
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir a unidade ${unit.code} permanentemente?`)) return;
    setSaving('excluir');
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao excluir unidade.');
      }
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao excluir unidade.');
    } finally {
      setSaving(null);
    }
  }

  const numInputClass = "w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25 focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors";
  const effectiveStatus = reservation ? 'reservado' : unit.status;
  const canRetryPix = reservation?.status === 'creating' || reservation?.status === 'payment_failed';
  const reservationStatusLabel: Record<string, string> = {
    creating: 'preparando cobrança',
    pending: 'aguardando pagamento',
    paid: 'sinal pago',
    overdue: 'PIX vencido',
    payment_failed: 'falha ao gerar PIX',
  };
  const documentStatusLabel: Record<ReservationDocument['status'], string> = {
    pendente: 'pendente',
    enviado: 'enviado',
    aprovado: 'aprovado',
    rejeitado: 'rejeitado',
  };
  const documentStatusClass: Record<ReservationDocument['status'], string> = {
    pendente: 'text-amber-100 bg-amber-500/15 border-amber-300/20',
    enviado: 'text-blue-100 bg-blue-500/15 border-blue-300/20',
    aprovado: 'text-emerald-100 bg-emerald-500/15 border-emerald-300/20',
    rejeitado: 'text-red-100 bg-red-500/15 border-red-300/20',
  };
  const unapprovedDocumentCount = documents.filter((item) => item.status !== 'aprovado').length;
  const qrCodeSource = reservation?.pix_qr_code
    ? (reservation.pix_qr_code.startsWith('data:') ? reservation.pix_qr_code : `data:image/png;base64,${reservation.pix_qr_code}`)
    : null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 shrink-0">
          <h3 className="text-lg font-bold text-white">Unidade {unit.code}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">{error}</div>}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-white/50">
              {centsToReais(unit.price_cents)} · status atual: <span className="font-semibold">{effectiveStatus}</span>
            </p>
            <button onClick={() => setEditing(e => !e)} className="text-[12px] font-semibold text-violet-200 hover:text-violet-100 transition-colors shrink-0">
              {editing ? 'fechar' : 'editar'}
            </button>
          </div>
          {!editing && unitDetails(unit) && (
            <p className="text-[12px] text-white/40">{unitDetails(unit)}</p>
          )}

          <div className="space-y-3 p-3 rounded-xl bg-violet-500/[0.06] border border-violet-300/15">
            <div className="flex items-center gap-2">
              <Calculator size={14} className="text-violet-200" />
              <div>
                <p className="text-[12px] font-bold text-white/80">Simulador de financiamento</p>
                <p className="text-[10px] text-white/35">Cálculo simples, sem juros e sem salvar proposta.</p>
              </div>
            </div>

            {!unit.price_cents ? (
              <p className="text-[12px] text-amber-200/80">Cadastre o preço da unidade para simular.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setEntryMode('percent')}
                    className={`py-2 rounded-xl text-[11px] font-semibold border transition-colors ${entryMode === 'percent' ? 'bg-violet-400/15 text-violet-100 border-violet-300/25' : 'bg-white/[0.03] text-white/40 border-white/10'}`}>
                    Entrada em %
                  </button>
                  <button type="button" onClick={() => setEntryMode('amount')}
                    className={`py-2 rounded-xl text-[11px] font-semibold border transition-colors ${entryMode === 'amount' ? 'bg-violet-400/15 text-violet-100 border-violet-300/25' : 'bg-white/[0.03] text-white/40 border-white/10'}`}>
                    Entrada em R$
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Entrada</label>
                    {entryMode === 'percent' ? (
                      <div className="flex items-stretch gap-1.5">
                        <input value={entryPercent}
                          onChange={(e) => setEntryPercent(e.target.value.replace(/[^\d,]/g, '').slice(0, 6))}
                          inputMode="decimal" aria-label="Percentual de entrada"
                          className={numInputClass} />
                        <span className="flex items-center px-3 rounded-xl text-sm text-white/45 bg-white/5 border border-white/12">%</span>
                      </div>
                    ) : (
                      <div className="flex items-stretch gap-1.5">
                        <span className="flex items-center px-2.5 rounded-xl text-xs text-white/45 bg-white/5 border border-white/12">R$</span>
                        <input value={maskFromCents(entryAmountCents)}
                          onChange={(e) => setEntryAmountCents(centsFromMaskInput(e.target.value))}
                          inputMode="numeric" aria-label="Valor da entrada"
                          className={numInputClass} />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1 block">Parcelas</label>
                    <input value={installmentCount}
                      onChange={(e) => setInstallmentCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      inputMode="numeric" min={1} max={120} aria-label="Quantidade de parcelas"
                      className={numInputClass} />
                  </div>
                </div>

                {simulation ? (
                  <div className="rounded-xl bg-black/15 border border-white/8 px-3 py-2.5 space-y-1.5 text-[11px]">
                    <div className="flex justify-between text-white/50"><span>Entrada</span><strong className="text-white/75">{formatCentsBR(simulation.entryCents)}</strong></div>
                    <div className="flex justify-between text-white/50"><span>Saldo sem juros</span><strong className="text-white/75">{formatCentsBR(simulation.financedCents)}</strong></div>
                    <div className="pt-1.5 border-t border-white/8 text-violet-100">
                      {simulation.installmentCount === 1 ? (
                        <strong>1 parcela de {formatCentsBR(simulation.finalInstallmentCents)}</strong>
                      ) : simulation.regularInstallmentCents === simulation.finalInstallmentCents ? (
                        <strong>{simulation.installmentCount} parcelas de {formatCentsBR(simulation.regularInstallmentCents)}</strong>
                      ) : (
                        <strong>{simulation.installmentCount - 1} parcelas de {formatCentsBR(simulation.regularInstallmentCents)} + última de {formatCentsBR(simulation.finalInstallmentCents)}</strong>
                      )}
                    </div>
                    <p className="text-[9px] leading-relaxed text-white/30">Fórmula: (preço − entrada) ÷ parcelas. Diferença de centavos fica na última parcela.</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-red-300">Use entrada entre 0% e 100% (ou até o preço) e de 1 a 120 parcelas.</p>
                )}
              </>
            )}
          </div>

          {editing && (
            <div className="space-y-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Preço</label>
                <div className="flex items-stretch gap-2">
                  <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-white/50 bg-white/5 border border-white/12">R$</span>
                  <input value={maskFromCents(priceCents)} onChange={(e) => setPriceCents(centsFromMaskInput(e.target.value))}
                    placeholder="0,00" inputMode="numeric" className={numInputClass} />
                </div>
              </div>
              {isLoteamento ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Área do lote (m²)</label>
                    <input value={areaLoteM2} onChange={(e) => setAreaLoteM2(e.target.value.replace(/[^\d,]/g, ''))} inputMode="decimal" placeholder="0" className={numInputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Testada (m)</label>
                    <input value={testadaM} onChange={(e) => setTestadaM(e.target.value.replace(/[^\d,]/g, ''))} inputMode="decimal" placeholder="0" className={numInputClass} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Quartos</label>
                    <input value={quartos} onChange={(e) => setQuartos(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" placeholder="0" className={numInputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Vagas garagem</label>
                    <input value={vagas} onChange={(e) => setVagas(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" placeholder="0" className={numInputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Área construída (m²)</label>
                    <input value={areaM2} onChange={(e) => setAreaM2(e.target.value.replace(/[^\d,]/g, ''))} inputMode="decimal" placeholder="0" className={numInputClass} />
                  </div>
                  {isVertical && (
                    <div>
                      <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Andar</label>
                      <input value={andar} onChange={(e) => setAndar(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="0" className={numInputClass} />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Orientação solar</label>
                <div className="flex gap-2">
                  {(['nascente', 'poente'] as const).map((o) => (
                    <button key={o} type="button" onClick={() => setOrientacao(orientacao === o ? '' : o)}
                      className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors border ${
                        orientacao === o ? 'bg-white/[0.16] text-white border-white/25' : 'bg-white/[0.04] text-white/45 border-white/10 hover:text-white/70'
                      }`}>{ORIENTACAO_LABEL[o]}</button>
                  ))}
                </div>
              </div>
              <button onClick={saveEdits} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
                {saving === 'editar' ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          )}

          {(reservation?.reserved_until || (unit.status === 'reservado' && unit.reserved_until)) && (
            <p className="text-[12px] text-amber-200 flex items-center gap-1.5">
              <Clock size={12} /> reserva expira em {hoursLeft(reservation?.reserved_until || unit.reserved_until || undefined)}
            </p>
          )}

          {CLIENT_FINANCIAL_OPERATIONS_ENABLED && reservation && (
            <div className="space-y-3 rounded-xl bg-emerald-500/[0.07] border border-emerald-300/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <QrCode size={16} className="text-emerald-200 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-white/80">Sinal da reserva</p>
                    <p className="text-[10px] text-white/40">Documento final •••• {reservation.buyer_document_last4}</p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-emerald-100 text-right">
                  {reservationStatusLabel[reservation.status] || reservation.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-white/55">
                <span>Valor do sinal</span>
                <strong className="text-white/85">{formatCentsBR(reservation.signal_amount_cents)}</strong>
              </div>
              {qrCodeSource && (
                <img src={qrCodeSource} alt="QR Code PIX da reserva" className="w-44 h-44 mx-auto rounded-xl bg-white p-2" />
              )}
              {reservation.pix_copy_paste && (
                <div className="space-y-2">
                  <p className="text-[10px] text-white/35 break-all line-clamp-2">{reservation.pix_copy_paste}</p>
                  <button type="button" onClick={copyPixCode}
                    className="w-full py-2 rounded-xl text-[12px] font-semibold text-emerald-100 bg-emerald-500/10 border border-emerald-300/20 hover:bg-emerald-500/20 flex items-center justify-center gap-2">
                    {copiedPix ? <Check size={14} /> : <Copy size={14} />}
                    {copiedPix ? 'PIX copiado' : 'Copiar PIX copia e cola'}
                  </button>
                </div>
              )}
              {reservation.status === 'paid' && (
                <p className="text-[11px] text-emerald-100">
                  {documentsLoading
                    ? 'Pagamento confirmado. Verificando os documentos da reserva...'
                    : unapprovedDocumentCount > 0
                    ? `Pagamento confirmado. Aprove os ${unapprovedDocumentCount} documento(s) restante(s) para concluir a venda.`
                    : 'Pagamento confirmado. A venda definitiva já pode ser concluída.'}
                </p>
              )}
            </div>
          )}

          {financialAccess && reservation && (
            <div className="space-y-3 rounded-xl bg-blue-500/[0.06] border border-blue-300/15 p-3">
              <div className="flex items-start gap-2">
                <FileText size={15} className="text-blue-200 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[12px] font-bold text-white/80">Documentos da reserva</p>
                  <p className="text-[10px] text-white/35">Arquivos privados; o link de visualização expira em 5 minutos.</p>
                </div>
              </div>

              {documentsLoading ? (
                <div className="flex items-center justify-center py-3"><Loader2 size={16} className="animate-spin text-white/40" /></div>
              ) : documents.length === 0 ? (
                <p className="text-[11px] text-white/40 rounded-lg bg-black/10 px-3 py-2">
                  Nenhum documento solicitado. Sem itens, esta etapa não bloqueia a venda.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((item) => {
                    const busy = documentAction?.endsWith(`:${item.id}`) === true;
                    const hasFile = !!item.uploaded_at;
                    return (
                      <div key={item.id} className="rounded-xl bg-black/10 border border-white/8 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-white/75 break-words">{item.label}</p>
                            {hasFile && (
                              <p className="text-[9px] text-white/30">
                                {item.file_mime_type === 'application/pdf' ? 'PDF' : 'Imagem'}
                                {item.file_size_bytes ? ` · ${(item.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : ''}
                              </p>
                            )}
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[9px] font-semibold ${documentStatusClass[item.status]}`}>
                            {documentStatusLabel[item.status]}
                          </span>
                        </div>

                        {item.rejection_reason && (
                          <p className="text-[10px] text-red-200 bg-red-500/10 border border-red-300/15 rounded-lg px-2.5 py-2">
                            Motivo: {item.rejection_reason}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          {(item.status === 'pendente' || item.status === 'rejeitado') && (
                            <label htmlFor={`reservation-document-${item.id}`}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-blue-100 bg-blue-500/15 border border-blue-300/20 hover:bg-blue-500/25 cursor-pointer ${documentAction ? 'pointer-events-none opacity-50' : ''}`}>
                              {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                              {item.status === 'rejeitado' ? 'Reenviar' : 'Enviar'}
                              <input id={`reservation-document-${item.id}`} type="file" className="hidden"
                                accept="application/pdf,image/jpeg,image/png,image/webp"
                                disabled={!!documentAction}
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0];
                                  event.currentTarget.value = '';
                                  void uploadDocument(item.id, file);
                                }} />
                            </label>
                          )}

                          {hasFile && (
                            <button type="button" onClick={() => openDocument(item.id)} disabled={!!documentAction}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50">
                              {documentAction === `view:${item.id}` ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
                              Visualizar
                            </button>
                          )}

                          {item.status === 'enviado' && (
                            <>
                              <button type="button" onClick={() => reviewDocument(item.id, 'aprovado')} disabled={!!documentAction}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-emerald-100 bg-emerald-500/15 border border-emerald-300/20 hover:bg-emerald-500/25 disabled:opacity-50">
                                {documentAction === `aprovado:${item.id}` ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                Aprovar
                              </button>
                              <button type="button" onClick={() => {
                                setRejectingDocumentId(item.id);
                                setRejectionReason('');
                              }} disabled={!!documentAction}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-red-100 bg-red-500/15 border border-red-300/20 hover:bg-red-500/25 disabled:opacity-50">
                                <XCircle size={11} /> Rejeitar
                              </button>
                            </>
                          )}
                        </div>

                        {item.status === 'enviado' && rejectingDocumentId === item.id && (
                          <div className="space-y-2 pt-1">
                            <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value.slice(0, 500))}
                              placeholder="Motivo da rejeição" rows={2}
                              className="w-full rounded-lg px-3 py-2 text-[11px] text-white bg-white/8 border border-white/12 placeholder-white/25 focus:outline-none focus:border-red-300/30 resize-none" />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => reviewDocument(item.id, 'rejeitado')} disabled={!!documentAction || rejectionReason.trim().length < 2}
                                className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold text-red-100 bg-red-500/20 border border-red-300/20 disabled:opacity-40">
                                Confirmar rejeição
                              </button>
                              <button type="button" onClick={() => { setRejectingDocumentId(null); setRejectionReason(''); }} disabled={!!documentAction}
                                className="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white/50 bg-white/5 border border-white/10 disabled:opacity-40">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2">
                <input value={documentLabel} onChange={(event) => setDocumentLabel(event.target.value.slice(0, 120))}
                  onKeyDown={(event) => { if (event.key === 'Enter') void requestDocument(); }}
                  placeholder="Ex.: RG do comprador" disabled={!!documentAction}
                  className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[11px] text-white bg-white/8 border border-white/12 placeholder-white/25 focus:outline-none focus:border-blue-300/30 disabled:opacity-50" />
                <button type="button" onClick={requestDocument} disabled={!!documentAction || documentLabel.trim().length < 2}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-semibold text-blue-100 bg-blue-500/15 border border-blue-300/20 hover:bg-blue-500/25 disabled:opacity-40">
                  {documentAction === 'request' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Pedir
                </button>
              </div>
            </div>
          )}

          {effectiveStatus !== 'vendido' && (
            <>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <User size={11} /> Interessado/comprador
                </label>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Nome" disabled={!!reservation && !canRetryPix}
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                    focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Phone size={11} /> Telefone
                </label>
                <div className="flex items-stretch gap-2">
                  <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-white/50 bg-white/5 border border-white/12">+55</span>
                  <input value={buyerPhone} onChange={(e) => setBuyerPhone(digitsOnly(e.target.value))} inputMode="numeric" maxLength={11} placeholder="62994381279" disabled={!!reservation && !canRetryPix}
                    className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                      focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
                </div>
              </div>
            </>
          )}

          {(unit.status === 'disponivel' && !reservation) && (
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Reservar por quantas horas?</label>
              <input value={holdHours} onChange={(e) => setHoldHours(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="1"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
          )}

          {CLIENT_FINANCIAL_OPERATIONS_ENABLED && financialAccess && ((unit.status === 'disponivel' && !reservation) || canRetryPix) && (
            <div className="space-y-3 p-3 rounded-xl bg-emerald-500/[0.05] border border-emerald-300/15">
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">CPF/CNPJ do comprador</label>
                <input value={buyerDocument} onChange={(e) => setBuyerDocument(maskCpfCnpj(e.target.value))}
                  inputMode="numeric" maxLength={18} placeholder="000.000.000-00" className={numInputClass} />
                <p className="text-[9px] text-white/30 mt-1">O documento completo vai direto para a Asaas e não fica salvo no ImobiFlow.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Valor do sinal</label>
                <div className="flex items-stretch gap-2">
                  <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-white/50 bg-white/5 border border-white/12">R$</span>
                  <input value={maskFromCents(signalAmountCents)} onChange={(e) => setSignalAmountCents(centsFromMaskInput(e.target.value))}
                    inputMode="numeric" placeholder="0,00" className={numInputClass} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-white/10">
          {unit.status === 'disponivel' && !reservation && (
            <>
              {CLIENT_FINANCIAL_OPERATIONS_ENABLED && financialAccess && (
                <button onClick={reserveWithPix} disabled={!!saving}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-emerald-100 bg-emerald-500/15 border border-emerald-300/25 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving === 'pix' ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
                  {saving === 'pix' ? 'Gerando PIX...' : 'Reservar e gerar PIX'}
                </button>
              )}
              <button onClick={() => act('reservar')} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-amber-200 bg-amber-500/15 border border-amber-400/25 hover:bg-amber-500/25 transition-colors disabled:opacity-50">
                {saving === 'reservar' ? 'Reservando...' : CLIENT_FINANCIAL_OPERATIONS_ENABLED ? 'Reservar sem cobrança' : 'Reservar unidade'}
              </button>
              <button onClick={() => act('vender')} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
                {saving === 'vender' ? 'Vendendo...' : 'Marcar como vendida'}
              </button>
            </>
          )}
          {CLIENT_FINANCIAL_OPERATIONS_ENABLED && financialAccess && canRetryPix && (
            <button onClick={reserveWithPix} disabled={!!saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-emerald-100 bg-emerald-500/15 border border-emerald-300/25 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving === 'pix' ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
              {saving === 'pix' ? 'Gerando PIX...' : 'Tentar gerar o PIX novamente'}
            </button>
          )}
          {effectiveStatus === 'reservado' && (
            <>
              <button onClick={() => act('vender')} disabled={!!saving || documentsLoading || unapprovedDocumentCount > 0}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
                {saving === 'vender'
                  ? 'Vendendo...'
                  : documentsLoading
                    ? 'Verificando documentos...'
                    : unapprovedDocumentCount > 0
                      ? `Aguardando ${unapprovedDocumentCount} documento(s)`
                      : 'Confirmar venda'}
              </button>
              <button onClick={() => act('liberar')} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50">
                {saving === 'liberar' ? 'Liberando...' : 'Liberar reserva'}
              </button>
            </>
          )}
          {unit.status === 'vendido' && (
            <button onClick={() => act('liberar')} disabled={!!saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50">
              {saving === 'liberar' ? 'Desfazendo...' : 'Desfazer venda (voltar a disponível)'}
            </button>
          )}
          <button onClick={handleDelete} disabled={!!saving}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-red-300 bg-red-500/10 border border-red-400/20 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            {saving === 'excluir' ? 'Excluindo...' : 'Excluir unidade'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lançamentos real: núcleo (Etapa 7 do UX_MASTERPLAN.md) — empreendimento +
// espelho de unidades + reserva com trava por tempo (expira sozinha ao
// recarregar). A simulação simples de financiamento é local e sem persistência;
// o sinal via PIX e o backoffice privado de documentos completam as fases 2 e 3.
export function LancamentosArea() {
  const [developments, setDevelopments] = useState<Development[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [error, setError] = useState('');
  const [showNewDev, setShowNewDev] = useState(false);
  const [editingDev, setEditingDev] = useState(false);
  const [deletingDev, setDeletingDev] = useState(false);
  const [showNewUnit, setShowNewUnit] = useState(false);
  const [activeUnit, setActiveUnit] = useState<Unit | null>(null);

  const loadDevelopments = () => {
    setLoading(true);
    setError('');
    fetch('/api/lancamentos/developments', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar empreendimentos.`);
        }
        return r.json();
      })
      .then((data: Development[]) => {
        setDevelopments(data);
        setSelectedId((cur) => cur && data.some((d) => d.id === cur) ? cur : (data[0]?.id || null));
      })
      .catch((e) => setError(e.message || 'Erro ao carregar empreendimentos.'))
      .finally(() => setLoading(false));
  };

  useEffect(loadDevelopments, []);

  const loadUnits = (devId: string) => {
    setLoadingUnits(true);
    fetch(`/api/lancamentos/developments/${devId}/units`, { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setUnits(Array.isArray(data) ? data : []))
      .catch(() => setUnits([]))
      .finally(() => setLoadingUnits(false));
  };

  useEffect(() => {
    if (selectedId) loadUnits(selectedId);
    else setUnits(null);
  }, [selectedId]);

  const refreshAll = () => { loadDevelopments(); if (selectedId) loadUnits(selectedId); };

  const handleDeleteDevelopment = async (dev: Development) => {
    if (!confirm(`Excluir o empreendimento "${dev.name}" e todas as suas unidades permanentemente?`)) return;
    setDeletingDev(true);
    try {
      const res = await fetch(`/api/lancamentos/developments/${dev.id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao excluir empreendimento.');
      }
      setSelectedId(null);
      loadDevelopments();
    } catch (e: any) {
      alert(e.message || 'Falha ao excluir empreendimento.');
    } finally {
      setDeletingDev(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center pt-20"><Loader2 className="w-6 h-6 text-white/40 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto w-full">
        <h2 className="text-2xl font-black text-white mb-6">Lançamentos</h2>
        <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>
      </div>
    );
  }

  const isEmpty = (developments || []).length === 0;
  const selected = (developments || []).find((d) => d.id === selectedId) || null;

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black text-white">Lançamentos</h2>
        <button onClick={() => setShowNewDev(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-white
            bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors">
          <Plus className="w-4 h-4" /> Novo empreendimento
        </button>
      </div>

      {isEmpty ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-white/[0.06] border border-white/12">
            <Building2 className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60 mb-6">Nenhum empreendimento cadastrado ainda.</p>
          <button onClick={() => setShowNewDev(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-white
              bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors">
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : (
        <>
          <div className="flex gap-2 mb-5 flex-wrap">
            {developments!.map((d) => (
              <button key={d.id} onClick={() => setSelectedId(d.id)}
                className={`inline-flex items-center gap-2 pl-2 pr-4 py-2 rounded-2xl text-[13px] font-semibold transition-colors ${
                  selectedId === d.id ? 'bg-white/[0.14] text-white' : 'bg-white/[0.04] text-white/45 hover:text-white/75'
                }`}>
                {d.images && d.images[0] ? (
                  <img src={d.images[0]} alt="" className="w-6 h-6 rounded-full object-cover border border-white/15" />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                    <Building2 className="w-3 h-3 text-white/40" />
                  </span>
                )}
                {d.name}
              </button>
            ))}
          </div>

          {selected && (
            <GlassCard>
              {selected.images && selected.images.length > 0 && (
                <div className="flex gap-2 overflow-x-auto mb-4 -mx-1 px-1">
                  {selected.images.map((url) => (
                    <img key={url} src={url} alt="" className="h-24 w-32 object-cover rounded-xl border border-white/12 shrink-0" />
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-bold text-white">{selected.name}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white/[0.06] border border-white/12 text-white/50">
                      {selected.tipo === 'horizontal'
                        ? (selected.subtipo === 'condominio_casas' ? 'Condomínio de casas' : 'Loteamento')
                        : 'Vertical'}
                    </span>
                  </div>
                  {selected.location && <p className="text-[12px] text-white/40">{selected.location}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex gap-3 text-[11px]">
                    <span className="text-emerald-200">● {selected.disponivel} disponível</span>
                    <span className="text-amber-200">● {selected.reservado} reservado</span>
                    <span className="text-white/30">● {selected.vendido} vendido</span>
                  </div>
                  <button onClick={() => setShowNewUnit(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white/70
                      bg-white/[0.05] hover:bg-white/[0.1] transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Unidade
                  </button>
                  <button onClick={() => setEditingDev(true)} title="Editar empreendimento"
                    className="p-1.5 rounded-xl text-white/50 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.1] transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeleteDevelopment(selected)} disabled={deletingDev} title="Excluir empreendimento"
                    className="p-1.5 rounded-xl text-red-300/70 hover:text-red-300 bg-white/[0.05] hover:bg-red-500/10 transition-colors disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {selected.amenities && selected.amenities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selected.amenities.map((a) => (
                    <span key={a} className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.04] border border-white/10 text-white/50">{a}</span>
                  ))}
                </div>
              )}

              {loadingUnits ? (
                <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-white/40 animate-spin" /></div>
              ) : !units || units.length === 0 ? (
                <p className="text-[13px] text-white/40 text-center py-8">Nenhuma unidade cadastrada neste empreendimento ainda.</p>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-10 gap-2">
                  {units.map((u) => (
                    <button key={u.id} onClick={() => setActiveUnit(u)}
                      title={`Unidade ${u.code} — ${u.status}${unitDetails(u) ? ` · ${unitDetails(u)}` : ''}`}
                      className={`aspect-square rounded-lg border flex items-center justify-center text-[10px] font-bold transition-transform hover:scale-105 ${mirrorColor[u.status]}`}>
                      {u.code}
                    </button>
                  ))}
                </div>
              )}
            </GlassCard>
          )}
        </>
      )}

      {showNewDev && <NewDevelopmentModal onClose={() => setShowNewDev(false)} onCreated={refreshAll} />}
      {editingDev && selected && (
        <NewDevelopmentModal initial={selected} onClose={() => setEditingDev(false)} onCreated={refreshAll} />
      )}
      {showNewUnit && selectedId && (
        <NewUnitModal developmentId={selectedId} developmentTipo={selected?.tipo || 'vertical'} developmentSubtipo={selected?.subtipo} onClose={() => setShowNewUnit(false)} onCreated={refreshAll} />
      )}
      {activeUnit && (
        <UnitActionModal unit={activeUnit} developmentTipo={selected?.tipo || 'vertical'} developmentSubtipo={selected?.subtipo} onClose={() => setActiveUnit(null)} onChanged={refreshAll} />
      )}
    </div>
  );
}
