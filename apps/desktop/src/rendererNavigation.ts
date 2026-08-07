export interface RendererNavigationTarget {
  loadURL(url: string): Promise<unknown>;
}

export interface RendererNavigationOptions {
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly onRetry?: (attempt: number, reason: unknown) => void;
}

const navigationWasSuperseded = (reason: unknown): boolean =>
  reason instanceof Error && reason.message.includes('ERR_ABORTED');

const defaultWait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function loadRendererUrlWithRetry(
  target: RendererNavigationTarget,
  url: string,
  {
    attempts = 4,
    retryDelayMs = 75,
    wait = defaultWait,
    onRetry
  }: RendererNavigationOptions = {}
): Promise<'loaded' | 'superseded'> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Renderer navigation attempts must be a positive integer.');
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await target.loadURL(url);
      return 'loaded';
    } catch (reason) {
      if (navigationWasSuperseded(reason)) return 'superseded';
      if (attempt === attempts) throw reason;
      onRetry?.(attempt, reason);
      await wait(retryDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw new Error('Renderer navigation exhausted without a result.');
}
