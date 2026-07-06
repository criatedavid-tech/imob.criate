import React, { useEffect, useState } from 'react';
import { Loader2, Plus, X, Building2, User, Phone, Clock } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface Development {
  id: string;
  name: string;
  location?: string;
  total_units: number;
  disponivel: number;
  reservado: number;
  vendido: number;
}

interface Unit {
  id: string;
  code: string;
  price_cents?: number;
  status: 'disponivel' | 'reservado' | 'vendido';
  reserved_until?: string;
  buyer_name?: string;
  buyer_phone?: string;
}

// Mesma paleta do widget mock "espelho de vendas" do cockpit (engine.ts/
// widgets.tsx) — consistência visual entre a prévia e o dado real.
const mirrorColor: Record<string, string> = {
  disponivel: 'bg-emerald-400/25 border-emerald-300/30 text-emerald-100',
  reservado: 'bg-amber-400/25 border-amber-300/30 text-amber-100',
  vendido: 'bg-white/[0.04] border-white/10 text-white/30',
};

function centsToReais(cents?: number): string {
  if (!cents) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function hoursLeft(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expirando...';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

function NewDevelopmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Nome do empreendimento é obrigatório.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/lancamentos/developments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ name, location: location || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao criar empreendimento.');
      }
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar empreendimento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h3 className="text-lg font-bold text-white">Novo empreendimento</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
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
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
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

function NewUnitModal({ developmentId, onClose, onCreated }: { developmentId: string; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!code.trim()) { setError('Código da unidade é obrigatório.'); return; }
    setSaving(true);
    setError('');
    try {
      const normalized = price.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
      const priceCents = normalized ? Math.round(parseFloat(normalized) * 100) : undefined;
      const res = await fetch(`/api/lancamentos/developments/${developmentId}/units`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ code, price_cents: priceCents }),
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

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h3 className="text-lg font-bold text-white">Nova unidade</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">{error}</div>}
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Código</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: 801 ou Cobertura 1201"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Preço (opcional)</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="450000,00" inputMode="decimal"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
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

function UnitActionModal({ unit, onClose, onChanged }: { unit: Unit; onClose: () => void; onChanged: () => void }) {
  const [buyerName, setBuyerName] = useState(unit.buyer_name || '');
  const [buyerPhone, setBuyerPhone] = useState(unit.buyer_phone || '');
  const [holdHours, setHoldHours] = useState('1');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(action: 'reservar' | 'vender' | 'liberar') {
    if (action === 'reservar' && !buyerName.trim()) { setError('Nome do interessado é obrigatório pra reservar.'); return; }
    setSaving(action);
    setError('');
    try {
      const res = await fetch(`/api/lancamentos/units/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ action, buyer_name: buyerName || undefined, buyer_phone: buyerPhone || undefined, hold_hours: Number(holdHours) || 1 }),
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

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden backdrop-blur-2xl bg-white/12 border border-white/25
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h3 className="text-lg font-bold text-white">Unidade {unit.code}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">{error}</div>}

          <p className="text-[13px] text-white/50">
            {centsToReais(unit.price_cents)} · status atual: <span className="font-semibold">{unit.status}</span>
          </p>

          {unit.status === 'reservado' && unit.reserved_until && (
            <p className="text-[12px] text-amber-200 flex items-center gap-1.5">
              <Clock size={12} /> reserva expira em {hoursLeft(unit.reserved_until)}
            </p>
          )}

          {unit.status !== 'vendido' && (
            <>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <User size={11} /> Interessado/comprador
                </label>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Nome"
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                    focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Phone size={11} /> Telefone
                </label>
                <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="(00) 00000-0000"
                  className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                    focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
              </div>
            </>
          )}

          {unit.status === 'disponivel' && (
            <div>
              <label className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-1.5 block">Reservar por quantas horas?</label>
              <input value={holdHours} onChange={(e) => setHoldHours(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="1"
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white bg-white/8 border border-white/12 placeholder-white/25
                  focus:outline-none focus:border-white/30 focus:bg-white/12 transition-colors" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-white/10">
          {unit.status === 'disponivel' && (
            <>
              <button onClick={() => act('reservar')} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-amber-200 bg-amber-500/15 border border-amber-400/25 hover:bg-amber-500/25 transition-colors disabled:opacity-50">
                {saving === 'reservar' ? 'Reservando...' : 'Reservar'}
              </button>
              <button onClick={() => act('vender')} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
                {saving === 'vender' ? 'Vendendo...' : 'Marcar como vendida'}
              </button>
            </>
          )}
          {unit.status === 'reservado' && (
            <>
              <button onClick={() => act('vender')} disabled={!!saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors disabled:opacity-50">
                {saving === 'vender' ? 'Vendendo...' : 'Confirmar venda'}
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
        </div>
      </div>
    </div>
  );
}

// Lançamentos real: núcleo (Etapa 7 do UX_MASTERPLAN.md) — empreendimento +
// espelho de unidades + reserva com trava por tempo (expira sozinha ao
// recarregar). Tabela de preço avançada, simulador de proposta+PIX e
// backoffice de aprovação de documentos ficam para uma rodada futura.
export function LancamentosArea() {
  const [developments, setDevelopments] = useState<Development[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [error, setError] = useState('');
  const [showNewDev, setShowNewDev] = useState(false);
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
                className={`px-4 py-2 rounded-2xl text-[13px] font-semibold transition-colors ${
                  selectedId === d.id ? 'bg-white/[0.14] text-white' : 'bg-white/[0.04] text-white/45 hover:text-white/75'
                }`}>
                {d.name}
              </button>
            ))}
          </div>

          {selected && (
            <GlassCard>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="text-[15px] font-bold text-white">{selected.name}</h3>
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
                </div>
              </div>

              {loadingUnits ? (
                <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-white/40 animate-spin" /></div>
              ) : !units || units.length === 0 ? (
                <p className="text-[13px] text-white/40 text-center py-8">Nenhuma unidade cadastrada neste empreendimento ainda.</p>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-10 gap-2">
                  {units.map((u) => (
                    <button key={u.id} onClick={() => setActiveUnit(u)}
                      title={`Unidade ${u.code} — ${u.status}`}
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
      {showNewUnit && selectedId && (
        <NewUnitModal developmentId={selectedId} onClose={() => setShowNewUnit(false)} onCreated={refreshAll} />
      )}
      {activeUnit && (
        <UnitActionModal unit={activeUnit} onClose={() => setActiveUnit(null)} onChanged={refreshAll} />
      )}
    </div>
  );
}
