import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Loader2, User, Send, Bot, Archive, ArchiveRestore } from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

interface ConversationSummary {
  customer_phone: string;
  ai_active: boolean;
  conversation_status: 'open' | 'closed';
  last_message: string | null;
  last_message_from: 'customer' | 'ai' | 'broker_manual' | null;
  last_activity: string | null;
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
// é o Aberto/Pendente/Fechado do Z-PRO, é a pergunta que importa pro corretor:
// quem está com a bola agora. Nunca fica "sem dono" — é sempre IA ou você.
function categoryOf(c: ConversationSummary): Category {
  if (c.conversation_status === 'closed') return 'encerrado';
  return c.ai_active ? 'ia' : 'aguardando';
}

const CATEGORY_LABEL: Record<Category, string> = {
  ia: 'IA atendendo',
  aguardando: 'Aguardando você',
  encerrado: 'Encerrado',
};

// Conversas real — lista quem está falando com a IA agora, a thread de cada
// conversa, e permite responder manualmente / ligar-desligar a IA / encerrar.
// Envio (Fase 2) e entrada (Fase 4) precisam de um corretor com UAZAPI
// conectada pra funcionar de ponta a ponta — sem isso, a lista funciona mas
// responder/ligar a IA vai dar erro claro, não fingir sucesso.
export function ConversasArea() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [category, setCategory] = useState<Category>('aguardando');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const loadMessages = (phone: string) => {
    setLoadingMessages(true);
    fetch(`/api/conversas/${phone}/messages`, { headers: authService.getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setMessages(Array.isArray(data) ? data : []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false));
  };

  useEffect(() => {
    if (selected) loadMessages(selected);
  }, [selected]);

  const filtered = useMemo(
    () => (conversations || []).filter((c) => categoryOf(c) === category),
    [conversations, category]
  );
  const counts = useMemo(() => {
    const c: Record<Category, number> = { ia: 0, aguardando: 0, encerrado: 0 };
    for (const conv of conversations || []) c[categoryOf(conv)]++;
    return c;
  }, [conversations]);

  const selectedConv = conversations?.find((c) => c.customer_phone === selected) || null;

  const handleSend = async () => {
    if (!selected || !draft.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/conversas/${selected}/reply`, {
        method: 'POST',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao enviar.');
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
    if (!selected || !selectedConv) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/conversas/${selected}/ai-toggle`, {
        method: 'PATCH',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_active: !selectedConv.ai_active }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Falha ao mudar a IA.');
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao mudar a IA.');
    }
  };

  const toggleStatus = async () => {
    if (!selected || !selectedConv) return;
    const next = selectedConv.conversation_status === 'closed' ? 'open' : 'closed';
    setActionError(null);
    try {
      const res = await fetch(`/api/conversas/${selected}/status`, {
        method: 'PATCH',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_status: next }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Falha ao mudar o status.');
      loadConversations();
    } catch (e: any) {
      setActionError(e.message || 'Falha ao mudar o status.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full">
      <h2 className="text-2xl font-black text-white mb-6">Conversas</h2>

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
            <GlassCard className="!p-2 h-fit">
              {filtered.length === 0 ? (
                <p className="text-[13px] text-white/40 text-center py-8">Nada por aqui.</p>
              ) : (
                <div className="space-y-1">
                  {filtered.map((c) => (
                    <button
                      key={c.customer_phone}
                      onClick={() => setSelected(c.customer_phone)}
                      className={`w-full flex items-center gap-3 rounded-2xl p-3 text-left transition-colors ${
                        selected === c.customer_phone ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0
                        bg-gradient-to-br from-slate-500/40 to-slate-700/40 border border-white/15">
                        <User className="w-4 h-4 text-white/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[14px] font-semibold text-white truncate block">{c.customer_phone}</span>
                        <p className="text-[12px] text-white/45 truncate">{c.last_message || 'sem mensagens'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard className="!p-0 min-h-[440px] flex flex-col overflow-hidden">
              {!selected || !selectedConv ? (
                <div className="h-full flex-1 flex items-center justify-center text-white/40 text-[14px]">
                  Selecione uma conversa
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8">
                    <span className="text-[14px] font-semibold text-white">{selected}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={toggleAi}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
                          selectedConv.ai_active ? 'text-violet-200 bg-violet-500/15 hover:bg-violet-500/25' : 'text-amber-200 bg-amber-500/15 hover:bg-amber-500/25'
                        }`}>
                        <Bot className="w-3.5 h-3.5" /> {selectedConv.ai_active ? 'IA ligada' : 'IA pausada'}
                      </button>
                      <button onClick={toggleStatus}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors">
                        {selectedConv.conversation_status === 'closed'
                          ? <><ArchiveRestore className="w-3.5 h-3.5" /> Reabrir</>
                          : <><Archive className="w-3.5 h-3.5" /> Encerrar</>}
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 p-5 overflow-y-auto">
                    {loadingMessages || !messages ? (
                      <div className="flex justify-center pt-16">
                        <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
                      </div>
                    ) : messages.length === 0 ? (
                      <p className="text-white/40 text-[14px] text-center pt-16">Sem mensagens registradas.</p>
                    ) : (
                      <div className="space-y-3">
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
                      placeholder="Responder como você…"
                      className="flex-1 px-4 py-2.5 rounded-2xl text-[13px] text-white placeholder:text-white/30
                        bg-white/[0.06] border border-white/12 outline-none focus:border-white/25"
                    />
                    <button onClick={handleSend} disabled={sending || !draft.trim()}
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
    </div>
  );
}
