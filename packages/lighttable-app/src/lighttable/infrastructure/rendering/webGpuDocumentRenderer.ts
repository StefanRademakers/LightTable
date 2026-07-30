import { WebGpuEngine } from '../../gpu/WebGpuEngine';
import type {
  DocumentRendererCallbacks,
  DocumentRendererScopeCanvases
} from '../../application/rendering/rendererTypes';

/**
 * Public, structural surface of the current document renderer.
 *
 * Keeping the concrete class behind this adapter prevents React/application
 * code from owning WebGPU construction. The surface is intentionally broad
 * during extraction and will shrink as tool operations move into application
 * commands.
 */
export type DocumentRendererPort = Omit<WebGpuEngine, never>;

export type WebGpuDocumentRendererFactory = (
  canvas: HTMLCanvasElement,
  callbacks?: DocumentRendererCallbacks,
  scopeCanvases?: DocumentRendererScopeCanvases
) => Promise<DocumentRendererPort>;

export const createWebGpuDocumentRenderer = (
  canvas: HTMLCanvasElement,
  callbacks: DocumentRendererCallbacks = {},
  scopeCanvases?: DocumentRendererScopeCanvases,
  createEngine: WebGpuDocumentRendererFactory = WebGpuEngine.create
): Promise<DocumentRendererPort> =>
  createEngine(canvas, callbacks, scopeCanvases);
