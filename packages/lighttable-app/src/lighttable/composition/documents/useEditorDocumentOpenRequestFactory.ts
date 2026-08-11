import { useCallback, type RefObject } from 'react';
import type {
  DocumentOpenLifecycleContext
} from '../../application/documents/useDocumentOpenLifecycle';
import type {
  DocumentOpenRequest
} from '../../application/documents/documentOpenController';
import {
  resolveDocumentSource,
  type DocumentSourceLoader
} from '../../application/documents/resolveDocumentSource';
import type { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import type {
  DocumentRendererCallbacks
} from '../../application/rendering/rendererTypes';
import type { DocumentTaskContext } from '../../application/tasks/documentTaskRegistry';
import type { DocumentStartupTelemetry } from '../../application/telemetry/documentStartupTelemetry';
import type { LightTableStartupTimings } from '../../application/telemetry/editorTelemetry';
import type { RgbHistogram } from '../../types';
import type { WebGpuScopeOptions } from '../../gpu/WebGpuScopeEngine';
import {
  createWebGpuDocumentRenderer,
  type DocumentRendererPort
} from '../../infrastructure/rendering/webGpuDocumentRenderer';
import {
  createDocumentRendererLifecycleBridge
} from '../../editor/documents/createDocumentRendererLifecycleBridge';
import {
  createEditorDocumentOpenRequest
} from '../../editor/documents/createEditorDocumentOpenRequest';
import {
  resolveEditorDocumentCanvases,
  type EditorDocumentScopeCanvasRefs
} from './resolveEditorDocumentCanvases';
import type { TextFontRuntimePort } from '../../text/rendering/TextLayerRenderCoordinator';

export interface EditorDocumentOpenRequestFactoryOptions {
  readonly canvases: EditorDocumentScopeCanvasRefs;
  readonly rendererRef: RefObject<DocumentRendererPort | null>;
  readonly rendererLifecycle: DocumentRendererLifecycle;
  readonly textFontRuntimePort: TextFontRuntimePort;
  readonly telemetryRef: RefObject<DocumentStartupTelemetry>;
  readonly source: {
    readonly inlineSource: Blob | null;
    readonly projectId: string;
    readonly sourceFileKey: string | null;
    readonly loadSource?: DocumentSourceLoader;
  };
  readonly getScopeOptions: () => {
    readonly histogramVisible: boolean;
    readonly options: WebGpuScopeOptions;
  };
  readonly hydrate: (
    renderer: DocumentRendererPort,
    source: Blob,
    task: DocumentTaskContext,
    isCurrent: () => boolean
  ) => Promise<void>;
  readonly publishHistogram: (histogram: RgbHistogram) => void;
  readonly publishGpuMemory: (bytes: number) => void;
  readonly publishTextRenderPresentation?: NonNullable<DocumentRendererCallbacks['onTextRenderPresentation']>;
  readonly publishCompositeRendered?: NonNullable<DocumentRendererCallbacks['onCompositeRendered']>;
  readonly publishError: (message: string) => void;
  readonly publishScopeError: (message: string) => void;
  readonly publishFeatureError: (featureId: string, message: string) => void;
  readonly publishTimings: (timings: LightTableStartupTimings) => void;
  readonly publishLoading: (loading: boolean) => void;
  readonly logTimings?: (timings: LightTableStartupTimings) => void;
}

/**
 * Owns the editor-to-renderer composition for one document-open generation.
 *
 * The editor root supplies semantic presentation ports and source identity;
 * concrete WebGPU construction, guarded renderer callbacks and symmetric slot
 * publication/retirement stay inside this infrastructure-facing boundary.
 */
export const useEditorDocumentOpenRequestFactory = ({
  canvases,
  rendererRef,
  rendererLifecycle,
  textFontRuntimePort,
  telemetryRef,
  source,
  getScopeOptions,
  hydrate,
  publishHistogram,
  publishGpuMemory,
  publishTextRenderPresentation,
  publishCompositeRendered,
  publishError,
  publishScopeError,
  publishFeatureError,
  publishTimings,
  publishLoading,
  logTimings
}: EditorDocumentOpenRequestFactoryOptions): ((
  context: DocumentOpenLifecycleContext
) => DocumentOpenRequest<DocumentRendererPort> | null) => useCallback(({
  isCurrent
}: DocumentOpenLifecycleContext) => {
  const resolvedCanvases = resolveEditorDocumentCanvases(canvases);
  if (!resolvedCanvases) return null;
  const lifecycleBridge = createDocumentRendererLifecycleBridge<DocumentRendererPort>({
    isCurrent,
    telemetry: telemetryRef.current,
    lifecycle: rendererLifecycle,
    scopeCanvases: resolvedCanvases.scopes,
    getScopeOptions,
    publishHistogram,
    publishGpuMemory,
    publishTextRenderPresentation,
    publishCompositeRendered,
    publishError,
    publishScopeError,
    publishFeatureError,
    publishTimings,
    publishLoading,
    logTimings
  });

  return createEditorDocumentOpenRequest({
    createRenderer: () => createWebGpuDocumentRenderer(
      resolvedCanvases.viewport,
      lifecycleBridge.callbacks as DocumentRendererCallbacks
    ),
    resolveSource: (signal) => resolveDocumentSource(source, signal),
    hydrate: (renderer, sourceBlob, task) => hydrate(
      renderer,
      sourceBlob,
      task,
      isCurrent
    ),
    rendererSlot: {
      get: () => rendererRef.current,
      set: (renderer) => {
        rendererRef.current = renderer;
      }
    },
    configureRenderer: (renderer) => renderer.configureTextFonts(textFontRuntimePort),
    lifecycleBridge
  });
}, [
  canvases,
  getScopeOptions,
  hydrate,
  logTimings,
  publishError,
  publishFeatureError,
  publishGpuMemory,
  publishTextRenderPresentation,
  publishCompositeRendered,
  publishHistogram,
  publishLoading,
  publishScopeError,
  publishTimings,
  rendererLifecycle,
  rendererRef,
  textFontRuntimePort,
  source,
  telemetryRef
]);
