import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircle, Loader2, User, Send, Bot, Plus, X, StickyNote, Trash2,
  Tags as TagsIcon, UserPlus, Check, Pencil, Menu, ArrowLeft, MoreVertical, RotateCcw,
} from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';
import { cn } from '../lib/utils';

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

const TAG_COLORS = ['#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8'];

// Uma entrada da timeline unificada — mensagem OU nota interna, sempre na
// posição cronológica certa (correção do bug "nota aparecia no topo": antes
// vivia num painel separado acima das mensagens; agora é só mais um item
// ordenado por created_at, igual ordenação já usada pra mensagens).
type TimelineEntry =
  | { kind: 'message'; id: string; created_at: string; message: Message }
  | { kind: 'note'; id: string; created_at: string; note: Note };

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
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-[var(--glass-border)] p-6 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-[var(--text-hi)] flex items-center gap-2"><TagsIcon className="w-4 h-4 text-violet-300" /> Tags</h3>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {error && <p className="text-[12px] text-red-300 mb-3">{error}</p>}

        <div className="flex-1 overflow-y-auto space-y-1.5 mb-4">
          {tags === null ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" /></div>
          ) : tags.length === 0 ? (
            <p className="text-[12px] text-[var(--text-low)] text-center py-4">Nenhuma tag criada ainda.</p>
          ) : (
            tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)] px-3 py-2">
                <div className="relative group shrink-0">
                  <span className="w-4 h-4 rounded-full block border border-[var(--glass-border)]" style={{ backgroundColor: tag.color || '#888' }} />
                  <div className="hidden group-hover:flex absolute z-10 top-6 left-0 gap-1 p-1.5 rounded-lg bg-slate-800 border border-[var(--glass-border)] shadow-xl">
                    {TAG_COLORS.map((c) => (
                      <button key={c} onClick={() => setColor(tag, c)}
                        className="w-4 h-4 rounded-full border border-[var(--glass-border)] hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                {editingId === tag.id ? (
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(tag)}
                    autoFocus
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] outline-none border border-[var(--glass-border)]" />
                ) : (
                  <span className="flex-1 min-w-0 text-[13px] text-[var(--text-hi)] truncate">{tag.name}</span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === tag.id ? (
                    <button onClick={() => saveEdit(tag)} disabled={savingId === tag.id}
                      className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
                      {savingId === tag.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <button onClick={() => startEdit(tag)} className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => remove(tag)} disabled={deletingId === tag.id}
                    className="p-1.5 rounded-lg text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
                    {deletingId === tag.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 pt-3 border-t border-[var(--hairline)]">
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Nova tag…"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] outline-none border border-[var(--hairline-strong)]" />
          <button onClick={create} disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-bold text-[var(--text-hi)] bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-40 transition-colors">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </div>
      </div>
    </div>
  );
}

// Painel único de detalhes do ticket — substitui os 3 pickers soltos
// (responsável/fila/tag) e as pills de status que antes poluíam o cabeçalho
// da conversa. Mesmo padrão visual dos outros modais deste arquivo (cartão
// centralizado), reaproveitado em vez de inventar um drawer/bottom-sheet novo.
function TicketDetailsModal({
  conversation, queues, members, allTags, newTagName, onNewTagNameChange, onCreateTag,
  onAssign, onSetQueue, onAddTag, onRemoveTag, onReopen, reopening, onClose,
}: {
  conversation: ConversationSummary;
  queues: Queue[];
  members: Member[];
  allTags: Tag[];
  newTagName: string;
  onNewTagNameChange: (v: string) => void;
  onCreateTag: () => void;
  onAssign: (userId: string) => void;
  onSetQueue: (queueId: string) => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onReopen: () => void;
  reopening: boolean;
  onClose: () => void;
}) {
  const availableTags = allTags.filter((t) => !conversation.tags.some((ct) => ct.id === t.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-[var(--glass-border)] p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[16px] font-bold text-[var(--text-hi)]">Detalhes do atendimento</h3>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-mid)] transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {conversation.conversation_status === 'closed' && (
          <button onClick={onReopen} disabled={reopening}
            className="w-full mb-5 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
              bg-violet-500/25 border border-violet-300/30 hover:bg-violet-500/35 disabled:opacity-50 transition-colors">
            {reopening ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Reabrir atendimento
          </button>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Responsável</label>
            <select value={conversation.assigned_user_id || ''} onChange={(e) => onAssign(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] outline-none [color-scheme:dark]">
              <option value="">Sem responsável</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Fila</label>
            {queues.length === 0 ? (
              <p className="text-[12px] text-[var(--text-low)]">Nenhuma fila cadastrada ainda.</p>
            ) : (
              <select value={conversation.queue_id || ''} onChange={(e) => onSetQueue(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] border border-[var(--hairline-strong)] outline-none [color-scheme:dark]">
                <option value="">Sem fila</option>
                {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--text-low)] uppercase tracking-wider mb-1.5 block">Tags</label>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              {conversation.tags.length === 0 && <span className="text-[12px] text-[var(--text-low)]">Nenhuma tag nesta conversa.</span>}
              {conversation.tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
                  style={{ backgroundColor: `${t.color}25`, color: t.color || '#fff' }}>
                  {t.name}
                  <button onClick={() => onRemoveTag(t.id)}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
            {availableTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                {availableTags.map((t) => (
                  <button key={t.id} onClick={() => onAddTag(t.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full text-[var(--text-mid)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] transition-colors">
                    <Plus className="w-2.5 h-2.5" /> {t.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newTagName} onChange={(e) => onNewTagNameChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCreateTag()}
                placeholder="Nova tag…"
                className="flex-1 min-w-0 px-3 py-1.5 rounded-xl text-[12px] bg-[var(--control-fill)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] outline-none border border-[var(--hairline)]" />
              <button onClick={onCreateTag} className="text-[12px] font-bold text-violet-300 px-2">Criar</button>
            </div>
          </div>
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
//
// Layout: inbox estilo Zendesk/Intercom (lista + thread), não um Kanban de
// arrastar — decisão de produto 2026-07-23, uma conversa recebe mensagem nova
// a cada poucos segundos (poll), então mover um card ao vivo entre colunas
// seria estranho e arriscado no mobile. No mobile a lista e a thread NUNCA
// ficam empilhadas: é lista OU thread em tela cheia, alternando por `selected`
// (sem media query nova — só troca `hidden`/visível abaixo do breakpoint `md`,
// que continua mostrando as duas colunas lado a lado como sempre foi).
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
  const [addingNote, setAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [creatingConvo, setCreatingConvo] = useState(false);
  const [deletingConvo, setDeletingConvo] = useState(false);
  const [showTagsManager, setShowTagsManager] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
      setAddingNote(false);
      setShowDetails(false);
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

  // Timeline unificada: mensagens e notas internas juntas, sempre em ordem
  // cronológica — a nota aparece na posição real dela (geralmente no fim,
  // por ser adicionada depois), nunca numa seção separada acima de tudo.
  const timeline = useMemo<TimelineEntry[]>(() => {
    const msgEntries: TimelineEntry[] = (messages || []).map((m) => ({ kind: 'message', id: `m-${m.id}`, created_at: m.created_at, message: m }));
    const noteEntries: TimelineEntry[] = (notes || []).map((n) => ({ kind: 'note', id: `n-${n.id}`, created_at: n.created_at, note: n }));
    return [...msgEntries, ...noteEntries].sort((a, b) => {
      const byDate = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return byDate || a.id.localeCompare(b.id);
    });
  }, [messages, notes]);

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
    if (!selected) return;
    setActionError(null);
    try {
      await api(`/api/conversas/${encodeURIComponent(selected)}/status`, { method: 'PATCH', body: JSON.stringify({ conversation_status: next }) });
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao mudar o status.');
    }
  };

  const reopenConversation = async () => {
    setReopening(true);
    await setStatus('open');
    setReopening(false);
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
      setAddingNote(false);
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
      setActionError(e.message || 'Falha ao criar CRM.');
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
      {/* Cabeçalho + tabs de categoria pertencem à tela de LISTA — no mobile,
          somem quando uma conversa está aberta (a thread vira a tela cheia). */}
      <div className={cn('flex items-center justify-between mb-6', selected && 'hidden md:flex')}>
        <h2 className="text-2xl font-black text-[var(--text-hi)]">Conversas</h2>
        <div className="flex items-center gap-2">
          {/* Desktop: os 2 botões sempre visíveis. */}
          <button
            onClick={() => setShowTagsManager(true)}
            className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-mid)]
              bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors"
          >
            <TagsIcon className="w-4 h-4" /> Tags
          </button>
          <button
            onClick={() => setShowNewConvo(true)}
            className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[13px] font-bold text-[var(--text-hi)]
              bg-[var(--control-fill)] border border-[var(--glass-border)] hover:bg-[var(--control-fill-hover)] transition-colors"
          >
            <Plus className="w-4 h-4" /> Nova conversa
          </button>

          {/* Mobile: hambúrguer com os mesmos 2 itens dentro. */}
          <div className="relative md:hidden">
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex items-center justify-center w-10 h-10 rounded-2xl text-[var(--text-mid)]
                bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>
            {mobileMenuOpen && (
              <div className="absolute z-10 top-11 right-0 w-44 rounded-xl bg-slate-900 border border-[var(--glass-border)] p-1 shadow-xl">
                <button onClick={() => { setShowTagsManager(true); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-2 text-left text-[13px] text-[var(--text-hi)] hover:bg-[var(--control-fill)] rounded-lg px-3 py-2">
                  <TagsIcon className="w-3.5 h-3.5" /> Tags
                </button>
                <button onClick={() => { setShowNewConvo(true); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-2 text-left text-[13px] text-[var(--text-hi)] hover:bg-[var(--control-fill)] rounded-lg px-3 py-2">
                  <Plus className="w-3.5 h-3.5" /> Nova conversa
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <GlassCard className="!py-14 text-center border-red-400/20">
          <p className="text-[15px] text-red-300 font-semibold mb-1">Não deu pra carregar as conversas.</p>
          <p className="text-[13px] text-[var(--text-low)]">{error}</p>
        </GlassCard>
      ) : conversations === null ? (
        <div className="flex justify-center pt-20">
          <Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" />
        </div>
      ) : conversations.length === 0 ? (
        <GlassCard className="!py-14 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4
            bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <MessageCircle className="w-5 h-5 text-violet-200" />
          </div>
          <p className="text-[15px] text-[var(--text-mid)]">Nenhuma conversa ainda.</p>
        </GlassCard>
      ) : (
        <>
          <div className={cn('flex gap-1 p-1 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] w-fit mb-4', selected && 'hidden md:flex')}>
            {(['aguardando', 'ia', 'encerrado'] as Category[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                  category === cat ? 'bg-[var(--control-fill-hover)] text-[var(--text-hi)]' : 'text-[var(--text-low)] hover:text-[var(--text-mid)]'
                }`}
              >
                {CATEGORY_LABEL[cat]} <span className="text-[var(--text-low)]">({counts[cat]})</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-5">
            <GlassCard className={cn('!p-2 h-[640px] overflow-y-auto', selected && 'hidden md:block')}>
              {filtered.length === 0 ? (
                <p className="text-[13px] text-[var(--text-low)] text-center py-8">Nada por aqui.</p>
              ) : (
                <div className="space-y-1">
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c.id)}
                      className={`w-full flex items-center gap-3 rounded-2xl p-3 text-left transition-colors ${
                        selected === c.id ? 'bg-[var(--control-fill-hover)]' : 'hover:bg-[var(--control-fill)]'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0
                        bg-gradient-to-br from-slate-500/40 to-slate-700/40 border border-[var(--glass-border)]">
                        <User className="w-4 h-4 text-[var(--text-mid)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[14px] font-semibold text-[var(--text-hi)] truncate block">{c.contact_name || c.customer_phone}</span>
                        {c.contact_name && <span className="text-[11px] text-[var(--text-low)] truncate block">{c.customer_phone}</span>}
                        <p className="text-[12px] text-[var(--text-low)] truncate">{c.last_message || 'sem mensagens'}</p>
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

            <GlassCard className={cn('!p-0 h-[640px] flex flex-col overflow-hidden', !selected && 'hidden md:flex')}>
              {!selected || !selectedConv ? (
                <div className="h-full flex-1 flex items-center justify-center text-[var(--text-low)] text-[14px]">
                  Selecione uma conversa
                </div>
              ) : (
                <>
                  <div className="px-5 py-3.5 border-b border-[var(--hairline)] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <button onClick={() => setSelected(null)} className="md:hidden shrink-0 text-[var(--text-mid)] hover:text-[var(--text-hi)] transition-colors">
                          <ArrowLeft className="w-4.5 h-4.5" />
                        </button>
                        <div className="min-w-0">
                          <span className="text-[14px] font-semibold text-[var(--text-hi)] block truncate">{selectedConv.contact_name || selectedConv.customer_phone}</span>
                          <span className="text-[11px] text-[var(--text-low)] truncate block">
                            {selectedConv.contact_name ? selectedConv.customer_phone + ' · ' : ''}
                            <span className="font-mono text-[var(--text-low)]" title={selectedConv.id}>Ticket #{selectedConv.id.slice(0, 8).toUpperCase()}</span>
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {leadStatusByTicket[selectedConv.id] ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-emerald-300 bg-emerald-500/15">
                            <Check className="w-3.5 h-3.5" /> CRM criado
                          </span>
                        ) : (
                          <button onClick={createLead} disabled={creatingLead}
                            title="Cadastrar este contato no CRM"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-[var(--text-mid)]
                              bg-[var(--control-fill)] border border-[var(--hairline-strong)] hover:bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors disabled:opacity-40">
                            {creatingLead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Criar CRM
                          </button>
                        )}
                        <button onClick={toggleAi} disabled={selectedConv.conversation_status === 'closed'}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
                            selectedConv.ai_active ? 'text-violet-200 bg-violet-500/15 hover:bg-violet-500/25' : 'text-amber-200 bg-amber-500/15 hover:bg-amber-500/25'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}>
                          <Bot className="w-3.5 h-3.5" /> {selectedConv.ai_active ? 'IA ligada' : 'IA pausada'}
                        </button>
                        <button onClick={() => setAddingNote((v) => !v)}
                          title="Adicionar nota interna"
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-xl transition-colors ${
                            addingNote ? 'text-amber-200 bg-amber-500/15' : 'text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)]'
                          }`}>
                          <StickyNote className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setShowDetails(true)} title="Detalhes do atendimento"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-[var(--text-low)] hover:bg-[var(--control-fill)] hover:text-[var(--text-mid)] transition-colors">
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={deleteConversation} disabled={deletingConvo}
                          title="Apagar este ciclo de atendimento"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-[var(--text-low)] hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-40">
                          {deletingConvo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {selectedConv.tags.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {selectedConv.tags.map((t) => (
                          <span key={t.id} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `${t.color}25`, color: t.color || '#fff' }}>
                            {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedConv.conversation_status === 'closed' && (
                    <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-[var(--hairline)] bg-[var(--control-fill)]">
                      <span className="text-[12px] text-[var(--text-mid)]">Atendimento encerrado.</span>
                      <button onClick={reopenConversation} disabled={reopening}
                        className="inline-flex items-center gap-1.5 text-[12px] font-bold text-violet-300 hover:text-violet-200 transition-colors disabled:opacity-50">
                        {reopening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reabrir
                      </button>
                    </div>
                  )}

                  <div className="flex-1 p-5 overflow-y-auto">
                    {loadingMessages || !messages ? (
                      <div className="flex justify-center pt-16">
                        <Loader2 className="w-5 h-5 text-[var(--text-low)] animate-spin" />
                      </div>
                    ) : messages.length === 0 ? (
                      <p className="text-[var(--text-low)] text-[14px] text-center pt-16">Sem mensagens registradas.</p>
                    ) : (
                      <div className="space-y-3">
                        {hasOlderMessages && (
                          <div className="flex justify-center pb-2">
                            <button
                              onClick={() => selected && loadMessages(selected, 'older')}
                              disabled={loadingOlderMessages}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold
                                text-[var(--text-mid)] bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] disabled:opacity-50"
                            >
                              {loadingOlderMessages && <Loader2 className="w-3 h-3 animate-spin" />}
                              Carregar mensagens anteriores
                            </button>
                          </div>
                        )}
                        {timeline.map((entry) => entry.kind === 'message' ? (
                          <div key={entry.id} className={`flex ${entry.message.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[13px] ${
                              entry.message.direction === 'out' ? 'bg-violet-500/20 text-[var(--text-hi)]' : 'bg-[var(--control-fill)] text-[var(--text-hi)]/85'
                            }`}>
                              {entry.message.body}
                              <div className="text-[10px] text-[var(--text-low)] mt-1">
                                {entry.message.sender_type === 'ai' ? 'IA' : entry.message.sender_type === 'broker_manual' ? 'Você' : 'Cliente'}
                                {' · '}
                                {new Date(entry.message.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div key={entry.id} className="flex justify-center">
                            <div className="max-w-[85%] w-full rounded-2xl px-4 py-2.5 text-[13px] bg-amber-500/10 border border-amber-400/20 text-[var(--text-mid)]">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-300/80 uppercase tracking-wide mb-1">
                                <StickyNote className="w-3 h-3" /> Nota interna — só o time vê
                              </div>
                              {entry.note.body}
                              <div className="text-[10px] text-[var(--text-low)] mt-1">
                                {memberName(entry.note.user_id) || 'Você'}
                                {' · '}
                                {new Date(entry.note.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
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

                  {addingNote && (
                    <div className="flex items-center gap-2 px-3 pt-3 border-t border-[var(--hairline)] bg-[var(--control-fill)]">
                      <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addNote()}
                        autoFocus
                        placeholder="Nota interna (só o time vê)…"
                        className="flex-1 px-3 py-2 rounded-xl text-[13px] bg-[var(--control-fill)] text-[var(--text-hi)] placeholder:text-[var(--text-low)] outline-none border border-amber-400/20" />
                      <button onClick={addNote} disabled={!noteDraft.trim()}
                        className="text-[12px] font-bold text-amber-300 px-3 py-2 disabled:opacity-40">Salvar</button>
                    </div>
                  )}

                  <div className="flex items-center gap-2 p-3 border-t border-[var(--hairline)]">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                      placeholder={selectedConv.conversation_status === 'closed' ? 'Ticket encerrado' : 'Responder como você…'}
                      disabled={selectedConv.conversation_status === 'closed'}
                      className="flex-1 px-4 py-2.5 rounded-2xl text-[13px] text-[var(--text-hi)] placeholder:text-[var(--text-low)]
                        bg-[var(--control-fill)] border border-[var(--hairline-strong)] outline-none focus:border-[var(--glass-border-strong)]"
                    />
                    <button onClick={handleSend} disabled={sending || !draft.trim() || selectedConv.conversation_status === 'closed'}
                      className="w-10 h-10 flex items-center justify-center rounded-2xl bg-violet-500/25 text-[var(--text-hi)]
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
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-[var(--glass-border)] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-[var(--text-hi)] mb-4">Nova conversa</h3>
            <label className="text-[12px] text-[var(--text-low)] font-semibold">Número (WhatsApp)</label>
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
              placeholder="55 62 99999-9999"
              className="w-full mt-1 mb-3 px-4 py-2.5 rounded-2xl text-[13px] text-[var(--text-hi)] placeholder:text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] outline-none focus:border-[var(--glass-border-strong)]" />
            <label className="text-[12px] text-[var(--text-low)] font-semibold">Primeira mensagem</label>
            <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} rows={3}
              placeholder="Olá! Aqui é..."
              className="w-full mt-1 mb-4 px-4 py-2.5 rounded-2xl text-[13px] text-[var(--text-hi)] placeholder:text-[var(--text-low)] bg-[var(--control-fill)] border border-[var(--hairline-strong)] outline-none focus:border-[var(--glass-border-strong)] resize-none" />
            {actionError && <p className="text-[12px] text-red-300 mb-3">{actionError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewConvo(false)} className="px-4 py-2 rounded-2xl text-[13px] font-semibold text-[var(--text-mid)] hover:text-[var(--text-hi)]">Cancelar</button>
              <button onClick={createConversation} disabled={creatingConvo || !newPhone.trim() || !newMessage.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-[13px] font-bold text-[var(--text-hi)] bg-violet-500/30 hover:bg-violet-500/40 disabled:opacity-40">
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

      {showDetails && selectedConv && (
        <TicketDetailsModal
          conversation={selectedConv}
          queues={queues}
          members={members}
          allTags={tags}
          newTagName={newTagName}
          onNewTagNameChange={setNewTagName}
          onCreateTag={createTag}
          onAssign={setAssign}
          onSetQueue={setQueue}
          onAddTag={addTagToConvo}
          onRemoveTag={removeTagFromConvo}
          onReopen={reopenConversation}
          reopening={reopening}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
}
