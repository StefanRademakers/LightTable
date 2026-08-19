/**
 * Waits without retaining an AbortSignal listener after the delay settles.
 * Provider polling reuses one signal for many waits, so `{ once: true }` alone
 * is insufficient: it removes the listener only when abort actually fires.
 */
export const abortableDelay = (
  durationMs: number,
  signal?: AbortSignal
): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }

  let settled = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const cleanup = () => {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
    signal?.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(signal?.reason);
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
    return;
  }
  timer = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  }, durationMs);
});
