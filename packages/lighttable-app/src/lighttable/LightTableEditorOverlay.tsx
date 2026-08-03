import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TEXT_CONTRACT_FIXTURE_COUNT } from '@lighttable/text-core';
import { buildTextEditingOverlay } from '@lighttable/text-rendering';
import {
  DocumentCommandHistory
} from './application/commands/documentCommandHistory';
import {
  useDocumentHistoryController,
  type EditorHistoryEntry
} from './application/commands/useDocumentHistoryController';
import type {
  DocumentSession,
  DocumentSessionId
} from './application/documents/documentSession';
import {
  DocumentTaskRegistry
} from './application/tasks/documentTaskRegistry';
import {
  DocumentRendererLifecycle
} from './application/rendering/documentRendererLifecycle';
import { useDocumentRuntimeServices } from './application/documents/useDocumentRuntimeServices';
import { resetDocumentOpenPresentation } from './application/documents/resetDocumentOpenPresentation';
import { useDocumentMutationController } from './application/documents/useDocumentMutationController';
import { hydrateDocumentFonts } from './application/documents/hydrateDocumentFonts';
import { useAdjustmentTransactionController } from './application/adjustments/useAdjustmentTransactionController';
import { createAdjustmentCommands } from './application/adjustments/createAdjustmentCommands';
import {
  AdjustmentPresentationStore,
  useAdjustmentPresentationSelector,
  type AdjustmentPresentationDomain
} from './application/adjustments/adjustmentPresentationStore';
import { createDocumentProjectionController } from './application/documents/documentProjectionController';
import { useViewportInteractionController } from './editor/hooks/useViewportInteractionController';
import { zoomViewToScaleAtPoint } from './editor/tools/pointer/viewportCoordinates';
import {
  steppedZoomPercent,
  zoomPercentToScale
} from './editor/tools/zoom/zoomLevels';
import { useEditorResizeController } from './editor/hooks/useEditorResizeController';
import { useLayerThumbnailController } from './editor/hooks/useLayerThumbnailController';
import { useEditorDiagnosticsController } from './editor/hooks/useEditorDiagnosticsController';
import {
  createScopeRendererOptions,
  useRendererPresentationSync
} from './editor/hooks/useRendererPresentationSync';
import { planPersistentToolActivation } from './application/tools/persistentToolActivation';
import { useAutoAlignController } from './application/tools/autoAlign/useAutoAlignController';
import { useLayerStyleEditorController } from './application/styles/useLayerStyleEditorController';
import { useLayerDocumentCommands } from './application/layers/useLayerDocumentCommands';
import { useLayerPanelController } from './application/layers/useLayerPanelController';
import type { LightTableStartupTimings } from './application/telemetry/editorTelemetry';
import { DocumentStartupTelemetry } from './application/telemetry/documentStartupTelemetry';
import { buildEditorStatus } from './application/telemetry/editorStatus';
import {
  type ReferenceDifferenceMetrics,
  type TextRenderPresentationSnapshot
} from './application/rendering/rendererTypes';
import { formatRenderTelemetry } from './application/rendering/renderTelemetry';
import { useTextEngineDiagnostics } from './text/diagnostics/useTextEngineDiagnostics';
import {
  documentTextFontDiagnostics,
  summarizeTextFontDiagnostics
} from './text/fonts/textLayerFontStatus';
import type {
  DocumentOpenMode
} from './application/documents/documentSourceProbe';
import {
  useEditorDocumentLifecycleController
} from './composition/documents/useEditorDocumentLifecycleController';
import {
  useEditorDocumentFileController
} from './composition/documents/useEditorDocumentFileController';
import {
  useEditorKeyboardController
} from './composition/input/useEditorKeyboardController';
import {
  createEditorMenuController
} from './composition/menus/createEditorMenuController';
import { primaryShortcutLabel } from './application/input/editorShortcutPresentation';
import {
  LayersWorkspacePanel
} from './composition/workspace/LayersWorkspacePanel';
import {
  ChannelsWorkspacePanel
} from './composition/workspace/ChannelsWorkspacePanel';
import {
  createEditorWorkspacePanels
} from './composition/workspace/createEditorWorkspacePanels';
import {
  EditorDocumentSurface
} from './composition/workspace/EditorDocumentSurface';
import {
  EditorOverlayLayer
} from './composition/workspace/EditorOverlayLayer';
import {
  type DocumentRendererPort
} from './infrastructure/rendering/webGpuDocumentRenderer';
import { useLightTableGradeClipboard } from './lightTableGradeClipboard';
import {
  resolveLightTableEditorSourceKey,
  resolveLightTableSaveSourceKey,
  type LightTableRecipe
} from './lightTableRecipe';
import {
  mapLensDistortionUv
} from './effects/lensDistortion/settings';
import { lightTableDepthAnalysis } from './analysis/depth/DepthAnalysisClient';
import { sampleMedianDepth } from './analysis/depth/normalization';
import { useEditorDialogController } from './editor/ui/useEditorDialogController';
import { LightTableEditorShell } from './editor/ui/LightTableEditorShell';
import { PointTextCreationDialog } from './editor/ui/PointTextCreationDialog';
import { TextInputBridge } from './editor/ui/TextInputBridge';
import {
  ParagraphTextCreationController,
  PointTextCreationController,
  createParagraphTextDocument,
  createPointTextDocument,
  defaultTextStyleForFamily,
  resolveTextToolFont
} from './application/text/pointTextCreation';
import { FlowTextEditingSessionController } from './application/text/flowTextEditingSession';
import { hitTestTextEditingLayout } from './application/text/textEditingHitTest';
import {
  formatFlowTextSource,
  type TextStylePatch
} from './application/text/flowTextFormatting';
import {
  buildTextPropertyPresentation,
  textFillPatchFromHex,
  textFontPatch
} from './application/text/textPropertyPresentation';
import { applyTextLayerDataMutation } from './editor/document/textLayerCommands';
import { lightTableTextEngine } from './text/wasm/TextEngineClient';
import { DocumentFontRegistry } from './text/fonts/DocumentFontRegistry';
import { FontationsFontFaceParser } from './text/fonts/FontationsFontFaceParser';
import {
  BUNDLED_TEXT_FONT_CATALOG,
  registerBundledTextFontByAssetId,
  registerBundledTextFontForSettings
} from './text/fonts/bundledTextFont';
import { bindRendererTextFontRuntime } from './composition/documents/bindRendererTextFontRuntime';
import {
  LightTableDockWorkspace,
  type LightTableDockWorkspaceHandle
} from './editor/workspace/LightTableDockWorkspace';
import {
  nextEditorScreenMode,
  type EditorScreenMode
} from './editor/workspace/editorScreenMode';
import { LIGHTTABLE_WORKSPACE_PANEL_IDS } from './editor/workspace/workspacePanelRegistry';
import { createEditorSession, type EditorSession, type ToolId } from './editor/session/editorSession';
import { TemporaryToolController } from './editor/tools/temporaryToolController';
import { useFillCommandController } from './application/tools/fill/useFillCommandController';
import {
  browserImageClipboard,
  type LightTableImageClipboard
} from '../platform/LightTableImageClipboard';
import { useLensBlurDepthController } from './application/effects/lensBlur/useLensBlurDepthController';
import { usePaintSessionController } from './application/tools/paint/usePaintSessionController';
import { useWarpSessionController } from './application/tools/warp/useWarpSessionController';
import { useSelectionSessionController } from './application/tools/selection/useSelectionSessionController';
import { useTransformSessionController } from './application/tools/transform/useTransformSessionController';
import { buildTransformEditingFrame } from './editor/tools/transform/transformEditingFrame';
import { useVectorToolSessionController } from './application/vectors/useVectorToolSessionController';
import {
  patchVectorStyle,
  vectorElementStyleSettings
} from './application/vectors/vectorStylePresentation';
import {
  useDocumentImageState,
  useDocumentEditorSession,
  useDocumentViewportState
} from './editor/hooks/useDocumentEditorState';
import {
  createDefaultGroupVisibility,
  type GroupVisibility
} from './application/adjustments/groupVisibility';
import {
  type LensBlurViewportMode
} from './editor/config/adjustmentControls';
import {
  type ImageDocument,
  type LayerId,
  type Rect
} from './editor/document/documentTypes';
import {
  findDocumentLayer,
  findRasterLayer,
  walkLayerTree
} from './editor/document/layerTree';
import {
  type FontAssetBlob,
  type PreservedSourceAssetBlob
} from './editor/persistence/layeredDocumentFormat';
import {
  imagePickerAccept
} from './image-io/supportedImageFormats';
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from './editor/psd/psdDocumentAdapter';
import { PaintGestureController } from './editor/tools/paint/paintGestureController';
import {
  isPaintTool,
  isWarpTool,
  steppedBrushHardness,
  steppedBrushSize
} from './editor/tools/toolCapabilities';
import { BrushPercentInput } from './application/input/brushPercentInput';
import { SelectionGestureController } from './editor/tools/selection/selectionGestureController';
import {
  type CompositeColorChannel,
  type SelectionShape
} from './editor/selection/selectionTypes';
import {
  DEFAULT_SCOPE_SETTINGS,
  DEFAULT_SCOPE_VISIBILITY,
  type ScopeSettings,
  type ScopeVisibility
} from './scopes';
import {
  createDefaultAdjustments,
  cloneAdjustments as cloneAllAdjustments,
  DEFAULT_BASIC_ADJUSTMENTS,
  type BasicAdjustments,
  type LightTableImageMetadata,
  type LightTableViewState,
  type RgbHistogram
} from './types';
import './lighttable.css';

const MIN_SCALE = 0.02;
const MAX_SCALE = 100;
const activeLayerCanOwnGrade = (document: ImageDocument | null): boolean => {
  if (!document?.activeLayerId) return false;
  const active = findDocumentLayer(document, document.activeLayerId);
  return active?.type === 'raster' || active?.type === 'adjustment';
};

export interface LightTableEditorOverlayProps {
  open: boolean;
  active?: boolean;
  screenMode?: EditorScreenMode;
  onScreenModeChange?: (mode: EditorScreenMode) => void;
  projectId: string;
  sourceFileKey?: string | null;
  sourceBlob?: Blob | null;
  sourceDecodeMode?: DocumentOpenMode;
  loadSource?: (request: {
    projectId: string;
    sourceFileKey: string;
    signal: AbortSignal;
  }) => Promise<Blob>;
  initialRecipe?: LightTableRecipe | null;
  fileNameBase: string;
  subjectLabel: string;
  onClose: () => void;
  onSave: (file: File, recipe: LightTableRecipe) => Promise<boolean | void> | boolean | void;
  workspaceDocumentId?: string;
  workspaceDocuments?: ReadonlyArray<{
    id: string;
    title: string;
    dirty?: boolean;
  }>;
  onActivateWorkspaceDocument?: (documentId: string) => void;
  onCloseWorkspaceDocument?: (documentId: string) => void;
  onRequestNewWorkspaceDocument?: () => void;
  onRequestOpenWorkspaceDocument?: (decodeMode: DocumentOpenMode) => Promise<void> | void;
  onOpenWorkspaceDocument?: (file: File, decodeMode: DocumentOpenMode) => void;
  onDocumentReady?: () => void;
  onDocumentError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  history?: DocumentCommandHistory;
  tasks?: DocumentTaskRegistry;
  rendererLifecycle?: DocumentRendererLifecycle;
  documentSession?: DocumentSession;
  imageClipboard?: LightTableImageClipboard;
}

export type { EditorScreenMode } from './editor/workspace/editorScreenMode';

type ZoomMode = 'fit' | '100' | 'custom';
const cloneAdjustments = cloneAllAdjustments;

