import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Loader2, User, Send, Bot, Plus, X, StickyNote, Trash2, Tags as TagsIcon, UserPlus, Check, Pencil } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface Tag { id: string; name: string; color: string | null; }
interface Queue { id: string; name: string; color: string | null; }
interface Member { user_id: string; name: string; is_owner: boolean; }
interface Note { id: string; body: string; user_id: string; created_at: string; }

type TicketStatus = 'pending' | 'open' | 'closed';

interface ConversationSummary {
  id: string;
  ticket_id: string;
  customer_phone: string;
  contact_name: string | null;
  ai_active: boolean;
  conversation_status: TicketStatus;
  queue_id: string | null;
  assigned_user_id: string | null;
  tags: Tag[];
  last_message: string | null;
  last_message_from: 'customer' | 'ai' | 'broker_manual' | null;
  last_activity: string | null;
  opened_at: string;
  closed_at: string | null;
}

interface Message {
  id: string;
  direction: 'in' | 'out';
  sender_type: 'customer' | 'ai' | 'broker_manual';
  body: string | null;
  created_at: string;
}

type Category = 'ia' | 'aguardando' | 'encerrado';

// Categoriza pelo estado que já temos (ai_active + conversation_status) — não
// é o ciclo Aberto/Pendente/Fechado do atendimento (isso vira o seletor de status
// dentro da conversa), é a pergunta que importa pro corretor na lista: quem
// está com a bola agora. Nunca fica "sem dono" — é sempre IA ou você.
function categoryOf(c: ConversationSummary): Category {
  if (c.conversation_status === 'closed') return 'encerrado';
  return c.ai_active ? 'ia' : 'aguardando';
}

const CATEGORY_LABEL: Record<Category, string> = {
  ia: 'IA atendendo',
  aguardando: 'Aguardando você',
  encerrado: 'Encerrado',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  pending: 'Pendente',
  open: 'Em atendimento',
  closed: 'Encerrado',
};

const TAG_COLORS = ['#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8'];

