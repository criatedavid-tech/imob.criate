const ASSET_RECOVERY_KEY = 'imobiflow:asset-recovery-at';
const ASSET_RECOVERY_WINDOW_MS = 60_000;

function errorMessage(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message || '');
  }
  return '';
}

/** Erros emitidos quando uma aba antiga tenta baixar um chunk removido. */
export function isStaleAssetError(value: unknown): boolean {
  return /(?:ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|module script.*MIME type.*text\/html)/i
    .test(errorMessage(value));
}

export function shouldAttemptStaleAssetRecovery(value: unknown, lastAttemptAt: number, now = Date.now()): boolean {
  return isStaleAssetError(value) && (!Number.isFinite(lastAttemptAt) || now - lastAttemptAt >= ASSET_RECOVERY_WINDOW_MS);
}

/** Faz no máximo uma recarga automática por minuto, evitando loop infinito. */
export function attemptStaleAssetRecovery(value: unknown): boolean {
  if (typeof window === 'undefined' || !isStaleAssetError(value)) return false;

  let lastAttemptAt = 0;
  try {
    lastAttemptAt = Number(window.sessionStorage.getItem(ASSET_RECOVERY_KEY) || 0);
  } catch {
    // Safari em modo privado pode recusar storage; a recarga ainda é segura.
  }

  if (!shouldAttemptStaleAssetRecovery(value, lastAttemptAt)) return false;

  try {
    window.sessionStorage.setItem(ASSET_RECOVERY_KEY, String(Date.now()));
  } catch {
    // A ausência de storage não deve impedir a recuperação da aplicação.
  }
  window.location.reload();
  return true;
}

export function extractEntryModulePath(html: string): string | null {
  const tag = html.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i)?.[0];
  if (!tag) return null;
  return tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || null;
}

function normalizeAssetPath(value: string): string {
  try {
    return new URL(value, window.location.origin).pathname;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

/** Atualiza uma aba suspensa antes que ela tente abrir um chunk removido. */
async function reloadIfClientVersionChanged(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || document.visibilityState !== 'visible') {
    return false;
  }

  const currentModule = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if (!currentModule) return false;

  try {
    const response = await fetch(`/app?__imobiflow_version=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return false;

    const latestModule = extractEntryModulePath(await response.text());
    if (!latestModule || normalizeAssetPath(currentModule) === normalizeAssetPath(latestModule)) return false;

    window.location.reload();
    return true;
  } catch {
    // Falha de rede ao acordar a aba não deve derrubar a interface atual.
    return false;
  }
}

export function installAppRecovery(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.addEventListener('vite:preloadError', ((event: Event & { payload?: unknown }) => {
    event.preventDefault();
    attemptStaleAssetRecovery(event.payload || 'Failed to fetch dynamically imported module');
  }) as EventListener);

  window.addEventListener('unhandledrejection', (event) => {
    if (!isStaleAssetError(event.reason)) return;
    event.preventDefault();
    attemptStaleAssetRecovery(event.reason);
  });

  const checkVersion = () => {
    if (document.visibilityState === 'visible') void reloadIfClientVersionChanged();
  };
  document.addEventListener('visibilitychange', checkVersion);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void reloadIfClientVersionChanged();
  });
}