export const LightTableEditorOverlay: React.FC<LightTableEditorOverlayProps> = ({
  open,
  active = true,
  screenMode: controlledScreenMode,
  onScreenModeChange,
  projectId,
  sourceFileKey = null,
  sourceBlob: initialSourceBlob = null,
  sourceDecodeMode = 'automatic',
  loadSource,
  initialRecipe = null,
  fileNameBase,
  onClose,
  onSave,
  workspaceDocumentId = 'active-document',
  workspaceDocuments,
  onActivateWorkspaceDocument,
  onCloseWorkspaceDocument,
  onRequestNewWorkspaceDocument,
  onRequestOpenWorkspaceDocument,
  onOpenWorkspaceDocument,
  onDocumentReady,
  onDocumentError,
  onDirtyChange,
  history,
  tasks,
  rendererLifecycle: providedRendererLifecycle,
  documentSession,
  imageClipboard: providedImageClipboard
}) => {
  const imageClipboard = providedImageClipboard ?? browserImageClipboard();
  const standaloneFontRegistryRef = useRef<DocumentFontRegistry | null>(null);
  if (!documentSession && !standaloneFontRegistryRef.current) {
    standaloneFontRegistryRef.current = new DocumentFontRegistry({
      parser: new FontationsFontFaceParser()
    });
  }
  const textFontRegistry = documentSession?.fonts ?? standaloneFontRegistryRef.current!;
  const {
    history: commandHistory,
    tasks: taskRegistry,
    rendererLifecycle
  } = useDocumentRuntimeServices({
    documentId: workspaceDocumentId as DocumentSessionId,
    active,
    history,
    tasks,
    rendererLifecycle: providedRendererLifecycle,
    onLocalDirtyChange: onDirtyChange
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hueDistributionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorMixerHueCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorMixerScopeContainerRef = useRef<HTMLDivElement | null>(null);
  const paradeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scopesColumnRef = useRef<HTMLElement | null>(null);
  const engineRef = useRef<DocumentRendererPort | null>(null);
  const adjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const adjustmentPresentationStoreRef = useRef<AdjustmentPresentationStore | null>(null);
  if (!adjustmentPresentationStoreRef.current) {
    adjustmentPresentationStoreRef.current = new AdjustmentPresentationStore(
      adjustmentsRef.current
    );
  }
  const adjustmentPresentationStore = adjustmentPresentationStoreRef.current;
  const publishAdjustmentPresentation = useCallback((
    next: BasicAdjustments,
    domain: AdjustmentPresentationDomain = 'all'
  ) => {
    adjustmentsRef.current = next;
    adjustmentPresentationStore.publish(next, domain);
  }, [adjustmentPresentationStore]);
  const documentAdjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const resetAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetDocumentTransactionRef = useRef<() => void>(() => undefined);
  const preservedSourceAssetsRef = useRef<PreservedSourceAssetBlob[]>([]);
  const fontAssetsRef = useRef<FontAssetBlob[]>([]);
  const [fontAvailabilityRevision, setFontAvailabilityRevision] = useState(0);
  const [fontHydrationPending, setFontHydrationPending] = useState(false);
  const fontHydrationGenerationRef = useRef(0);
  const paintGestureRef = useRef(new PaintGestureController());
  const selectionGestureRef = useRef(new SelectionGestureController());
  const commitTransformRef = useRef<() => void>(() => undefined);
  const cancelTransformRef = useRef<() => void>(() => undefined);
  const resetTransformRef = useRef<() => void>(() => undefined);
  const transformActiveRef = useRef<() => boolean>(() => false);
  const activateToolRef = useRef<(tool: ToolId) => void>(() => undefined);
  const cancelAutoAlignRef = useRef<() => void>(() => undefined);
  const copySelectedContentRef = useRef<() => void>(() => undefined);
  const copyMergedContentRef = useRef<() => void>(() => undefined);
  const pasteSelectedContentRef = useRef<() => void>(() => undefined);
  const layerViaCopyRef = useRef<() => void>(() => undefined);
  const mergeActiveLayerDownRef = useRef<() => void>(() => undefined);
  const selectedLayerIdsRef = useRef<LayerId[]>([]);
  const invertActiveLayerColorsRef = useRef<() => void>(() => undefined);
  const fillActiveTargetRef = useRef<(color: string) => void>(() => undefined);
  const temporaryToolRef = useRef(new TemporaryToolController());
  const groupVisibilityRef = useRef<GroupVisibility>(createDefaultGroupVisibility());
  const scopeSettingsRef = useRef<ScopeSettings>({ ...DEFAULT_SCOPE_SETTINGS });
  const scopeVisibilityRef = useRef<ScopeVisibility>({ ...DEFAULT_SCOPE_VISIBILITY });
  const startupTelemetryRef = useRef(new DocumentStartupTelemetry());
  const workspaceRef = useRef<LightTableDockWorkspaceHandle | null>(null);
  const [localScreenMode, setLocalScreenMode] = useState<EditorScreenMode>('normal');
  const screenMode = controlledScreenMode ?? localScreenMode;
  const toggleScreenMode = useCallback(() => {
    const next = nextEditorScreenMode(screenMode);
    if (onScreenModeChange) {
      onScreenModeChange(next);
    } else {
      setLocalScreenMode(next);
    }
  }, [onScreenModeChange, screenMode]);
  const [metadata, setMetadata] = useState<LightTableImageMetadata | null>(null);
  const [histogram, setHistogram] = useState<RgbHistogram | null>(null);
  const {
    zoomMode,
    setZoomMode,
    view,
    setView
  } = useDocumentViewportState(documentSession);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [documentSurfaceRevision, setDocumentSurfaceRevision] = useState(0);
  const handleDocumentSurfaceReady = useCallback(() => {
    setDocumentSurfaceRevision((current) => current + 1);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showDifference, setShowDifference] = useState(false);
  const [isolatedMaskLayerId, setIsolatedMaskLayerId] = useState<LayerId | null>(null);
  const [isolatedCompositeChannel, setIsolatedCompositeChannel] =
    useState<CompositeColorChannel | null>(null);
  const [sourceName, setSourceName] = useState(fileNameBase);
  const [groupVisibility, setGroupVisibility] = useState<GroupVisibility>(
    createDefaultGroupVisibility
  );
  const [shiftPressed, setShiftPressed] = useState(false);
  const [scopeSettings, setScopeSettings] = useState<ScopeSettings>({ ...DEFAULT_SCOPE_SETTINGS });
  const [scopeVisibility, setScopeVisibility] = useState<ScopeVisibility>({ ...DEFAULT_SCOPE_VISIBILITY });
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [gradeStatus, setGradeStatus] = useState<string | null>(null);
  const [psdImportInfo, setPsdImportInfo] = useState<PsdDecodeSuccess | null>(null);
  const [psdDifferenceMetrics, setPsdDifferenceMetrics] = useState<ReferenceDifferenceMetrics | null>(null);
  const [psdCompatibility, setPsdCompatibility] = useState<PsdImportCompatibilityEntry[]>([]);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceIdentity, setSourceIdentity] = useState('');
  const [focusPickerActive, setFocusPickerActive] = useState(false);
  const [lensBlurViewportMode, setLensBlurViewportModeState] = useState<LensBlurViewportMode>('result');
  const [imageDocument, setImageDocument, imageDocumentRef] =
    useDocumentImageState(documentSession);
  const [thumbnailDocumentReadyId, setThumbnailDocumentReadyId] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useDocumentEditorSession(documentSession);
  const [selectionDraft, setSelectionDraft] = useState<SelectionShape | null>(null);
  const editorDialogs = useEditorDialogController();
  const [selectionClipboardAvailable, setSelectionClipboardAvailable] = useState(false);
  const [temporaryPanActive, setTemporaryPanActive] = useState(false);
  const [temporaryEraseActive, setTemporaryEraseActive] = useState(false);
  const [startupTimings, setStartupTimings] = useState<LightTableStartupTimings | null>(null);
  const [gpuMemoryBytes, setGpuMemoryBytes] = useState(0);
  const [textRenderPresentation, setTextRenderPresentation] = useState<TextRenderPresentationSnapshot>({
    publicationRevision: 0,
    readyLayerCount: 0,
    textureBytes: 0,
    mode: 'placeholder', rebuildingLayerCount: 0,
    cacheBudgetBytes: 256 * 1024 * 1024, cacheEvictions: 0,
    atlasLayerCount: 0, cachedLayerCount: 0, atlasEncodes: 0,
    sourceCacheHits: 0, sourceCacheMisses: 0,
    layoutCacheBytes: 0, layoutCacheBudgetBytes: 32 * 1024 * 1024,
    layoutCacheHits: 0, layoutCacheMisses: 0, layoutCacheEvictions: 0,
    atlasBytes: 0, atlasHits: 0, atlasMisses: 0, atlasEvictions: 0,
    sourceDecisionMeasurements: 0, lastSourceDecision: null,
    coordinatorActive: true, configuredFontCount: 0, visibleTextLayerCount: 0,
    preparationStage: 'waiting-document', preparationLayerId: null, lastPreparationError: null,
    traceRevision: 0, traceMessage: null, traceDetails: null,
    shapingOperations: 0, latestShapingRoundTripMs: 0,
    rasterizedGlyphs: 0, latestRasterRoundTripMs: 0, textCacheSubmissions: 0,
    textInputLatencySamples: 0, pendingTextInputs: 0, supersededTextInputs: 0,
    inputToSubmitP95Ms: 0, inputToSubmitMaxMs: 0,
    inputToGpuP95Ms: 0, inputToGpuMaxMs: 0
  });
  const [accessoryWidthConstraintsEnabled, setAccessoryWidthConstraintsEnabled] = useState(true);
  const [editorResizeObserversEnabled, setEditorResizeObserversEnabled] = useState(true);
  const [toolOptionsMenu, setToolOptionsMenu] = useState<{ x: number; y: number } | null>(null);
  const pointTextControllerRef = useRef<PointTextCreationController | null>(null);
  pointTextControllerRef.current ??= new PointTextCreationController();
  const pointTextController = pointTextControllerRef.current;
  const paragraphTextControllerRef = useRef<ParagraphTextCreationController | null>(null);
  paragraphTextControllerRef.current ??= new ParagraphTextCreationController();
  const paragraphTextController = paragraphTextControllerRef.current;
  const pointTextCapabilityGenerationRef = useRef(0);
  const commitPointTextRef = useRef<() => boolean>(() => false);
  const cancelPointTextRef = useRef<() => boolean>(() => false);
  const commitParagraphTextRef = useRef<() => boolean>(() => false);
  const cancelParagraphTextRef = useRef<() => boolean>(() => false);
  const finishTextEditingRef = useRef<() => boolean>(() => false);
  const textPropertyGestureRef = useRef<
    | { readonly kind: 'text'; readonly layerId: LayerId }
    | { readonly kind: 'document'; readonly documentId: ImageDocument['id']; readonly layerId: LayerId; readonly before: ImageDocument }
    | null
  >(null);
  const selectLayerRef = useRef<(layerId: LayerId) => void>(() => undefined);
  const pointTextCreation = useSyncExternalStore(
    pointTextController.subscribe,
    pointTextController.getSnapshot,
    pointTextController.getSnapshot
  );
  const paragraphTextCreation = useSyncExternalStore(
    paragraphTextController.subscribe,
    paragraphTextController.getSnapshot,
    paragraphTextController.getSnapshot
  );
  const copiedGrade = useLightTableGradeClipboard();
  const brushPercentInputRef = useRef(new BrushPercentInput());

  useEffect(() => {
    setToolOptionsMenu(null);
  }, [editorSession.activeTool]);

  useEffect(() => () => {
    pointTextController.cancel();
    paragraphTextController.cancel();
    textEditingControllerRef.current?.finish();
    standaloneFontRegistryRef.current?.dispose();
    standaloneFontRegistryRef.current = null;
  }, [paragraphTextController, pointTextController]);

  useEffect(() => {
    temporaryToolRef.current.end();
    fontHydrationGenerationRef.current += 1;
    pointTextCapabilityGenerationRef.current += 1;
    pointTextController.cancel();
    paragraphTextController.cancel();
    textEditingControllerRef.current?.reset();
    setTemporaryPanActive(false);
    setTemporaryEraseActive(false);
    brushPercentInputRef.current.clear();
  }, [paragraphTextController, pointTextController, workspaceDocumentId]);

  // StoryBuilder supplies an object-storage key. Standalone web/Electron files
  // do not have one, but still need a stable provenance identifier so recipes
  // and layered saves are valid. This key is metadata only; it does not embed
  // or duplicate the local source file.
  const effectiveSourceFileKey = resolveLightTableSaveSourceKey(
    sourceFileKey,
    initialRecipe,
    initialSourceBlob ? fileNameBase || 'Untitled' : null
  );
  const editorSourceFileKey = resolveLightTableEditorSourceKey(sourceFileKey, initialRecipe);
  // Standalone/Electron startup receives a real File. Keep its complete name:
  // layered-document and PSD detection must see the same extension as the
  // editor's File > Open path.
  const initialSourceName = initialSourceBlob instanceof File && initialSourceBlob.name
    ? initialSourceBlob.name
    : fileNameBase;

  const fitScale = useMemo(() => {
    if (!metadata) return 1;
    return Math.min(viewportSize.width / metadata.width, viewportSize.height / metadata.height) * 0.94;
  }, [metadata, viewportSize.height, viewportSize.width]);
  const activeScale = zoomMode === 'fit' ? fitScale : zoomMode === '100' ? 1 : view.scale;
  const imageRect = useMemo(() => ({
    x: (viewportSize.width - (metadata?.width ?? 1) * activeScale) / 2 + view.panX,
    y: (viewportSize.height - (metadata?.height ?? 1) * activeScale) / 2 + view.panY,
    width: (metadata?.width ?? 1) * activeScale,
    height: (metadata?.height ?? 1) * activeScale
  }), [activeScale, metadata, view.panX, view.panY, viewportSize.height, viewportSize.width]);
  const {
    dockResizeActiveRef,
    handleDockResizeInteractionChange
  } = useEditorResizeController({
    open,
    active,
    documentSurfaceRevision,
    observersEnabled: editorResizeObserversEnabled,
    hasMetadata: Boolean(metadata),
    viewportRef,
    scopesColumnRef,
    colorMixerScopeRef: colorMixerScopeContainerRef,
    getRenderer: () => engineRef.current,
    viewportSize,
    setViewportSize,
    imageRect
  });
  const layerThumbnails = useLayerThumbnailController({
    document: imageDocument,
    rendererReadyDocumentId: thumbnailDocumentReadyId,
    textPresentationRevision: textRenderPresentation.publicationRevision,
    getRenderer: () => engineRef.current
  });
  const availableFontAssets = useMemo(
    () => textFontRegistry.availableAssets,
    [textFontRegistry, fontAvailabilityRevision]
  );
  const selectableTextFonts = useMemo(() => {
    const fonts = new Map(BUNDLED_TEXT_FONT_CATALOG.map((asset) => [asset.assetId, asset]));
    availableFontAssets.forEach((asset) => fonts.set(asset.assetId, asset));
    return [...fonts.values()];
  }, [availableFontAssets]);
  const textFontRuntimePort = useMemo(() => ({
    get revision() { return textFontRegistry.availabilityRevision; },
    get assets() { return textFontRegistry.availableAssets; },
    bytes: (assetId: string) => textFontRegistry.bytes(assetId),
    subscribe: (listener: () => void) => textFontRegistry.subscribeAvailability(listener)
  }), [textFontRegistry]);
  useEffect(() => bindRendererTextFontRuntime(
    rendererLifecycle,
    () => engineRef.current,
    textFontRuntimePort
  ), [rendererLifecycle, textFontRuntimePort]);
  const fontDiagnostics = useMemo(
    () => imageDocument && !fontHydrationPending
      ? documentTextFontDiagnostics(imageDocument, availableFontAssets)
      : [],
    [availableFontAssets, fontHydrationPending, imageDocument]
  );
  const fontDiagnosticStatus = useMemo(
    () => summarizeTextFontDiagnostics(fontDiagnostics),
    [fontDiagnostics]
  );
  const {
    messages: debugMessages,
    photoshopCompatibilitySummary: psdCompatibilitySummary,
    append: appendDebugMessage,
    clear: clearDebugMessages
  } = useEditorDiagnosticsController({
    error,
    scopeError,
    gradeStatus,
    startupTimings,
    sourceName,
    psdImportInfo,
    psdCompatibility,
    psdDifferenceMetrics,
    onDocumentReady,
    onDocumentError
  });
  const textEngineDiagnostic = useTextEngineDiagnostics(appendDebugMessage);
  const textRenderTraceSignatureRef = useRef('');
  const publishTextRenderPresentation = useCallback((snapshot: TextRenderPresentationSnapshot) => {
    setTextRenderPresentation(snapshot);
    if (!snapshot.traceMessage) return;
    const signature = `${snapshot.traceRevision}:${snapshot.traceMessage}:${snapshot.traceDetails ?? ''}`;
    if (textRenderTraceSignatureRef.current === signature) return;
    textRenderTraceSignatureRef.current = signature;
    appendDebugMessage(
      snapshot.preparationStage === 'failed' ? 'error' : 'info',
      'GPU text pipeline',
      snapshot.traceMessage,
      snapshot.traceDetails ?? undefined
    );
  }, [appendDebugMessage]);
  useEffect(() => {
    let activeRegistration = true;
    if (!thumbnailDocumentReadyId && editorSession.activeTool !== 'text-point') return undefined;
    void textEngineDiagnostic.probe().catch((reason: unknown) => {
      if (activeRegistration && editorSession.activeTool === 'text-point') {
        setError(reason instanceof Error
          ? reason.message
          : 'The bundled text engine could not be prepared.');
      }
    });
    return () => { activeRegistration = false; };
  }, [editorSession.activeTool, textEngineDiagnostic.probe, textFontRegistry, thumbnailDocumentReadyId]);
  const [developmentTextFixture, setDevelopmentTextFixture] = useState<{
    enabled: boolean;
    status: 'off' | 'preparing' | 'ready' | 'error';
    error: string | null;
  }>({ enabled: false, status: 'off', error: null });
  const developmentTextFixtureGenerationRef = useRef(0);
  const changeDevelopmentTextFixture = useCallback((enabled: boolean) => {
    const generation = ++developmentTextFixtureGenerationRef.current;
    const renderer = engineRef.current;
    if (!enabled) {
      setDevelopmentTextFixture({ enabled: false, status: 'off', error: null });
      if (renderer) void renderer.setDevelopmentTextFixtureEnabled(false);
      appendDebugMessage('info', 'GPU text canvas fixture', 'Disabled.');
      return;
    }
    if (!import.meta.env.DEV || !renderer) {
      const error = !import.meta.env.DEV
        ? 'The canvas text fixture is available only in development builds.'
        : 'Open a document before enabling the canvas text fixture.';
      setDevelopmentTextFixture({ enabled: false, status: 'error', error });
      appendDebugMessage('error', 'GPU text canvas fixture', error);
      return;
    }
    setDevelopmentTextFixture({ enabled: true, status: 'preparing', error: null });
    void renderer.setDevelopmentTextFixtureEnabled(true).then((snapshot) => {
      if (generation !== developmentTextFixtureGenerationRef.current) return;
      setDevelopmentTextFixture({
        enabled: snapshot.enabled,
        status: snapshot.status,
        error: snapshot.error
      });
      appendDebugMessage('info', 'GPU text canvas fixture', 'Ready on the real rgba16float canvas path.');
    }).catch((reason: unknown) => {
      if (generation !== developmentTextFixtureGenerationRef.current) return;
      const error = reason instanceof Error ? reason.message : 'The canvas text fixture could not be prepared.';
      setDevelopmentTextFixture({ enabled: false, status: 'error', error });
      appendDebugMessage('error', 'GPU text canvas fixture', error);
    });
  }, [appendDebugMessage]);
  const reportedFontDiagnosticsRef = useRef('');
  useEffect(() => {
    const signature = `${imageDocument?.id ?? 'no-document'}:${JSON.stringify(fontDiagnostics)}`;
    if (signature === reportedFontDiagnosticsRef.current) return;
    reportedFontDiagnosticsRef.current = signature;
    fontDiagnostics.forEach(({ layerId, layerName, status }) => {
      appendDebugMessage(
        'warning',
        'Text fonts',
        `${status.label}: ${layerName}`,
        `layer=${layerId}; ${status.detail}`
      );
    });
  }, [appendDebugMessage, fontDiagnostics, imageDocument?.id]);
  const documentProjectionController = useMemo(
    () => createDocumentProjectionController({
      getDocument: () => imageDocumentRef.current,
      publishDocument: (document) => {
        imageDocumentRef.current = document;
        setImageDocument(document);
      },
      getDocumentAdjustments: () => documentAdjustmentsRef.current,
      publishDocumentAdjustments: (nextAdjustments) => {
        documentAdjustmentsRef.current = nextAdjustments;
      },
      publishEditorAdjustments: (nextAdjustments, domain) => {
        publishAdjustmentPresentation(nextAdjustments, domain);
      },
      getGroupVisibility: () => groupVisibilityRef.current,
      publishGroupVisibility: (visibility) => {
        groupVisibilityRef.current = visibility;
        setGroupVisibility(visibility);
      },
      publishRendererDocument: (document) => {
        engineRef.current?.setDocument(document);
      },
      publishRendererAdjustments: (nextAdjustments) => {
        engineRef.current?.setAdjustments(nextAdjustments);
      }
    }),
    [publishAdjustmentPresentation, setImageDocument]
  );
  const applyAdjustmentSnapshot = documentProjectionController.applyAdjustmentSnapshot;
  const previewAdjustmentSnapshot = documentProjectionController.previewAdjustmentSnapshot;

  const finishOpenHistoryTransactions = useCallback(() => {
    commitPointTextRef.current();
    commitParagraphTextRef.current();
    finishTextEditingRef.current();
    resetAdjustmentTransactionRef.current();
    resetDocumentTransactionRef.current();
  }, []);

  const documentHistoryController = useDocumentHistoryController({
    documentId: workspaceDocumentId as DocumentSessionId,
    history: commandHistory,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    finishOpenTransactions: finishOpenHistoryTransactions,
    setError
  });
  const clearEditorHistory = documentHistoryController.clear;
  const pushHistoryEntry = documentHistoryController.record;

  const applyDocumentSnapshot = documentProjectionController.applyDocumentSnapshot;

  const documentMutationController = useDocumentMutationController({
    getDocument: () => imageDocumentRef.current,
    applySnapshot: applyDocumentSnapshot,
    pushHistoryEntry
  });
  resetDocumentTransactionRef.current = documentMutationController.reset;
  const pushDocumentHistory = documentMutationController.record;
  const beginDocumentTransaction = documentMutationController.begin;
  const endDocumentTransaction = documentMutationController.end;
  const textEditingControllerRef = useRef<FlowTextEditingSessionController | null>(null);
  textEditingControllerRef.current ??= new FlowTextEditingSessionController(() => ({
    getDocument: () => imageDocumentRef.current,
    applyDocument: applyDocumentSnapshot,
    pushHistory: (entry) => pushHistoryEntry({
      ...entry,
      type: `text.${entry.group}`,
      label: entry.group === 'composition' ? 'Compose text' : 'Edit text'
    })
  }));
  const textEditingController = textEditingControllerRef.current;
  const textEditing = useSyncExternalStore(
    textEditingController.subscribe,
    textEditingController.getSnapshot,
    textEditingController.getSnapshot
  );
  finishTextEditingRef.current = () => textEditingController.finish();

  useEffect(() => {
    if (textEditing.status !== 'editing' || imageDocument?.activeLayerId === textEditing.layerId) return;
    const gesture = textPropertyGestureRef.current;
    if (gesture?.kind === 'text' && gesture.layerId === textEditing.layerId) {
      textEditingController.endFormatting();
      textPropertyGestureRef.current = null;
    }
    textEditingController.finish();
  }, [imageDocument?.activeLayerId, textEditing.layerId, textEditing.status, textEditingController]);

  const selectionSessionController = useSelectionSessionController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getSelection: () => editorSession.selection,
    publishSelection: (selection, pointerId) => {
      setEditorSession((current) => ({ ...current, pointerId, selection }));
    },
    publishDraft: setSelectionDraft,
    pushHistoryEntry,
    setError
  }, selectionGestureRef.current);

  const adjustmentTransactionController = useAdjustmentTransactionController({
    getDocumentId: () => imageDocumentRef.current?.id ?? null,
    getAdjustments: () => adjustmentsRef.current,
    getActiveTargetLayerId: () => {
      const document = imageDocumentRef.current;
      if (!document) return null;
      const active = findDocumentLayer(document, document.activeLayerId);
      return active?.type === 'adjustment' || active?.type === 'raster'
        ? active.id
        : null;
    },
    getRenderer: () => engineRef.current,
    previewSnapshot: previewAdjustmentSnapshot,
    commitSnapshot: applyAdjustmentSnapshot,
    pushHistoryEntry
  });
  resetAdjustmentTransactionRef.current = adjustmentTransactionController.reset;

  const beginAdjustmentTransaction = adjustmentTransactionController.begin;
  const endAdjustmentTransaction = adjustmentTransactionController.end;
  const changeAdjustments = adjustmentTransactionController.change;
  const lensBlurEnabled = useAdjustmentPresentationSelector(
    adjustmentPresentationStore,
    (current) => current.effects.lensBlur.enabled
  );
  const {
    depthResult,
    depthProgress,
    reset: resetLensBlurDepth
  } = useLensBlurDepthController({
    open,
    enabled: lensBlurEnabled,
    sourceBlob,
    sourceIdentity,
    getRenderer: () => engineRef.current,
    estimateDepth: (blob, identity, onProgress) =>
      lightTableDepthAnalysis.estimate(blob, identity, onProgress),
    disableLensBlur: () => {
      changeAdjustments((current) => ({
        ...current,
        effects: {
          ...current.effects,
          lensBlur: { ...current.effects.lensBlur, enabled: false }
        }
      }), 'lens-fx');
    }
  });

  const beginLensBlurInteraction = useCallback(() => {
    beginAdjustmentTransaction();
  }, [beginAdjustmentTransaction]);

  const endLensBlurInteraction = useCallback(() => {
    endAdjustmentTransaction();
  }, [endAdjustmentTransaction]);

  const adjustmentCommands = createAdjustmentCommands({
    beginAdjustment: beginAdjustmentTransaction,
    endAdjustment: endAdjustmentTransaction,
    beginLensBlurInteraction,
    endLensBlurInteraction,
    changeAdjustments,
    getAdjustments: () => adjustmentsRef.current,
    getGroupVisibility: () => groupVisibilityRef.current,
    publishGroupVisibility: (visibility) => {
      documentProjectionController.applyGroupVisibilitySnapshot(visibility);
    },
    setFocusPickerActive,
    publishLensBlurViewportMode: (mode) => {
      setLensBlurViewportModeState(mode);
    },
    getSourceName: () => sourceName,
    publishGradeStatus: setGradeStatus
  });
  const {
    updateAdjustment,
    resetAdjustment,
    updateGrain: updateGrainAdjustment,
    resetGrainControl: resetGrainAdjustment,
    resetGrain,
    toggleGrain,
    updateHalation: updateHalationAdjustment,
    resetHalationControl: resetHalationAdjustment,
    resetHalation,
    setHalationEnabled,
    updateChromaticAberration: updateChromaticAberrationAdjustment,
    resetChromaticAberrationControl: resetChromaticAberrationAdjustment,
    resetChromaticAberration,
    setChromaticAberrationEnabled,
    updateLensDistortion: updateLensDistortionAdjustment,
    resetLensDistortionControl: resetLensDistortionAdjustment,
    resetLensDistortion,
    setLensDistortionEnabled,
    updateLensBlur: updateLensBlurAdjustment,
    resetLensBlurControl: resetLensBlurAdjustment,
    resetLensBlur,
    setLensBlurEnabled,
    setLensBlurShape,
    setLensBlurQuality,
    setLensBlurViewportMode,
    updateColorMixer: updateColorMixerAdjustment,
    resetColorMixer: resetColorMixerAdjustment,
    updateColorGradingWheel,
    updateColorGradingLuminance,
    updateColorGradingControl,
    resetColorGradingControl,
    resetColorGradingZone,
    resetColorGradingLuminance,
    updateCurve,
    resetCurve,
    resetAll,
    toggleGroupVisibility,
    resetGroup
  } = adjustmentCommands;
  const copyCurrentGrade = adjustmentCommands.copyGrade;
  const pasteCurrentGrade = () => {
    if (copiedGrade) {
      adjustmentCommands.pasteGrade(copiedGrade.name, copiedGrade.settings);
    }
  };

  const undoEditor = useCallback(() => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    void documentHistoryController.undo();
  }, [documentHistoryController, endAdjustmentTransaction, endDocumentTransaction]);

  const redoEditor = useCallback(() => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    void documentHistoryController.redo();
  }, [documentHistoryController, endAdjustmentTransaction, endDocumentTransaction]);

  const getDocumentPublicationPorts = useCallback(() => ({
    mergeStartupTimings: (timings: LightTableStartupTimings) => {
      startupTelemetryRef.current.merge(timings);
    },
    publishDocument: (nextDocument: ImageDocument) => {
      imageDocumentRef.current = nextDocument;
      // PSD sources are converted into native LightTable assets. The source
      // file itself is not duplicated in the native document.
      preservedSourceAssetsRef.current = [];
      fontAssetsRef.current = [];
      setFontHydrationPending(nextDocument.assets.fonts.length > 0);
      setImageDocument(nextDocument);
      setThumbnailDocumentReadyId(nextDocument.id);
    },
    publishMetadata: setMetadata,
    publishBinaryAssets: (fontAssets: readonly FontAssetBlob[], preservedSources: readonly PreservedSourceAssetBlob[]) => {
      fontAssetsRef.current = [...fontAssets];
      preservedSourceAssetsRef.current = [...preservedSources];
      const hydrationGeneration = fontHydrationGenerationRef.current;
      const hydrationDocumentId = imageDocumentRef.current?.id ?? null;
      const hydrationRegistry = documentSession?.fonts ?? standaloneFontRegistryRef.current!;
      const fontMetadata = imageDocumentRef.current?.assets.fonts ?? [];
      void hydrateDocumentFonts(hydrationRegistry, fontAssets, fontMetadata).catch((reason) => {
        if (
          hydrationGeneration === fontHydrationGenerationRef.current
          && hydrationDocumentId === imageDocumentRef.current?.id
        ) setError(reason instanceof Error ? reason.message : 'Document fonts could not be loaded.');
      }).finally(() => {
        if (
          hydrationGeneration === fontHydrationGenerationRef.current
          && hydrationDocumentId === imageDocumentRef.current?.id
        ) setFontHydrationPending(false);
      });
    },
    publishPsdImport: setPsdImportInfo,
    publishPsdCompatibility: (entries: readonly PsdImportCompatibilityEntry[]) =>
      setPsdCompatibility([...entries]),
    publishPsdDifference: setPsdDifferenceMetrics,
    publishSource: (nextName: string, nextBlob: Blob, identity: string) => {
      setSourceName(nextName);
      setSourceBlob(nextBlob);
      setSourceIdentity(identity);
    },
    resetDocumentInteraction: () => {
      resetLensBlurDepth();
      setFocusPickerActive(false);
      selectionGestureRef.current.reset();
      paintGestureRef.current.reset();
      setSelectionDraft(null);
      resetTransformRef.current();
      setEditorSession((current) => ({ ...current, selection: [] }));
      setSelectionClipboardAvailable(false);
      editorDialogs.closeFeather();
      setLensBlurViewportModeState('result');
      clearEditorHistory();
      setHistogram(null);
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
    },
    publishAdjustments: (nextAdjustments: BasicAdjustments) => {
      documentAdjustmentsRef.current = nextAdjustments;
      publishAdjustmentPresentation(nextAdjustments);
    },
    publishStatus: setGradeStatus,
    reportDifferenceFailure: (failure: unknown) => {
      console.warn('LightTable PSD difference measurement failed', failure);
    },
    reportPsdWarnings: (warnings: readonly string[]) => {
      console.warn('LightTable PSD semantic import warnings', warnings);
    }
  }), [
    clearEditorHistory,
    documentSession,
    textFontRegistry,
    publishAdjustmentPresentation,
    resetLensBlurDepth,
    setEditorSession,
    setImageDocument,
    setView,
    setZoomMode
  ]);

  useEffect(() => {
    return textFontRegistry.subscribeAvailability(() => {
      setFontAvailabilityRevision((revision) => revision + 1);
    });
  }, [textFontRegistry]);

  const beforeDocumentOpen = useCallback(() => {
    finishTextEditingRef.current();
    fontHydrationGenerationRef.current += 1;
    if (!documentSession) {
      standaloneFontRegistryRef.current?.dispose();
      standaloneFontRegistryRef.current = new DocumentFontRegistry({
        parser: new FontationsFontFaceParser()
      });
      setFontAvailabilityRevision((revision) => revision + 1);
    }
    resetDocumentOpenPresentation({
      initialAdjustments: initialRecipe?.settings,
      port: {
        resetTelemetry: () => {
          startupTelemetryRef.current.begin();
          setStartupTimings(null);
          setLoading(true);
        },
        resetSource: () => {
          setSourceName(fileNameBase);
          setSourceBlob(null);
          setSourceIdentity('');
        },
        resetDocument: () => {
          setMetadata(null);
          imageDocumentRef.current = null;
          preservedSourceAssetsRef.current = [];
          fontAssetsRef.current = [];
          setFontHydrationPending(false);
          setImageDocument(null);
          setThumbnailDocumentReadyId(null);
        },
        resetSelection: (editorSession) => {
          setEditorSession(editorSession);
          selectionGestureRef.current.reset();
          paintGestureRef.current.reset();
          setSelectionDraft(null);
          setSelectionClipboardAvailable(false);
          editorDialogs.closeFeather();
          resetTransformRef.current();
        },
        resetLensBlur: () => {
          resetLensBlurDepth();
          setFocusPickerActive(false);
          setLensBlurViewportModeState('result');
        },
        publishAdjustments: (startingAdjustments) => {
          publishAdjustmentPresentation(startingAdjustments);
        },
        resetHistory: clearEditorHistory,
        resetViewport: () => {
          setIsolatedMaskLayerId(null);
          setIsolatedCompositeChannel(null);
          setShowOriginal(false);
          setShowDifference(false);
          setView({ scale: 1, panX: 0, panY: 0 });
        },
        resetScopes: (settings, visibility) => {
          scopeSettingsRef.current = settings;
          scopeVisibilityRef.current = visibility;
          setScopeSettings(settings);
          setScopeVisibility(visibility);
          setHistogram(null);
        },
        resetDiagnostics: () => {
          setError(null);
          setScopeError(null);
          setGradeStatus(null);
          setGpuMemoryBytes(0);
          setTextRenderPresentation({
            publicationRevision: 0,
            readyLayerCount: 0,
            textureBytes: 0,
            mode: 'placeholder', rebuildingLayerCount: 0,
            cacheBudgetBytes: 256 * 1024 * 1024, cacheEvictions: 0,
            atlasLayerCount: 0, cachedLayerCount: 0, atlasEncodes: 0,
            sourceCacheHits: 0, sourceCacheMisses: 0,
            layoutCacheBytes: 0, layoutCacheBudgetBytes: 32 * 1024 * 1024,
            layoutCacheHits: 0, layoutCacheMisses: 0, layoutCacheEvictions: 0,
            atlasBytes: 0, atlasHits: 0, atlasMisses: 0, atlasEvictions: 0,
            sourceDecisionMeasurements: 0, lastSourceDecision: null,
            coordinatorActive: true, configuredFontCount: 0, visibleTextLayerCount: 0,
            preparationStage: 'waiting-document', preparationLayerId: null, lastPreparationError: null,
            traceRevision: 0, traceMessage: null, traceDetails: null,
            shapingOperations: 0, latestShapingRoundTripMs: 0,
            rasterizedGlyphs: 0, latestRasterRoundTripMs: 0, textCacheSubmissions: 0,
            textInputLatencySamples: 0, pendingTextInputs: 0, supersededTextInputs: 0,
            inputToSubmitP95Ms: 0, inputToSubmitMaxMs: 0,
            inputToGpuP95Ms: 0, inputToGpuMaxMs: 0
          });
          setPsdImportInfo(null);
          setPsdDifferenceMetrics(null);
          setPsdCompatibility([]);
          editorDialogs.reset();
        },
        publishGroupVisibility: (visibility) => {
          groupVisibilityRef.current = visibility;
          setGroupVisibility(visibility);
        }
      }
    });
  }, [
    clearEditorHistory,
    documentSession,
    fileNameBase,
    initialRecipe,
    resetLensBlurDepth,
    setEditorSession,
    setImageDocument,
    setView
  ]);

  const getDocumentOpenScopeOptions = useCallback(() => ({
    histogramVisible: scopeVisibilityRef.current.histogram,
    options: createScopeRendererOptions(
      scopeVisibilityRef.current,
      scopeSettingsRef.current
    )
  }), []);

  const documentOpenGeneration = useMemo(() => ({}), [
    documentSurfaceRevision,
    editorSourceFileKey,
    initialRecipe,
    initialSourceBlob,
    initialSourceName,
    loadSource,
    projectId,
    sourceDecodeMode
  ]);

  const afterDocumentClose = useCallback(() => {
    cancelAutoAlignRef.current();
    clearEditorHistory();
    engineRef.current = null;
  }, [clearEditorHistory]);

  const documentLifecycleController = useEditorDocumentLifecycleController({
    enabled: open,
    generation: documentOpenGeneration,
    tasks: taskRegistry,
    rendererLifecycle,
    textFontRuntimePort,
    canvases: {
      viewport: canvasRef,
      hueDistribution: hueDistributionCanvasRef,
      colorMixerHueDistribution: colorMixerHueCanvasRef,
      parade: paradeCanvasRef,
      vectorscope: vectorscopeCanvasRef
    },
    rendererRef: engineRef,
    telemetryRef: startupTelemetryRef,
    source: {
      inlineSource: initialSourceBlob,
      projectId,
      sourceFileKey: editorSourceFileKey,
      loadSource,
      name: initialSourceName,
      identity: editorSourceFileKey ?? initialSourceName,
      decodeMode: sourceDecodeMode,
      initialAdjustments: initialRecipe?.settings ?? createDefaultAdjustments()
    },
    getGroupVisibility: () => groupVisibilityRef.current,
    getPublicationPorts: getDocumentPublicationPorts,
    getScopeOptions: getDocumentOpenScopeOptions,
    publishHistogram: setHistogram,
    publishGpuMemory: setGpuMemoryBytes,
    publishTextRenderPresentation,
    publishError: setError,
    publishScopeError: setScopeError,
    publishFeatureError: (featureId, message) => {
      appendDebugMessage('error', `GPU feature: ${featureId}`, message);
      setGradeStatus(`${featureId} is unavailable; the image remains in bypass mode.`);
    },
    publishTimings: setStartupTimings,
    publishLoading: setLoading,
    logTimings: (timings) => console.info('[LightTable startup]', timings),
    beforeOpen: beforeDocumentOpen,
    afterClose: afterDocumentClose
  });

  const textEditingOverlay = useMemo(() => {
    if (textEditing.status !== 'editing' || !textEditing.layerId) return null;
    const presentation = engineRef.current?.textEditingLayout(textEditing.layerId);
    if (!presentation) return null;
    const composition = textEditing.compositionRange ? {
      start: Math.min(textEditing.compositionRange.anchor, textEditing.compositionRange.focus),
      end: Math.max(textEditing.compositionRange.anchor, textEditing.compositionRange.focus)
    } : null;
    return buildTextEditingOverlay({
      layerId: textEditing.layerId,
      layout: presentation.layout,
      localToDocument: presentation.localToDocument,
      anchor: textEditing.selection.anchor,
      focus: textEditing.selection.focus,
      caretAffinity: textEditing.caretAffinity,
      composition
    });
  }, [
    imageDocument,
    textEditing,
    textRenderPresentation.publicationRevision
  ]);

  useEffect(() => {
    const layerId = textEditing.status === 'editing' ? textEditing.layerId : null;
    if (!layerId) return undefined;
    const renderer = engineRef.current;
    renderer?.setTextLayerInteraction(layerId, true);
    return () => {
      renderer?.setTextLayerInteraction(layerId, false);
    };
  }, [textEditing.layerId, textEditing.status]);

  useEffect(() => {
    const renderer = engineRef.current;
    if (!renderer || !active || !textEditingOverlay) {
      renderer?.setTextEditingOverlay(null);
      return undefined;
    }
    let caretVisible = true;
    renderer.setTextEditingOverlay(textEditingOverlay, caretVisible);
    const blink = window.setInterval(() => {
      caretVisible = !caretVisible;
      renderer.setTextEditingOverlay(textEditingOverlay, caretVisible);
    }, 530);
    return () => {
      window.clearInterval(blink);
      renderer.setTextEditingOverlay(null);
    };
  }, [active, textEditingOverlay]);

  useRendererPresentationSync({
    rendererRef: engineRef,
    showOriginal,
    showDifference,
    isolatedMaskLayerId,
    isolatedCompositeChannel,
    lensBlurViewportMode,
    warpDebugView: editorSession.warp.debugView,
    vectorSelection: editorSession.vectorSelection,
    selection: editorSession.selection,
    selectionDraft,
    selectionOverlayVisible: editorSession.activeTool !== 'view',
    scopeVisibility,
    scopeSettings,
    scopeVisibilityRef,
    scopeSettingsRef
  });

  useEffect(() => {
    if (!isolatedMaskLayerId) return;
    const isolatedLayer = imageDocument
      ? findDocumentLayer(imageDocument, isolatedMaskLayerId)
      : null;
    if (!isolatedLayer?.mask) setIsolatedMaskLayerId(null);
  }, [imageDocument, isolatedMaskLayerId]);

  useEffect(() => {
    engineRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    if (!gradeStatus) return;
    const timeout = window.setTimeout(() => setGradeStatus(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [gradeStatus]);

  const selectAllContent = selectionSessionController.selectAll;
  const clearCurrentSelection = selectionSessionController.clear;
  const invertCurrentSelection = selectionSessionController.invert;
  const featherCurrentSelection = selectionSessionController.feather;
  const setExactZoom = (percent: number) => {
    setZoomMode('custom');
    setView(zoomViewToScaleAtPoint({
      cursor: {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2
      },
      viewport: viewportSize,
      view: { scale: activeScale, panX: view.panX, panY: view.panY },
      scale: zoomPercentToScale(percent)
    }));
  };
  const fitZoom = () => {
    setZoomMode('fit');
    setView({ scale: 1, panX: 0, panY: 0 });
  };

  useEditorKeyboardController({
    enabled: open && active,
    getContext: () => ({
      saving,
      activeTool: editorSession.activeTool,
      hasActiveLayer: Boolean(imageDocumentRef.current?.activeLayerId),
      hasSelection: editorSession.selection.length > 0,
      hasSelectionClipboard: selectionClipboardAvailable,
      transforming: transformActiveRef.current()
    }),
    commands: {
      openFile: () => { finishTextEditingRef.current(); void chooseLocalFile('automatic'); },
      saveFile: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleSave(); },
      quickExportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPng(); },
      isTransformActive: () => transformActiveRef.current(),
      commitTransform: () => commitTransformRef.current(),
      activateTool: (tool) => activateToolRef.current(tool),
      undo: () => { void undoEditor(); },
      redo: () => { void redoEditor(); },
      beginTemporaryPan: () => {
        if (temporaryToolRef.current.begin('view')) setTemporaryPanActive(true);
      },
      beginTemporaryErase: () => {
        if (temporaryToolRef.current.begin('erase')) setTemporaryEraseActive(true);
      },
      fillForeground: () =>
        fillActiveTargetRef.current(editorSession.brush.color),
      fillBackground: () =>
        fillActiveTargetRef.current(editorSession.brush.backgroundColor),
      selectAll: selectAllContent,
      selectNone: clearCurrentSelection,
      invertSelection: invertCurrentSelection,
      copySelection: () => copySelectedContentRef.current(),
      copyMergedSelection: () => copyMergedContentRef.current(),
      pasteSelection: () => pasteSelectedContentRef.current(),
      layerViaCopy: () => layerViaCopyRef.current(),
      mergeDown: () => mergeActiveLayerDownRef.current(),
      invertActiveTarget: () => invertActiveLayerColorsRef.current(),
      openSelectionFeather: editorDialogs.openFeather,
      swapColors: () => setEditorSession((current) => ({
        ...current,
        brush: {
          ...current.brush,
          color: current.brush.backgroundColor,
          backgroundColor: current.brush.color
        }
      })),
      resetColors: () => setEditorSession((current) => ({
        ...current,
        brush: { ...current.brush, color: '#000000', backgroundColor: '#ffffff' }
      })),
      toggleOriginal: () => {
        setShowDifference(false);
        setShowOriginal((current) => !current);
      },
      toggleScreenMode,
      changeBrushSize: (direction) => setEditorSession((current) => current.activeTool === 'warp'
        ? {
            ...current,
            warp: {
              ...current.warp,
              diameterPx: steppedBrushSize(current.warp.diameterPx, direction)
            }
          }
        : {
            ...current,
            brush: {
              ...current.brush,
              size: steppedBrushSize(current.brush.size, direction)
            }
          }),
      changeBrushHardness: (direction) => setEditorSession((current) => current.activeTool === 'warp'
        ? {
            ...current,
            warp: {
              ...current.warp,
              hardness: steppedBrushHardness(current.warp.hardness * 100, direction) / 100
            }
          }
        : {
            ...current,
            brush: {
              ...current.brush,
              hardness: steppedBrushHardness(current.brush.hardness * 100, direction) / 100
            }
          }),
      inputBrushPercent: (target, digit) => {
        const percent = brushPercentInputRef.current.input(target, digit);
        setEditorSession((current) => ({
          ...current,
          brush: { ...current.brush, [target]: percent / 100 }
        }));
      },
      activateAdjacentDocument: (direction) => {
        if (!onActivateWorkspaceDocument || !workspaceDocuments?.length) return;
        const currentIndex = workspaceDocuments.findIndex(
          (document) => document.id === workspaceDocumentId
        );
        const origin = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (
          origin + direction + workspaceDocuments.length
        ) % workspaceDocuments.length;
        const nextDocument = workspaceDocuments[nextIndex];
        if (nextDocument && nextDocument.id !== workspaceDocumentId) {
          onActivateWorkspaceDocument(nextDocument.id);
        }
      },
      closeActiveDocument: onClose,
      changeZoom: (direction) => {
        setExactZoom(steppedZoomPercent(activeScale * 100, direction));
      },
      fitZoom,
      cancelOrClose: () => {
        if (cancelParagraphTextRef.current()) return;
        if (cancelPointTextRef.current()) return;
        if (transformActiveRef.current()) {
          cancelTransformRef.current();
          return;
        }
        if (autoAlignPreview) {
          cancelAutoAlignRef.current();
          return;
        }
        if (selectionSessionController.draft) {
          selectionSessionController.reset();
          return;
        }
        if (editorSession.selection.length) {
          selectionSessionController.clear();
          return;
        }
        onClose();
      }
    },
    temporaryPanActive: () => temporaryToolRef.current.activeTool === 'view',
    releaseTemporaryPan: () => {
      if (temporaryToolRef.current.end('view')) setTemporaryPanActive(false);
    },
    temporaryEraseActive: () => temporaryToolRef.current.activeTool === 'erase',
    releaseTemporaryErase: () => {
      if (temporaryToolRef.current.end('erase')) setTemporaryEraseActive(false);
    },
    clearTemporaryTool: () => {
      if (temporaryToolRef.current.end()) {
        setTemporaryPanActive(false);
        setTemporaryEraseActive(false);
      }
      brushPercentInputRef.current.clear();
    },
    onShiftChange: setShiftPressed
  });

  const fillCommandController = useFillCommandController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getChannel: () => editorSession.activeChannel,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setStatus: setGradeStatus,
    setError
  });
  const fillActiveTarget = fillCommandController.fill;
  fillActiveTargetRef.current = fillActiveTarget;

  const paintSessionController = usePaintSessionController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setError
  }, paintGestureRef.current);

  const warpSessionController = useWarpSessionController({
    getDocument: () => imageDocumentRef.current,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setError,
    createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`
  });

  const vectorToolSessionController = useVectorToolSessionController({
    document: imageDocument,
    selection: editorSession.vectorSelection,
    activeTool: editorSession.activeTool,
    foregroundColor: editorSession.brush.color,
    fillColor: editorSession.vectorStyle.fillColor,
    strokeColor: editorSession.vectorStyle.strokeColor,
    strokeWidth: editorSession.vectorStyle.strokeWidth,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection: (vectorSelection) => {
      setEditorSession((current) => ({ ...current, vectorSelection }));
    }
  });
  const selectedVectorStyle = useMemo(() => {
    const reference = editorSession.vectorSelection.elements[0];
    if (!reference || !imageDocument) return null;
    const layer = findDocumentLayer(imageDocument, reference.layerId);
    const element = layer?.type === 'vector'
      ? layer.elements.find(({ id }) => id === reference.elementId)
      : null;
    return element ? vectorElementStyleSettings(element) : null;
  }, [editorSession.vectorSelection.elements, imageDocument]);
  const updateSelectedVectorStyle = (change: Partial<EditorSession['vectorStyle']>) => {
    vectorToolSessionController.editSelectedElementStyles(
      (style) => patchVectorStyle(style, change)
    );
  };

  const selectedPointTextFont = () => {
    return resolveTextToolFont(textFontRegistry.availableAssets, editorSession.text);
  };

  const beginPointTextCreation = async (origin: { x: number; y: number }) => {
    const document = imageDocumentRef.current;
    if (!document) return;
    if (!engineRef.current || rendererLifecycle.getSnapshot().status !== 'ready') {
      setGradeStatus('Text creation is unavailable until the WebGPU renderer is ready.');
      return;
    }
    const generation = pointTextCapabilityGenerationRef.current + 1;
    pointTextCapabilityGenerationRef.current = generation;
    const documentId = document.id;
    setGradeStatus('Preparing the text engine...');
    try {
      await registerBundledTextFontForSettings(textFontRegistry, editorSession.text);
      await lightTableTextEngine.probe();
      // Font selection is the authoritative lazy-load boundary. Rebind here as
      // well as at renderer publication so a standalone registry replacement
      // cannot leave the first authored layer behind an empty open-time port.
      engineRef.current?.configureTextFonts(textFontRuntimePort);
      if (
        generation !== pointTextCapabilityGenerationRef.current
        || imageDocumentRef.current?.id !== documentId
        || editorSession.activeTool !== 'text-point'
        || !engineRef.current
        || rendererLifecycle.getSnapshot().status !== 'ready'
      ) return;
      pointTextController.begin(documentId, origin);
      setGradeStatus(null);
    } catch (reason) {
      if (generation !== pointTextCapabilityGenerationRef.current) return;
      setError(reason instanceof Error
        ? `Text creation is unavailable: ${reason.message}`
        : 'Text creation is unavailable because the text engine failed to load.');
    } finally {
      if (generation === pointTextCapabilityGenerationRef.current) {
        setGradeStatus(null);
      }
    }
  };

  const commitPointTextCreation = () => {
    const before = imageDocumentRef.current;
    const font = selectedPointTextFont();
    if (pointTextController.getSnapshot().request && !font) {
      setError('The selected text font and style are unavailable. Choose an available face.');
      return false;
    }
    const request = pointTextController.commit();
    if (!request || !before || !font || request.documentId !== before.id) return false;
    const after = createPointTextDocument(
      before,
      request,
      editorSession.text,
      font,
      editorSession.brush.color
    );
    if (after === before) return false;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    return true;
  };

  const cancelPointTextCreation = () => pointTextController.cancel();
  commitPointTextRef.current = commitPointTextCreation;
  cancelPointTextRef.current = cancelPointTextCreation;

  const beginParagraphTextCreation = (
    pointerId: number,
    origin: { x: number; y: number }
  ) => {
    const document = imageDocumentRef.current;
    if (!document || !engineRef.current || rendererLifecycle.getSnapshot().status !== 'ready') {
      setGradeStatus('Text creation is unavailable until the WebGPU renderer is ready.');
      return false;
    }
    pointTextController.cancel();
    textEditingController.finish();
    if (!paragraphTextController.begin(
      document.id,
      document.activeLayerId,
      pointerId,
      origin
    )) return false;
    const generation = ++pointTextCapabilityGenerationRef.current;
    const documentId = document.id;
    setGradeStatus('Preparing the text engine...');
    void (async () => {
      try {
        await registerBundledTextFontForSettings(textFontRegistry, editorSession.text);
        await lightTableTextEngine.probe();
        engineRef.current?.configureTextFonts(textFontRuntimePort);
        if (
          generation !== pointTextCapabilityGenerationRef.current
          || imageDocumentRef.current?.id !== documentId
        ) return;
      } catch (reason) {
        if (generation !== pointTextCapabilityGenerationRef.current) return;
        paragraphTextController.cancel();
        setError(reason instanceof Error
          ? `Text creation is unavailable: ${reason.message}`
          : 'Text creation is unavailable because the text engine failed to load.');
      } finally {
        if (generation === pointTextCapabilityGenerationRef.current) setGradeStatus(null);
      }
    })();
    return true;
  };

  const commitParagraphTextCreation = () => {
    const before = imageDocumentRef.current;
    const font = selectedPointTextFont();
    if (paragraphTextController.getSnapshot().request && !font) {
      setError('The selected text font and style are still loading. Try again.');
      return false;
    }
    const request = paragraphTextController.commit();
    if (!request || !before || !font || request.documentId !== before.id) return false;
    const after = createParagraphTextDocument(
      before,
      request,
      editorSession.text,
      font,
      editorSession.brush.color
    );
    if (after === before) return false;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    return true;
  };

  const cancelParagraphTextCreation = () => paragraphTextController.cancel();
  commitParagraphTextRef.current = commitParagraphTextCreation;
  cancelParagraphTextRef.current = cancelParagraphTextCreation;

  const viewportInteraction = useViewportInteractionController({
    metadata,
    document: imageDocument,
    imageRect,
    activeScale,
    viewportSize,
    view,
    setView,
    setZoomMode,
    editorSession,
    setEditorSession,
    temporaryTools: temporaryToolRef.current,
    focusPickerActive: focusPickerActive && Boolean(depthResult),
    onFocusPick: ({ x, y }) => {
      if (!metadata || !depthResult) return;
      const sourceUv = mapLensDistortionUv(
        x,
        y,
        metadata.width,
        metadata.height,
        adjustmentsRef.current.effects.lensDistortion
      );
      const selectedDepth = sampleMedianDepth(depthResult, sourceUv.x, sourceUv.y);
      if (selectedDepth === null) return;
      changeAdjustments((current) => ({
        ...current,
        effects: {
          ...current.effects,
          lensBlur: {
            ...current.effects.lensBlur,
            focusDistance: selectedDepth
          }
        }
      }), 'lens-fx');
    },
    onFocusPickerEnd: () => setFocusPickerActive(false),
    onFill: fillActiveTarget,
    onPointTextCreate: (point) => {
      const document = imageDocumentRef.current;
      if (document) {
        const candidates = walkLayerTree(document.layers)
          .map(({ node }) => node)
          .filter((node) => node.type === 'text' && node.text.source.kind === 'flow')
          .reverse();
        for (const layer of candidates) {
          const layout = engineRef.current?.textEditingLayout(layer.id);
          const hit = layout ? hitTestTextEditingLayout(layout, point) : null;
          if (!hit) continue;
          pointTextController.cancel();
          selectLayerRef.current(layer.id);
          textEditingController.begin(layer.id, hit.offset, hit.affinity);
          return;
        }
      }
      textEditingController.finish();
      void beginPointTextCreation(point);
    },
    paragraphText: {
      begin: beginParagraphTextCreation,
      owns: (pointerId) => paragraphTextController.owns(pointerId),
      move: (pointerId, point) => paragraphTextController.move(pointerId, point),
      finish: (pointerId) => paragraphTextController.finish(pointerId),
      cancel: (pointerId) => paragraphTextController.owns(pointerId)
        ? paragraphTextController.cancel()
        : false
    },
    selection: selectionSessionController,
    paint: paintSessionController,
    warp: warpSessionController,
    vector: vectorToolSessionController,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    onBrushCursorChange: (cursor) => {
      engineRef.current?.setBrushCursorOverlay(cursor);
    }
  });

  const applyDocumentChange = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    textEditingController.finish();
    documentMutationController.change(change, recordHistory);
  };

  const layerDocumentCommands = useLayerDocumentCommands({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getImageClipboard: () => imageClipboard,
    getDocumentId: () => workspaceDocumentId,
    applyDocumentSnapshot,
    pushDocumentHistory,
    pushHistoryEntry,
    setActiveChannel: (activeChannel) => {
      setEditorSession((session) => ({ ...session, activeChannel }));
    },
    setSelectionClipboardAvailable,
    setStatus: setGradeStatus,
    setError,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    getPanelAdjustments: () => adjustmentsRef.current,
    publishDocumentAdjustments: (next) => {
      documentAdjustmentsRef.current = cloneAdjustments(next);
    },
    publishPanelAdjustments: (next) => {
      publishAdjustmentPresentation(cloneAdjustments(next));
    }
  });
  const duplicateActiveLayer = layerDocumentCommands.duplicateActiveLayer;
  const rasterizeActiveTextLayer = layerDocumentCommands.rasterizeActiveTextLayer;
  const mergeSelectedRasterLayers = layerDocumentCommands.mergeSelectedRasterLayers;
  const mergeActiveLayerDown = layerDocumentCommands.mergeActiveLayerDown;
  const mergeSelectionOrActiveDown = useCallback(() => {
    const selectedLayerIds = selectedLayerIdsRef.current;
    return selectedLayerIds.length > 1
      ? mergeSelectedRasterLayers(selectedLayerIds)
      : mergeActiveLayerDown();
  }, [mergeActiveLayerDown, mergeSelectedRasterLayers]);
  const handleLayerSelectionChange = useCallback((layerIds: LayerId[]) => {
    selectedLayerIdsRef.current = layerIds;
  }, []);

  const copySelectedContent = () => {
    void layerDocumentCommands.copySelectedContent(editorSession.selection);
  };
  copySelectedContentRef.current = copySelectedContent;

  const copyMergedContent = () => {
    void layerDocumentCommands.copyMergedContent(editorSession.selection);
  };
  copyMergedContentRef.current = copyMergedContent;

  const pasteSelectedContent = () => {
    void layerDocumentCommands.pasteSelectedContent(editorSession.selection);
  };
  pasteSelectedContentRef.current = pasteSelectedContent;

  const layerViaCopy = () => {
    layerDocumentCommands.layerViaCopy(editorSession.selection);
  };
  layerViaCopyRef.current = layerViaCopy;
  mergeActiveLayerDownRef.current = mergeSelectionOrActiveDown;

  const autoAlignController = useAutoAlignController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    pushDocumentHistory,
    setStatus: setGradeStatus,
    setError
  });
  const autoAlignPreview = autoAlignController.preview;
  const cancelAutoAlignPreview = autoAlignController.cancel;
  const applyAutoAlignPreview = autoAlignController.apply;
  const beginAutoAlign = autoAlignController.begin;
  cancelAutoAlignRef.current = cancelAutoAlignPreview;

  const layerStyleEditor = useLayerStyleEditorController({
    activeDocument: imageDocument,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    pushDocumentHistory
  });
  const openLayerStyleEditor = layerStyleEditor.open;
  const layerPanelController = useLayerPanelController({
    getDocument: () => imageDocumentRef.current,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    mutateDocument: applyDocumentChange,
    publishPanelAdjustments: (next) => {
      publishAdjustmentPresentation(cloneAdjustments(next));
    },
    setPaintTarget: (activeChannel, brushColor) => {
      setEditorSession((current) => ({
        ...current,
        activeChannel,
        brush: brushColor
          ? { ...current.brush, color: brushColor }
          : current.brush
      }));
    },
    beginDocumentTransaction,
    endDocumentTransaction,
    createAdjustmentLayer: layerDocumentCommands.createAdjustmentLayer,
    createLensFxLayer: layerDocumentCommands.createLensFxLayer,
    addActiveLayerMask: () => layerDocumentCommands.addActiveLayerMask(
      editorSession.selection.length > 0
    ),
    duplicateActiveLayer,
    rasterizeActiveTextLayer,
    loadLayerMaskSelection: selectionSessionController.selectLayerMask,
    mergeActiveLayerDown: mergeSelectionOrActiveDown,
    mergeSelectedRasterLayers,
    requestFlattenGroup: (groupId) =>
      editorDialogs.requestFlatten({ kind: 'group', groupId }),
    requestFlattenImage: () => editorDialogs.requestFlatten({ kind: 'image' }),
    editStyles: openLayerStyleEditor,
    prepareActiveLayerChange: (layerId) => {
      if (textEditingController.getSnapshot().layerId !== layerId) {
        textEditingController.finish();
      }
      vectorToolSessionController.prepareActiveLayerChange(layerId);
    },
    finishTextEditing: () => { textEditingController.finish(); }
  });
  selectLayerRef.current = layerPanelController.select;

  const transformSession = useTransformSessionController({
    activeTool: editorSession.activeTool,
    activeDocument: imageDocument,
    activeLayerId: imageDocument?.activeLayerId ?? null,
    selection: editorSession.selection,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    applyDocumentAndSelection: (document, selection) => {
      applyDocumentSnapshot(document);
      setEditorSession((current) => ({
        ...current,
        pointerId: null,
        selection
      }));
    },
    pushDocumentHistory,
    pushHistoryEntry,
    activateViewTool: () => {
      setEditorSession((current) => ({
        ...current,
        pointerId: null,
        activeTool: 'view'
      }));
    },
    setError,
    setStatus: setGradeStatus
  });
  const transformState = transformSession.state;
  useEffect(() => {
    engineRef.current?.setTransformEditingFrame(
      transformState
        ? buildTransformEditingFrame(transformState, activeScale)
        : null
    );
  }, [activeScale, transformState]);
  const updateTransformMatrix = transformSession.update;
  const updateTransformProjective = transformSession.updateProjective;
  commitTransformRef.current = transformSession.commit;
  cancelTransformRef.current = transformSession.cancel;
  resetTransformRef.current = transformSession.reset;
  transformActiveRef.current = transformSession.isActive;

  const activatePersistentTool = (requestedTool: ToolId) => {
    if (requestedTool !== 'text-point') {
      pointTextCapabilityGenerationRef.current += 1;
      commitPointTextCreation();
      textEditingController.finish();
    }
    if (
      editorSession.activeTool === 'warp'
      && requestedTool !== 'warp'
      && warpSessionController.active
    ) {
      warpSessionController.reset();
    }
    const plan = planPersistentToolActivation(
      editorSession.activeTool,
      requestedTool,
      transformSession.isActive()
    );
    if (plan.finishTransform) transformSession.commit();
    if (plan.nextTool) {
      if (
        selectionSessionController.draft
        && editorSession.activeTool !== plan.nextTool
      ) {
        selectionSessionController.reset();
      }
      setEditorSession((current) => (
        current.activeTool === plan.nextTool
          ? current
          : { ...current, activeTool: plan.nextTool as ToolId }
      ));
    }
  };
  activateToolRef.current = activatePersistentTool;

  const commitFlattenRequest = () => {
    const request = editorDialogs.flattenRequest;
    editorDialogs.closeFlatten();
    if (request) layerDocumentCommands.flatten(request);
  };

  const invertActiveLayerColors = () => {
    layerDocumentCommands.invertActiveLayerColors(editorSession.activeChannel);
  };
  invertActiveLayerColorsRef.current = invertActiveLayerColors;

  const focusActiveLayerName = () => {
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (!layerId) return;
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`.lighttable-layer[data-layer-id="${layerId}"] .lighttable-layer__name`);
      input?.focus();
      input?.select();
    });
  };

  const {
    saving,
    save: handleSave,
    exportPng: handleExportPng,
    handleFastFileInput: handleLocalFile,
    handlePrecisionFileInput: handleAdvancedLocalFile,
    chooseLocalFile,
    fileInputRef,
    advancedFileInputRef
  } = useEditorDocumentFileController({
    lifecycle: documentLifecycleController,
    taskRegistry,
    commandHistory,
    effectiveSourceFileKey,
    fileNameBase,
    hasMetadata: Boolean(metadata),
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getFlatAdjustments: () => adjustmentsRef.current,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    getEffectiveLayeredAdjustments: () => documentAdjustmentsRef.current,
    getPreservedSourceAssets: () => preservedSourceAssetsRef.current,
    getFontAssets: async () => {
      const materialized = await textFontRegistry.materializeBytes();
      const usedFingerprints = new Set(
        imageDocumentRef.current?.assets.fonts.map(({ fingerprintSha256 }) => fingerprintSha256)
      );
      return materialized
        .filter(({ fingerprintSha256 }) => usedFingerprints.has(fingerprintSha256))
        .map(({ fingerprintSha256, bytes }) => ({
        fingerprintSha256,
        source: new Blob([Uint8Array.from(bytes).buffer], { type: 'font/otf' })
        }));
    },
    cancelAutoAlign: cancelAutoAlignPreview,
    onSave,
    onClose,
    onDirtyChange,
    onRequestOpenWorkspaceDocument,
    onOpenWorkspaceDocument,
    setLoading,
    setError
  });

  const editorMenuController = createEditorMenuController({
    projection: {
      document: imageDocumentRef.current,
      saving,
      hasMetadata: Boolean(metadata),
      hasSourceKey: Boolean(effectiveSourceFileKey),
      copiedGradeName: copiedGrade?.name ?? null,
      hasSelection: editorSession.selection.length > 0,
      selectionClipboardAvailable,
      activeChannel: editorSession.activeChannel,
      autoAlignPreview: Boolean(autoAlignPreview),
      zoomMode,
      showOriginal,
      showDifference
    },
    labels: {
      primaryShortcut: primaryShortcutLabel
    },
    file: {
      newDocument: () => { finishTextEditingRef.current(); onRequestNewWorkspaceDocument?.(); },
      // The application probe selects browser-native, wasm-vips, Photoshop or
      // layered-document import after reading the source signature.
      open: () => { finishTextEditingRef.current(); void chooseLocalFile('automatic'); },
      save: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleSave(); },
      exportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPng(); }
    },
    edit: {
      copySelectedContent,
      copyMergedContent,
      pasteSelectedContent,
      pasteGrade: pasteCurrentGrade,
      copyGrade: copyCurrentGrade
    },
    selection: {
      selectAll: selectAllContent,
      clear: clearCurrentSelection,
      invert: invertCurrentSelection
    },
    layers: {
      panel: layerPanelController,
      duplicate: duplicateActiveLayer,
      rasterizeText: rasterizeActiveTextLayer,
      layerViaCopy,
      rename: focusActiveLayerName,
      invertColors: invertActiveLayerColors,
      mergeDown: mergeSelectionOrActiveDown
    },
    autoAlign: {
      begin: () => void beginAutoAlign(),
      apply: applyAutoAlignPreview,
      cancel: cancelAutoAlignPreview
    },
    dialogs: editorDialogs,
    viewport: {
      setZoomMode,
      setView,
      setShowOriginal,
      setShowDifference
    },
    workspace: {
      showDebugPanel: () => workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.debug),
      toggleScreenMode,
      resetLayout: () => workspaceRef.current?.resetLayout()
    }
  });
  const createAppMenuOptions = editorMenuController.optionsFor;
  const layersPanel = (
    <LayersWorkspacePanel
      document={imageDocument}
      availableFonts={availableFontAssets}
      thumbnails={layerThumbnails}
      activeChannel={editorSession.activeChannel}
      isolatedMaskLayerId={isolatedMaskLayerId}
      controller={layerPanelController}
      editingTextLayerId={textEditing.layerId}
      onEditText={(layerId) => {
        pointTextController.cancel();
        activatePersistentTool('text-point');
        textEditingController.begin(layerId);
      }}
      onSelectionChange={handleLayerSelectionChange}
      onMaskIsolationChange={(layerId) => {
        setIsolatedMaskLayerId(layerId);
        if (layerId) setIsolatedCompositeChannel(null);
      }}
    />
  );
  const channelsPanel = (
    <ChannelsWorkspacePanel
      document={imageDocument}
      thumbnails={layerThumbnails}
      isolatedCompositeChannel={isolatedCompositeChannel}
      isolatedMaskLayerId={isolatedMaskLayerId}
      onCompositeChannelIsolationChange={(channel) => {
        setIsolatedCompositeChannel(channel);
        if (channel) setIsolatedMaskLayerId(null);
      }}
      onMaskIsolationChange={(layerId) => {
        setIsolatedMaskLayerId(layerId);
        if (layerId) setIsolatedCompositeChannel(null);
      }}
      onSelectCompositeChannel={selectionSessionController.selectCompositeChannel}
      onSelectLayerMask={selectionSessionController.selectLayerMask}
    />
  );

  const statusBar = buildEditorStatus({
    metadata,
    scale: activeScale,
    startupTimings,
    gpuMemoryBytes,
    photoshopImport: psdImportInfo,
    photoshopCompatibilitySummary: psdCompatibilitySummary,
    referenceDifference: psdDifferenceMetrics,
    reportAvailable: Boolean(imageDocument?.photoshopImportReport)
  });

  if (!open) return null;

  const visibleTool = temporaryPanActive
    ? 'view'
    : temporaryEraseActive
      ? 'erase'
      : editorSession.activeTool;
  const updateBrush = (change: Partial<EditorSession['brush']>) => {
    setEditorSession((current) => ({
      ...current,
      brush: { ...current.brush, ...change }
    }));
  };
  const updateWarp = (change: Partial<EditorSession['warp']>) => {
    setEditorSession((current) => ({
      ...current,
      warp: { ...current.warp, ...change }
    }));
  };
  const updateText = (change: Partial<EditorSession['text']>) => {
    setEditorSession((current) => {
      if (!change.family || change.family === current.text.family) {
        return { ...current, text: { ...current.text, ...change } };
      }
      const style = defaultTextStyleForFamily(selectableTextFonts, change.family);
      return {
        ...current,
        text: {
          ...current.text,
          ...change,
          style: style ?? current.text.style
        }
      };
    });
  };
  const activeTextPropertyLayer = imageDocument
    ? findDocumentLayer(imageDocument, imageDocument.activeLayerId)
    : null;
  const activeFlowTextPropertyLayer = activeTextPropertyLayer?.type === 'text'
    && activeTextPropertyLayer.text.source.kind === 'flow'
    ? activeTextPropertyLayer : null;
  const activeFlowTextPropertySource = activeFlowTextPropertyLayer?.text.source.kind === 'flow'
    ? activeFlowTextPropertyLayer.text.source : null;
  const editingTargetsActiveLayer = textEditing.status === 'editing'
    && textEditing.layerId === activeFlowTextPropertyLayer?.id;
  const runMeasuredTextInput = (mutation: () => boolean) => {
    const startedAt = performance.now();
    const changed = mutation();
    if (changed && textEditing.layerId) {
      engineRef.current?.beginTextInput(textEditing.layerId, startedAt);
    }
    return changed;
  };
  const textFormatProjection = editingTargetsActiveLayer
    ? textEditingController.formatProjection()
    : null;
  const projectedInsertionStyle = textFormatProjection?.target === 'insertion'
    && textFormatProjection.style.kind === 'value'
    ? { ...textFormatProjection.style.value, start: 0, end: 0 }
    : undefined;
  const textPropertyPresentation = activeFlowTextPropertyLayer && activeFlowTextPropertySource
    ? buildTextPropertyPresentation(
        activeFlowTextPropertySource,
        editingTargetsActiveLayer
          ? textEditing.selection : null,
        availableFontAssets,
        projectedInsertionStyle
      )
    : activeTextPropertyLayer?.type === 'text' ? {
        target: 'layer' as const,
        family: { kind: 'unavailable' as const },
        face: { kind: 'unavailable' as const },
        size: { kind: 'unavailable' as const },
        fill: { kind: 'unavailable' as const },
        tracking: { kind: 'unavailable' as const },
        advancedUnavailableReason:
          'Positioned imported text preserves exact glyph placement. Editable flow conversion is not available yet; preserve it or rasterize a copy.'
      } : null;
  const beginTextPropertyGesture = (): boolean => {
    if (textPropertyGestureRef.current) return false;
    const document = imageDocumentRef.current;
    const layerId = document?.activeLayerId;
    if (!document || !layerId || layerId !== activeFlowTextPropertyLayer?.id) return false;
    const editing = textEditingController.getSnapshot();
    if (editing.status === 'editing' && editing.layerId === layerId) {
      if (!textEditingController.beginFormatting()) return false;
      textPropertyGestureRef.current = { kind: 'text', layerId };
      return true;
    }
    if (!beginDocumentTransaction()) return false;
    textPropertyGestureRef.current = { kind: 'document', documentId: document.id, layerId, before: document };
    return true;
  };
  const applyTextPropertyPatch = (patch: TextStylePatch) => {
    const gesture = textPropertyGestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'text') {
      const editing = textEditingController.getSnapshot();
      if (editing.status !== 'editing' || editing.layerId !== gesture.layerId) return;
      textEditingController.format(patch);
      return;
    }
    if (imageDocumentRef.current?.id !== gesture.documentId) return;
    const layerId = gesture.layerId;
    documentMutationController.change((document) => {
      const layer = findDocumentLayer(document, layerId);
      if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
      return applyTextLayerDataMutation(document, layerId, {
        ...layer.text,
        source: formatFlowTextSource(layer.text.source, null, patch)
      });
    });
  };
  const commitTextPropertyGesture = () => {
    const gesture = textPropertyGestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'text') textEditingController.endFormatting();
    else endDocumentTransaction();
    textPropertyGestureRef.current = null;
  };
  const cancelTextPropertyGesture = () => {
    const gesture = textPropertyGestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'text') {
      textEditingController.cancelFormatting();
    } else if (imageDocumentRef.current?.id === gesture.documentId) {
      applyDocumentSnapshot(gesture.before);
      resetDocumentTransactionRef.current();
    }
    textPropertyGestureRef.current = null;
  };
  const applyDiscreteTextProperty = (patch: TextStylePatch) => {
    if (!beginTextPropertyGesture()) return;
    applyTextPropertyPatch(patch);
    commitTextPropertyGesture();
  };
  const applyTextFontAsset = (assetId: string) => {
    void (async () => {
      const bundled = await registerBundledTextFontByAssetId(textFontRegistry, assetId);
      const asset = bundled ?? textFontRegistry.availableAssets.find((font) => font.assetId === assetId);
      if (asset) applyDiscreteTextProperty(textFontPatch(asset));
    })().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The selected font could not be loaded.');
    });
  };
  const applyTextFill = (fill: string) => {
    if (!textPropertyPresentation) {
      updateBrush({ color: fill });
      return;
    }
    const patch = textFillPatchFromHex(fill);
    if (patch) applyTextPropertyPatch(patch);
  };
  const textPropertiesPanel = textPropertyPresentation ? {
    model: textPropertyPresentation,
    fonts: availableFontAssets,
    onFontAsset: applyTextFontAsset,
    onSize: (size: number) => applyTextPropertyPatch({ fontSize: size }),
    onFill: applyTextFill,
    onTracking: (tracking: number) => applyTextPropertyPatch({ tracking }),
    onBegin: beginTextPropertyGesture,
    onCommit: commitTextPropertyGesture,
    onCancel: cancelTextPropertyGesture
  } : null;
  useEffect(() => {
    if (activeFlowTextPropertyLayer?.id) {
      workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.text);
    }
  }, [activeFlowTextPropertyLayer?.id]);
  return (
    <LightTableEditorShell
      screenMode={screenMode}
      active={active}
      saving={saving}
      onClose={onClose}
      menuOptionsFor={createAppMenuOptions}
      activeTool={visibleTool}
      brush={editorSession.brush}
      warp={editorSession.warp}
      vectorStyle={editorSession.vectorStyle}
      text={editorSession.text}
      textFonts={selectableTextFonts}
      textProperties={textPropertyPresentation}
      selectedVectorStyle={selectedVectorStyle}
      selectionPixelSnap={editorSession.selectionPixelSnap}
      selectionCombineMode={editorSession.selectionCombineMode}
      selectionRowHeight={editorSession.selectionRowHeight}
      selectionColumnWidth={editorSession.selectionColumnWidth}
      zoomPercent={activeScale * 100}
      onBrushChange={updateBrush}
      onWarpChange={updateWarp}
      onVectorStyleChange={(change) => {
        setEditorSession((current) => ({
          ...current,
          vectorStyle: { ...current.vectorStyle, ...change }
        }));
      }}
      onTextChange={updateText}
      onTextFontAssetChange={applyTextFontAsset}
      onTextSizeChange={(fontSize) => applyTextPropertyPatch({ fontSize })}
      onTextFillChange={applyTextFill}
      onTextPropertyBegin={beginTextPropertyGesture}
      onTextPropertyCommit={commitTextPropertyGesture}
      onTextPropertyCancel={cancelTextPropertyGesture}
      onSelectedVectorStyleChange={updateSelectedVectorStyle}
      onWarpReset={() => {
        warpSessionController.clearActiveLayer();
      }}
      onSelectionPixelSnapChange={(selectionPixelSnap) => {
        setEditorSession((current) => ({ ...current, selectionPixelSnap }));
      }}
      onSelectionCombineModeChange={(selectionCombineMode) => {
        setEditorSession((current) => ({ ...current, selectionCombineMode }));
      }}
      onSelectionRowHeightChange={(selectionRowHeight) => {
        setEditorSession((current) => ({ ...current, selectionRowHeight }));
      }}
      onSelectionColumnWidthChange={(selectionColumnWidth) => {
        setEditorSession((current) => ({ ...current, selectionColumnWidth }));
      }}
      onZoomPreset={setExactZoom}
      onZoomFit={fitZoom}
      onToolChange={activatePersistentTool}
      onForegroundColorChange={(color) => updateBrush({ color })}
      onBackgroundColorChange={(backgroundColor) => updateBrush({ backgroundColor })}
      onSwapColors={() => updateBrush({
        color: editorSession.brush.backgroundColor,
        backgroundColor: editorSession.brush.color
      })}
      onResetColors={() => updateBrush({
        color: '#000000',
        backgroundColor: '#ffffff'
      })}
      fileInputRef={fileInputRef}
      advancedFileInputRef={advancedFileInputRef}
      fastFileAccept={imagePickerAccept('fast')}
      precisionFileAccept={imagePickerAccept('preserve-precision')}
      onFastFileChange={handleLocalFile}
      onPrecisionFileChange={handleAdvancedLocalFile}
      overlays={(
        <>
          <EditorOverlayLayer
          document={imageDocument}
          layerStyles={layerStyleEditor}
          dialogs={{
            controller: editorDialogs,
            photoshopReport: imageDocument?.photoshopImportReport ?? null,
            differenceMetrics: psdDifferenceMetrics,
            onFeather: featherCurrentSelection,
            onFlatten: commitFlattenRequest,
            onError: setError
          }}
          toolOptions={toolOptionsMenu ? {
            x: toolOptionsMenu.x,
            y: toolOptionsMenu.y,
            activeTool: visibleTool,
            brush: editorSession.brush,
            warp: editorSession.warp,
            vectorStyle: editorSession.vectorStyle,
            text: editorSession.text,
            textFonts: selectableTextFonts,
            textProperties: textPropertyPresentation,
            selectedVectorStyle,
            selectionPixelSnap: editorSession.selectionPixelSnap,
            selectionCombineMode: editorSession.selectionCombineMode,
            selectionRowHeight: editorSession.selectionRowHeight,
            selectionColumnWidth: editorSession.selectionColumnWidth,
            zoomPercent: activeScale * 100,
            onBrushChange: updateBrush,
            onWarpChange: updateWarp,
            onVectorStyleChange: (change) => {
              setEditorSession((current) => ({
                ...current,
                vectorStyle: { ...current.vectorStyle, ...change }
              }));
            },
            onTextChange: updateText,
            onTextFontAssetChange: applyTextFontAsset,
            onTextSizeChange: (fontSize) => applyTextPropertyPatch({ fontSize }),
            onTextFillChange: applyTextFill,
            onTextPropertyBegin: beginTextPropertyGesture,
            onTextPropertyCommit: commitTextPropertyGesture,
            onTextPropertyCancel: cancelTextPropertyGesture,
            onSelectedVectorStyleChange: updateSelectedVectorStyle,
            onWarpReset: () => {
              warpSessionController.clearActiveLayer();
              setToolOptionsMenu(null);
            },
            onSelectionPixelSnapChange: (selectionPixelSnap) => {
              setEditorSession((current) => ({ ...current, selectionPixelSnap }));
            },
            onSelectionCombineModeChange: (selectionCombineMode) => {
              setEditorSession((current) => ({ ...current, selectionCombineMode }));
            },
            onSelectionRowHeightChange: (selectionRowHeight) => {
              setEditorSession((current) => ({ ...current, selectionRowHeight }));
            },
            onSelectionColumnWidthChange: (selectionColumnWidth) => {
              setEditorSession((current) => ({ ...current, selectionColumnWidth }));
            },
            onZoomPreset: setExactZoom,
            onZoomFit: fitZoom,
            onClose: () => setToolOptionsMenu(null)
          } : null}
          />
          {pointTextCreation.request ? (
            <PointTextCreationDialog
              value={pointTextCreation.request.text}
              onChange={(text) => pointTextController.update(text)}
              onCommit={commitPointTextCreation}
              onCancel={cancelPointTextCreation}
            />
          ) : null}
          {paragraphTextCreation.status === 'editing' && paragraphTextCreation.request ? (
            <PointTextCreationDialog
              value={paragraphTextCreation.request.text}
              onChange={(text) => paragraphTextController.update(text)}
              onCommit={commitParagraphTextCreation}
              onCancel={cancelParagraphTextCreation}
            />
          ) : null}
        </>
      )}
    >
          <LightTableDockWorkspace
            ref={workspaceRef}
            canvasOnly={screenMode === 'canvas-only'}
            documents={(workspaceDocuments ?? [{
              id: workspaceDocumentId,
              title: sourceName
            }]).map((workspaceDocument) => ({
              ...workspaceDocument,
              onClose: saving
                ? undefined
                : () => {
                    if (onCloseWorkspaceDocument) {
                      onCloseWorkspaceDocument(workspaceDocument.id);
                    } else if (workspaceDocument.id === workspaceDocumentId) {
                      onClose();
                    }
                  },
              content: workspaceDocument.id === workspaceDocumentId ? (
                <EditorDocumentSurface
                  viewport={{
                    viewportRef,
                    canvasRef,
                    activeTool: editorSession.activeTool,
                    temporaryPanActive,
                    dragging: viewportInteraction.dragging,
                    focusPickerActive,
                    selection: editorSession.selection,
                    selectionDraft,
                    imageRect,
                    scale: activeScale,
                    viewportSize,
                    transformState,
                    loading,
                    unavailable: Boolean(error && !metadata),
                    inputBridge: textEditing.status === 'editing' ? (
                      <TextInputBridge
                        label={`Edit ${imageDocument && textEditing.layerId
                          ? findDocumentLayer(imageDocument, textEditing.layerId)?.name ?? 'text layer'
                          : 'text layer'}`}
                        text={textEditingController.text()}
                        selectionStart={Math.min(textEditing.selection.anchor, textEditing.selection.focus)}
                        selectionEnd={Math.max(textEditing.selection.anchor, textEditing.selection.focus)}
                        focusKey={textEditing.focusKey}
                        selectedText={textEditingController.selectedText()}
                        onEdit={(command) => {
                          runMeasuredTextInput(() => command.kind === 'insert'
                            ? textEditingController.insert(command.text)
                            : textEditingController.delete(command.direction, command.unit));
                        }}
                        onNavigate={(command, extend) => {
                          if (command === 'select-all') {
                            textEditingController.selectAll();
                          } else if (command === 'backward' || command === 'forward') {
                            textEditingController.navigate(command, { extend });
                          } else if (command === 'word-backward' || command === 'word-forward') {
                            textEditingController.navigate(
                              command === 'word-backward' ? 'backward' : 'forward',
                              { extend, unit: 'word' }
                            );
                          } else if (command === 'document-start') {
                            textEditingController.moveToBoundary('start', extend);
                          } else if (command === 'document-end') {
                            textEditingController.moveToBoundary('end', extend);
                          } else if (textEditing.layerId) {
                            const layout = engineRef.current
                              ?.textEditingLayout(textEditing.layerId)?.layout;
                            if (layout) textEditingController.navigateLayout(layout, command, extend);
                            else textEditingController.navigateLogicalLine(command, extend);
                          }
                        }}
                        onCompositionStart={() => { textEditingController.compositionStart(); }}
                        onCompositionUpdate={(text) => {
                          runMeasuredTextInput(() => textEditingController.compositionUpdate(text));
                        }}
                        onCompositionEnd={(text) => {
                          runMeasuredTextInput(() => textEditingController.compositionUpdate(text));
                          textEditingController.compositionEnd(text);
                        }}
                        onPaste={(text) => {
                          runMeasuredTextInput(() => textEditingController.paste(text));
                        }}
                        onCut={() => {
                          runMeasuredTextInput(() => textEditingController.delete('backward'));
                        }}
                        onCheckpoint={() => { textEditingController.checkpoint(); }}
                        onCommit={() => { textEditingController.finish(); }}
                        onCancel={() => {
                          if (!textEditingController.cancelComposition()) textEditingController.finish();
                        }}
                      />
                    ) : null,
                    onWheel: viewportInteraction.onWheel,
                    onPointerDown: viewportInteraction.onPointerDown,
                    onPointerMove: viewportInteraction.onPointerMove,
                    onPointerUp: viewportInteraction.onPointerUp,
                    onPointerCancel: viewportInteraction.onPointerCancel,
                    onPointerLeave: () => {
                      if (
                        !paintSessionController.active
                        && !warpSessionController.active
                      ) {
                        viewportInteraction.hideBrushCursor();
                      }
                    },
                    onContextMenu: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setToolOptionsMenu({ x: event.clientX, y: event.clientY });
                    },
                    onTransformChange: updateTransformMatrix,
                    onTransformProjectiveChange: updateTransformProjective
                  }}
                  status={{
                    status: error ?? gradeStatus ?? fontDiagnosticStatus,
                    error: Boolean(error),
                    meta: statusBar.meta,
                    metaTitle: statusBar.title,
                    reportAvailable: statusBar.reportAvailable,
                    onOpenReport: editorDialogs.openPsdReport
                  }}
                />
              ) : null
            }))}
            activeDocumentId={workspaceDocumentId}
            onActiveDocumentChange={onActivateWorkspaceDocument}
            accessoryWidthConstraintsEnabled={accessoryWidthConstraintsEnabled}
            onResizeInteractionChange={handleDockResizeInteractionChange}
            onDocumentSurfaceReady={handleDocumentSurfaceReady}
            panels={createEditorWorkspacePanels({
              scopes: {
                containerRef: scopesColumnRef,
                visibility: scopeVisibility,
                settings: scopeSettings,
                histogram,
                hueDistributionCanvasRef,
                paradeCanvasRef,
                vectorscopeCanvasRef,
                error: scopeError,
                onVisibilityChange: (scope, visible) => {
                  setScopeVisibility((current) => ({ ...current, [scope]: visible }));
                },
                onSettingsChange: setScopeSettings
              },
              layers: layersPanel,
              channels: channelsPanel,
              debug: {
                messages: debugMessages,
                onClear: clearDebugMessages,
                accessoryWidthConstraintsEnabled,
                editorResizeObserversEnabled,
                dockResizeActive: dockResizeActiveRef.current,
                onAccessoryWidthConstraintsChange: (enabled) => {
                  setAccessoryWidthConstraintsEnabled(enabled);
                  appendDebugMessage(
                    'info',
                    'Layout diagnostics',
                    `Accessory width constraints ${enabled ? 'enabled' : 'disabled'}.`
                  );
                },
                onEditorResizeObserversChange: (enabled) => {
                  setEditorResizeObserversEnabled(enabled);
                  appendDebugMessage(
                    'info',
                    'Layout diagnostics',
                    `Editor ResizeObservers ${enabled ? 'enabled' : 'disabled'}.`
                  );
                },
                onCaptureRenderTelemetry: () => {
                  const snapshot = engineRef.current?.renderTelemetrySnapshot();
                  if (!snapshot) {
                    appendDebugMessage(
                      'warning',
                      'Render telemetry',
                      'No active document renderer is available.'
                    );
                    return;
                  }
                  appendDebugMessage(
                    'info',
                    'Render telemetry',
                    `${snapshot.correctionFrames} correction frames; `
                      + `${snapshot.submittedFrames} submitted frames; `
                      + `${snapshot.noWorkSkips} no-work skips.`,
                    formatRenderTelemetry(snapshot)
                  );
                },
                onResetRenderTelemetry: () => {
                  engineRef.current?.resetRenderTelemetry();
                  appendDebugMessage(
                    'info',
                    'Render telemetry',
                    'Render counters reset.'
                  );
                },
                textEngineStatus: textEngineDiagnostic.state.status,
                textEngineSummary: textEngineDiagnostic.state.summary,
                textEnginePhase: textEngineDiagnostic.state.phase,
                textCorpusReport: textEngineDiagnostic.state.report,
                textCorpusAvailable: textEngineDiagnostic.state.corpusAvailable,
                textContractFixtureCount: TEXT_CONTRACT_FIXTURE_COUNT,
                lastTextLayoutError: textEngineDiagnostic.state.lastLayoutError,
                onProbeTextEngine: textEngineDiagnostic.probe,
                onRunTextCorpus: textEngineDiagnostic.runCorpus,
                textRendererStatus: textEngineDiagnostic.state.rendererStatus,
                textRendererPhase: textEngineDiagnostic.state.rendererPhase,
                textRendererReport: textEngineDiagnostic.state.rendererReport,
                onRunTextRendererBakeoff: textEngineDiagnostic.runRendererBakeoff,
                developmentTextFixtureEnabled: developmentTextFixture.enabled,
                developmentTextFixtureStatus: developmentTextFixture.status,
                developmentTextFixtureError: developmentTextFixture.error,
                textSourceMode: textRenderPresentation.mode,
                readyTextSourceCount: textRenderPresentation.readyLayerCount,
                textRenderTelemetry: textRenderPresentation,
                onDevelopmentTextFixtureChange: changeDevelopmentTextFixture
              },
              lensFxKey: sourceIdentity || sourceName,
              lensFx: {
                model: {
                  adjustmentStore: adjustmentPresentationStore,
                  // Grade controls are contextual. A group or missing
                  // selection must never fall back to an invisible global
                  // creative grade.
                  metadata: activeLayerCanOwnGrade(imageDocument) ? metadata : null,
                  resetModifierActive: shiftPressed,
                  depthProgress,
                  depthResult,
                  viewportMode: lensBlurViewportMode,
                  focusPickerActive
                },
                commands: {
                  beginAdjustment: beginAdjustmentTransaction,
                  endAdjustment: endAdjustmentTransaction,
                  grain: {
                    setEnabled: toggleGrain,
                    update: updateGrainAdjustment,
                    resetControl: resetGrainAdjustment,
                    reset: resetGrain
                  },
                  halation: {
                    setEnabled: setHalationEnabled,
                    update: updateHalationAdjustment,
                    resetControl: resetHalationAdjustment,
                    reset: resetHalation
                  },
                  chromaticAberration: {
                    setEnabled: setChromaticAberrationEnabled,
                    update: updateChromaticAberrationAdjustment,
                    resetControl: resetChromaticAberrationAdjustment,
                    reset: resetChromaticAberration
                  },
                  lensDistortion: {
                    setEnabled: setLensDistortionEnabled,
                    update: updateLensDistortionAdjustment,
                    resetControl: resetLensDistortionAdjustment,
                    reset: resetLensDistortion
                  },
                  lensBlur: {
                    setEnabled: setLensBlurEnabled,
                    update: updateLensBlurAdjustment,
                    resetControl: resetLensBlurAdjustment,
                    reset: resetLensBlur,
                    setShape: setLensBlurShape,
                    setQuality: setLensBlurQuality,
                    setViewportMode: setLensBlurViewportMode,
                    toggleFocusPicker: () => setFocusPickerActive((current) => !current)
                  }
                }
              },
              grade: {
                model: {
                  adjustmentStore: adjustmentPresentationStore,
                  metadata,
                  visibility: groupVisibility,
                  histogram,
                  resetModifierActive: shiftPressed,
                  showOriginal,
                  colorMixerScopeContainerRef,
                  colorMixerHueCanvasRef
                },
                  commands: {
                  resetAll,
                  toggleOriginal: () => {
                    setShowDifference(false);
                    setShowOriginal((current) => !current);
                  },
                  toggleVisibility: toggleGroupVisibility,
                  resetGroup,
                  beginAdjustment: beginAdjustmentTransaction,
                  endAdjustment: endAdjustmentTransaction,
                  updateAdjustment,
                  resetAdjustment,
                  updateColorMixer: updateColorMixerAdjustment,
                  resetColorMixer: resetColorMixerAdjustment,
                  updateColorGradingWheel,
                  updateColorGradingLuminance,
                  updateColorGradingControl,
                  resetColorGradingControl,
                  resetColorGradingZone,
                  resetColorGradingLuminance,
                  updateCurve,
                    resetCurve
                  }
                },
              text: textPropertiesPanel
            })}
          />
    </LightTableEditorShell>
  );
};
