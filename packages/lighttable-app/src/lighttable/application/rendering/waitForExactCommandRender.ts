import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';

export const waitForExactCommandRender = async (
  renderer: DocumentRendererPort | null,
  signal?: AbortSignal
) => {
  if (!renderer) return true;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (signal?.aborted) throw new DOMException('The command was canceled.', 'AbortError');
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (await renderer.waitForTextSourcesForExport()) return true;
  }
  // The command owner has already published the document and its undo entry.
  // A lagging derived render source must not turn that committed mutation into
  // an apparent command failure, because clients would retry the same edit.
  return false;
};
