const ELECTRON_REMOTE_PREFIX = /^Error invoking remote method '[^']+': Error:\s*/u;

/** Removes Electron transport wording before an application error reaches the UI. */
export const normalizeDesktopGenAiError = (reason: unknown): Error => {
  const message = (reason instanceof Error ? reason.message : String(reason))
    .replace(ELECTRON_REMOTE_PREFIX, '')
    .trim();
  return new Error(message || 'The generation request failed.', { cause: reason });
};
