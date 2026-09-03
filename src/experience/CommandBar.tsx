import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, Loader2, Check, X, ArrowLeft, Paperclip, SquarePen, Mic, Square } from 'lucide-react';
import { authService } from '../services/auth';
import { PERSONA_LABEL } from './engine';
import type { Autonomy, Persona } from './types';

interface ProposedAction {
  type: string;
  [k: string]: any;
}

interface Turn {
  role: 'user' | 'ai';
  text: string;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'audio' | null;
  proposedAction?: ProposedAction;
  done?: boolean; // ação já confirmada/executada
}

// O navegador embutido de apps no Android (WebView do WhatsApp, Instagram,
// Facebook, etc.) não implementa o seletor de arquivo — `<input type="file">`
// vira um no-op silencioso e a galeria simplesmente não abre. O marcador
// "; wv)" no user agent identifica o WebView do Android; Chrome, Samsung
// Internet e Firefox de verdade não o trazem. No iOS o WebView implementa o
// seletor normalmente, então o desvio é só pro Android.
function isAndroidInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android/.test(ua) && /;\s*wv\)/.test(ua);
}

// Altura máxima do campo de mensagem antes de passar a rolar por dentro
// (~6 linhas em text-[14px]) — cresce com o texto até aqui, depois vira scroll
// interno em vez de empurrar o resto do painel pra fora da tela.
const MAX_INPUT_HEIGHT_PX = 144;

