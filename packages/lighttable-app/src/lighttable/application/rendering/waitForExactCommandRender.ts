import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';

export const waitForExactCommandRender = async (
  renderer: DocumentRendererPort | null,
  signal?: AbortSignal
) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (signal?.aborted) throw new DOMException('The command was canceled.', 'AbortError');
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (await renderer?.waitForTextSourcesForExport()) return;
  }
  throw new Error('The exact command render did not settle.');
};
