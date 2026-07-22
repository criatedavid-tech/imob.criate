export interface RecurringJob {
  name: string;
  intervalMs: number;
  runOnStart?: boolean;
  task: () => Promise<void>;
}

interface RecurringJobLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface RecurringJobRunnerOptions {
  shutdownTimeoutMs?: number;
  logger?: RecurringJobLogger;
}

export interface RecurringJobRunner {
  start: () => void;
  stop: () => Promise<boolean>;
  activeJobNames: () => string[];
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export function createRecurringJobRunner(
  jobs: RecurringJob[],
  options: RecurringJobRunnerOptions = {},
): RecurringJobRunner {
  const logger = options.logger || console;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const active = new Map<string, Promise<void>>();
  const timers: NodeJS.Timeout[] = [];
  let started = false;
  let stopping = false;

  for (const job of jobs) {
    if (!job.name.trim()) throw new Error("Job recorrente sem nome.");
    if (!Number.isFinite(job.intervalMs) || job.intervalMs < 1) {
      throw new Error(`Intervalo inválido para o job ${job.name}.`);
    }
  }
  if (new Set(jobs.map((job) => job.name)).size !== jobs.length) {
    throw new Error("Jobs recorrentes precisam de nomes únicos.");
  }

  function execute(job: RecurringJob): void {
    if (stopping) return;
    if (active.has(job.name)) {
      logger.warn(`[Scheduler] ${job.name} ainda está ativo; tick sobreposto ignorado.`);
      return;
    }

    const execution = Promise.resolve()
      .then(job.task)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[Scheduler] ${job.name} falhou: ${message}`);
      })
      .finally(() => {
        active.delete(job.name);
      });
    active.set(job.name, execution);
  }

  function start(): void {
    if (started) return;
    started = true;
    for (const job of jobs) {
      timers.push(setInterval(() => execute(job), job.intervalMs));
      if (job.runOnStart) execute(job);
      logger.info(`[Scheduler] ${job.name} ativo (tick ${job.intervalMs}ms).`);
    }
  }

  async function stop(): Promise<boolean> {
    if (stopping) return active.size === 0;
    stopping = true;
    for (const timer of timers) clearInterval(timer);

    const executions = [...active.values()];
    if (!executions.length) return true;

    let timeout: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.allSettled(executions).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), shutdownTimeoutMs);
        timeout.unref();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return drained;
  }

  return {
    start,
    stop,
    activeJobNames: () => [...active.keys()],
  };
}
