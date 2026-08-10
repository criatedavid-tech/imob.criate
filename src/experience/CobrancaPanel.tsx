import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, X, Bot, Clock, CalendarDays, Pencil, RotateCcw, AlertTriangle,
  Moon, ChevronDown, ChevronRight, Check, Eye, MessageSquare, UserCog, Zap,
} from 'lucide-react';
import { authService } from '../services/auth';
import { GlassCard } from './ui';

// Aba "Cobrança automática": responde, sem jargão, três perguntas —
//   1. A IA está mesmo cobrando por mim, agora?
//   2. Que mensagem ela manda, e em que dia?
//   3. O que exatamente vai sair nos próximos dias?
// A prévia e a agenda vêm renderizadas do backend, pelo MESMO código que envia.
// Assim o que aparece aqui não é "parecido com" o que o inquilino recebe: é
// igual, caractere por caractere.

async function api(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dayLabel = (offset: number) =>
  offset < 0 ? `${-offset} ${-offset === 1 ? 'dia' : 'dias'} antes`
    : offset === 0 ? 'No dia do vencimento'
      : `${offset} ${offset === 1 ? 'dia' : 'dias'} de atraso`;

const shortDay = (offset: number) => (offset < 0 ? `D${offset}` : offset === 0 ? 'D' : `D+${offset}`);

function dateLabel(iso: string, hoje: string) {
  if (iso === hoje) return 'Hoje';
  const d = new Date(`${iso}T12:00:00`);
  const txt = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

interface LadderStep {
  step: string;
  title: string;
  offset_days: number;
  enabled: boolean;
  body: string;
  is_default: boolean;
  min_offset: number;
  max_offset: number;
  can_disable: boolean;
  hands_over: boolean;
  preview: string;
}

interface ReguaData {
  passos: LadderStep[];
  variaveis: { key: string; label: string; example: string }[];
  exemplo: { inquilino: string; real: boolean };
  geracao_dias_antes: number;
  horario_silencio: { inicio: number; fim: number };
}

interface AgendaItem {
  data: string;
  tipo: 'mensagem' | 'geracao' | 'humano';
  contract_id: string;
  tenant_name: string;
  imovel: string;
  titulo: string;
  step: string;
  valor_cents: number;
  status: 'programado' | 'enviado' | 'simulado' | 'pausado' | 'bloqueado' | 'sem_telefone';
  mensagem: string;
}

interface AgendaData {
  hoje: string;
  dias_janela: number;
  simulando: boolean;
  truncado: boolean;
  ativo: {
    global: boolean;
    geracao_conta: boolean;
    regua_conta: boolean;
    contratos_ativos: number;
    contratos_no_piloto: number;
    horario_silencio: { inicio: number; fim: number };
  };
  dias: { data: string; itens: AgendaItem[] }[];
}

const STATUS_BADGE: Record<AgendaItem['status'], { label: string; className: string }> = {
  programado: { label: 'Programado', className: 'text-emerald-300 bg-emerald-500/12 border-emerald-400/25' },
  enviado: { label: 'Já enviado', className: 'text-[var(--text-low)] bg-[var(--control-fill)] border-[var(--hairline)]' },
  simulado: { label: 'Simulação', className: 'text-sky-300 bg-sky-500/10 border-sky-400/25' },
  pausado: { label: 'Pausado (promessa)', className: 'text-amber-300 bg-amber-500/12 border-amber-400/25' },
  bloqueado: { label: 'Desligado', className: 'text-[var(--text-low)] bg-[var(--control-fill)] border-[var(--hairline)]' },
  sem_telefone: { label: 'Sem telefone', className: 'text-red-300 bg-red-500/12 border-red-400/25' },
};

// ─── Balão da mensagem ──────────────────────────────────────────────────────
function MessageBubble({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <p className="text-[12px] text-[var(--text-low)] italic">
        Sem mensagem para o inquilino neste passo.
      </p>
    );
  }
  return (
    <div className="rounded-2xl rounded-tl-md px-3.5 py-2.5 bg-emerald-950/40 border border-emerald-400/20 max-w-[440px]">
      <p className="text-[12.5px] leading-relaxed text-[var(--text-hi)] whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}

// ─── Editor de um passo ─────────────────────────────────────────────────────
function StepEditor({ step, variables, onClose, onSaved }: {
  step: LadderStep;
  variables: ReguaData['variaveis'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(step.body);
  const [offset, setOffset] = useState(step.offset_days);
  const [enabled, setEnabled] = useState(step.enabled);
  const [preview, setPreview] = useState(step.preview);
  const [invalidVars, setInvalidVars] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Prévia sempre pelo backend: é a única forma de garantir que a tela e o
  // envio real usam a mesma regra de substituição.
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch('/api/locacao/regua/preview', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, offset_days: offset }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setPreview(d.texto);
          setInvalidVars(d.variaveis_invalidas || []);
        })
        .catch(() => {});
    }, 350);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [body, offset]);

  const insertVariable = (key: string) => {
    const area = areaRef.current;
    const token = `{{${key}}}`;
    if (!area) { setBody((b) => b + token); return; }
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async (reset = false) => {
    setSaving(true);
    setError('');
    try {
      await api('/api/locacao/regua', {
        method: 'PUT',
        body: JSON.stringify({
          passos: [reset
            ? { step: step.step, reset: true }
            : { step: step.step, body, offset_days: offset, enabled }],
        }),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-3xl max-h-[88vh] rounded-3xl bg-slate-900 border border-[var(--glass-border)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--hairline)] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-[var(--text-hi)]">{step.title}</h3>
            <p className="text-[11.5px] text-[var(--text-low)] mt-0.5">
              {step.hands_over
                ? 'Último passo da régua: avisa o inquilino e entrega a conversa para você.'
                : 'Mensagem enviada automaticamente no WhatsApp do inquilino.'}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-low)] hover:text-[var(--text-hi)] shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)] mb-1.5">
                Quando enviar
              </label>
              <div className="flex items-center gap-2">
                <input type="number" value={offset} disabled={step.min_offset === step.max_offset}
                  min={step.min_offset} max={step.max_offset}
                  onChange={(e) => setOffset(Math.trunc(Number(e.target.value)))}
                  className="w-24 px-3 py-2 rounded-xl bg-[var(--control-fill)] border border-[var(--hairline)] text-[13px] text-[var(--text-hi)] tabular-nums disabled:opacity-50" />
                <span className="text-[12.5px] text-[var(--text-mid)]">{dayLabel(offset)}</span>
              </div>
              <p className="text-[11px] text-[var(--text-low)] mt-1.5">
                {step.min_offset === step.max_offset
                  ? 'Este passo é sempre no dia do vencimento.'
                  : `Entre ${step.min_offset} e ${step.max_offset}. Negativo é antes do vencimento.`}
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)] mb-1.5">
                Este passo
              </label>
              <button onClick={() => step.can_disable && setEnabled(!enabled)} disabled={!step.can_disable}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-colors disabled:opacity-60 ${
                  enabled ? 'text-emerald-300 bg-emerald-500/15' : 'text-[var(--text-mid)] bg-[var(--control-fill-hover)]'
                }`}>
                {enabled ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                {enabled ? 'Ligado' : 'Desligado'}
              </button>
              <p className="text-[11px] text-[var(--text-low)] mt-1.5">
                {step.can_disable
                  ? 'Desligado, a IA pula direto para o próximo passo.'
                  : 'Não pode ser desligado: é a rede de segurança que traz o caso para você.'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)] mb-1.5">
              Mensagem
            </label>
            <textarea ref={areaRef} value={body} onChange={(e) => setBody(e.target.value)} rows={8}
              className="w-full px-3.5 py-3 rounded-2xl bg-[var(--control-fill)] border border-[var(--hairline)] text-[13px] text-[var(--text-hi)] leading-relaxed resize-y font-mono"
              placeholder={step.hands_over ? 'Deixe em branco para transferir sem avisar o inquilino.' : 'Escreva a mensagem…'} />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {variables.map((v) => (
                <button key={v.key} onClick={() => insertVariable(v.key)} title={v.label}
                  className="px-2 py-1 rounded-lg text-[10.5px] font-mono text-violet-200 bg-violet-500/12 border border-violet-400/20 hover:bg-violet-500/20 transition-colors">
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-low)] mt-2">
              Clique numa variável para inserir. Ela é trocada pelo dado real do inquilino na hora do envio.
              <strong className="text-[var(--text-mid)]"> {'{{pix}}'}</strong> e
              <strong className="text-[var(--text-mid)]"> {'{{boleto}}'}</strong> já vêm com o rótulo e somem
              sozinhas quando a cobrança não tiver esse dado.
            </p>
            {invalidVars.length > 0 && (
              <p className="text-[12px] text-amber-300 mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Variável inexistente: {invalidVars.map((v) => `{{${v}}}`).join(', ')} — vai sair vazia.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-low)] mb-2">
              Como o inquilino vai receber
            </label>
            <MessageBubble text={preview} />
          </div>

          {error && <p className="text-[12.5px] text-red-300">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[var(--hairline)] flex items-center justify-between gap-3">
          <button onClick={() => save(true)} disabled={saving || step.is_default}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-low)] hover:text-[var(--text-mid)] disabled:opacity-40">
            <RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-2xl text-[12.5px] font-bold text-[var(--text-mid)] hover:text-[var(--text-hi)]">
              Cancelar
            </button>
            <button onClick={() => save(false)} disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-[12.5px] font-bold text-[var(--text-hi)] bg-violet-600/70 border border-violet-400/25 hover:bg-violet-600/85 disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status: a IA está cobrando ou não? ─────────────────────────────────────
function StatusCard({ ativo, onToggle, saving }: {
  ativo: AgendaData['ativo'];
  onToggle: (field: 'charge_generation_enabled' | 'dunning_enabled', value: boolean) => void;
  saving: string | null;
}) {
  const comPiloto = ativo.contratos_no_piloto > 0;
  const tudoLigado = ativo.global && ativo.geracao_conta && ativo.regua_conta && comPiloto;

  const linhas = [
    {
      ok: ativo.global,
      titulo: 'Cobrança liberada na plataforma',
      detalhe: ativo.global ? 'Liberado para a sua conta.' : 'Ainda não liberado. Fale com o suporte da Criate.',
      acao: null as React.ReactNode,
    },
    {
      ok: ativo.geracao_conta,
      titulo: 'Gerar a cobrança do mês sozinha',
      detalhe: 'Emite o boleto com PIX antes do vencimento, sem você precisar lembrar.',
      acao: (
        <button onClick={() => onToggle('charge_generation_enabled', !ativo.geracao_conta)}
          disabled={(!ativo.global && !ativo.geracao_conta) || saving === 'charge_generation_enabled'}
          className={`shrink-0 px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors disabled:opacity-40 ${
            ativo.geracao_conta ? 'text-emerald-300 bg-emerald-500/15' : 'text-[var(--text-mid)] bg-[var(--control-fill-hover)]'
          }`}>
          {saving === 'charge_generation_enabled' ? '…' : ativo.geracao_conta ? 'Ligado' : 'Ligar'}
        </button>
      ),
    },
    {
      ok: ativo.regua_conta,
      titulo: 'Enviar as mensagens de cobrança',
      detalhe: 'É a régua abaixo. Sem isso a cobrança é gerada, mas ninguém é avisado.',
      acao: (
        <button onClick={() => onToggle('dunning_enabled', !ativo.regua_conta)}
          disabled={(!ativo.global && !ativo.regua_conta) || saving === 'dunning_enabled'}
          className={`shrink-0 px-3.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors disabled:opacity-40 ${
            ativo.regua_conta ? 'text-emerald-300 bg-emerald-500/15' : 'text-[var(--text-mid)] bg-[var(--control-fill-hover)]'
          }`}>
          {saving === 'dunning_enabled' ? '…' : ativo.regua_conta ? 'Ligado' : 'Ligar'}
        </button>
      ),
    },
    {
      ok: comPiloto,
      titulo: `Contratos no piloto: ${ativo.contratos_no_piloto} de ${ativo.contratos_ativos}`,
      detalhe: comPiloto
        ? 'Só estes recebem cobrança automática.'
        : 'Ligue contrato a contrato em "Imóveis alugados" → Diário e piloto.',
      acao: null,
    },
  ];

  return (
    <GlassCard className="!p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
          tudoLigado ? 'bg-emerald-500/15 border border-emerald-400/25' : 'bg-[var(--control-fill)] border border-[var(--hairline-strong)]'
        }`}>
          <Bot className={`w-5 h-5 ${tudoLigado ? 'text-emerald-300' : 'text-[var(--text-low)]'}`} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-black text-[var(--text-hi)]">
            {tudoLigado ? 'A IA está cobrando por você' : 'A IA ainda não está cobrando'}
          </h3>
          <p className="text-[12px] text-[var(--text-low)] mt-0.5">
            {tudoLigado
              ? `${ativo.contratos_no_piloto} contrato(s) no piloto automático. Veja abaixo o que sai e quando.`
              : 'Precisa das quatro chaves ligadas. Enquanto isso, nada é enviado sozinho.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {linhas.map((l) => (
          <div key={l.titulo} className="flex items-start justify-between gap-3 py-2 border-t border-[var(--hairline)] first:border-t-0">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className={`mt-0.5 w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[9px] font-black ${
                l.ok ? 'bg-emerald-500/25 text-emerald-300' : 'bg-[var(--control-fill-hover)] text-[var(--text-low)]'
              }`}>
                {l.ok ? '✓' : ''}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold text-[var(--text-hi)]">{l.titulo}</p>
                <p className="text-[11.5px] text-[var(--text-low)] leading-relaxed">{l.detalhe}</p>
              </div>
            </div>
            {l.acao}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Painel principal ───────────────────────────────────────────────────────
export function CobrancaTab() {
  const [regua, setRegua] = useState<ReguaData | null>(null);
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [editing, setEditing] = useState<LadderStep | null>(null);
  const [simular, setSimular] = useState(true);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [savingFlag, setSavingFlag] = useState<string | null>(null);
  const [savingStep, setSavingStep] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadAgenda = useCallback((sim: boolean) => {
    api(`/api/locacao/agenda?days=14&simular=${sim ? '1' : '0'}`)
      .then(setAgenda)
      .catch((e) => setError(e.message));
  }, []);

  const loadAll = useCallback((sim: boolean) => {
    setLoading(true);
    Promise.all([api('/api/locacao/regua'), api(`/api/locacao/agenda?days=14&simular=${sim ? '1' : '0'}`)])
      .then(([r, a]) => { setRegua(r); setAgenda(a); setError(''); })
      .catch((e) => setError(e.message || 'Não foi possível carregar a cobrança.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAll(simular); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const toggleFlag = async (field: 'charge_generation_enabled' | 'dunning_enabled', value: boolean) => {
    setSavingFlag(field);
    try {
      await api('/api/locacao/ai-settings', { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      loadAgenda(simular);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingFlag(null);
    }
  };

  const toggleStep = async (step: LadderStep) => {
    if (!regua || !step.can_disable || savingStep) return;
    const enabled = !step.enabled;
    const previous = regua;
    setSavingStep(step.step);
    setError('');
    // Resposta visual imediata; se a API falhar, restaura exatamente o estado
    // anterior. O backend continua sendo a fonte final da configuração.
    setRegua({ ...regua, passos: regua.passos.map((item) => (
      item.step === step.step ? { ...item, enabled } : item
    )) });
    try {
      await api('/api/locacao/regua', {
        method: 'PUT',
        body: JSON.stringify({ passos: [{ step: step.step, enabled }] }),
      });
      const [nextRegua, nextAgenda] = await Promise.all([
        api('/api/locacao/regua'),
        api(`/api/locacao/agenda?days=14&simular=${simular ? '1' : '0'}`),
      ]);
      setRegua(nextRegua);
      setAgenda(nextAgenda);
    } catch (e: any) {
      setRegua(previous);
      setError(e.message || 'Não foi possível alterar o envio desta mensagem.');
    } finally {
      setSavingStep(null);
    }
  };

  const totalProgramado = useMemo(
    () => (agenda?.dias || []).reduce((acc, d) => acc + d.itens.filter((i) => i.status === 'programado').length, 0),
    [agenda],
  );

  if (loading) {
    return <div className="flex justify-center pt-16"><Loader2 className="w-6 h-6 text-[var(--text-low)] animate-spin" /></div>;
  }

  if (error && !regua) {
    return <GlassCard className="!py-10 text-center"><p className="text-[14px] text-red-300">{error}</p></GlassCard>;
  }

  return (
    <div className="space-y-5">
      {agenda && <StatusCard ativo={agenda.ativo} onToggle={toggleFlag} saving={savingFlag} />}

      {/* ─── Régua ─── */}
      {regua && (
        <GlassCard className="!p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
            <h3 className="text-[14px] font-bold text-[var(--text-hi)]">A régua de cobrança</h3>
            <span className="text-[11px] text-[var(--text-low)] inline-flex items-center gap-1.5">
              <Moon className="w-3.5 h-3.5" />
              Nunca envia entre {regua.horario_silencio.inicio}h e {regua.horario_silencio.fim}h
            </span>
          </div>
          <p className="text-[12px] text-[var(--text-low)] mb-4 leading-relaxed">
            A cobrança do mês é emitida {regua.geracao_dias_antes} dias antes do vencimento. A partir daí a IA segue
            estes passos sozinha — e para na hora em que o inquilino paga ou promete uma data.
            {regua.exemplo.real
              ? ` As prévias abaixo usam os dados de ${regua.exemplo.inquilino}.`
              : ' As prévias usam um contrato de exemplo até você cadastrar o primeiro.'}
          </p>

          {/* Linha do tempo */}
          <div className="overflow-x-auto -mx-1 px-1 mb-4">
            <div className="flex items-center gap-0 min-w-max py-2">
              {regua.passos.map((p, i) => (
                <React.Fragment key={p.step}>
                  {i > 0 && <span className="w-8 h-px bg-[var(--hairline-strong)]" />}
                  <button onClick={() => setEditing(p)}
                    className="flex flex-col items-center gap-1 group"
                    title={`${p.title} — ${dayLabel(p.offset_days)}`}>
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-colors ${
                      !p.enabled ? 'bg-[var(--control-fill)] text-[var(--text-low)] border border-[var(--hairline)]'
                        : p.hands_over ? 'bg-red-500/15 text-red-300 border border-red-400/30'
                          : p.offset_days < 0 ? 'bg-sky-500/15 text-sky-300 border border-sky-400/30'
                            : p.offset_days === 0 ? 'bg-violet-500/15 text-violet-300 border border-violet-400/30'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-400/30'
                    } group-hover:scale-110`}>
                      {shortDay(p.offset_days)}
                    </span>
                    <span className="text-[9.5px] text-[var(--text-low)] max-w-[74px] text-center leading-tight">
                      {p.enabled ? p.title : 'desligado'}
                    </span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Cartões dos passos */}
          <div className="space-y-2">
            {regua.passos.map((p) => (
              <div key={p.step}
                className={`rounded-2xl border p-3.5 transition-colors ${
                  p.enabled ? 'border-[var(--hairline)] bg-[var(--control-fill)]' : 'border-[var(--hairline)] bg-black/10'
                }`}>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] font-bold text-[var(--text-hi)]">{p.title}</span>
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-[var(--text-mid)] bg-[var(--control-fill-hover)]">
                        {dayLabel(p.offset_days)}
                      </span>
                      {p.hands_over && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-red-300 bg-red-500/12 inline-flex items-center gap-1">
                          <UserCog className="w-3 h-3" /> passa para você
                        </span>
                      )}
                      {!p.is_default && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-violet-300 bg-violet-500/12">editado</span>
                      )}
                      {!p.enabled && (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold text-[var(--text-low)] bg-[var(--control-fill-hover)]">desligado</span>
                      )}
                    </div>
                    <p className="text-[12px] text-[var(--text-mid)] mt-1.5 line-clamp-2 whitespace-pre-wrap">
                      {p.enabled ? (p.preview || '— sem mensagem —') : 'Mensagem desativada para esta etapa.'}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center justify-between sm:justify-end gap-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={p.enabled}
                        aria-label={`${p.enabled ? 'Desativar' : 'Ativar'} mensagem: ${p.title}`}
                        title={p.can_disable
                          ? `${p.enabled ? 'Desativar' : 'Ativar'} o envio desta mensagem`
                          : 'Etapa obrigatória de entrega para uma pessoa'}
                        disabled={!p.can_disable || savingStep !== null}
                        onClick={() => toggleStep(p)}
                        className={`relative w-11 h-6 rounded-full border transition-colors disabled:cursor-not-allowed ${
                          p.enabled
                            ? 'bg-emerald-500/25 border-emerald-400/40'
                            : 'bg-[var(--control-fill-hover)] border-[var(--hairline-strong)]'
                        } ${!p.can_disable ? 'opacity-65' : ''}`}
                      >
                        {savingStep === p.step ? (
                          <Loader2 className="absolute w-3.5 h-3.5 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-[var(--text-hi)]" />
                        ) : (
                          <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full shadow-sm transition-all ${
                            p.enabled ? 'left-[24px] bg-emerald-200' : 'left-0.5 bg-[var(--text-low)]'
                          }`} />
                        )}
                      </button>
                      <span className={`text-[10.5px] font-bold whitespace-nowrap ${
                        p.enabled ? 'text-emerald-300' : 'text-[var(--text-low)]'
                      }`}>
                        {p.can_disable ? (p.enabled ? 'Envia' : 'Não envia') : 'Obrigatório'}
                      </span>
                    </div>
                    <button onClick={() => setEditing(p)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-[var(--text-mid)] bg-[var(--control-fill-hover)] hover:text-[var(--text-hi)] transition-colors">
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ─── Agenda ─── */}
      {agenda && (
        <GlassCard className="!p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
            <h3 className="text-[14px] font-bold text-[var(--text-hi)] inline-flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[var(--text-low)]" />
              Próximos {agenda.dias_janela} dias
            </h3>
            <label className="inline-flex items-center gap-2 text-[11.5px] text-[var(--text-mid)] cursor-pointer">
              <input type="checkbox" checked={simular}
                onChange={(e) => { setSimular(e.target.checked); loadAgenda(e.target.checked); }}
                className="accent-violet-500" />
              Incluir contratos fora do piloto (simulação)
            </label>
          </div>
          <p className="text-[12px] text-[var(--text-low)] mb-4">
            {totalProgramado > 0
              ? `${totalProgramado} envio(s) realmente programado(s).`
              : 'Nenhum envio programado — o que aparece abaixo é simulação.'}
            {' '}Clique num item para ler a mensagem exata.
          </p>

          {agenda.dias.length === 0 ? (
            <p className="text-[13px] text-[var(--text-low)] text-center py-10">
              Nada na agenda desta janela. Cobranças aparecem aqui a partir de {agenda.ativo.contratos_ativos > 0
                ? `${regua?.geracao_dias_antes ?? 5} dias antes do vencimento de cada contrato.`
                : 'quando houver contratos ativos.'}
            </p>
          ) : (
            <div className="space-y-4">
              {agenda.dias.map((dia) => (
                <div key={dia.data}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-bold text-[var(--text-hi)]">{dateLabel(dia.data, agenda.hoje)}</span>
                    <span className="text-[11px] text-[var(--text-low)]">
                      {dia.itens.length} {dia.itens.length === 1 ? 'item' : 'itens'}
                    </span>
                    <span className="flex-1 h-px bg-[var(--hairline)]" />
                  </div>

                  <div className="space-y-1.5">
                    {dia.itens.map((item, idx) => {
                      const key = `${dia.data}-${item.contract_id}-${item.step}-${idx}`;
                      const aberto = !!abertos[key];
                      const badge = STATUS_BADGE[item.status] || STATUS_BADGE.programado;
                      return (
                        <div key={key} className="rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill)] overflow-hidden">
                          <button onClick={() => setAbertos((cur) => ({ ...cur, [key]: !aberto }))}
                            className="w-full px-3.5 py-2.5 flex items-center gap-3 text-left hover:bg-[var(--control-fill-hover)] transition-colors">
                            {aberto ? <ChevronDown className="w-4 h-4 text-[var(--text-low)] shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-[var(--text-low)] shrink-0" />}
                            <span className="shrink-0">
                              {item.tipo === 'geracao' ? <Zap className="w-3.5 h-3.5 text-violet-300" />
                                : item.tipo === 'humano' ? <UserCog className="w-3.5 h-3.5 text-red-300" />
                                  : <MessageSquare className="w-3.5 h-3.5 text-sky-300" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12.5px] font-bold text-[var(--text-hi)] truncate">
                                {item.tenant_name}
                              </span>
                              <span className="block text-[11px] text-[var(--text-low)] truncate">
                                {item.titulo}{item.imovel ? ` · ${item.imovel}` : ''}
                              </span>
                            </span>
                            <span className="text-[12px] font-bold text-[var(--text-mid)] tabular-nums shrink-0 hidden sm:block">
                              {brl(item.valor_cents)}
                            </span>
                            <span className={`shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${badge.className}`}>
                              {badge.label}
                            </span>
                          </button>

                          {aberto && (
                            <div className="px-3.5 pb-3.5 pt-1 border-t border-[var(--hairline)]">
                              {item.tipo === 'geracao' ? (
                                <p className="text-[12px] text-[var(--text-mid)] mt-2">
                                  Nesta data o sistema emite o boleto com PIX de {brl(item.valor_cents)} e envia
                                  para o inquilino conforme a régua. Nenhuma mensagem é disparada neste passo.
                                </p>
                              ) : (
                                <div className="mt-2">
                                  <MessageBubble text={item.mensagem} />
                                  {item.tipo === 'humano' && (
                                    <p className="text-[11.5px] text-amber-300 mt-2 flex items-center gap-1.5">
                                      <AlertTriangle className="w-3.5 h-3.5" />
                                      Depois desta mensagem a IA para, e o caso vai para você.
                                    </p>
                                  )}
                                </div>
                              )}
                              <p className="text-[11px] text-[var(--text-low)] mt-2 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" />
                                {item.status === 'simulado'
                                  ? 'Este contrato está fora do piloto — não vai sair de verdade.'
                                  : item.status === 'pausado'
                                    ? 'Pausado: o inquilino prometeu uma data de pagamento.'
                                    : item.status === 'bloqueado'
                                      ? 'A régua está desligada na conta — nada é enviado.'
                                      : item.status === 'sem_telefone'
                                        ? 'O contrato não tem telefone do inquilino cadastrado.'
                                        : item.status === 'enviado'
                                          ? 'Este passo já foi enviado.'
                                          : `Sai neste dia, fora do horário de silêncio (${agenda.ativo.horario_silencio.inicio}h–${agenda.ativo.horario_silencio.fim}h).`}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {agenda.truncado && (
            <p className="text-[11.5px] text-amber-300 mt-4 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Mostrando apenas os primeiros itens da janela — há mais envios previstos.
            </p>
          )}
        </GlassCard>
      )}

      {error && regua && <p className="text-[12.5px] text-red-300">{error}</p>}

      {editing && regua && (
        <StepEditor step={editing} variables={regua.variaveis}
          onClose={() => setEditing(null)}
          onSaved={() => loadAll(simular)} />
      )}
    </div>
  );
}
