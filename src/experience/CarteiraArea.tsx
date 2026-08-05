import React, { useEffect, useState } from 'react';
import { Plus, MapPin, Copy, Pencil, Trash2, Loader2, Home, Check, AlertTriangle, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import { authService } from '../services/auth';
import { formatPriceDisplay } from '../lib/money';
import PropertyForm from '../components/PropertyForm';
import { GlassCard } from './ui';

interface Property {
  id: string;
  title: string;
  price: string;
  location: string;
  status?: string;
  imageUrl?: string;
  slug: string;
  link?: string;
  description?: string;
  images?: string[];
  // GET /api/properties já devolve os campos estruturados separados (backend
  // limpa a descrição e extrai o JSON embutido) — precisam ser remesclados
  // ao editar, porque o PropertyForm espera recebê-los no nível raiz.
  details?: Record<string, any>;
}

const STATUS_LABEL: Record<string, string> = {
  disponivel: 'Disponível',
  vendido: 'Vendido',
  alugado: 'Alugado',
};

// Carteira real: lista os imóveis do corretor logado (GET /api/properties) e
// reaproveita o PropertyForm já existente (cadastro por foto + IA) para criar/editar.

// ─── Saúde do cadastro ──────────────────────────────────────────────────────
// A IA de atendimento só é tão boa quanto o cadastro: um imóvel com "quartos:
// 0" faz ela errar o número na frente do cliente, e descrição genérica repetida
// faz ela falar igual de todos. Este bloco mostra exatamente o que arrumar —
// é o item de maior retorno da carteira inteira.

interface QualidadeImovel {
  id: string; titulo: string; local: string; preco: string | null;
  problemas: { campo: string; gravidade: 'alta' | 'media'; problema: string; sugestao: string }[];
  campos_incertos: string[];
}

interface QualidadeResumo {
  total: number; com_problema: number; graves: number;
  mais_comuns: { problema: string; vezes: number }[];
  imoveis: QualidadeImovel[];
}

function SaudeDoCadastro() {
  const [dados, setDados] = useState<QualidadeResumo | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    fetch('/api/properties/qualidade', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setDados)
      .catch(() => setDados(null));
  }, []);

  if (!dados || dados.com_problema === 0) return null;

  return (
    <GlassCard className="!p-4 mb-5 border-amber-400/25">
      <button onClick={() => setAberto(!aberto)} className="w-full flex items-start gap-3 text-left">
        <span className="w-9 h-9 rounded-xl bg-amber-500/12 border border-amber-400/25 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-300" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-[var(--text-hi)]">
            {dados.com_problema} de {dados.total} imóveis com cadastro incompleto
          </span>
          <span className="block text-[11.5px] text-[var(--text-low)] mt-0.5 leading-relaxed">
            <Bot className="w-3 h-3 inline mr-1 -mt-0.5" />
            A IA não afirma dado que está faltando ou contraditório — nesses imóveis ela precisa
            desconversar em vez de responder.
          </span>
        </span>
        {aberto ? <ChevronDown className="w-4 h-4 text-[var(--text-low)] shrink-0 mt-1" />
          : <ChevronRight className="w-4 h-4 text-[var(--text-low)] shrink-0 mt-1" />}
      </button>

      {aberto && (
        <div className="mt-4 pt-3 border-t border-[var(--hairline)]">
          {dados.mais_comuns.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-low)] mb-1.5">
                Comece por aqui
              </p>
              {dados.mais_comuns.map((m) => (
                <p key={m.problema} className="text-[12px] text-[var(--text-mid)]">
                  <span className="tabular-nums font-bold text-amber-300">{m.vezes}×</span> {m.problema}
                </p>
              ))}
            </div>
          )}
          <div className="space-y-3 max-h-[420px] overflow-y-auto">
            {dados.imoveis.map((im) => (
              <div key={im.id} className="rounded-xl bg-[var(--control-fill)] p-3">
                <p className="text-[12.5px] font-bold text-[var(--text-hi)]">
                  {im.titulo} <span className="font-normal text-[var(--text-low)]">{im.local}</span>
                </p>
                {im.problemas.map((pr, i) => (
                  <p key={i} className="text-[11.5px] text-[var(--text-mid)] mt-1 leading-relaxed">
                    <span className={pr.gravidade === 'alta' ? 'text-red-300' : 'text-amber-300'}>•</span>{' '}
                    {pr.problema} <span className="text-[var(--text-low)]">{pr.sugestao}</span>
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

export function CarteiraArea() {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/properties', { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProperties(Array.isArray(data) ? data : []))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este imóvel permanentemente?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/properties/${id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao remover imóvel.');
      }
      setProperties((prev) => (prev || []).filter((p) => p.id !== id));
    } catch (e: any) {
      alert(e.message || 'Falha ao remover imóvel.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/properties/${id}/status`, {
        method: 'PATCH',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Falha ao atualizar status.');
      }
      setProperties((prev) => (prev || []).map((p) => (p.id === id ? { ...p, status } : p)));
    } catch (e: any) {
      alert(e.message || 'Falha ao atualizar status.');
    }
  };

  const handleCopyLink = (p: Property) => {
    if (!p.link) return;
    navigator.clipboard.writeText(p.link).then(() => {
      setCopiedId(p.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black text-[var(--text-hi)]">Carteira</h2>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
            bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo imóvel
        </button>
      </div>

      <SaudeDoCadastro />

      {loading ? (
        <div className="flex justify-center pt-20">
          <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />
        </div>
      ) : !properties || properties.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <Home className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)] mb-6">Nenhum imóvel cadastrado ainda.</p>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
          >
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {properties.map((p) => (
            <div key={p.id}>
            <GlassCard className="!p-0 overflow-hidden">
              <div className="h-40 bg-[var(--control-fill)] relative">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--text-low)]">
                    <Home className="w-8 h-8" />
                  </div>
                )}
                <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full
                  bg-black/50 backdrop-blur-md text-[var(--text-hi)]">
                  {STATUS_LABEL[p.status || 'disponivel'] || p.status}
                </span>
              </div>
              <div className="p-4">
                <h3 className="text-[15px] font-bold text-[var(--text-hi)] truncate">{p.title}</h3>
                <p className="text-[12px] text-[var(--text-low)] flex items-center gap-1 mt-0.5 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> {p.location}
                </p>
                <p className="text-[16px] font-black cr-money mt-2">{formatPriceDisplay(p.price)}</p>

                <div className="flex items-center gap-1.5 mt-4">
                  <button onClick={() => { setEditing(p); setShowForm(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold text-[var(--text-mid)]
                      bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={() => handleCopyLink(p)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-low)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors">
                    {copiedId === p.id ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleDelete(p.id)} disabled={deletingId === p.id}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-red-300/70 hover:bg-red-500/10 hover:text-red-300 transition-colors disabled:opacity-40">
                    {deletingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>

                {(() => {
                  const finalidade = p.details?.finalidade || 'venda';
                  const status = p.status || 'disponivel';
                  if (status !== 'disponivel') {
                    return (
                      <button onClick={() => handleStatusChange(p.id, 'disponivel')}
                        className="w-full mt-2 py-2 rounded-xl text-[11px] font-semibold text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
                        Marcar como disponível
                      </button>
                    );
                  }
                  return (
                    <div className="flex gap-1.5 mt-2">
                      {finalidade !== 'aluguel' && (
                        <button onClick={() => handleStatusChange(p.id, 'vendido')}
                          className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
                          Marcar como vendido
                        </button>
                      )}
                      {finalidade !== 'venda' && (
                        <button onClick={() => handleStatusChange(p.id, 'alugado')}
                          className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
                          Marcar como alugado
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </GlassCard>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <PropertyForm
          initialData={editing ? {
            ...editing,
            ...(editing.details || {}),
            description: editing.description || editing.details?.description || '',
          } : undefined}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}
