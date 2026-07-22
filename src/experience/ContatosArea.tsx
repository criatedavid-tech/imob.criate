import React, { useEffect, useState } from 'react';
import { Loader2, Phone, Plus, X, User, Pencil, Trash2, Search, Contact as ContactIcon } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { digitsOnly, normalizePhoneBR, stripDDI } from '../lib/phone';

interface Contact {
  id: string;
  name: string;
  phone: string;
  notes?: string | null;
  created_at: string;
}

const CONTACTS_PAGE_SIZE = 100;

function ContactModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone ? stripDDI(initial.phone) : '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Nome é obrigatório.'); return; }
    if (!phone.trim()) { setError('Telefone é obrigatório.'); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(isEdit ? `/api/contacts/${initial!.id}` : '/api/contacts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ name, phone: normalizePhoneBR(phone), notes: notes || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Falha ao ${isEdit ? 'editar' : 'criar'} contato.`);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || `Falha ao ${isEdit ? 'editar' : 'criar'} contato.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden
        backdrop-blur-2xl bg-white/12 border border-[var(--glass-border-strong)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_24px_64px_rgba(0,0,0,0.5)]">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--hairline)]">
          <h3 className="text-lg font-bold text-[var(--text-hi)]">{isEdit ? 'Editar contato' : 'Novo contato'}</h3>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <User size={11} /> Nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Phone size={11} /> Telefone
            </label>
            <div className="flex items-stretch gap-2">
              <span className="flex items-center px-3 rounded-xl text-sm font-semibold text-[var(--text-low)]
                bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
                +55
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(digitsOnly(e.target.value))}
                inputMode="numeric"
                maxLength={11}
                placeholder="62994381279 (DDD + número)"
                className="flex-1 min-w-0 rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                  bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                  focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">
              Observações (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex.: proprietário do apê centro, prefere contato à noite..."
              className="w-full rounded-xl px-4 py-2.5 text-sm text-[var(--text-hi)]
                bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
                focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-white/12 transition-colors resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[var(--hairline)]">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-low)]
              bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-[var(--text-hi)]
              bg-blue-600/80 border border-blue-400/30 hover:bg-blue-600 transition-colors
              disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isEdit ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Contatos salvos por corretor — o agente de IA (command bar) usa essa lista
// pra resolver um nome ("manda mensagem pro Hunter") pro telefone certo,
// sem precisar digitar o número toda vez (ver server/services/agent.ts).
export function ContatosArea() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [totalContacts, setTotalContacts] = useState(0);
  const [hasMoreContacts, setHasMoreContacts] = useState(false);
  const [loadingMoreContacts, setLoadingMoreContacts] = useState(false);

  const load = (append = false) => {
    if (append) setLoadingMoreContacts(true);
    else setLoading(true);
    setError('');
    const offset = append ? (contacts?.length || 0) : 0;
    fetch(`/api/contacts?limit=${CONTACTS_PAGE_SIZE}&offset=${offset}`, { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar contatos.`);
        }
        const data = await r.json();
        return {
          data: Array.isArray(data) ? data : [],
          total: Number(r.headers.get('X-Total-Count') || 0),
          hasMore: r.headers.get('X-Has-More') === 'true',
        };
      })
      .then((page) => {
        setTotalContacts(page.total);
        setHasMoreContacts(page.hasMore);
        setContacts((current) => {
          if (!append) return page.data;
          const byId = new Map((current || []).map((contact) => [contact.id, contact]));
          for (const contact of page.data) byId.set(contact.id, contact);
          return Array.from(byId.values());
        });
      })
      .catch((e) => setError(e.message || 'Erro ao carregar contatos.'))
      .finally(() => {
        setLoading(false);
        setLoadingMoreContacts(false);
      });
  };

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE', headers: authService.getAuthHeaders() });
      if (!res.ok) throw new Error();
      setContacts((cur) => (cur || []).filter((c) => c.id !== id));
      setTotalContacts((current) => Math.max(0, current - 1));
    } catch {
      setError('Não consegui excluir esse contato.');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />
      </div>
    );
  }

  if (error && !contacts) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-black text-[var(--text-hi)] mb-6">Contatos</h2>
        <GlassCard className="!py-10 text-center">
          <p className="text-[14px] text-red-300">{error}</p>
        </GlassCard>
      </div>
    );
  }

  const filtered = (contacts || []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.includes(q);
  });

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="text-2xl font-black text-[var(--text-hi)]">Contatos</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
            bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo contato
        </button>
      </div>

      <p className="text-[13px] text-[var(--text-low)] mb-5">
        Contatos salvos aqui podem ser chamados pelo nome na conversa com a IA — ex.: <em>"manda mensagem pro Hunter dizendo..."</em>
      </p>

      {(contacts || []).length > 0 && (
        <div className="relative mb-5">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-low)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full rounded-2xl pl-10 pr-4 py-2.5 text-sm text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--hairline-strong)] placeholder-[var(--text-low)]
              focus:outline-none focus:border-[var(--glass-border-strong)] focus:bg-[var(--control-fill-hover)] transition-colors"
          />
        </div>
      )}

      {(contacts || []).length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <ContactIcon className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)] mb-6">
            Nenhum contato salvo ainda. Cadastre pra IA conseguir mandar mensagem por nome, sem precisar do número na hora.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
          >
            <Plus className="w-4 h-4" /> Cadastrar o primeiro
          </button>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="!py-10 text-center">
          <p className="text-[14px] text-[var(--text-low)]">Nenhum contato bate com "{search}".</p>
        </GlassCard>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((c) => (
            <div key={c.id}>
              <GlassCard className="!p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-[var(--text-hi)] truncate">{c.name}</p>
                  <p className="text-[12px] text-[var(--text-low)] flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3 shrink-0" /> {c.phone}
                  </p>
                  {c.notes && <p className="text-[12px] text-[var(--text-low)] mt-1 truncate">{c.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditing(c)}
                    className="p-2 rounded-xl text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(c.id)} disabled={deletingId === c.id}
                    className="p-2 rounded-xl text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
                    {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </GlassCard>
            </div>
          ))}
        </div>
      )}

      {(contacts || []).length > 0 && (
        <p className="text-[11px] text-[var(--text-low)] mt-4 text-center">
          {(contacts || []).length}{totalContacts > (contacts || []).length ? ` de ${totalContacts}` : ''} contato(s) carregado(s)
        </p>
      )}

      {hasMoreContacts && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => load(true)}
            disabled={loadingMoreContacts}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold text-[var(--text-mid)]
              bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50"
          >
            {loadingMoreContacts && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Carregar mais contatos
          </button>
        </div>
      )}

      {showCreate && (
        <ContactModal onClose={() => setShowCreate(false)} onSaved={() => load()} />
      )}
      {editing && (
        <ContactModal initial={editing} onClose={() => setEditing(null)} onSaved={() => load()} />
      )}
    </div>
  );
}
