import React, { useEffect, useState } from 'react';
import { Plus, MapPin, Copy, Pencil, Trash2, Loader2, Home, Check } from 'lucide-react';
import { authService } from '../services/auth';
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
        <h2 className="text-2xl font-black text-white">Carteira</h2>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-white
            bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo imóvel
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center pt-20">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
        </div>
      ) : !properties || properties.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-white/[0.06] border border-white/12">
            <Home className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60 mb-6">Nenhum imóvel cadastrado ainda.</p>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-white
              bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors"
          >
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {properties.map((p) => (
            <div key={p.id}>
            <GlassCard className="!p-0 overflow-hidden">
              <div className="h-40 bg-white/5 relative">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/20">
                    <Home className="w-8 h-8" />
                  </div>
                )}
                <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full
                  bg-black/50 backdrop-blur-md text-white/80">
                  {STATUS_LABEL[p.status || 'disponivel'] || p.status}
                </span>
              </div>
              <div className="p-4">
                <h3 className="text-[15px] font-bold text-white truncate">{p.title}</h3>
                <p className="text-[12px] text-white/45 flex items-center gap-1 mt-0.5 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> {p.location}
                </p>
                <p className="text-[16px] font-black text-white mt-2">{p.price}</p>

                <div className="flex items-center gap-1.5 mt-4">
                  <button onClick={() => { setEditing(p); setShowForm(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold text-white/70
                      bg-white/[0.05] hover:bg-white/[0.1] transition-colors">
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={() => handleCopyLink(p)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-white/50 hover:bg-white/[0.1] hover:text-white transition-colors">
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
                        className="w-full mt-2 py-2 rounded-xl text-[11px] font-semibold text-white/40 hover:text-white/70 transition-colors">
                        Marcar como disponível
                      </button>
                    );
                  }
                  return (
                    <div className="flex gap-1.5 mt-2">
                      {finalidade !== 'aluguel' && (
                        <button onClick={() => handleStatusChange(p.id, 'vendido')}
                          className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-white/40 hover:text-white/70 transition-colors">
                          Marcar como vendido
                        </button>
                      )}
                      {finalidade !== 'venda' && (
                        <button onClick={() => handleStatusChange(p.id, 'alugado')}
                          className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-white/40 hover:text-white/70 transition-colors">
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
          initialData={editing ? { ...editing, ...(editing.details || {}) } : undefined}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}