// Camada de comando REAL (Etapa 13): fala do corretor → agente no backend
// (POST /api/agent/command, OpenRouter) que responde, navega ou age sobre os
// endpoints que já existem. Autonomia é só o rótulo (piloto/copiloto/manual)
// — desde o hardening contra prompt injection (22/07/2026), toda mutação
// SEMPRE propõe e espera o "Confirmar", nos 3 modos igual (ver
// requiresHumanConfirmation em agentGuardrails.ts).
//
// Vive no verso do card-flip (ver ExperienceShell) — painel de tela cheia,
// não mais uma barra fixa por cima de toda página.
export function CommandBar({
  persona,
  autonomy,
  onNavigate,
  onActionDone,
  onClose,
}: {
  persona: Persona;
  autonomy: Autonomy;
  onNavigate: (area: string) => void;
  onActionDone: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmingIdx, setConfirmingIdx] = useState<number | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Textarea que cresce com o texto (até MAX_INPUT_HEIGHT_PX, depois rola por
  // dentro) — era um <input> de uma linha só, texto ditado/longo ficava
  // ilegível porque só rolava na horizontal em vez de quebrar linha.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [value]);

  // O chat é desmontado toda vez que fecha (ver ExperienceShell) e o estado
  // era só local — fechar/reabrir, ou recarregar a página, apagava tudo.
  // Agora recarrega o que já foi conversado assim que abre.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/history', { headers: authService.getAuthHeaders() });
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data)) setTurns(data);
      } catch {
        // silencioso — sem histórico prévio não é erro, é chat novo
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // "Nova conversa" — apaga o histórico salvo (não tem tela pra navegar entre
  // conversas antigas, então manter apagado só no front reapareceria tudo de
  // novo na próxima vez que abrir o chat) e limpa a tela.
  const startNewConversation = async () => {
    if (clearingHistory || busy) return;
    setClearingHistory(true);
    try {
      const res = await fetch('/api/agent/history', { method: 'DELETE', headers: authService.getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Não consegui limpar o histórico agora.');
      setTurns([]);
    } catch (error: any) {
      // Se existir uma ação em execução, o backend preserva o contexto para
      // impedir duplicidade. Nesse caso a tela também não pode fingir que
      // apagou: mantém os turnos e mostra o motivo recebido.
      setTurns((cur) => [...cur, { role: 'ai', text: error?.message || 'Não consegui limpar o histórico agora.' }]);
    } finally {
      setClearingHistory(false);
    }
  };

  // Fotos anexadas na conversa — sobem pro Storage assim que escolhidas
  // (mesmo padrão do PropertyForm.tsx), guardamos só as URLs públicas.
  // Vão junto na próxima mensagem enviada; o backend anexa mecanicamente
  // a um create_property, se for o caso — a IA nunca "vê" a imagem.
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Remonta o <input type="file"> transparente após cada uso (ver key no
  // JSX). No iOS, depois que você abre o seletor de foto uma vez, o WebKit
  // retém foco/prioridade de toque no controle nativo — o toque SEGUINTE,
  // mesmo no botão de microfone ao lado, era roteado de volta pro seletor
  // de foto (abria a galeria em vez de gravar). Por isso só quebrava DEPOIS
  // de anexar uma foto (sem foto o input nunca foi tocado). Trocar a key
  // descarta o nó DOM antigo com o estado preso e cria um limpo.
  const [fileInputResetKey, setFileInputResetKey] = useState(0);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 800;
          let { width, height } = img;
          if (width > height) {
            if (width > MAX) { height = Math.round((height *= MAX / width)); width = MAX; }
          } else if (height > MAX) {
            width = Math.round((width *= MAX / height)); height = MAX;
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
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    // Recria o input (ver fileInputResetKey) pra soltar o foco/prioridade de
    // toque que o iOS prende no controle nativo depois de abrir a galeria —
    // senão o próximo toque no microfone reabre a galeria. Os arquivos já
    // foram lidos em `files` acima, então remontar aqui não perde nada.
    setFileInputResetKey((k) => k + 1);
    if (!files.length) return;
    if (attachedImages.length + files.length > 15) {
      pushTurn({ role: 'ai', text: 'Você pode anexar no máximo 15 fotos por vez.' });
      return;
    }
    files.forEach(async (file) => {
      setUploadingCount((c) => c + 1);
      try {
        const compressed = await compressImage(file);
        const res = await fetch('/api/properties/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
          body: JSON.stringify({ imageData: compressed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Falha ao enviar a imagem.');
        setAttachedImages((cur) => [...cur, data.url]);
      } catch (err: any) {
        pushTurn({ role: 'ai', text: err.message || 'Não consegui enviar uma das fotos.' });
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    });
  };

  const removeAttachedImage = (idx: number) => {
    setAttachedImages((cur) => cur.filter((_, i) => i !== idx));
  };

  // Botão de microfone — grava com MediaRecorder (funciona em qualquer
  // navegador/celular, diferente da Web Speech API que não existe no
  // Firefox/Safari) e manda o áudio pro backend só pra virar texto
  // (POST /api/ai/transcribe). O texto cai no campo de digitação pra você
  // revisar antes de enviar — nunca manda a mensagem sozinho.
  const micSupported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    if (recording || transcribing || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
        .find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        setTranscribing(true);
        try {
          const audioData: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const res = await fetch('/api/ai/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
            body: JSON.stringify({ audioData, mimeType: blob.type }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'Não consegui transcrever o áudio.');
          if (data.text) {
            setValue((cur) => (cur ? `${cur} ${data.text}` : data.text));
            inputRef.current?.focus();
          } else {
            pushTurn({ role: 'ai', text: 'Não consegui entender o áudio. Pode tentar de novo ou digitar?' });
          }
        } catch (err: any) {
          pushTurn({ role: 'ai', text: err.message || 'Não consegui transcrever o áudio.' });
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      pushTurn({ role: 'ai', text: 'Não consegui acessar o microfone — verifique a permissão no navegador.' });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const pushTurn = (t: Turn) => setTurns((cur) => [...cur.slice(-8), t]);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy || uploadingCount > 0 || recording || transcribing) return;
    // Histórico ANTES de empurrar o turno atual — o backend só precisa do que
    // já aconteceu antes desta mensagem, senão a IA esquece o que foi dito
    // 1 pergunta atrás (ex.: nome do cliente antes da data da visita).
    const history = turns.map(({ role, text }) => ({ role, text }));
    const imageUrls = attachedImages;
    setValue('');
    setAttachedImages([]);
    pushTurn({ role: 'user', text: imageUrls.length ? `${v}\n📎 ${imageUrls.length} foto(s) anexada(s)` : v });
    setBusy(true);
    try {
      const res = await fetch('/api/agent/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ message: v, persona, autonomy, history, imageUrls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao falar com a IA.');

      // @reset apaga o historico compartilhado no backend. Remove tambem o
      // turno otimista que foi colocado na tela antes da resposta chegar.
      if (data.reset) {
        setTurns([]);
        return;
      }

      pushTurn({
        role: 'ai',
        text: data.executed ? `${data.reply}\n✓ ${data.executed}` : data.reply,
        proposedAction: data.proposedAction,
      });

      if (data.navigate) onNavigate(data.navigate);
      if (data.refresh) onActionDone();
    } catch (e: any) {
      pushTurn({ role: 'ai', text: e.message || 'Erro ao falar com a IA.' });
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async (idx: number, action: ProposedAction) => {
    setConfirmingIdx(idx);
    try {
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Não consegui concluir.');
      setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, done: true, proposedAction: undefined, text: `${t.text}\n✓ ${data.executed}` } : t)));
      if (data.navigate) onNavigate(data.navigate);
      if (data.refresh) onActionDone();
    } catch (e: any) {
      setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, text: `${t.text}\n✗ ${e.message}` } : t)));
    } finally {
      setConfirmingIdx(null);
    }
  };

  const dismissAction = (idx: number) => {
    setTurns((cur) => cur.map((t, i) => (i === idx ? { ...t, proposedAction: undefined, text: `${t.text}\n(cancelado)` } : t)));
  };

  return (
    <div className="flex flex-col h-full w-full app-bg">
      {/* Cabeçalho — voltar fecha o chat. Sem backdrop-blur: o fundo do chat é
          um gradiente opaco, então o blur não teria efeito visível e só custaria
          GPU (peso desnecessário no mobile). */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-[var(--hairline)] bg-[var(--control-fill)]">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-mid)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-colors shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-4.5 h-4.5" />
        </button>
        {/* Mesma marca e mesmo vidro do rail e do botão flutuante: o agente É o
            PANTUS. Antes era um gradiente violeta com glifo genérico — fora da
            paleta azul/ciano da marca. */}
        <div className="cr-glass-accent relative w-8 h-8 rounded-xl flex items-center justify-center shrink-0 p-1.5">
          <span aria-hidden="true" className="cr-brand-mark w-full h-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-[var(--text-hi)] leading-tight">Assistente IA</p>
          <p className="text-[11px] text-[var(--text-low)] leading-tight truncate">{PERSONA_LABEL[persona]}</p>
        </div>
        <button
          onClick={startNewConversation}
          disabled={clearingHistory || busy || (turns.length === 0 && !loadingHistory)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-mid)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)] transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Nova conversa"
          title="Nova conversa"
        >
          {clearingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <SquarePen className="w-4 h-4" />}
        </button>
      </div>

      {/* Histórico */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {turns.length === 0 && !busy && !loadingHistory && (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div>
              {/* O estado vazio usa o mesmo selo do cabeçalho: além de reforçar
                  a identidade do agente, mantém o olho legível no modo Dia. */}
              <div className="cr-glass-accent cr-glass-accent-quiet relative w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 p-3">
                <span aria-hidden="true" className="cr-brand-mark w-full h-full" />
              </div>
              <p className="text-[14px] text-[var(--text-low)] max-w-xs mx-auto">
                Pergunte qualquer coisa ou peça pra eu fazer algo — ex: <em>"cadastra a Maria 62999998888 no apê centro"</em> ou <em>"quantos leads eu tenho?"</em>
              </p>
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] whitespace-pre-line ${
              t.role === 'user'
                ? 'bg-violet-500/25 border border-violet-300/25 text-[var(--text-hi)]'
                : 'bg-[var(--control-fill)] border border-[var(--hairline)] text-[var(--text-hi)]/85'
            }`}>
              {t.mediaUrl && t.mediaType === 'image' && (
                <a href={t.mediaUrl} target="_blank" rel="noreferrer" className="block mb-1.5">
                  <img
                    src={t.mediaUrl}
                    alt="Foto enviada ao Assistente IA"
                    loading="lazy"
                    className="max-h-72 max-w-full rounded-xl object-contain"
                  />
                </a>
              )}
              {t.mediaUrl && t.mediaType === 'audio' && (
                <audio src={t.mediaUrl} controls preload="none" className="mb-1.5 max-w-full w-64" />
              )}
              {t.text && !(t.mediaUrl && t.mediaType === 'image' && /^\[(Foto|Imagem)\]$/.test(t.text)) && t.text}
            </div>
            {t.proposedAction && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => confirmAction(i, t.proposedAction!)}
                  disabled={confirmingIdx === i}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold text-[var(--text-hi)]
                    bg-emerald-500/25 border border-emerald-300/30 hover:bg-emerald-500/40 transition-colors disabled:opacity-50"
                >
                  {confirmingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Confirmar
                </button>
                <button
                  onClick={() => dismissAction(i)}
                  disabled={confirmingIdx === i}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-[var(--text-mid)]
                    bg-[var(--control-fill)] border border-[var(--hairline)] hover:bg-[var(--control-fill-hover)] transition-colors disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" /> Cancelar
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-low)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> pensando…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-5 pb-5 pt-2">
        {(attachedImages.length > 0 || uploadingCount > 0) && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {attachedImages.map((url, i) => (
              <div key={url} className="relative w-12 h-12 rounded-lg overflow-hidden border border-[var(--glass-border)] shrink-0">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => removeAttachedImage(i)}
                  className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-black/60 text-[var(--text-hi)]"
                  aria-label="Remover foto"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            {uploadingCount > 0 && (
              <div className="w-12 h-12 rounded-lg flex items-center justify-center border border-[var(--glass-border)] bg-[var(--control-fill)] shrink-0">
                <Loader2 className="w-4 h-4 text-[var(--text-low)] animate-spin" />
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 rounded-[22px] px-3 py-2.5
          bg-[var(--control-fill)] border border-[var(--glass-border)]
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_16px_40px_-12px_rgba(0,0,0,0.6)]">
          {/* Anexar foto: o input de arquivo fica TRANSPARENTE POR CIMA do
              ícone (absolute inset-0, opacity-0) — o toque cai direto no
              próprio input, a ativação mais nativa que existe. Formas
              indiretas falharam no Android Chrome real em teste de campo:
              botão chamando .click() programático e label com input
              display:none (Android Chrome não abre o seletor de input
              display:none nem via label). Aqui não há display:none, label
              nem .click() — nada entre o dedo e o input.
              ⚠️ overflow-hidden é OBRIGATÓRIO neste wrapper: no iOS o
              controle nativo do input file ("Choose File" + nome do
              arquivo) tem largura intrínseca (~110px+) que o WebKit NÃO
              encolhe pra caber nos 32px — sem o clip, o excedente
              invisível transborda por cima do botão de microfone ao lado
              e captura o toque dele (abria a galeria em vez de gravar;
              bug real num iPhone 11, ~6 de 7 toques no mic). O clip corta
              pintura E hit-test no limite da caixa. */}
          <div
            className={`relative overflow-hidden w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              busy || recording || transcribing
                ? 'text-[var(--text-low)]'
                : 'text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)]'
            }`}
            title="Anexar foto"
          >
            <Paperclip className="w-4 h-4" />
            <input
              key={fileInputResetKey}
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={busy || recording || transcribing}
              onChange={handleFileChange}
              onClick={(e) => {
                // Navegador embutido do WhatsApp (Android) não implementa o
                // seletor de arquivo — explica em vez de um toque sem efeito.
                if (isAndroidInAppBrowser()) {
                  e.preventDefault();
                  pushTurn({
                    role: 'ai',
                    text: 'Pra anexar fotos, abra o app no Chrome: toque nos três pontinhos (⋮) aqui no topo e escolha "Abrir no Chrome". O navegador de dentro do WhatsApp não deixa selecionar arquivos.',
                  });
                }
              }}
              aria-label="Anexar foto"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed file:cursor-pointer"
            />
          </div>
          {micSupported && (
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={busy || transcribing}
              title={recording ? 'Parar gravação' : 'Falar por voz'}
              // relative z-10: defesa extra contra o transbordo do input file
              // ao lado (ver comentário do wrapper acima) — posicionado com
              // z-index pinta e recebe toque ACIMA do input, mesmo se algum
              // engine ainda vazar hit-area além do overflow-hidden.
              className={`relative z-10 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 ${
                recording ? 'text-red-300 bg-red-500/20 animate-pulse' : 'text-[var(--text-low)] hover:text-[var(--text-hi)] hover:bg-[var(--control-fill-hover)]'
              }`}
              aria-label={recording ? 'Parar gravação' : 'Falar por voz'}
            >
              {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Enter sozinho envia (igual ao input de antes); Shift+Enter
              // quebra linha — senão dá pra crescer o texto mas nunca revisar
              // antes de mandar sem querer no meio de uma frase.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={busy}
            rows={1}
            placeholder={recording ? 'Gravando… fale sua mensagem' : transcribing ? 'Transcrevendo áudio…' : 'Fale com a IA…  ex: cadastra a Maria 62999998888 no apê centro'}
            className="flex-1 bg-transparent outline-none resize-none text-[14px] text-[var(--text-hi)] placeholder:text-[var(--text-low)] disabled:opacity-60 py-1 leading-snug"
            style={{ maxHeight: MAX_INPUT_HEIGHT_PX, overflowY: 'auto' }}
          />
          <button onClick={submit} disabled={busy || uploadingCount > 0 || recording || transcribing}
            title={uploadingCount > 0 ? 'Aguarde as fotos terminarem de enviar' : transcribing ? 'Aguarde a transcrição terminar' : undefined}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-[var(--text-hi)]
              bg-violet-500/40 border border-violet-300/30 hover:bg-violet-500/60 transition-colors disabled:opacity-50">
            {busy || uploadingCount > 0 || transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
