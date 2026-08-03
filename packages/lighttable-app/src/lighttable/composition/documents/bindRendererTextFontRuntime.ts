import type { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import type { TextFontRuntimePort } from '../../text/rendering/TextLayerRenderCoordinator';

/** Keeps a published renderer attached to the current document-owned font port. */
export const bindRendererTextFontRuntime = (
  lifecycle: DocumentRendererLifecycle,
  getRenderer: () => DocumentRendererPort | null,
  port: TextFontRuntimePort
) => {
  const synchronize = () => {
    const status = lifecycle.getSnapshot().status;
    if (status === 'ready' || status === 'suspended') {
      getRenderer()?.configureTextFonts(port);
    }
  };
  synchronize();
  return lifecycle.subscribe(synchronize);
};
