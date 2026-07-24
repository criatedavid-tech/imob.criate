import { useEffect, useRef } from 'react';

// Polling que não castiga o servidor.
//
// O padrão anterior (setInterval + fetch solto) tinha três defeitos que só
// aparecem em escala:
//  1. continuava rodando com a aba em segundo plano — e o corretor deixa o app
//     aberto o dia inteiro enquanto trabalha em outra aba. Esse é o caso
//     dominante, não a exceção: era a maior parte da carga, toda inútil.
//  2. as requisições EMPILHAVAM. Se o servidor ficasse lento, o intervalo
//     continuava disparando: quanto mais lento, mais requisições ele recebia
//     (exatamente o oposto do que se quer sob carga), e uma resposta atrasada
//     podia sobrescrever uma mais nova.
//  3. nada era cancelado ao desmontar/trocar de conversa.
//
// Aqui o próximo ciclo só é agendado DEPOIS que o anterior termina, a aba
// oculta pausa (e volta com refetch imediato) e cada ciclo recebe um
// AbortSignal.
export function usePolling(
  task: (signal: AbortSignal) => Promise<void> | void,
  intervalMs: number,
  enabled = true,
) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const schedule = (delay: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    };

    const run = async () => {
      if (stopped) return;
      // Aba oculta: não consulta e não reagenda. O listener de visibilidade
      // religa com uma execução imediata, então nada fica desatualizado quando
      // o usuário volta.
      if (isHidden()) return;
      controller?.abort();
      controller = new AbortController();
      try {
        await taskRef.current(controller.signal);
      } catch {
        /* o próprio ciclo trata; aqui só garantimos o reagendamento */
      }
      schedule(intervalMs);
    };

    const onVisibility = () => {
      if (isHidden()) {
        if (timer) clearTimeout(timer);
        controller?.abort();
      } else {
        schedule(0);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule(intervalMs);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
