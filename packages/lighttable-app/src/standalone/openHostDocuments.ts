import type { LightTableHost } from '../platform/LightTableHost';

/**
 * File > Open prefers the host's multi-document picker while retaining the
 * single-file capability for older hosts. Place/import callers do not use this
 * helper and therefore remain intentionally single-file.
 */
export const openHostDocuments = async (host: LightTableHost): Promise<readonly File[]> => {
  if (host.openFiles) return host.openFiles();
  const file = await host.openFile?.();
  return file ? [file] : [];
};
