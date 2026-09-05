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
import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  prepareDocumentOpenSource,
  type PreparedDocumentOpenSource
} from '../../application/documents/prepareDocumentOpenSource';

export interface EditorResolvedDocumentSource {
  readonly blob: Blob;
  readonly prepared: PreparedDocumentOpenSource | null;
}

const waitForActivePresentation = async (
  renderer: DocumentRendererPort,
  lifecycle: DocumentRendererLifecycle,
  task: DocumentTaskContext
): Promise<void> => {
  if (!lifecycle.getSnapshot().active || !task.isCurrent()) return;

  let releaseSuspension!: () => void;
  const suspended = new Promise<void>((resolve) => {
    releaseSuspension = resolve;
  });
  const unsubscribe = lifecycle.subscribe((snapshot) => {
    if (!snapshot.active || !task.isCurrent()) releaseSuspension();
  });
  const onAbort = () => releaseSuspension();
  task.signal.addEventListener('abort', onAbort, { once: true });
  if (!lifecycle.getSnapshot().active || !task.isCurrent()) releaseSuspension();

  try {
    await Promise.race([renderer.waitForPresentation(), suspended]);
  } finally {
    unsubscribe();
    task.signal.removeEventListener('abort', onAbort);
  }
};

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
    readonly existingDocument?: ImageDocument | null;
    readonly name: string;
    readonly decodeMode: import('../../application/documents/documentSourceProbe').DocumentOpenMode;
  };
  readonly getScopeOptions: () => {
    readonly histogramVisible: boolean;
    readonly options: WebGpuScopeOptions;
  };
  readonly hydrate: (
    renderer: DocumentRendererPort,
    source: EditorResolvedDocumentSource,
    task: DocumentTaskContext,
    isCurrent: () => boolean
  ) => Promise<void>;
  readonly publishHistogram: (histogram: RgbHistogram) => void;
  readonly publishGpuMemory: (bytes: number) => void;
  readonly publishTextRenderPresentation?: NonNullable<DocumentRendererCallbacks['onTextRenderPresentation']>;
  readonly publishCompositeRendered?: NonNullable<DocumentRendererCallbacks['onCompositeRendered']>;
  readonly publishError: (message: string) => void;
  readonly publishOpenFailure?: (message: string) => void;
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
  publishOpenFailure,
  publishScopeError,
  publishFeatureError,
  publishTimings,
  publishLoading,
  logTimings
}: EditorDocumentOpenRequestFactoryOptions): ((
  context: DocumentOpenLifecycleContext
) => DocumentOpenRequest<DocumentRendererPort, EditorResolvedDocumentSource> | null) => useCallback(({
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
    publishOpenFailure,
    publishScopeError,
    publishFeatureError,
    publishTimings,
    publishLoading,
    logTimings
  });

  return createEditorDocumentOpenRequest<DocumentRendererPort, EditorResolvedDocumentSource>({
    createRenderer: () => {
      telemetryRef.current.markTimelineStage('gpu-device-requested', { warmReuse: false });
      return createWebGpuDocumentRenderer(
        resolvedCanvases.viewport,
        lifecycleBridge.callbacks as DocumentRendererCallbacks
      );
    },
    resolveSource: source.existingDocument
      ? async () => ({ blob: new Blob(), prepared: null })
      : async (signal) => {
          const blob = await resolveDocumentSource(source, signal);
          const startupTimeline = telemetryRef.current.activeTimeline();
          startupTimeline?.mark('bytes-available');
          const prepared = await prepareDocumentOpenSource({
            blob,
            name: source.name,
            decodeMode: source.decodeMode,
            signal,
            startupTimeline
          });
          return { blob, prepared };
        },
    hydrate: (renderer, resolvedSource, task) => {
      // Attach the trace only when the selected source is ready to hydrate.
      // A reused renderer may still owe a frame for the previous document;
      // counting that submission would produce a fast but false milestone.
      renderer.setStartupTimeline(telemetryRef.current.activeTimeline());
      return hydrate(renderer, resolvedSource, task, isCurrent);
    },
    waitUntilPresented: (renderer, task) =>
      waitForActivePresentation(renderer, rendererLifecycle, task),
    disposeSource: (resolvedSource) => resolvedSource.prepared?.dispose(),
    rendererSlot: {
      get: () => rendererRef.current,
      set: (renderer) => {
        rendererRef.current = renderer;
      }
    },
    configureRenderer: (renderer) => {
      renderer.updateCallbacks(lifecycleBridge.callbacks);
      renderer.configureTextFonts(textFontRuntimePort);
    },
    lifecycleBridge
  });
}, [
  canvases,
  getScopeOptions,
  hydrate,
  logTimings,
  publishError,
  publishOpenFailure,
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
