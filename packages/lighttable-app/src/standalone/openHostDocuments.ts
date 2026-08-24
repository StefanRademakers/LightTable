import type { LightTableHost } from '../platform/LightTableHost';
import type { DocumentSession } from '../lighttable/application/documents/documentSession';

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

/**
 * The standalone shell owns one renderer. Multi-open must therefore let each
 * newly active session publish before opening the next one; otherwise React
 * mounts only the final tab and earlier sessions remain permanently opening.
 */
export const waitForDocumentOpeningToSettle = (session: DocumentSession): Promise<void> => {
  if (session.getSnapshot().lifecycle !== 'opening') return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = session.subscribe(() => {
      if (session.getSnapshot().lifecycle === 'opening') return;
      unsubscribe();
      resolve();
    });
  });
};
