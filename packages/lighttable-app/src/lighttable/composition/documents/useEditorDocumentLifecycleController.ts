import { useCallback, useMemo, type RefObject } from 'react';
import type { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import type { DocumentTaskRegistry } from '../../application/tasks/documentTaskRegistry';
import type { DocumentStartupTelemetry } from '../../application/telemetry/documentStartupTelemetry';
import type { LightTableStartupTimings } from '../../application/telemetry/editorTelemetry';
import type { DocumentSourceLoader } from '../../application/documents/resolveDocumentSource';
import type { DocumentOpenMode } from '../../application/documents/documentSourceProbe';
import { useDocumentOpenLifecycle } from '../../application/documents/useDocumentOpenLifecycle';
import {
  createDocumentSourceLoadController
} from '../../application/documents/documentSourceLoadController';
import type {
  PreparedDocumentPublicationPorts
} from '../../application/documents/publishPreparedDocument';
import type { GroupVisibility } from '../../application/adjustments/groupVisibility';
import type { BasicAdjustments, RgbHistogram } from '../../types';
import type { DocumentCreationSettings } from '../../editor/document/documentTypes';
import type { WebGpuScopeOptions } from '../../gpu/WebGpuScopeEngine';
import type {
  DocumentRendererPort
} from '../../infrastructure/rendering/webGpuDocumentRenderer';
import type {
  EditorDocumentScopeCanvasRefs
} from './resolveEditorDocumentCanvases';
import { useEditorDocumentOpenRequestFactory } from './useEditorDocumentOpenRequestFactory';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';
import type { TextFontRuntimePort } from '../../text/rendering/TextLayerRenderCoordinator';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { LightTableImageMetadata } from '../../types';

export interface EditorDocumentLifecycleControllerOptions {
  readonly enabled: boolean;
  readonly generation: object;
  readonly tasks: DocumentTaskRegistry;
  readonly rendererLifecycle: DocumentRendererLifecycle;
  readonly textFontRuntimePort: TextFontRuntimePort;
  readonly canvases: EditorDocumentScopeCanvasRefs;
  readonly rendererRef: RefObject<DocumentRendererPort | null>;
  readonly telemetryRef: RefObject<DocumentStartupTelemetry>;
  readonly source: {
    readonly inlineSource: Blob | null;
    readonly projectId: string;
    readonly sourceFileKey: string | null;
    readonly loadSource?: DocumentSourceLoader;
    readonly name: string;
    readonly identity: string;
    readonly decodeMode: DocumentOpenMode;
    readonly initialAdjustments: BasicAdjustments;
    readonly creationSettings?: DocumentCreationSettings;
    readonly existingDocument?: ImageDocument | null;
    readonly existingMetadata?: LightTableImageMetadata | null;
  };
  readonly getGroupVisibility: () => GroupVisibility;
  readonly getPublicationPorts: () => PreparedDocumentPublicationPorts;
  readonly getScopeOptions: () => {
    readonly histogramVisible: boolean;
    readonly options: WebGpuScopeOptions;
  };
  readonly publishHistogram: (histogram: RgbHistogram) => void;
  readonly publishGpuMemory: (bytes: number) => void;
  readonly publishTextRenderPresentation?: (snapshot: TextRenderPresentationSnapshot) => void;
  readonly publishCompositeRendered?: () => void;
  readonly publishInitialThumbnail?: (renderer: DocumentRendererPort) => Promise<void>;
  readonly publishError: (message: string) => void;
  readonly publishScopeError: (message: string) => void;
  readonly publishFeatureError: (featureId: string, message: string) => void;
  readonly publishTimings: (timings: LightTableStartupTimings) => void;
  readonly publishLoading: (loading: boolean) => void;
  readonly logTimings?: (timings: LightTableStartupTimings) => void;
  readonly beforeOpen?: () => void;
  readonly afterClose?: () => void;
  readonly canReuseRenderer?: () => boolean;
}

export interface EditorDocumentSourceLoad {
  readonly blob: Blob;
  readonly name: string;
  readonly identity: string;
  readonly decodeMode: DocumentOpenMode;
  readonly initialAdjustments: BasicAdjustments;
  readonly creationSettings?: DocumentCreationSettings;
  readonly signal?: AbortSignal;
  readonly isCanceled?: () => boolean;
}

export interface EditorDocumentLifecycleController {
  loadSource(request: EditorDocumentSourceLoad): Promise<boolean>;
}

/**
 * Composes the complete renderer/source lifecycle for one mounted document.
 *
 * The editor root owns presentation state, while this boundary owns renderer
 * construction, source hydration, generation cancellation and teardown. This
 * keeps a document switch from exposing half-open GPU or source state.
 */
export const useEditorDocumentLifecycleController = ({
  enabled,
  generation,
  tasks,
  rendererLifecycle,
  textFontRuntimePort,
  canvases,
  rendererRef,
  telemetryRef,
  source,
  getGroupVisibility,
  getPublicationPorts,
  getScopeOptions,
  publishHistogram,
  publishGpuMemory,
  publishTextRenderPresentation,
  publishCompositeRendered,
  publishInitialThumbnail,
  publishError,
  publishScopeError,
  publishFeatureError,
  publishTimings,
  publishLoading,
  logTimings,
  beforeOpen,
  afterClose,
  canReuseRenderer
}: EditorDocumentLifecycleControllerOptions): EditorDocumentLifecycleController => {
  const sourceLoadController = useMemo(
    () => createDocumentSourceLoadController({
      getRenderer: () => rendererRef.current,
      getGroupVisibility,
      getPublicationPorts
    }),
    [getGroupVisibility, getPublicationPorts, rendererRef]
  );

  const loadSource = useCallback(
    (request: EditorDocumentSourceLoad) => sourceLoadController.load({
      blob: request.blob,
      name: request.name,
      cacheKey: `${request.identity}:${request.blob.size}`,
      sourceIdentity: `${request.identity}:${request.blob.size}`,
      decodeMode: request.decodeMode,
      initialAdjustments: request.initialAdjustments,
      creationSettings: request.creationSettings,
      signal: request.signal,
      isCanceled: request.isCanceled
    }),
    [sourceLoadController]
  );

  const hydrate = useCallback(async (
    renderer: DocumentRendererPort,
    sourceBlob: Blob,
    task: { isCurrent(): boolean; signal: AbortSignal },
    isCurrent: () => boolean
  ) => {
    if (source.existingDocument) {
      renderer.bindExistingDocument(
        source.existingDocument,
        source.existingMetadata ?? undefined
      );
      return;
    }
    await loadSource({
      blob: sourceBlob,
      name: source.name,
      identity: source.identity,
      decodeMode: source.decodeMode,
      initialAdjustments: source.initialAdjustments,
      creationSettings: source.creationSettings,
      signal: task.signal,
      isCanceled: () => !isCurrent() || !task.isCurrent()
    });
    if (
      isCurrent()
      && task.isCurrent()
      && !rendererLifecycle.getSnapshot().active
    ) {
      void publishInitialThumbnail?.(renderer);
    }
  }, [loadSource, publishInitialThumbnail, rendererLifecycle, source]);

  const createRequest = useEditorDocumentOpenRequestFactory({
    canvases,
    rendererRef,
    rendererLifecycle,
    textFontRuntimePort,
    telemetryRef,
    source: {
      inlineSource: source.inlineSource,
      projectId: source.projectId,
      sourceFileKey: source.sourceFileKey,
      loadSource: source.loadSource,
      existingDocument: source.existingDocument
    },
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
  });

  useDocumentOpenLifecycle<DocumentRendererPort>({
    enabled,
    generation,
    tasks,
    rendererLifecycle,
    createRequest,
    beforeOpen,
    afterClose,
    canReuseRenderer
  });

  return { loadSource };
};