async function api(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, { ...opts, headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

// Cadastro/edição/exclusão de tags — antes só dava pra criar uma tag nova
// de dentro do picker de uma conversa (sem nenhum lugar pra renomear,
// trocar cor ou apagar). Autocontido: recarrega a própria lista e avisa o
// pai via onChanged pra manter o picker da conversa sincronizado.
function TagsManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    api('/api/conversas/tags').then(setTags).catch((e) => setError(e.message || 'Falha ao carregar tags.'));
  };
  useEffect(load, []);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const color = TAG_COLORS[(tags?.length || 0) % TAG_COLORS.length];
      await api('/api/conversas/tags', { method: 'POST', body: JSON.stringify({ name: newName.trim(), color }) });
      setNewName('');
      load();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar tag.');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (tag: Tag) => { setEditingId(tag.id); setEditName(tag.name); };

  const saveEdit = async (tag: Tag) => {
    if (!editName.trim()) return;
    setSavingId(tag.id);
    setError('');
    try {
      await api(`/api/conversas/tags/${tag.id}`, { method: 'PATCH', body: JSON.stringify({ name: editName.trim() }) });
      setEditingId(null);
      load();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Falha ao salvar tag.');
    } finally {
      setSavingId(null);
    }
  };

  const setColor = async (tag: Tag, color: string) => {
    try {
      await api(`/api/conversas/tags/${tag.id}`, { method: 'PATCH', body: JSON.stringify({ color }) });
      load();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Falha ao trocar a cor.');
    }
  };

  const remove = async (tag: Tag) => {
    if (!confirm(`Apagar a tag "${tag.name}"? Ela some de todas as conversas que a usam.`)) return;
    setDeletingId(tag.id);
    setError('');
    try {
      await api(`/api/conversas/tags/${tag.id}`, { method: 'DELETE' });
      load();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Falha ao apagar tag.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/15 p-6 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-white flex items-center gap-2"><TagsIcon className="w-4 h-4 text-violet-300" /> Gerenciar tags</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {error && <p className="text-[12px] text-red-300 mb-3">{error}</p>}

        <div className="flex-1 overflow-y-auto space-y-1.5 mb-4">
          {tags === null ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-white/40 animate-spin" /></div>
          ) : tags.length === 0 ? (
            <p className="text-[12px] text-white/35 text-center py-4">Nenhuma tag criada ainda.</p>
          ) : (
            tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2">
                <div className="relative group shrink-0">
                  <span className="w-4 h-4 rounded-full block border border-white/20" style={{ backgroundColor: tag.color || '#888' }} />
                  <div className="hidden group-hover:flex absolute z-10 top-6 left-0 gap-1 p-1.5 rounded-lg bg-slate-800 border border-white/15 shadow-xl">
                    {TAG_COLORS.map((c) => (
                      <button key={c} onClick={() => setColor(tag, c)}
                        className="w-4 h-4 rounded-full border border-white/20 hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                {editingId === tag.id ? (
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(tag)}
                    autoFocus
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg text-[13px] bg-white/[0.06] text-white outline-none border border-white/15" />
                ) : (
                  <span className="flex-1 min-w-0 text-[13px] text-white truncate">{tag.name}</span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === tag.id ? (
                    <button onClick={() => saveEdit(tag)} disabled={savingId === tag.id}
                      className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
                      {savingId === tag.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <button onClick={() => startEdit(tag)} className="p-1.5 rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-white/70 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => remove(tag)} disabled={deletingId === tag.id}
                    className="p-1.5 rounded-lg text-white/40 hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
                    {deletingId === tag.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 pt-3 border-t border-white/10">
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Nova tag…"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[13px] bg-white/[0.06] text-white placeholder:text-white/30 outline-none border border-white/12" />
          <button onClick={create} disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-bold text-white bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-40 transition-colors">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </div>
      </div>
    </div>
  );
}

// Conversas real — lista quem está falando com a IA agora, a thread de cada
// conversa, e permite responder manualmente / ligar-desligar a IA / gerenciar
// o ticket (status, fila, atribuição, tags, notas — inspirado na API de
// atendimento, implementado nativamente). Envio e entrada precisam de um
// corretor com UAZAPI conectada pra funcionar de ponta a ponta — sem isso, a
// lista funciona mas responder vai dar erro claro, não fingir sucesso.
export function ConversasArea() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('aguardando');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [queues, setQueues] = useState<Queue[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [queuePickerOpen, setQueuePickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [creatingConvo, setCreatingConvo] = useState(false);
  const [deletingConvo, setDeletingConvo] = useState(false);
  const [showTagsManager, setShowTagsManager] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [leadStatusByTicket, setLeadStatusByTicket] = useState<Record<string, 'created' | 'existing'>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldScrollToEndRef = useRef(false);

  const loadConversations = () => {
    fetch('/api/conversas', { headers: authService.getAuthHeaders() })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `Erro ${r.status} ao carregar conversas.`);
        }
        return r.json();
      })
      .then((data) => setConversations(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message || 'Erro ao carregar conversas.'));
  };

  useEffect(loadConversations, []);
  useEffect(() => {
    api('/api/conversas/queues').then(setQueues).catch(() => setQueues([]));
    api('/api/conversas/tags').then(setTags).catch(() => setTags([]));
    api('/api/equipe/members').then(setMembers).catch(() => setMembers([]));
  }, []);

  // Sem isso, uma resposta nova (do cliente ou da IA) só aparecia depois de
  // um F5 manual — a lista de conversas e a thread aberta agora se atualizam
  // sozinhas em segundo plano, sem piscar o loading a cada rodada.
  useEffect(() => {
    const id = setInterval(loadConversations, 5000);
    return () => clearInterval(id);
  }, []);

  const loadMessages = async (ticketId: string, mode: 'replace' | 'poll' | 'older' = 'replace') => {
    if (mode === 'replace') setLoadingMessages(true);
    if (mode === 'older') setLoadingOlderMessages(true);
    try {
      const before = mode === 'older' && messageCursor
        ? `&before=${encodeURIComponent(messageCursor)}`
        : '';
      const response = await fetch(
        `/api/conversas/${encodeURIComponent(ticketId)}/messages?limit=50${before}`,
        { headers: authService.getAuthHeaders() },
      );
      if (!response.ok) throw new Error(`Erro ${response.status}`);
      const payload = await response.json();
      const page = Array.isArray(payload) ? payload : [];

      if (mode !== 'poll') {
        setHasOlderMessages(response.headers.get('X-Has-More') === 'true');
        setMessageCursor(response.headers.get('X-Next-Cursor') || null);
      }
      shouldScrollToEndRef.current = mode === 'replace';
      setMessages((current) => {
        if (mode === 'replace') return page;
        const byId = new Map<string, Message>();
        for (const message of [...(current || []), ...page]) byId.set(message.id, message);
        return Array.from(byId.values()).sort((a, b) => {
          const byDate = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          return byDate || a.id.localeCompare(b.id);
        });
      });
    } catch {
      if (mode === 'replace') setMessages([]);
    } finally {
      if (mode === 'replace') setLoadingMessages(false);
      if (mode === 'older') setLoadingOlderMessages(false);
    }
  };

  const loadNotes = (ticketId: string) => {
    api(`/api/conversas/${encodeURIComponent(ticketId)}/notes`).then(setNotes).catch(() => setNotes([]));
  };

  useEffect(() => {
    if (selected) {
      loadMessages(selected);
      loadNotes(selected);
      setShowNotes(false);
      setTagPickerOpen(false);
      setAssignPickerOpen(false);
      setQueuePickerOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => loadMessages(selected, 'poll'), 3000);
    return () => clearInterval(id);
  }, [selected]);

  useEffect(() => {
    if (shouldScrollToEndRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
      shouldScrollToEndRef.current = false;
    }
  }, [messages]);

  const filtered = useMemo(
    () => (conversations || []).filter((c) => categoryOf(c) === category),
    [conversations, category]
  );
  const counts = useMemo(() => {
    const c: Record<Category, number> = { ia: 0, aguardando: 0, encerrado: 0 };
    for (const conv of conversations || []) c[categoryOf(conv)]++;
    return c;
  }, [conversations]);

  const selectedConv = conversations?.find((c) => c.id === selected) || null;

  const handleSend = async () => {
    if (!selected || !draft.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/reply`, { method: 'POST', body: JSON.stringify({ message: draft.trim() }) });
      setDraft('');
      loadMessages(selected);
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao enviar.');
    } finally {
      setSending(false);
    }
  };

  const toggleAi = async () => {
    if (!selected || !selectedConv || selectedConv.conversation_status === 'closed') return;
    setActionError(null);
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/ai-toggle`, { method: 'PATCH', body: JSON.stringify({ ai_active: !selectedConv.ai_active }) });
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao mudar a IA.');
    }
  };

  const setStatus = async (next: TicketStatus) => {
    if (!selected || selectedConv?.conversation_status === 'closed') return;
    setActionError(null);
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/status`, { method: 'PATCH', body: JSON.stringify({ conversation_status: next }) });
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao mudar o status.');
    }
  };

  const setAssign = async (userId: string) => {
    if (!selected) return;
    setActionError(null);
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/assign`, { method: 'PATCH', body: JSON.stringify({ user_id: userId || null }) });
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao atribuir.');
    }
  };

  const setQueue = async (queueId: string) => {
    if (!selected) return;
    setActionError(null);
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/queue`, { method: 'PATCH', body: JSON.stringify({ queue_id: queueId || null }) });
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao mudar a fila.');
    }
  };

  const addTagToConvo = async (tagId: string) => {
    if (!selected) return;
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/tags`, { method: 'POST', body: JSON.stringify({ tag_id: tagId }) });
      loadConversations();
      setTagPickerOpen(false);
    } catch (e: any) {
      setActionError(e.message || 'Falha ao marcar tag.');
    }
  };

  const removeTagFromConvo = async (tagId: string) => {
    if (!selected) return;
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao remover tag.');
    }
  };

  const createTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const color = TAG_COLORS[tags.length % TAG_COLORS.length];
      const tag = await api('/api/conversas/tags', { method: 'POST', body: JSON.stringify({ name: newTagName.trim(), color }) });
      setTags((prev) => [...prev.filter((t) => t.id !== tag.id), tag]);
      setNewTagName('');
      if (selected) addTagToConvo(tag.id);
    } catch (e: any) {
      setActionError(e.message || 'Falha ao criar tag.');
    }
  };

  const addNote = async () => {
    if (!selected || !noteDraft.trim()) return;
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/notes`, { method: 'POST', body: JSON.stringify({ body: noteDraft.trim() }) });
      setNoteDraft('');
      loadNotes(selected);
    } catch (e: any) {
      setActionError(e.message || 'Falha ao salvar nota.');
    }
  };

  const createConversation = async () => {
    if (!newPhone.trim() || !newMessage.trim()) return;
    setCreatingConvo(true);
    setActionError(null);
    try {
      const digits = newPhone.replace(/\D/g, '');
      const created = await api('/api/conversas/create', { method: 'POST', body: JSON.stringify({ phone: digits, message: newMessage.trim() }) });
      setShowNewConvo(false);
      setNewPhone('');
      setNewMessage('');
      loadConversations();
      setSelected(created.ticket_id || null);
    } catch (e: any) {
      setActionError(e.message || 'Falha ao criar conversa.');
    } finally {
      setCreatingConvo(false);
    }
  };

  const deleteConversation = async () => {
    if (!selected) return;
    if (!confirm('Apagar este ciclo de atendimento? Isso remove as mensagens, notas e tags dele. Não dá pra desfazer.')) return;
    setDeletingConvo(true);
    setActionError(null);
    try {
      await api(`/api/conversas/${selected}`, { method: 'DELETE' });
      setSelected(null);
      setMessages(null);
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao apagar conversa.');
    } finally {
      setDeletingConvo(false);
    }
  };

  const createLead = async () => {
    if (!selected) return;
    setCreatingLead(true);
    setActionError(null);
    try {
      const result = await api(`/api/conversas/${selected}/create-lead`, { method: 'POST' });
      setLeadStatusByTicket((cur) => ({ ...cur, [selected]: result.already_existed ? 'existing' : 'created' }));
    } catch (e: any) {
      setActionError(e.message || 'Falha ao criar lead.');
    } finally {
      setCreatingLead(false);
    }
  };

  const memberName = (userId: string | null) => {
    if (!userId) return null;
    return members.find((m) => m.user_id === userId)?.name || 'Membro';
  };

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-black text-white">Conversas</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTagsManager(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-white/70
              bg-white/[0.05] border border-white/12 hover:bg-white/[0.1] hover:text-white transition-colors"
          >
            <TagsIcon className="w-4 h-4" /> Gerenciar tags
          </button>
          <button
            onClick={() => setShowNewConvo(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-white
              bg-white/[0.08] border border-white/15 hover:bg-white/[0.14] transition-colors"
          >
            <Plus className="w-4 h-4" /> Nova conversa
          </button>
        </div>
      </div>

      {error ? (
        <GlassCard className="!py-14 text-center border-red-400/20">
          <p className="text-[15px] text-red-300 font-semibold mb-1">Não deu pra carregar as conversas.</p>
          <p className="text-[13px] text-white/40">{error}</p>
        </GlassCard>
      ) : conversations === null ? (
        <div className="flex justify-center pt-20">
          <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
        </div>
      ) : conversations.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-white/[0.06] border border-white/12">
            <MessageCircle className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-white/60">Nenhuma conversa ainda.</p>
        </GlassCard>
      ) : (
        <>
          <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.05] border border-white/10 w-fit mb-4">
            {(['aguardando', 'ia', 'encerrado'] as Category[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                  category === cat ? 'bg-white/[0.14] text-white' : 'text-white/45 hover:text-white/75'
                }`}
              >
                {CATEGORY_LABEL[cat]} <span className="text-white/35">({counts[cat]})</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-5">
            <GlassCard className="!p-2 h-[640px] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-[13px] text-white/40 text-center py-8">Nada por aqui.</p>
              ) : (
                <div className="space-y-1">
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c.id)}
                      className={`w-full flex items-center gap-3 rounded-2xl p-3 text-left transition-colors ${
                        selected === c.id ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0
                        bg-gradient-to-br from-slate-500/40 to-slate-700/40 border border-white/15">
                        <User className="w-4 h-4 text-white/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[14px] font-semibold text-white truncate block">{c.contact_name || c.customer_phone}</span>
                        {c.contact_name && <span className="text-[11px] text-white/40 truncate block">{c.customer_phone}</span>}
                        <p className="text-[12px] text-white/45 truncate">{c.last_message || 'sem mensagens'}</p>
                        {c.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {c.tags.map((t) => (
                              <span key={t.id} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: `${t.color}25`, color: t.color || '#fff' }}>
                                {t.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard className="!p-0 h-[640px] flex flex-col overflow-hidden">
              {!selected || !selectedConv ? (
                <div className="h-full flex-1 flex items-center justify-center text-white/40 text-[14px]">
                  Selecione uma conversa
                </div>
              ) : (
                <>
                  <div className="px-5 py-3.5 border-b border-white/8 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <span className="text-[14px] font-semibold text-white block truncate">{selectedConv.contact_name || selectedConv.customer_phone}</span>
                        <span className="text-[11px] text-white/40 truncate block">
                          {selectedConv.contact_name ? selectedConv.customer_phone + ' · ' : ''}
                          <span className="font-mono text-white/30" title={selectedConv.id}>Ticket #{selectedConv.id.slice(0, 8).toUpperCase()}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {leadStatusByTicket[selectedConv.id] ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-emerald-300 bg-emerald-500/15">
                            <Check className="w-3.5 h-3.5" /> Já é lead
                          </span>
                        ) : (
                          <button onClick={createLead} disabled={creatingLead}
                            title="Cadastrar este contato como lead"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white/70
                              bg-white/[0.05] border border-white/12 hover:bg-white/[0.1] hover:text-white transition-colors disabled:opacity-40">
                            {creatingLead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Criar lead
                          </button>
                        )}
                        <button onClick={toggleAi} disabled={selectedConv.conversation_status === 'closed'}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
                            selectedConv.ai_active ? 'text-violet-200 bg-violet-500/15 hover:bg-violet-500/25' : 'text-amber-200 bg-amber-500/15 hover:bg-amber-500/25'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}>
                          <Bot className="w-3.5 h-3.5" /> {selectedConv.ai_active ? 'IA ligada' : 'IA pausada'}
                        </button>
                        <button onClick={deleteConversation} disabled={deletingConvo}
                          title="Apagar este ciclo de atendimento"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-white/40 hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
                          {deletingConvo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['pending', 'open', 'closed'] as TicketStatus[]).map((s) => (
                        <button key={s} onClick={() => setStatus(s)} disabled={selectedConv.conversation_status === 'closed'}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                            selectedConv.conversation_status === s
                              ? 'bg-white/[0.16] text-white'
                              : 'text-white/40 hover:text-white/70 bg-white/[0.04]'
                          } disabled:cursor-not-allowed`}>
                          {STATUS_LABEL[s]}
                        </button>
                      ))}

                      <div className="relative ml-1">
                        <button onClick={() => { setAssignPickerOpen((v) => !v); setQueuePickerOpen(false); setTagPickerOpen(false); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/[0.04] text-white/70 hover:bg-white/[0.08] transition-colors">
                          {memberName(selectedConv.assigned_user_id) || 'Sem responsável'}
                        </button>
                        {assignPickerOpen && (
                          <div className="absolute z-10 top-6 left-0 w-44 rounded-xl bg-slate-900 border border-white/15 p-1 shadow-xl">
                            <button onClick={() => { setAssign(''); setAssignPickerOpen(false); }}
                              className="w-full text-left text-[11px] text-white/60 hover:bg-white/[0.08] rounded-lg px-2 py-1.5">
                              Sem responsável
                            </button>
                            {members.map((m) => (
                              <button key={m.user_id} onClick={() => { setAssign(m.user_id); setAssignPickerOpen(false); }}
                                className="w-full text-left text-[11px] text-white/80 hover:bg-white/[0.08] rounded-lg px-2 py-1.5">
                                {m.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <button onClick={() => { setQueuePickerOpen((v) => !v); setAssignPickerOpen(false); setTagPickerOpen(false); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/[0.04] text-white/70 hover:bg-white/[0.08] transition-colors">
                          {queues.find((q) => q.id === selectedConv.queue_id)?.name || 'Sem fila'}
                        </button>
                        {queuePickerOpen && (
                          <div className="absolute z-10 top-6 left-0 w-44 rounded-xl bg-slate-900 border border-white/15 p-1 shadow-xl">
                            <button onClick={() => { setQueue(''); setQueuePickerOpen(false); }}
                              className="w-full text-left text-[11px] text-white/60 hover:bg-white/[0.08] rounded-lg px-2 py-1.5">
                              Sem fila
                            </button>
                            {queues.map((q) => (
                              <button key={q.id} onClick={() => { setQueue(q.id); setQueuePickerOpen(false); }}
                                className="w-full text-left text-[11px] text-white/80 hover:bg-white/[0.08] rounded-lg px-2 py-1.5">
                                {q.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button onClick={() => setShowNotes((v) => !v)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                          showNotes ? 'bg-white/[0.16] text-white' : 'text-white/40 hover:text-white/70 bg-white/[0.04]'
                        }`}>
                        <StickyNote className="w-3 h-3" /> Notas {notes && notes.length > 0 ? `(${notes.length})` : ''}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {selectedConv.tags.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: `${t.color}25`, color: t.color || '#fff' }}>
                          {t.name}
                          <button onClick={() => removeTagFromConvo(t.id)}><X className="w-2.5 h-2.5" /></button>
                        </span>
                      ))}
                      <div className="relative">
                        <button onClick={() => setTagPickerOpen((v) => !v)}
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-white/40 hover:text-white/70 bg-white/[0.04]">
                          <Plus className="w-2.5 h-2.5" /> Tag
                        </button>
                        {tagPickerOpen && (
                          <div className="absolute z-10 top-6 left-0 w-48 rounded-xl bg-slate-900 border border-white/15 p-2 space-y-1 shadow-xl">
                            {tags.filter((t) => !selectedConv.tags.some((st) => st.id === t.id)).map((t) => (
                              <button key={t.id} onClick={() => addTagToConvo(t.id)}
                                className="w-full text-left text-[11px] text-white/80 hover:bg-white/[0.08] rounded-lg px-2 py-1">
                                {t.name}
                              </button>
                            ))}
                            <div className="flex gap-1 pt-1">
                              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && createTag()}
                                placeholder="Nova tag…"
                                className="flex-1 min-w-0 px-2 py-1 rounded-lg text-[11px] bg-white/[0.06] text-white outline-none" />
                              <button onClick={createTag} className="text-[11px] text-violet-300 font-bold px-1">+</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {showNotes && (
                    <div className="px-5 py-3 border-b border-white/8 bg-white/[0.02] space-y-2 max-h-40 overflow-y-auto">
                      {notes === null ? (
                        <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                      ) : notes.length === 0 ? (
                        <p className="text-[11px] text-white/35">Nenhuma nota ainda — visível só pro time.</p>
                      ) : (
                        notes.map((n) => (
                          <div key={n.id} className="text-[12px] text-white/70 bg-white/[0.04] rounded-xl px-3 py-2">
                            {n.body}
                            <div className="text-[10px] text-white/30 mt-0.5">{memberName(n.user_id) || 'Você'}</div>
                          </div>
                        ))
                      )}
                      <div className="flex gap-2">
                        <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addNote()}
                          placeholder="Anotar algo pro time…"
                          className="flex-1 px-3 py-1.5 rounded-xl text-[12px] bg-white/[0.06] text-white placeholder:text-white/30 outline-none" />
                        <button onClick={addNote} className="text-[11px] font-bold text-violet-300 px-2">Salvar</button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 p-5 overflow-y-auto">
                    {loadingMessages || !messages ? (
                      <div className="flex justify-center pt-16">
                        <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
                      </div>
                    ) : messages.length === 0 ? (
                      <p className="text-white/40 text-[14px] text-center pt-16">Sem mensagens registradas.</p>
                    ) : (
                      <div className="space-y-3">
                        {hasOlderMessages && (
                          <div className="flex justify-center pb-2">
                            <button
                              onClick={() => selected && loadMessages(selected, 'older')}
                              disabled={loadingOlderMessages}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold
                                text-white/55 bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] disabled:opacity-50"
                            >
                              {loadingOlderMessages && <Loader2 className="w-3 h-3 animate-spin" />}
                              Carregar mensagens anteriores
                            </button>
                          </div>
                        )}
                        {messages.map((m) => (
                          <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[13px] ${
                              m.direction === 'out' ? 'bg-violet-500/20 text-white' : 'bg-white/[0.07] text-white/85'
                            }`}>
                              {m.body}
                              <div className="text-[10px] text-white/35 mt-1">
                                {m.sender_type === 'ai' ? 'IA' : m.sender_type === 'broker_manual' ? 'Você' : 'Cliente'}
                                {' · '}
                                {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </div>

                  {actionError && (
                    <p className="px-5 pb-1 text-[12px] text-red-300">{actionError}</p>
                  )}
                  <div className="flex items-center gap-2 p-3 border-t border-white/8">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                      placeholder={selectedConv.conversation_status === 'closed' ? 'Ticket encerrado' : 'Responder como você…'}
                      disabled={selectedConv.conversation_status === 'closed'}
                      className="flex-1 px-4 py-2.5 rounded-2xl text-[13px] text-white placeholder:text-white/30
                        bg-white/[0.06] border border-white/12 outline-none focus:border-white/25"
                    />
                    <button onClick={handleSend} disabled={sending || !draft.trim() || selectedConv.conversation_status === 'closed'}
                      className="w-10 h-10 flex items-center justify-center rounded-2xl bg-violet-500/25 text-white
                        hover:bg-violet-500/35 disabled:opacity-40 transition-colors">
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </>
              )}
            </GlassCard>
          </div>
        </>
      )}

      {showNewConvo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowNewConvo(false)}>
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/15 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-white mb-4">Nova conversa</h3>
            <label className="text-[12px] text-white/50 font-semibold">Número (WhatsApp)</label>
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
              placeholder="55 62 99999-9999"
              className="w-full mt-1 mb-3 px-4 py-2.5 rounded-2xl text-[13px] text-white placeholder:text-white/30 bg-white/[0.06] border border-white/12 outline-none focus:border-white/25" />
            <label className="text-[12px] text-white/50 font-semibold">Primeira mensagem</label>
            <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={3}
              placeholder="Olá! Aqui é..."
              className="w-full mt-1 mb-4 px-4 py-2.5 rounded-2xl text-[13px] text-white placeholder:text-white/30 bg-white/[0.06] border border-white/12 outline-none focus:border-white/25 resize-none" />
            {actionError && <p className="text-[12px] text-red-300 mb-3">{actionError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewConvo(false)} className="px-4 py-2 rounded-2xl text-[13px] font-semibold text-white/60 hover:text-white/90">Cancelar</button>
              <button onClick={createConversation} disabled={creatingConvo || !newPhone.trim() || !newMessage.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-[13px] font-bold text-white bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-40">
                {creatingConvo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar e abrir
              </button>
            </div>
          </div>
        </div>
      )}

      {showTagsManager && (
        <TagsManagerModal
          onClose={() => setShowTagsManager(false)}
          onChanged={() => { api('/api/conversas/tags').then(setTags).catch(() => {}); loadConversations(); }}
        />
      )}
    </div>
  );
}
