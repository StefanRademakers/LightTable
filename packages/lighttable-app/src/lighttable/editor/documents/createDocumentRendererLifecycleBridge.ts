import type { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import { guardDocumentRendererCallbacks } from '../../application/rendering/guardDocumentRendererCallbacks';
import type {
  DocumentRendererCallbacks,
  DocumentRendererScopeCanvases
} from '../../application/rendering/rendererTypes';
import type { DocumentStartupTelemetry } from '../../application/telemetry/documentStartupTelemetry';
import type { LightTableStartupTimings } from '../../application/telemetry/editorTelemetry';
import type { WebGpuScopeOptions } from '../../gpu/WebGpuScopeEngine';

export interface EditorDocumentRenderer {
  setActive(active: boolean): void;
  setLensBlurDepthVisualization(enabled: boolean): void;
  setScopeOptions(
    histogramVisible: boolean,
    options: WebGpuScopeOptions
  ): void;
  initializeScopes(canvases: DocumentRendererScopeCanvases): Promise<void>;
}

export interface DocumentRendererLifecycleBridgeOptions<
  Renderer extends EditorDocumentRenderer
> {
  readonly isCurrent: () => boolean;
  readonly telemetry: DocumentStartupTelemetry;
  readonly lifecycle: DocumentRendererLifecycle;
  readonly scopeCanvases: DocumentRendererScopeCanvases;
  readonly getScopeOptions: () => {
    readonly histogramVisible: boolean;
    readonly options: WebGpuScopeOptions;
  };
  readonly publishHistogram: NonNullable<DocumentRendererCallbacks['onHistogram']>;
  readonly publishGpuMemory: (bytes: number) => void;
  readonly publishError: (message: string) => void;
  readonly publishScopeError: (message: string) => void;
  readonly publishFeatureError: (featureId: string, message: string) => void;
  readonly publishTimings: (timings: LightTableStartupTimings) => void;
  readonly publishLoading: (loading: boolean) => void;
  readonly logTimings?: (timings: LightTableStartupTimings) => void;
}

export interface DocumentRendererLifecycleBridge<
  Renderer extends EditorDocumentRenderer
> {
  readonly callbacks: DocumentRendererCallbacks;
  onRendererReady(renderer: Renderer, elapsedMs: number): void;
  onRendererDiscarded(renderer: Renderer): void;
  onSourceReady(elapsedMs: number): void;
  onFailed(error: Error): void;
  onSettled(): void;
}

/**
 * Adapts a document renderer generation to editor presentation ports.
 *
 * It is intentionally React-free. Every callback is guarded by the owning
 * document generation and deferred scope startup is attached to the renderer
 * that produced the first frame.
 */
export const createDocumentRendererLifecycleBridge = <
  Renderer extends EditorDocumentRenderer
>(
  options: DocumentRendererLifecycleBridgeOptions<Renderer>
): DocumentRendererLifecycleBridge<Renderer> => {
  let renderer: Renderer | null = null;

  const callbacks = guardDocumentRendererCallbacks(options.isCurrent, {
    onHistogram: options.publishHistogram,
    onGpuMemoryEstimate: (bytes) => {
      options.publishGpuMemory(bytes);
      options.lifecycle.setMemoryEstimate(bytes);
    },
    onDeviceLost: (message) => {
      options.publishError(message);
      options.lifecycle.markFailed(
        options.lifecycle.getSnapshot().generation,
        message
      );
    },
    onScopeError: options.publishScopeError,
    onFeatureError: options.publishFeatureError,
    onFirstFrame: () => {
      const completed = options.telemetry.completeFirstFrame();
      if (!completed || !renderer) return;
      options.publishTimings(completed);
      options.logTimings?.(completed);
      const scopeStartedAt = options.telemetry.beginDeferredScopes();
      const scopeOptions = options.getScopeOptions();
      renderer.setScopeOptions(
        scopeOptions.histogramVisible,
        scopeOptions.options
      );
      void renderer.initializeScopes(options.scopeCanvases).then(() => {
        if (!options.isCurrent()) return;
        options.publishTimings(
          options.telemetry.completeDeferredScopes(scopeStartedAt)
        );
      });
    }
  });

  return {
    callbacks,
    onRendererReady: (createdRenderer, elapsedMs) => {
      renderer = createdRenderer;
      options.telemetry.rendererReady(elapsedMs);
      createdRenderer.setActive(options.lifecycle.getSnapshot().active);
      createdRenderer.setLensBlurDepthVisualization(false);
      const scopeOptions = options.getScopeOptions();
      createdRenderer.setScopeOptions(false, scopeOptions.options);
    },
    onRendererDiscarded: (discardedRenderer) => {
      if (renderer === discardedRenderer) renderer = null;
    },
    onSourceReady: (elapsedMs) => {
      options.telemetry.sourceReady(elapsedMs);
    },
    onFailed: (failure) => {
      if (options.isCurrent()) {
        options.publishError(
          failure.message || 'LightTable could not be initialized.'
        );
      }
    },
    onSettled: () => {
      if (options.isCurrent()) options.publishLoading(false);
    }
  };
};
