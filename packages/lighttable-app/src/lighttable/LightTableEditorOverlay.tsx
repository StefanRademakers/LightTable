import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TEXT_CONTRACT_FIXTURE_COUNT, type TextPaint } from '@lighttable/text-core';
import {
  buildParagraphFrameOverlay
} from '@lighttable/text-rendering';
import {
  DocumentCommandHistory
} from './application/commands/documentCommandHistory';
import {
  LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
  type LightTableCommandId,
  type LightTableCommandPortRegistry,
  type LightTableCommandService,
  type LightTableGestureKind,
  type LightTableGestureSample
} from './application/commands/lightTableCommandService';
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
import { TextToShapeCommandController } from './application/text/TextToShapeCommandController';
import { PositionedTextRecoveryCommandController } from './application/text/PositionedTextRecoveryCommandController';
import { buildPdfTextExportPreflight } from './application/pdf/pdfTextExportPreflight';
import { buildPdfNativeTextPage } from './application/pdf/buildPdfNativeTextPage';
import {
  buildPdfNativeVectorLayerPage,
  buildPdfNativeVectorExportPage
} from './application/pdf/buildPdfNativeVectorPage';
import {
  pdfDocumentProcessingActive,
  planHybridPdfPageExport,
  type HybridPdfPageExportReason
} from './application/pdf/planHybridPdfPageExport';
import {
  planHybridPdfVectorPageExport,
  type HybridPdfVectorPageExportReason
} from './application/pdf/planHybridPdfVectorPageExport';
import {
  planHybridPdfNativePageExport,
  type HybridPdfNativePageExportReason
} from './application/pdf/planHybridPdfNativePageExport';
import { TextSelectionGestureController } from './application/text/TextSelectionGestureController';
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
  summarizeTextFontDiagnostics,
  textLayerFontStatus
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
import {
  ParagraphTextCreationController,
  PointTextCreationController,
  createParagraphTextDocument,
  createPathTextDocument,
  createPointTextDocument,
  defaultTextStyleForFamily,
  resolvePathTextCreationTarget,
  type PathTextCreationTarget,
  resolveTextToolFont,
  textCreationKind
} from './application/text/pointTextCreation';
import { FlowTextEditingSessionController } from './application/text/flowTextEditingSession';
import { FlowTextEditingRuntime } from './application/text/FlowTextEditingRuntime';
import { ParagraphFrameResizeController } from './application/text/ParagraphFrameResizeController';
import { PathTextHandleController } from './application/text/PathTextHandleController';
import {
  replaceMissingTextFont,
  replaceMissingTextFonts
} from './application/text/replaceMissingTextFont';
import { hitTestTextEditingLayout } from './application/text/textEditingHitTest';
import { TextLayerMoveGestureController } from './application/text/TextLayerMoveGestureController';
import {
  formatFlowTextSource,
  type ParagraphStylePatch,
  type TextStylePatch
} from './application/text/flowTextFormatting';
import {
  buildTextPropertyPresentation,
  textFillEnabledPatch,
  textFillPatchFromHex,
  textFontPatch,
  textStrokePatch
} from './application/text/textPropertyPresentation';
import {
  applyTextLayerDataMutation,
  convertParagraphTextToPoint,
  convertPointTextToParagraph,
  setFlowTextLayout
} from './editor/document/textLayerCommands';
import { lightTableTextEngine } from './text/wasm/TextEngineClient';
import { DocumentFontRegistry } from './text/fonts/DocumentFontRegistry';
import { FontationsFontFaceParser } from './text/fonts/FontationsFontFaceParser';
import {
  BUNDLED_TEXT_FONT_CATALOG,
  registerBundledTextFontsForDocument,
  registerBundledTextFontByAssetId,
  registerBundledTextFontForSettings
} from './text/fonts/bundledTextFont';
import {
  DEFAULT_TEXT_SUBSTITUTION_FAMILIES,
  documentNeedsFlowFontFallback
} from './text/fonts/flowFontSelection';
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
import {
  createEditorSession,
  createGradientToolSettings,
  type EditorSession,
  type ToolId
} from './editor/session/editorSession';
import { TemporaryToolController } from './editor/tools/temporaryToolController';
import { useFillCommandController } from './application/tools/fill/useFillCommandController';
import {
  RasterGradientCommandController,
  type RasterGradientDependencies
} from './application/tools/gradient/RasterGradientCommandController';
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
import type { VectorElementCreationTransaction } from './application/vectors/VectorDocumentController';
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
  siblingLayers,
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
import { paintTargetSourceToDocument } from './editor/tools/paint/paintCoordinates';
import {
  mergeLayers as mergeDocumentLayers,
  setLayerTransform
} from './editor/document/documentCommands';
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
const downloadEditorFile = (file: File): void => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
const hybridPdfReasonLabel: Record<HybridPdfPageExportReason, string> = {
  'text-plan-blocked': 'the text preflight is blocked',
  'no-native-text': 'no text layer can be emitted natively',
  'stale-native-layer': 'the document changed after preflight',
  'native-text-not-topmost': 'non-text content is above native text',
  'document-processing-active': 'document-wide Grade or Lens Fx is active'
};
const hybridPdfVectorReasonLabel: Record<HybridPdfVectorPageExportReason, string> = {
  'no-native-vectors': 'no visible vector layer can be emitted natively',
  'native-vectors-not-topmost': 'non-vector content is above native vectors',
  'vector-effects-unsupported': 'a vector or ancestor uses unsupported masks, clipping, blend or effects',
  'vector-blend-mode-unsupported': 'the vector layer blend mode has no exact PDF equivalent',
  'vector-stroke-alignment-unsupported': 'inside or outside vector strokes require outlining first',
  'vector-gradient-unsupported': 'vector gradients require native PDF shading export',
  'vector-clipping-unsupported': 'vector clipping requires one opaque fill-only vector base',
  'document-processing-active': 'document-wide Grade or Lens Fx is active'
};
const hybridPdfNativeReasonLabel: Record<HybridPdfNativePageExportReason, string> = {
  'no-native-content': 'no text or vector layer can be emitted natively',
  'native-content-not-topmost': 'non-native content interrupts the native top layer stack',
  'stale-native-text-layer': 'the document changed after text preflight',
  'vector-content-unsupported': 'a top vector uses unsupported compositing or stroke alignment',
  'document-processing-active': 'document-wide Grade or Lens Fx is active'
};
const activeLayerCanOwnGrade = (document: ImageDocument | null): boolean => {
  if (!document?.activeLayerId) return false;
  const active = findDocumentLayer(document, document.activeLayerId);
  return active?.type === 'raster' || active?.type === 'adjustment';
};

const rgba8ToHex = (color: readonly number[]) => `#${color.slice(0, 3)
  .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
  .join('')}`;

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
  commandService?: LightTableCommandService;
  commandPorts?: LightTableCommandPortRegistry;
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
  commandService,
  commandPorts,
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
  const commandRequestSequenceRef = useRef(0);
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
  const repeatTransformRef = useRef<(duplicate?: boolean) => void>(() => undefined);
  const finishPenPathRef = useRef<() => void>(() => undefined);
  const cancelPenPathRef = useRef<() => boolean>(() => false);
  const undoPenAnchorRef = useRef<() => boolean>(() => false);
  const activateToolRef = useRef<(tool: ToolId) => void>(() => undefined);
  const cancelAutoAlignRef = useRef<() => void>(() => undefined);
  const copySelectedContentRef = useRef<() => void>(() => undefined);
  const copyMergedContentRef = useRef<() => void>(() => undefined);
  const pasteSelectedContentRef = useRef<() => void>(() => undefined);
  const layerViaCopyRef = useRef<() => void>(() => undefined);
  const mergeActiveLayerDownRef = useRef<() => void>(() => undefined);
  const rasterizeShapeRef = useRef<(
    transaction: VectorElementCreationTransaction
  ) => boolean>(() => false);
  const selectedLayerIdsRef = useRef<LayerId[]>([]);
  const invertActiveLayerColorsRef = useRef<() => void>(() => undefined);
  const fillActiveTargetRef = useRef<(
    color: string,
    preserveTransparency?: boolean
  ) => void>(() => undefined);
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
  const executeRegisteredCommand = useCallback((
    command: LightTableCommandId,
    parameters: unknown
  ) => {
    if (!commandService) return null;
    const requestId = `ui-${workspaceDocumentId}-${++commandRequestSequenceRef.current}`;
    const execution = commandService.execute({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId,
      command,
      documentId: workspaceDocumentId,
      parameters
    });
    void execution.then((result) => {
      if (result.status === 'rejected') setError(result.message);
    });
    return execution;
  }, [commandService, workspaceDocumentId]);
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
  const [altPressed, setAltPressed] = useState(false);
  const [preciseBrushCursor, setPreciseBrushCursor] = useState(false);
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
  const fallbackGradientSettingsRef = useRef(createGradientToolSettings());
  const gradientToolSettings = editorSession.gradient ?? fallbackGradientSettingsRef.current;
  useEffect(() => {
    if (editorSession.gradient) return;
    setEditorSession((current) => ({
      ...current,
      gradient: current.gradient ?? fallbackGradientSettingsRef.current
    }));
  }, [editorSession.gradient, setEditorSession]);
  const [selectionDraft, setSelectionDraft] = useState<SelectionShape | null>(null);
  const editorDialogs = useEditorDialogController();
  const [selectionClipboardAvailable, setSelectionClipboardAvailable] = useState(false);
  const [temporaryPanActive, setTemporaryPanActive] = useState(false);
  const [temporaryEraseActive, setTemporaryEraseActive] = useState(false);
  const [temporaryZoomActive, setTemporaryZoomActive] = useState(false);
  const [temporaryZoomOutActive, setTemporaryZoomOutActive] = useState(false);
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
  const pathTextCreationTargetRef = useRef<PathTextCreationTarget | null>(null);
  const commitPointTextRef = useRef<() => boolean>(() => false);
  const cancelPointTextRef = useRef<() => boolean>(() => false);
  const commitParagraphTextRef = useRef<() => boolean>(() => false);
  const commitParagraphCanvasTextRef = useRef<() => boolean>(() => false);
  const cancelParagraphTextRef = useRef<() => boolean>(() => false);
  const paragraphCanvasCreationPendingRef = useRef(false);
  const finishTextEditingRef = useRef<() => boolean>(() => false);
  const exportNativeArtifactRef = useRef<() => Promise<File>>(async () => {
    throw new Error('The native export controller is not ready.');
  });
  const exportPngArtifactRef = useRef<() => Promise<File>>(async () => {
    throw new Error('The PNG export controller is not ready.');
  });
  const beginAutomationGestureRef = useRef<(
    kind: LightTableGestureKind,
    pointerId: number,
    parameters: Record<string, unknown>,
    sample: LightTableGestureSample
  ) => boolean>(() => false);
  const updateAutomationGestureRef = useRef<(
    kind: LightTableGestureKind,
    pointerId: number,
    sample: LightTableGestureSample
  ) => boolean>(() => false);
  const finishAutomationGestureRef = useRef<(
    kind: LightTableGestureKind,
    pointerId: number,
    commit: boolean
  ) => boolean>(() => false);
  const automationTranslateRef = useRef<{
    readonly before: ImageDocument;
    readonly layerId: LayerId;
    readonly start: LightTableGestureSample;
  } | null>(null);
  const textPropertyGestureRef = useRef<
    | { readonly kind: 'text'; readonly layerId: LayerId }
    | { readonly kind: 'document'; readonly documentId: ImageDocument['id']; readonly layerId: LayerId; readonly before: ImageDocument }
    | null
  >(null);
  const pendingTextPaintPatchRef = useRef<TextStylePatch | null>(null);
  const textPaintPreviewFrameRef = useRef<number | null>(null);
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

  useEffect(() => () => {
    pathTextCreationTargetRef.current = null;
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
    pathTextCreationTargetRef.current = null;
    pointTextController.cancel();
    paragraphTextController.cancel();
    textEditingControllerRef.current?.reset();
    setTemporaryPanActive(false);
    setTemporaryEraseActive(false);
    setTemporaryZoomActive(false);
    setTemporaryZoomOutActive(false);
    setAltPressed(false);
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
      ? documentTextFontDiagnostics(
          imageDocument,
          availableFontAssets,
          DEFAULT_TEXT_SUBSTITUTION_FAMILIES,
          (layerId) => engineRef.current?.textEditingLayout(layerId)?.layout ?? null
        )
      : [],
    [
      availableFontAssets,
      fontHydrationPending,
      imageDocument,
      textRenderPresentation.publicationRevision
    ]
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
  const pendingTextRenderPresentationRef = useRef<TextRenderPresentationSnapshot | null>(null);
  const textRenderPresentationFrameRef = useRef<number | null>(null);
  const publishTextRenderPresentation = useCallback((snapshot: TextRenderPresentationSnapshot) => {
    pendingTextRenderPresentationRef.current = snapshot;
    if (textRenderPresentationFrameRef.current !== null) return;
    textRenderPresentationFrameRef.current = window.requestAnimationFrame(() => {
      textRenderPresentationFrameRef.current = null;
      const latest = pendingTextRenderPresentationRef.current;
      pendingTextRenderPresentationRef.current = null;
      if (!latest) return;
      setTextRenderPresentation(latest);
      if (!latest.traceMessage) return;
      const signature = `${latest.traceRevision}:${latest.traceMessage}:${latest.traceDetails ?? ''}`;
      if (textRenderTraceSignatureRef.current === signature) return;
      textRenderTraceSignatureRef.current = signature;
      appendDebugMessage(
        latest.preparationStage === 'failed' ? 'error' : 'info',
        'GPU text pipeline',
        latest.traceMessage,
        latest.traceDetails ?? undefined
      );
    });
  }, [appendDebugMessage]);
  useEffect(() => () => {
    if (textRenderPresentationFrameRef.current !== null) {
      window.cancelAnimationFrame(textRenderPresentationFrameRef.current);
    }
    textRenderPresentationFrameRef.current = null;
    pendingTextRenderPresentationRef.current = null;
  }, []);
  useEffect(() => {
    let activeRegistration = true;
    const typeToolActive = editorSession.activeTool === 'text-point'
      || editorSession.activeTool === 'text-vertical';
    if (!thumbnailDocumentReadyId && !typeToolActive) return undefined;
    void textEngineDiagnostic.probe().catch((reason: unknown) => {
      if (activeRegistration && typeToolActive) {
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
    if (!imageDocument || fontHydrationPending) return;
    if (!documentNeedsFlowFontFallback(imageDocument, availableFontAssets)) return;
    let cancelled = false;
    void registerBundledTextFontsForDocument(textFontRegistry, imageDocument).catch((reason: unknown) => {
      if (cancelled) return;
      appendDebugMessage(
        'error',
        'Text fonts',
        reason instanceof Error ? reason.message : 'The bundled fallback font could not be loaded.'
      );
    });
    return () => { cancelled = true; };
  }, [
    appendDebugMessage,
    availableFontAssets,
    fontDiagnostics,
    fontHydrationPending,
    imageDocument,
    textFontRegistry
  ]);
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
  const textToShapeControllerRef = useRef<TextToShapeCommandController | null>(null);
  textToShapeControllerRef.current ??= new TextToShapeCommandController(() => ({
    getDocument: () => imageDocumentRef.current,
    applyDocument: applyDocumentSnapshot,
    pushDocumentHistory,
    resolveVectorPaths: (layerId, signal) => (
      engineRef.current?.vectorPathsForTextLayer(layerId, signal) ?? Promise.resolve(null)
    )
  }));
  const textToShapeController = textToShapeControllerRef.current;
  const positionedTextRecoveryControllerRef = useRef<PositionedTextRecoveryCommandController | null>(null);
  positionedTextRecoveryControllerRef.current ??= new PositionedTextRecoveryCommandController(() => ({
    getDocument: () => imageDocumentRef.current,
    applyDocument: applyDocumentSnapshot,
    pushDocumentHistory
  }));
  const positionedTextRecoveryController = positionedTextRecoveryControllerRef.current;
  const pendingTextDocumentRef = useRef<ImageDocument | null>(null);
  const textDocumentPublicationFrameRef = useRef<number | null>(null);
  const applyTextEditingDocument = (document: ImageDocument) => {
    // Typing owns the canonical ref immediately. GPU and React shell
    // projections consume only the newest document once per frame, preventing
    // a full editor render and obsolete shaping dispatch for every character.
    imageDocumentRef.current = document;
    pendingTextDocumentRef.current = document;
    if (textDocumentPublicationFrameRef.current !== null) return;
    textDocumentPublicationFrameRef.current = window.requestAnimationFrame(() => {
      textDocumentPublicationFrameRef.current = null;
      const pending = pendingTextDocumentRef.current;
      if (pending && imageDocumentRef.current === pending) {
        engineRef.current?.setDocument(pending);
        setImageDocument(pending);
      }
    });
  };
  const flushTextEditingDocument = () => {
    if (textDocumentPublicationFrameRef.current !== null) {
      window.cancelAnimationFrame(textDocumentPublicationFrameRef.current);
      textDocumentPublicationFrameRef.current = null;
    }
    const pending = pendingTextDocumentRef.current;
    pendingTextDocumentRef.current = null;
    if (!pending) return;
    imageDocumentRef.current = pending;
    engineRef.current?.setDocument(pending);
    setImageDocument(pending);
  };
  const textEditingControllerRef = useRef<FlowTextEditingSessionController | null>(null);
  textEditingControllerRef.current ??= new FlowTextEditingSessionController(() => ({
    getDocument: () => pendingTextDocumentRef.current ?? imageDocumentRef.current,
    applyDocument: applyTextEditingDocument,
    pushHistory: (entry) => {
      flushTextEditingDocument();
      pushHistoryEntry({
        ...entry,
        type: `text.${entry.group}`,
        label: entry.group === 'composition' ? 'Compose text' : 'Edit text'
      });
    }
  }));
  const textEditingController = textEditingControllerRef.current;
  useEffect(() => () => {
    if (textDocumentPublicationFrameRef.current !== null) {
      window.cancelAnimationFrame(textDocumentPublicationFrameRef.current);
      textDocumentPublicationFrameRef.current = null;
    }
    pendingTextDocumentRef.current = null;
  }, []);
  const textSelectionGestureControllerRef = useRef<TextSelectionGestureController | null>(null);
  textSelectionGestureControllerRef.current ??= new TextSelectionGestureController(() => ({
    focusAt: (layerId, point) => {
      const layout = engineRef.current?.textEditingLayout(layerId);
      return layout
        ? hitTestTextEditingLayout(layout, point, Number.POSITIVE_INFINITY)?.offset ?? null
        : null;
    },
    publishSelection: (selection, transient) => {
      textEditingController.setSelection(selection, { transient });
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frame) => window.cancelAnimationFrame(frame)
  }));
  const textSelectionGestureController = textSelectionGestureControllerRef.current;
  const textLayerMoveGestureControllerRef = useRef<TextLayerMoveGestureController | null>(null);
  textLayerMoveGestureControllerRef.current ??= new TextLayerMoveGestureController(() => ({
    getDocument: () => imageDocumentRef.current,
    getEditingLayerId: () => {
      const snapshot = textEditingController.getSnapshot();
      return snapshot.status === 'editing' ? snapshot.layerId : null;
    },
    applyDocument: applyDocumentSnapshot,
    recordHistory: pushDocumentHistory
  }));
  const textLayerMoveGestureController = textLayerMoveGestureControllerRef.current;
  const paragraphFrameResizeControllerRef = useRef<ParagraphFrameResizeController | null>(null);
  paragraphFrameResizeControllerRef.current ??= new ParagraphFrameResizeController(() => ({
    getDocument: () => imageDocumentRef.current,
    getEditingLayerId: () => {
      const snapshot = textEditingController.getSnapshot();
      return snapshot.status === 'editing' ? snapshot.layerId : null;
    },
    getLocalToDocument: (layerId) => engineRef.current?.textEditingLayout(layerId)?.localToDocument ?? null,
    applyDocument: applyDocumentSnapshot,
    recordHistory: pushDocumentHistory
  }));
  const paragraphFrameResizeController = paragraphFrameResizeControllerRef.current;
  const pathTextHandleControllerRef = useRef<PathTextHandleController | null>(null);
  pathTextHandleControllerRef.current ??= new PathTextHandleController(() => ({
    getDocument: () => imageDocumentRef.current,
    getEditingLayerId: () => {
      const snapshot = textEditingController.getSnapshot();
      return snapshot.status === 'editing' ? snapshot.layerId : null;
    },
    getRealization: (layerId) => {
      const editingLayout = engineRef.current?.textEditingLayout(layerId);
      return editingLayout?.path ? {
        table: editingLayout.path.table,
        projection: editingLayout.path.projection,
        localToDocument: editingLayout.localToDocument
      } : null;
    },
    applyDocument: applyDocumentSnapshot,
    recordHistory: pushDocumentHistory
  }));
  const pathTextHandleController = pathTextHandleControllerRef.current;
  const textEditing = useSyncExternalStore(
    textEditingController.subscribeShell,
    textEditingController.getShellSnapshot,
    textEditingController.getShellSnapshot
  );
  finishTextEditingRef.current = () => textEditingController.finish();

  useEffect(() => () => {
    textToShapeController.cancel();
  }, [textToShapeController]);

  useEffect(() => () => {
    textSelectionGestureController.dispose();
  }, [textSelectionGestureController]);

  useEffect(() => {
    textSelectionGestureController.dispose();
  }, [textSelectionGestureController, workspaceDocumentId]);

  useEffect(() => () => {
    paragraphFrameResizeController.cancel();
  }, [paragraphFrameResizeController]);

  useEffect(() => () => {
    pathTextHandleController.cancel();
  }, [pathTextHandleController]);

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

  const applyUndoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    return documentHistoryController.undo();
  }, [documentHistoryController, endAdjustmentTransaction, endDocumentTransaction]);

  const applyRedoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    return documentHistoryController.redo();
  }, [documentHistoryController, endAdjustmentTransaction, endDocumentTransaction]);

  const undoEditor = useCallback(() => {
    if (!executeRegisteredCommand('history.undo', {})) void applyUndoEditor();
  }, [applyUndoEditor, executeRegisteredCommand]);

  const redoEditor = useCallback(() => {
    if (!executeRegisteredCommand('history.redo', {})) void applyRedoEditor();
  }, [applyRedoEditor, executeRegisteredCommand]);

  const getDocumentPublicationPorts = useCallback(() => ({
    mergeStartupTimings: (timings: LightTableStartupTimings) => {
      startupTelemetryRef.current.merge(timings);
      // PSD/PDF source-stage timings arrive after the embedded preview's first
      // frame. Publish the merged snapshot as well as retaining it, otherwise
      // the toolbar only exposes the earlier WebGPU/download/first-frame slice.
      setStartupTimings(startupTelemetryRef.current.snapshot());
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

  const paragraphCreationOverlay = useMemo(() => {
    const request = paragraphTextCreation.request;
    if (!request) return null;
    const x = Math.min(request.start.x, request.end.x);
    const y = Math.min(request.start.y, request.end.y);
    return buildParagraphFrameOverlay({
      layerId: `paragraph-draft-${request.documentId}`,
      frame: {
        x,
        y,
        width: Math.abs(request.end.x - request.start.x),
        height: Math.abs(request.end.y - request.start.y)
      },
      localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    });
  }, [paragraphTextCreation]);

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
    if (textEditing.status === 'editing') return undefined;
    if (!renderer || !active || !paragraphCreationOverlay) {
      renderer?.setTextEditingOverlay(null);
      return undefined;
    }
    renderer.setTextEditingOverlay(paragraphCreationOverlay, true);
    return () => renderer.setTextEditingOverlay(null);
  }, [active, paragraphCreationOverlay, textEditing.status]);

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
  const applyExactZoom = useCallback((percent: number) => {
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
  }, [activeScale, setView, setZoomMode, view.panX, view.panY, viewportSize]);
  const applyFitZoom = useCallback(() => {
    setZoomMode('fit');
    setView({ scale: 1, panX: 0, panY: 0 });
  }, [setView, setZoomMode]);
  const applyActualZoom = useCallback(() => {
    setZoomMode('100');
    setView({ scale: 1, panX: 0, panY: 0 });
  }, [setView, setZoomMode]);
  const setExactZoom = useCallback((percent: number) => {
    if (!executeRegisteredCommand('view.setZoom', { mode: 'custom', percent })) {
      applyExactZoom(percent);
    }
  }, [applyExactZoom, executeRegisteredCommand]);
  const fitZoom = useCallback(() => {
    if (!executeRegisteredCommand('view.setZoom', { mode: 'fit' })) applyFitZoom();
  }, [applyFitZoom, executeRegisteredCommand]);
  const actualZoom = useCallback(() => {
    if (!executeRegisteredCommand('view.setZoom', { mode: '100' })) applyActualZoom();
  }, [applyActualZoom, executeRegisteredCommand]);

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
      repeatTransform: (duplicate) => repeatTransformRef.current(duplicate),
      commitActiveOperation: () => {
        if (transformActiveRef.current()) commitTransformRef.current();
        else finishPenPathRef.current();
      },
      activateTool: (tool) => activateToolRef.current(tool),
      undo: () => { void undoEditor(); },
      undoPenAnchor: () => undoPenAnchorRef.current(),
      redo: () => { void redoEditor(); },
      beginTemporaryPan: () => {
        if (temporaryToolRef.current.begin('view')) setTemporaryPanActive(true);
      },
      beginTemporaryZoom: (direction) => {
        if (temporaryToolRef.current.begin('zoom')) {
          setTemporaryZoomActive(true);
          setTemporaryZoomOutActive(direction < 0);
        }
      },
      beginTemporaryErase: () => {
        if (temporaryToolRef.current.begin('erase')) setTemporaryEraseActive(true);
      },
      fillForeground: (preserveTransparency) =>
        fillActiveTargetRef.current(editorSession.brush.color, preserveTransparency),
      fillBackground: (preserveTransparency) =>
        fillActiveTargetRef.current(editorSession.brush.backgroundColor, preserveTransparency),
      openFillDialog: editorDialogs.openFill,
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
      openBrushSettings: () => {
        const bounds = viewportRef.current?.getBoundingClientRect();
        setToolOptionsMenu({
          x: (bounds?.left ?? 0) + 16,
          y: (bounds?.top ?? 0) + 16
        });
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
      actualZoom,
      cancelOrClose: () => {
        if (textEditingController.getSnapshot().status === 'editing') {
          textEditingController.finish();
          return;
        }
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
        if (cancelPenPathRef.current()) return;
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
    temporaryZoomActive: () => temporaryToolRef.current.activeTool === 'zoom',
    releaseTemporaryZoom: () => {
      if (temporaryToolRef.current.end('zoom')) {
        setTemporaryZoomActive(false);
        setTemporaryZoomOutActive(false);
        engineRef.current?.setZoomEditingOverlay(null);
      }
    },
    temporaryEraseActive: () => temporaryToolRef.current.activeTool === 'erase',
    releaseTemporaryErase: () => {
      if (temporaryToolRef.current.end('erase')) setTemporaryEraseActive(false);
    },
    clearTemporaryTool: () => {
      if (temporaryToolRef.current.end()) {
        setTemporaryPanActive(false);
        setTemporaryEraseActive(false);
        setTemporaryZoomActive(false);
        setTemporaryZoomOutActive(false);
        engineRef.current?.setZoomEditingOverlay(null);
      }
      brushPercentInputRef.current.clear();
    },
    onShiftChange: setShiftPressed,
    onAltChange: setAltPressed,
    onCapsLockChange: setPreciseBrushCursor
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

  const rasterGradientPortsRef = useRef<RasterGradientDependencies>({
    getDocument: () => null,
    getRenderer: () => null,
    getChannel: () => 'pixels',
    getSettings: createGradientToolSettings,
    applyDocumentSnapshot: () => undefined,
    pushHistoryEntry: () => undefined,
    setStatus: () => undefined,
    setError: () => undefined
  });
  rasterGradientPortsRef.current = {
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getChannel: () => editorSession.activeChannel,
    getSettings: () => gradientToolSettings,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setStatus: setGradeStatus,
    setError
  };
  const rasterGradientControllerRef = useRef<RasterGradientCommandController | null>(null);
  rasterGradientControllerRef.current ??= new RasterGradientCommandController(
    () => rasterGradientPortsRef.current
  );
  const rasterGradientController = rasterGradientControllerRef.current;

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

  const activeDocumentLayer = imageDocument?.activeLayerId
    ? findDocumentLayer(imageDocument, imageDocument.activeLayerId)
    : null;
  const vectorMoveActive = editorSession.activeTool === 'transform'
    && activeDocumentLayer?.type === 'vector';

  const vectorToolSessionController = useVectorToolSessionController({
    document: imageDocument,
    selection: editorSession.vectorSelection,
    activeTool: vectorMoveActive ? 'vector-select' : editorSession.activeTool,
    foregroundColor: editorSession.brush.color,
    gradient: gradientToolSettings,
    shape: editorSession.shape,
    fillEnabled: editorSession.vectorStyle.fillEnabled,
    fillColor: editorSession.vectorStyle.fillColor,
    strokeEnabled: editorSession.vectorStyle.strokeEnabled,
    strokeColor: editorSession.vectorStyle.strokeColor,
    strokeWidth: editorSession.vectorStyle.strokeWidth,
    strokeAlignment: editorSession.vectorStyle.strokeAlignment,
    strokeStyle: editorSession.vectorStyle.strokeStyle,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection: (vectorSelection) => {
      setEditorSession((current) => ({ ...current, vectorSelection }));
    },
    rasterizeShape: (transaction) => rasterizeShapeRef.current(transaction)
  });
  finishPenPathRef.current = () => { vectorToolSessionController.finishPenPath(); };
  cancelPenPathRef.current = () => vectorToolSessionController.cancelPenPath();
  undoPenAnchorRef.current = () => vectorToolSessionController.undoPenAnchor();
  const selectedVectorStyle = useMemo(() => {
    const reference = editorSession.vectorSelection.elements[0];
    if (!reference || !imageDocument) return null;
    if (reference.layerId !== imageDocument.activeLayerId) return null;
    const layer = findDocumentLayer(imageDocument, reference.layerId);
    const element = layer?.type === 'vector'
      ? layer.elements.find(({ id }) => id === reference.elementId)
      : null;
    return element ? vectorElementStyleSettings(element) : null;
  }, [editorSession.vectorSelection.elements, imageDocument]);
  const selectedShapeGeometry = useMemo(() => {
    const reference = editorSession.vectorSelection.elements[0];
    if (!reference || !imageDocument) return null;
    if (reference.layerId !== imageDocument.activeLayerId) return null;
    const layer = findDocumentLayer(imageDocument, reference.layerId);
    const element = layer?.type === 'vector'
      ? layer.elements.find(({ id }) => id === reference.elementId)
      : null;
    if (element?.type !== 'live-shape'
      || (element.geometry.kind !== 'rectangle'
        && element.geometry.kind !== 'ellipse'
        && element.geometry.kind !== 'line')) return null;
    const geometry = element.geometry;
    const lineDelta = geometry.kind === 'line' ? {
      x: geometry.end.x - geometry.start.x,
      y: geometry.end.y - geometry.start.y
    } : null;
    return {
      kind: geometry.kind,
      settings: {
        ...editorSession.shape,
        width: geometry.kind === 'line' ? Math.abs(lineDelta!.x) : geometry.width,
        height: geometry.kind === 'line' ? Math.abs(lineDelta!.y) : geometry.height,
        rectangleCornerRadii: geometry.kind === 'rectangle'
          ? [...geometry.cornerRadii] as [number, number, number, number]
          : editorSession.shape.rectangleCornerRadii,
        linkedCorners: geometry.kind === 'rectangle'
          ? geometry.linkedCorners : editorSession.shape.linkedCorners,
        lineStartArrow: geometry.kind === 'line'
          ? Boolean(geometry.startArrow) : editorSession.shape.lineStartArrow,
        lineEndArrow: geometry.kind === 'line'
          ? Boolean(geometry.endArrow) : editorSession.shape.lineEndArrow,
        lineArrowWidth: geometry.kind === 'line'
          ? geometry.startArrow?.width ?? geometry.endArrow?.width ?? editorSession.shape.lineArrowWidth
          : editorSession.shape.lineArrowWidth,
        lineArrowLength: geometry.kind === 'line'
          ? geometry.startArrow?.length ?? geometry.endArrow?.length ?? editorSession.shape.lineArrowLength
          : editorSession.shape.lineArrowLength,
        lineRotationDegrees: geometry.kind === 'line'
          ? Math.atan2(lineDelta!.y, lineDelta!.x) * 180 / Math.PI
          : editorSession.shape.lineRotationDegrees
      }
    };
  }, [editorSession.shape, editorSession.vectorSelection.elements, imageDocument]);
  const updateSelectedVectorStyle = (change: Partial<EditorSession['vectorStyle']>) => {
    vectorToolSessionController.editSelectedElementStyles(
      (style) => patchVectorStyle(style, change)
    );
  };
  const updateSelectedShapeGeometry = (change: Partial<EditorSession['shape']>) => {
    vectorToolSessionController.editSelectedLiveShapes((shape) => {
      if (shape.geometry.kind === 'rectangle') {
        shape.geometry = {
          ...shape.geometry,
          width: change.width ?? shape.geometry.width,
          height: change.height ?? shape.geometry.height,
          cornerRadii: change.rectangleCornerRadii
            ? [...change.rectangleCornerRadii] : shape.geometry.cornerRadii,
          linkedCorners: change.linkedCorners ?? shape.geometry.linkedCorners
        };
      } else if (shape.geometry.kind === 'ellipse') {
        shape.geometry = {
          ...shape.geometry,
          width: change.width ?? shape.geometry.width,
          height: change.height ?? shape.geometry.height
        };
      } else if (shape.geometry.kind === 'line') {
        const geometry = shape.geometry;
        const dx = geometry.end.x - geometry.start.x;
        const dy = geometry.end.y - geometry.start.y;
        const currentLength = Math.max(Math.hypot(dx, dy), 1e-6);
        const angle = change.lineRotationDegrees !== undefined
          ? change.lineRotationDegrees * Math.PI / 180 : Math.atan2(dy, dx);
        const nextDx = change.lineRotationDegrees !== undefined
          ? Math.cos(angle) * currentLength
          : change.width !== undefined ? Math.sign(dx || 1) * change.width : dx;
        const nextDy = change.lineRotationDegrees !== undefined
          ? Math.sin(angle) * currentLength
          : change.height !== undefined ? Math.sign(dy || 1) * change.height : dy;
        const arrow = {
          width: change.lineArrowWidth
            ?? geometry.startArrow?.width ?? geometry.endArrow?.width ?? editorSession.shape.lineArrowWidth,
          length: change.lineArrowLength
            ?? geometry.startArrow?.length ?? geometry.endArrow?.length ?? editorSession.shape.lineArrowLength,
          concavity: 0
        };
        shape.geometry = {
          ...geometry,
          end: { x: geometry.start.x + nextDx, y: geometry.start.y + nextDy },
          startArrow: (change.lineStartArrow ?? Boolean(geometry.startArrow)) ? arrow : null,
          endArrow: (change.lineEndArrow ?? Boolean(geometry.endArrow)) ? arrow : null
        };
      }
      return shape;
    });
  };

  const selectedPointTextFont = () => {
    return resolveTextToolFont(textFontRegistry.availableAssets, editorSession.text);
  };

  const requestExistingFlowTextEditing = (
    layerId: LayerId,
    offset?: number,
    affinity: 'upstream' | 'downstream' = 'downstream'
  ) => {
    const document = imageDocumentRef.current;
    const layer = document ? findDocumentLayer(document, layerId) : null;
    const unresolved = layer?.type === 'text'
      && textLayerFontStatus(
        layer,
        textFontRegistry.availableAssets,
        DEFAULT_TEXT_SUBSTITUTION_FAMILIES
      ).kind !== 'exact';
    if (layer?.type === 'text'
      && layer.text.source.kind === 'flow'
      && unresolved) {
      editorDialogs.requestMissingFontRecovery({ layerId, offset, affinity });
      return false;
    }
    return textEditingController.begin(layerId, offset, affinity);
  };

  const beginExistingFlowTextEditing = (
    point: { x: number; y: number },
    mode: 'point' | 'paragraph' | 'any' = 'any',
    pointerId?: number
  ) => {
    const document = imageDocumentRef.current;
    if (!document) return false;
    const candidates = walkLayerTree(document.layers)
      .map(({ node }) => node)
      .filter((node) => node.type === 'text'
        && node.text.source.kind === 'flow'
        && (mode === 'any' || node.text.source.layout.mode === mode))
      .reverse();
    for (const layer of candidates) {
      const layout = engineRef.current?.textEditingLayout(layer.id);
      const hit = layout ? hitTestTextEditingLayout(layout, point) : null;
      if (!hit) continue;
      pointTextController.cancel();
      paragraphTextController.cancel();
      selectLayerRef.current(layer.id);
      const editingStarted = requestExistingFlowTextEditing(layer.id, hit.offset, hit.affinity);
      if (editingStarted && pointerId !== undefined) {
        textSelectionGestureController.begin(pointerId, layer.id, hit.offset);
      }
      return true;
    }
    return false;
  };

  const beginPointTextCreation = async (
    origin: { x: number; y: number },
    pathTarget: PathTextCreationTarget | null = null
  ) => {
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
        || editorSession.activeTool !== (pathTarget
          ? 'text-path'
          : editorSession.activeTool === 'text-vertical' ? 'text-vertical' : 'text-point')
        || !engineRef.current
        || rendererLifecycle.getSnapshot().status !== 'ready'
      ) return;
      pathTextCreationTargetRef.current = pathTarget;
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
    const pathTarget = pathTextCreationTargetRef.current;
    pathTextCreationTargetRef.current = null;
    if (!request || !before || !font || request.documentId !== before.id) return false;
    const after = pathTarget
      ? createPathTextDocument(
          before, request, pathTarget, editorSession.text, font, editorSession.brush.color
        )
      : createPointTextDocument(
          before,
          request,
          editorSession.text,
          font,
          editorSession.brush.color,
          editorSession.activeTool === 'text-vertical' ? 'vertical-rl' : 'horizontal-tb'
        );
    if (after === before) return false;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    return true;
  };

  const cancelPointTextCreation = () => {
    pathTextCreationTargetRef.current = null;
    return pointTextController.cancel();
  };
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
    if (paragraphFrameResizeController.begin(
      pointerId,
      origin,
      8 / Math.max(activeScale, 1e-6)
    )) return true;
    if (beginExistingFlowTextEditing(origin, 'any', pointerId)) return true;
    pointTextController.cancel();
    textEditingController.finish();
    paragraphCanvasCreationPendingRef.current = false;
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
        if (
          paragraphCanvasCreationPendingRef.current
          && paragraphTextController.getSnapshot().status === 'editing'
        ) {
          commitParagraphCanvasTextRef.current();
        }
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

  const commitParagraphTextCreation = (beginEditing = false) => {
    const before = imageDocumentRef.current;
    const font = selectedPointTextFont();
    if (paragraphTextController.getSnapshot().request && !font) {
      setError('The selected text font and style are still loading. Try again.');
      return false;
    }
    const request = paragraphTextController.commit();
    if (!request || !before || !font || request.documentId !== before.id) return false;
    paragraphCanvasCreationPendingRef.current = false;
    const after = createParagraphTextDocument(
      before,
      request,
      editorSession.text,
      font,
      editorSession.brush.color,
      editorSession.activeTool === 'text-vertical' ? 'vertical-rl' : 'horizontal-tb'
    );
    if (after === before) return false;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    if (beginEditing && after.activeLayerId) {
      textEditingController.begin(after.activeLayerId);
      textEditingController.selectAll();
    }
    return true;
  };

  const finishParagraphTextCreation = (
    pointerId: number,
    point: { x: number; y: number }
  ) => {
    paragraphTextController.move(pointerId, point);
    const request = paragraphTextController.getSnapshot().request;
    if (request && textCreationKind(request.start, request.end, activeScale) === 'point') {
      const origin = request.start;
      paragraphCanvasCreationPendingRef.current = false;
      paragraphTextController.cancel();
      void beginPointTextCreation(origin);
      return true;
    }
    if (!paragraphTextController.finish(pointerId)) return false;
    paragraphCanvasCreationPendingRef.current = true;
    if (selectedPointTextFont()) commitParagraphCanvasTextRef.current();
    return true;
  };

  const cancelParagraphTextCreation = () => {
    paragraphCanvasCreationPendingRef.current = false;
    return paragraphTextController.cancel();
  };
  commitParagraphTextRef.current = commitParagraphTextCreation;
  commitParagraphCanvasTextRef.current = () => commitParagraphTextCreation(true);
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
    temporaryZoomOut: temporaryZoomOutActive,
    vectorMoveActive,
    preciseBrushCursor,
    eyedropperActive: (editorSession.activeTool === 'brush'
      || editorSession.activeTool === 'fill'
      || editorSession.activeTool === 'gradient') && altPressed,
    onColorPick: (point) => {
      void engineRef.current?.sampleDisplayColor(point).then((color) => {
        updateBrush({ color: rgba8ToHex(color) });
      }).catch((reason: unknown) => {
        setGradeStatus(reason instanceof Error ? reason.message : 'The color could not be sampled.');
      });
    },
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
      if (beginExistingFlowTextEditing(point)) return;
      textEditingController.finish();
      if (editorSession.activeTool === 'text-path') {
        const resolution = imageDocumentRef.current
          ? resolvePathTextCreationTarget(
              imageDocumentRef.current,
              editorSession.vectorSelection
            )
          : { kind: 'none' as const };
        if (resolution.kind !== 'resolved') {
          setError(resolution.kind === 'live-shape'
            ? 'Path text requires a native path. Convert the selected shape to a path first.'
            : resolution.kind === 'ambiguous-subpath'
              ? 'Select exactly one contour for Path Text.'
              : 'Select exactly one native path before creating Path Text.');
          return;
        }
        void beginPointTextCreation(point, resolution.target);
        return;
      }
      void beginPointTextCreation(point);
    },
    textGesture: {
      beginPoint: (pointerId, point, temporaryMove) => (temporaryMove
        && textLayerMoveGestureController.begin(pointerId, point)) || pathTextHandleController.begin(
          pointerId, point, 8 / Math.max(activeScale, 1e-6)
        ) || beginExistingFlowTextEditing(point, 'any', pointerId),
      beginParagraph: (pointerId, point, temporaryMove) => (temporaryMove
        && textLayerMoveGestureController.begin(pointerId, point)) || pathTextHandleController.begin(
          pointerId, point, 8 / Math.max(activeScale, 1e-6)
        ) || beginParagraphTextCreation(pointerId, point),
      owns: (pointerId) => textLayerMoveGestureController.owns(pointerId)
        || textSelectionGestureController.owns(pointerId)
        || pathTextHandleController.owns(pointerId)
        || paragraphFrameResizeController.owns(pointerId)
        || paragraphTextController.owns(pointerId),
      move: (pointerId, point) => textLayerMoveGestureController.owns(pointerId)
        ? textLayerMoveGestureController.move(pointerId, point)
        : textSelectionGestureController.owns(pointerId)
          ? textSelectionGestureController.move(pointerId, point)
        : pathTextHandleController.owns(pointerId)
          ? pathTextHandleController.move(pointerId, point)
          : paragraphFrameResizeController.owns(pointerId)
            ? paragraphFrameResizeController.move(pointerId, point)
            : paragraphTextController.move(pointerId, point),
      finish: (pointerId, point) => textLayerMoveGestureController.owns(pointerId)
        ? textLayerMoveGestureController.finish(pointerId, point)
        : textSelectionGestureController.owns(pointerId)
          ? textSelectionGestureController.finish(pointerId, point)
        : pathTextHandleController.owns(pointerId)
          ? pathTextHandleController.finish(pointerId, point)
          : paragraphFrameResizeController.owns(pointerId)
            ? paragraphFrameResizeController.finish(pointerId, point)
            : finishParagraphTextCreation(pointerId, point),
      cancel: (pointerId) => textLayerMoveGestureController.cancel(pointerId)
        || textSelectionGestureController.cancel(pointerId)
        || pathTextHandleController.cancel(pointerId)
        || paragraphFrameResizeController.cancel(pointerId)
        || (paragraphTextController.owns(pointerId) ? paragraphTextController.cancel() : false)
    },
    selection: selectionSessionController,
    paint: paintSessionController,
    warp: warpSessionController,
    vector: vectorToolSessionController,
    rasterGradient: rasterGradientController,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    onBrushCursorChange: (cursor) => {
      engineRef.current?.setBrushCursorOverlay(cursor);
    },
    onZoomDraftChange: (draft) => {
      engineRef.current?.setZoomEditingOverlay(draft);
    },
    onPenRubberBandChange: (band) => {
      engineRef.current?.setPenRubberBandOverlay(band);
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
  rasterizeShapeRef.current = (transaction) => {
    const renderer = engineRef.current;
    const siblings = siblingLayers(transaction.previewDocument, transaction.layerId);
    const shapeIndex = siblings.findIndex(({ id }) => id === transaction.layerId);
    const destinationSource = shapeIndex > 0 ? siblings[shapeIndex - 1] : null;
    if (!renderer || destinationSource?.type !== 'raster') {
      setError('Pixels mode requires an editable raster layer directly below the new shape.');
      return false;
    }
    const layerIds = [destinationSource.id, transaction.layerId];
    const next = mergeDocumentLayers(transaction.previewDocument, layerIds);
    const destination = next.activeLayerId ? findRasterLayer(next, next.activeLayerId) : null;
    if (next === transaction.previewDocument
      || !destination
      || !renderer.prepareRasterDestination(destination)) {
      setError('The GPU raster target for this shape could not be allocated.');
      return false;
    }
    if (!renderer.mergeLayers(
      transaction.previewDocument,
      layerIds,
      destination.id
    )) {
      renderer.releaseRasterDestination(destination.id);
      setError('The shape could not be baked into the active raster layer.');
      return false;
    }
    applyDocumentSnapshot(next);
    pushHistoryEntry({
      byteSize: transaction.beforeDocument.width * transaction.beforeDocument.height * 8,
      layerIds: [...layerIds, destination.id],
      undo: () => applyDocumentSnapshot(transaction.beforeDocument),
      redo: () => applyDocumentSnapshot(next)
    });
    renderer.commitRasterDestination(destination.id);
    setEditorSession((session) => ({ ...session, activeChannel: 'pixels' }));
    setError(null);
    setGradeStatus('Shape applied to pixels');
    return true;
  };
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
  useEffect(() => {
    if (!commandPorts) return;
    return commandPorts.register(workspaceDocumentId as DocumentSessionId, {
      setZoom: (viewport) => {
        if (viewport.zoomMode === 'fit') applyFitZoom();
        else if (viewport.zoomMode === '100') applyActualZoom();
        else applyExactZoom(viewport.scale * 100);
      },
      createRasterLayer: layerPanelController.createRasterLayer,
      renameLayer: layerPanelController.rename,
      setLayerVisibility: layerPanelController.setVisibility,
      setLayerFillOpacity: layerPanelController.setFillOpacity,
      setLayerStyleEnabled: layerPanelController.setStyleStackEnabled,
      setLayerEffectEnabled: layerPanelController.setStyleEnabled,
      exportNativeArtifact: () => exportNativeArtifactRef.current(),
      exportPngArtifact: () => exportPngArtifactRef.current(),
      beginGesture: (kind, pointerId, parameters, sample) =>
        beginAutomationGestureRef.current(kind, pointerId, parameters, sample),
      updateGesture: (kind, pointerId, sample) =>
        updateAutomationGestureRef.current(kind, pointerId, sample),
      finishGesture: (kind, pointerId, commit) =>
        finishAutomationGestureRef.current(kind, pointerId, commit),
      undo: applyUndoEditor,
      redo: applyRedoEditor
    });
  }, [
    applyActualZoom,
    applyExactZoom,
    applyFitZoom,
    applyRedoEditor,
    applyUndoEditor,
    commandPorts,
    layerPanelController,
    workspaceDocumentId
  ]);
  const commandLayerPanelController = useMemo(() => ({
    ...layerPanelController,
    createRasterLayer: () => {
      if (!executeRegisteredCommand('layer.createRaster', {})) {
        layerPanelController.createRasterLayer();
      }
    },
    rename: (layerId: LayerId, name: string) => {
      if (!executeRegisteredCommand('layer.rename', { layerId, name })) {
        layerPanelController.rename(layerId, name);
      }
    },
    setVisibility: (layerIds: LayerId[], visible: boolean) => {
      if (!executeRegisteredCommand('layer.setVisibility', { layerIds, visible })) {
        layerPanelController.setVisibility(layerIds, visible);
      }
    }
  }), [executeRegisteredCommand, layerPanelController]);
  selectLayerRef.current = layerPanelController.select;

  const transformSession = useTransformSessionController({
    activeTool: vectorMoveActive ? 'view' : editorSession.activeTool,
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
  repeatTransformRef.current = transformSession.repeat;
  beginAutomationGestureRef.current = (kind, pointerId, parameters, sample) => {
    if (kind === 'selection-rectangle') {
      return selectionSessionController.begin(
        pointerId,
        'select-rectangle',
        sample,
        parameters.mode === 'add' || parameters.mode === 'subtract'
          || parameters.mode === 'intersect'
          ? parameters.mode
          : 'replace'
      );
    }
    if (kind === 'brush-stroke') {
      const document = imageDocumentRef.current;
      const layerId = typeof parameters.layerId === 'string'
        ? parameters.layerId as LayerId
        : document?.activeLayerId ?? null;
      const layer = document && layerId ? findRasterLayer(document, layerId) : null;
      if (!layer) return false;
      const channel = parameters.channel === 'mask' ? 'mask' : 'pixels';
      return paintSessionController.begin({
        pointerId,
        layer,
        target: {
          layerId: layer.id,
          channel,
          erase: parameters.erase === true,
          sourceToDocument: paintTargetSourceToDocument(layer, channel)
        },
        brush: editorSession.brush,
        point: {
          ...sample,
          pressure: sample.pressure ?? 1
        }
      });
    }
    const document = imageDocumentRef.current;
    const layerId = typeof parameters.layerId === 'string'
      ? parameters.layerId as LayerId
      : document?.activeLayerId ?? null;
    if (!document || !layerId || !findDocumentLayer(document, layerId)) return false;
    automationTranslateRef.current = { before: document, layerId, start: sample };
    return true;
  };
  updateAutomationGestureRef.current = (kind, pointerId, sample) => {
    if (kind === 'selection-rectangle') {
      return selectionSessionController.move(pointerId, sample);
    }
    if (kind === 'brush-stroke') {
      return paintSessionController.move(pointerId, {
        ...sample,
        pressure: sample.pressure ?? 1
      });
    }
    const transaction = automationTranslateRef.current;
    const layer = transaction
      ? findDocumentLayer(transaction.before, transaction.layerId)
      : null;
    if (!transaction || !layer || imageDocumentRef.current?.id !== transaction.before.id) return false;
    applyDocumentSnapshot(setLayerTransform(transaction.before, transaction.layerId, {
      ...layer.transform,
      tx: layer.transform.tx + sample.x - transaction.start.x,
      ty: layer.transform.ty + sample.y - transaction.start.y
    }));
    return true;
  };
  finishAutomationGestureRef.current = (kind, pointerId, commit) => {
    if (kind === 'selection-rectangle') {
      return commit
        ? selectionSessionController.finish(pointerId)
        : selectionSessionController.cancel(pointerId);
    }
    if (kind === 'brush-stroke') {
      return commit
        ? paintSessionController.finish(pointerId)
        : paintSessionController.cancel(pointerId);
    }
    const transaction = automationTranslateRef.current;
    automationTranslateRef.current = null;
    if (!transaction || imageDocumentRef.current?.id !== transaction.before.id) return false;
    if (!commit) {
      applyDocumentSnapshot(transaction.before);
      return true;
    }
    const after = imageDocumentRef.current;
    if (after !== transaction.before) pushDocumentHistory(transaction.before, after);
    return true;
  };

  const activatePersistentTool = (requestedTool: ToolId) => {
    if (requestedTool !== 'text-point' && requestedTool !== 'text-vertical') {
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
    exportOutput,
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
      const embeddedFonts = imageDocumentRef.current?.assets.fonts
        .filter(({ source }) => source !== 'system') ?? [];
      const usedFingerprints = new Set(embeddedFonts.map(({ fingerprintSha256 }) => fingerprintSha256));
      const materialized = await textFontRegistry.materializeBytes(embeddedFonts.map(({ assetId }) => assetId));
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
  exportNativeArtifactRef.current = async () => (await exportOutput()).file;
  exportPngArtifactRef.current = async () => {
    const renderer = engineRef.current;
    if (!renderer || !imageDocumentRef.current) {
      throw new Error('The document renderer is not ready.');
    }
    return new File(
      [await renderer.exportPng()],
      `${fileNameBase.replace(/\.[^.]+$/, '') || 'image'}-lighttable.png`,
      { type: 'image/png' }
    );
  };

  const editorMenuController = createEditorMenuController({
    projection: {
      document: imageDocumentRef.current,
      saving,
      hasMetadata: Boolean(metadata),
      hasSourceKey: Boolean(effectiveSourceFileKey),
      hasCompatibilityReport: Boolean(
        imageDocument?.photoshopImportReport || fontDiagnostics.length > 0
      ),
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
      exportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPng(); },
      openCompatibilityReport: editorDialogs.openPsdReport,
      openFormatSupport: editorDialogs.openFormatSupport,
      pdfExportPreflight: () => {
        finishTextEditingRef.current();
        commitPointTextRef.current();
        commitParagraphTextRef.current();
        const document = imageDocumentRef.current;
        if (!document) return;
        const fonts = textFontRegistry.availableAssets;
        const plan = buildPdfTextExportPreflight({
          document,
          availableFonts: fonts,
          fontBytesAvailable: new Set(fonts.map((font) => font.assetId)),
          realizedLayout: (layerId) => engineRef.current?.textEditingLayout(layerId)?.layout ?? null
        });
        const hybridPlan = planHybridPdfPageExport({
          document,
          textPlan: plan,
          documentProcessingActive: pdfDocumentProcessingActive(documentAdjustmentsRef.current)
        });
        const vectorPlan = planHybridPdfVectorPageExport(
          document,
          pdfDocumentProcessingActive(documentAdjustmentsRef.current)
        );
        const nativePlan = planHybridPdfNativePageExport({
          document,
          textPlan: plan,
          documentProcessingActive: pdfDocumentProcessingActive(documentAdjustmentsRef.current)
        });
        editorDialogs.openPdfExportPreflight({
          plan,
          fontLabels: Object.fromEntries(fonts.map((font) => [
            font.assetId,
            `${font.familyNames[0] ?? font.postScriptName ?? font.assetId} ${font.styleName}`.trim()
          ])),
          validateFonts: plan.fonts.length > 0 ? async () => {
            const { materializePdfFontsWithHarfBuzz } = await import(
              './infrastructure/pdf/materializePdfFontsWithHarfBuzz'
            );
            const resources = await materializePdfFontsWithHarfBuzz(plan, {
              fonts,
              loadFontBytes: (assetId) => textFontRegistry.bytes(assetId)
            });
            return {
              embeddedFontCount: resources.embedded.length,
              totalEmbeddedBytes: resources.totalEmbeddedBytes
            };
          } : undefined,
          exportNativeTextPage: hybridPlan.kind === 'ready' ? async () => {
            const currentDocument = imageDocumentRef.current;
            const renderer = engineRef.current;
            if (!currentDocument || !renderer) throw new Error('LightTable is not ready yet.');
            if (currentDocument.id !== document.id || currentDocument.revision !== document.revision) {
              throw new Error('The document changed after PDF preflight. Open preflight again.');
            }
            const { materializePdfFontsWithHarfBuzz } = await import(
              './infrastructure/pdf/materializePdfFontsWithHarfBuzz'
            );
            const resources = await materializePdfFontsWithHarfBuzz(plan, {
              fonts,
              loadFontBytes: (assetId) => textFontRegistry.bytes(assetId)
            });
            const nativePage = buildPdfNativeTextPage({
              document: currentDocument,
              plan,
              realizedLayout: (layerId) => renderer.textEditingLayout(layerId)?.layout ?? null,
              nativeTextLayerIds: hybridPlan.nativeTextLayerIds,
              pixelsPerInch: 300
            });
            const rasterUnderlayPng = await renderer.exportPng({
              excludedLayerIds: [...hybridPlan.nativeTextLayerIds]
            });
            const { writeNativeTextPdfPage } = await import(
              './infrastructure/pdf/writeNativeTextPdfPage'
            );
            const result = await writeNativeTextPdfPage({
              page: nativePage,
              fonts: resources.embedded,
              title: currentDocument.name,
              rasterUnderlayPng
            });
            downloadEditorFile(new File(
              [result.blob],
              `${fileNameBase.replace(/\.pdf$/i, '')}-native.pdf`,
              { type: 'application/pdf' }
            ));
            return {
              byteLength: result.blob.size,
              searchableLayerCount: plan.layers.filter(layer => layer.disposition === 'text').length
            };
          } : undefined,
          nativeTextUnavailableReason: plan.layers.length > 0 && hybridPlan.kind === 'flattened-only'
            ? hybridPlan.reasons.map(reason => hybridPdfReasonLabel[reason]).join('; ')
            : undefined,
          nativeVectorLayerCount: vectorPlan.kind === 'ready'
            ? vectorPlan.nativeVectorLayerIds.size
            : 0,
          exportNativeVectorPage: vectorPlan.kind === 'ready' ? async () => {
            const currentDocument = imageDocumentRef.current;
            const renderer = engineRef.current;
            if (!currentDocument || !renderer) throw new Error('LightTable is not ready yet.');
            if (currentDocument.id !== document.id || currentDocument.revision !== document.revision) {
              throw new Error('The document changed after PDF preflight. Open preflight again.');
            }
            const nativeExport = buildPdfNativeVectorExportPage({
              document: currentDocument,
              nativeVectorLayerIds: vectorPlan.nativeVectorLayerIds,
              transparencyGroups: vectorPlan.transparencyGroups,
              clippingPairs: vectorPlan.clippingPairs,
              pixelsPerInch: 300
            });
            const rasterUnderlayPng = await renderer.exportPng({
              excludedLayerIds: [...vectorPlan.nativeVectorLayerIds]
            });
            const { writePdfDisplayListPage } = await import(
              './infrastructure/pdf/writePdfDisplayListPage'
            );
            const result = await writePdfDisplayListPage({
              page: nativeExport.page,
              title: currentDocument.name,
              rasterUnderlayPng,
              transparencyGroups: nativeExport.transparencyGroups
            });
            downloadEditorFile(new File(
              [result.blob],
              `${fileNameBase.replace(/\.pdf$/i, '')}-vectors.pdf`,
              { type: 'application/pdf' }
            ));
            return {
              byteLength: result.blob.size,
              vectorLayerCount: vectorPlan.nativeVectorLayerIds.size
            };
          } : undefined,
          nativeVectorUnavailableReason: vectorPlan.kind === 'flattened-only'
            && !vectorPlan.reasons.includes('no-native-vectors')
            ? vectorPlan.reasons.map(reason => hybridPdfVectorReasonLabel[reason]).join('; ')
            : undefined,
          nativeMixedLayerCount: nativePlan.kind === 'ready'
            ? nativePlan.nativeLayerOrder.length
            : 0,
          exportNativeMixedPage: nativePlan.kind === 'ready'
            && nativePlan.nativeTextLayerIds.size > 0
            && nativePlan.nativeVectorLayerIds.size > 0 ? async () => {
              const currentDocument = imageDocumentRef.current;
              const renderer = engineRef.current;
              if (!currentDocument || !renderer) throw new Error('LightTable is not ready yet.');
              if (currentDocument.id !== document.id || currentDocument.revision !== document.revision) {
                throw new Error('The document changed after PDF preflight. Open preflight again.');
              }
              const { materializePdfFontsWithHarfBuzz } = await import(
                './infrastructure/pdf/materializePdfFontsWithHarfBuzz'
              );
              const resources = await materializePdfFontsWithHarfBuzz(plan, {
                fonts,
                loadFontBytes: (assetId) => textFontRegistry.bytes(assetId)
              });
              const nativeTextPage = buildPdfNativeTextPage({
                document: currentDocument,
                plan,
                realizedLayout: (layerId) => renderer.textEditingLayout(layerId)?.layout ?? null,
                nativeTextLayerIds: nativePlan.nativeTextLayerIds,
                pixelsPerInch: 300
              });
              const nativeVectorPage = buildPdfNativeVectorLayerPage({
                document: currentDocument,
                nativeVectorLayerIds: nativePlan.nativeVectorLayerIds,
                pixelsPerInch: 300
              });
              const excludedLayerIds = [
                ...nativePlan.nativeTextLayerIds,
                ...nativePlan.nativeVectorLayerIds
              ];
              const rasterUnderlayPng = await renderer.exportPng({ excludedLayerIds });
              const { writeNativeTextPdfPage } = await import(
                './infrastructure/pdf/writeNativeTextPdfPage'
              );
              const result = await writeNativeTextPdfPage({
                page: nativeTextPage,
                fonts: resources.embedded,
                title: currentDocument.name,
                rasterUnderlayPng,
                vectorLayers: nativeVectorPage.layers,
                nativeLayerOrder: nativePlan.nativeLayerOrder
              });
              downloadEditorFile(new File(
                [result.blob],
                `${fileNameBase.replace(/\.pdf$/i, '')}-native-mixed.pdf`,
                { type: 'application/pdf' }
              ));
              return {
                byteLength: result.blob.size,
                searchableLayerCount: nativePlan.nativeTextLayerIds.size,
                vectorLayerCount: nativePlan.nativeVectorLayerIds.size
              };
            } : undefined,
          nativeMixedUnavailableReason: nativePlan.kind === 'flattened-only'
            && plan.layers.length > 0
            && vectorPlan.kind === 'ready'
            ? nativePlan.reasons.map(reason => hybridPdfNativeReasonLabel[reason]).join('; ')
            : undefined,
          exportFlattenedPage: async () => {
            const currentDocument = imageDocumentRef.current;
            const renderer = engineRef.current;
            if (!currentDocument || !renderer) throw new Error('LightTable is not ready yet.');
            const png = await renderer.exportPng();
            const { writeRasterPdfPage } = await import(
              './infrastructure/pdf/writeRasterPdfPage'
            );
            const result = await writeRasterPdfPage({
              png,
              widthPixels: currentDocument.width,
              heightPixels: currentDocument.height,
              pixelsPerInch: 300,
              title: currentDocument.name
            });
            downloadEditorFile(new File(
              [result.blob],
              `${fileNameBase.replace(/\.pdf$/i, '')}.pdf`,
              { type: 'application/pdf' }
            ));
            return { byteLength: result.blob.size };
          }
        });
      }
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
      panel: commandLayerPanelController,
      duplicate: duplicateActiveLayer,
      rasterizeText: rasterizeActiveTextLayer,
      convertTextToShape: () => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) requestTextToShape(layerId);
      },
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
      fit: fitZoom,
      actualSize: actualZoom,
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
      textFontDiagnostics={fontDiagnostics}
      thumbnails={layerThumbnails}
      activeChannel={editorSession.activeChannel}
      isolatedMaskLayerId={isolatedMaskLayerId}
      controller={commandLayerPanelController}
      editingTextLayerId={textEditing.layerId}
      onEditText={(layerId) => {
        pointTextController.cancel();
        activatePersistentTool('text-point');
        requestExistingFlowTextEditing(layerId);
      }}
      onOpenFontReport={() => editorDialogs.openPsdReport()}
      onConvertTextToShape={requestTextToShape}
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
    : temporaryZoomActive
      ? 'zoom'
      : temporaryEraseActive
        ? 'erase'
        : editorSession.activeTool;
  const updateBrush = (change: Partial<EditorSession['brush']>) => {
    setEditorSession((current) => ({
      ...current,
      brush: { ...current.brush, ...change }
    }));
  };

  function requestTextToShape(layerId: LayerId) {
    const layer = imageDocumentRef.current
      ? findDocumentLayer(imageDocumentRef.current, layerId)
      : null;
    if (layer?.type !== 'text' || layer.locks.all || layer.locks.pixels) return;
    textEditingController.finish();
    pointTextController.cancel();
    paragraphTextController.cancel();
    editorDialogs.requestTextToShape({ layerId });
  }

  function commitTextToShape(layerId: LayerId) {
    setGradeStatus('Converting text to editable shapes...');
    void textToShapeController.convert(layerId).then((converted) => {
      setGradeStatus(converted ? 'Text converted to editable shapes.' : null);
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setGradeStatus(null);
        return;
      }
      setGradeStatus(null);
      setError(reason instanceof Error ? reason.message : 'Text could not be converted to shapes.');
    });
  }
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
  const textFormatProjection = editingTargetsActiveLayer
    ? textEditingController.formatProjection()
    : null;
  const projectedInsertionStyle = textFormatProjection?.target === 'insertion'
    && textFormatProjection.style.kind === 'value'
    ? { ...textFormatProjection.style.value, start: 0, end: 0 }
    : undefined;
  const projectedInsertionParagraph = textFormatProjection?.target === 'insertion'
    && textFormatProjection.paragraph.kind === 'value'
    ? { ...textFormatProjection.paragraph.value, start: 0, end: 0 }
    : undefined;
  const textPropertyPresentation = activeFlowTextPropertyLayer && activeFlowTextPropertySource
    ? buildTextPropertyPresentation(
        activeFlowTextPropertySource,
        editingTargetsActiveLayer
          ? textEditing.selection : null,
        availableFontAssets,
        projectedInsertionStyle,
        projectedInsertionParagraph
      )
    : activeTextPropertyLayer?.type === 'text' ? {
        target: 'layer' as const,
        family: { kind: 'unavailable' as const },
        face: { kind: 'unavailable' as const },
        size: { kind: 'unavailable' as const },
        fillEnabled: { kind: 'unavailable' as const },
        fill: { kind: 'unavailable' as const },
        strokeColor: { kind: 'unavailable' as const },
        strokeWidth: { kind: 'unavailable' as const },
        tracking: { kind: 'unavailable' as const },
        kerning: { kind: 'unavailable' as const },
        baselineShift: { kind: 'unavailable' as const },
        horizontalScale: { kind: 'unavailable' as const },
        verticalScale: { kind: 'unavailable' as const },
        syntheticBold: { kind: 'unavailable' as const },
        syntheticItalic: { kind: 'unavailable' as const },
        underline: { kind: 'unavailable' as const },
        writingMode: { kind: 'unavailable' as const },
        alignment: { kind: 'unavailable' as const },
        lineHeight: { kind: 'unavailable' as const },
        firstLineIndent: { kind: 'unavailable' as const },
        startIndent: { kind: 'unavailable' as const },
        endIndent: { kind: 'unavailable' as const },
        spaceBefore: { kind: 'unavailable' as const },
        spaceAfter: { kind: 'unavailable' as const },
        advancedUnavailableReason:
          'Positioned imported text preserves exact glyph placement. Editable flow conversion is not available yet; preserve it or rasterize a copy.'
      } : null;
  const positionedTextRecovery = activeTextPropertyLayer?.type === 'text'
    && activeTextPropertyLayer.text.source.kind === 'positioned'
    ? positionedTextRecoveryController.analyze(activeTextPropertyLayer.id)
    : null;
  const textLayoutMode = activeFlowTextPropertySource?.layout.mode === 'point'
    || activeFlowTextPropertySource?.layout.mode === 'paragraph'
    ? activeFlowTextPropertySource.layout.mode
    : null;
  const changeTextLayoutMode = (mode: 'point' | 'paragraph') => {
    const editing = textEditingController.getSnapshot();
    const layerId = activeFlowTextPropertyLayer?.id;
    if (!layerId || mode === textLayoutMode) return;
    const firstBaselineOffset = engineRef.current
      ?.textEditingLayout(layerId)?.layout.firstBaselineOffset ?? 0;
    const restoreEditing = editing.status === 'editing' && editing.layerId === layerId;
    const restoreOffset = restoreEditing
      ? textEditingController.getSnapshot().selection.focus
      : undefined;
    if (restoreEditing) textEditingController.finish();
    const before = imageDocumentRef.current;
    if (!before) return;
    const after = mode === 'paragraph'
      ? convertPointTextToParagraph(before, layerId, {
          width: 240,
          height: 120,
          firstBaselineOffset
        })
      : convertParagraphTextToPoint(before, layerId, { firstBaselineOffset });
    if (after === before) return;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    activatePersistentTool('text-point');
    if (restoreEditing) textEditingController.begin(layerId, restoreOffset);
  };
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
  const applyTextPropertyPatch = (
    patch: TextStylePatch,
    paragraphPatch: ParagraphStylePatch = {}
  ) => {
    const gesture = textPropertyGestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'text') {
      const editing = textEditingController.getSnapshot();
      if (editing.status !== 'editing' || editing.layerId !== gesture.layerId) return;
      textEditingController.format(patch, paragraphPatch);
      return;
    }
    if (imageDocumentRef.current?.id !== gesture.documentId) return;
    const layerId = gesture.layerId;
    documentMutationController.change((document) => {
      const layer = findDocumentLayer(document, layerId);
      if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
      return applyTextLayerDataMutation(document, layerId, {
        ...layer.text,
        source: formatFlowTextSource(layer.text.source, null, patch, paragraphPatch)
      });
    });
  };
  const cancelPendingTextPaintPreview = () => {
    pendingTextPaintPatchRef.current = null;
    if (textPaintPreviewFrameRef.current === null) return;
    window.cancelAnimationFrame(textPaintPreviewFrameRef.current);
    textPaintPreviewFrameRef.current = null;
  };
  const flushPendingTextPaintPreview = () => {
    const patch = pendingTextPaintPatchRef.current;
    pendingTextPaintPatchRef.current = null;
    if (textPaintPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(textPaintPreviewFrameRef.current);
      textPaintPreviewFrameRef.current = null;
    }
    if (patch) applyTextPropertyPatch(patch);
  };
  const queueTextPaintPreview = (patch: TextStylePatch) => {
    pendingTextPaintPatchRef.current = patch;
    if (textPaintPreviewFrameRef.current !== null) return;
    textPaintPreviewFrameRef.current = window.requestAnimationFrame(() => {
      textPaintPreviewFrameRef.current = null;
      flushPendingTextPaintPreview();
    });
  };
  const commitTextPropertyGesture = () => {
    flushPendingTextPaintPreview();
    const gesture = textPropertyGestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'text') textEditingController.endFormatting();
    else endDocumentTransaction();
    textPropertyGestureRef.current = null;
  };
  const cancelTextPropertyGesture = () => {
    cancelPendingTextPaintPreview();
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
  const applyDiscreteTextParagraph = (patch: ParagraphStylePatch) => {
    if (!beginTextPropertyGesture()) return;
    applyTextPropertyPatch({}, patch);
    commitTextPropertyGesture();
  };
  const applyTextFontAsset = (assetId: string) => {
    void (async () => {
      const bundled = await registerBundledTextFontByAssetId(textFontRegistry, assetId);
      const asset = bundled ?? textFontRegistry.availableAssets.find((font) => font.assetId === assetId);
      if (!asset) return;
      if (!textPropertyPresentation) {
        updateText({ family: asset.familyNames[0]!, style: asset.styleName });
      } else {
        applyDiscreteTextProperty(textFontPatch(asset));
      }
    })().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The selected font could not be loaded.');
    });
  };
  const applyTextFill = (fill: string) => {
    if (!textPropertyPresentation) {
      updateBrush({ color: fill });
      return;
    }
    // Native colour pickers can emit far more input events than the compositor
    // can present. Coalesce them to one canonical paint update per frame while
    // retaining the final value on gesture commit.
    const patch = textFillPatchFromHex(fill);
    if (patch) queueTextPaintPreview(patch);
  };
  const applyTextFillPaint = (fill: TextPaint) => {
    queueTextPaintPreview({ fill: structuredClone(fill) });
  };
  const applyTextFillEnabled = (enabled: boolean) => {
    if (!textPropertyPresentation) {
      updateText({ fillEnabled: enabled });
      return;
    }
    const fallback = textPropertyPresentation.fill.kind === 'value'
      ? textPropertyPresentation.fill.value : editorSession.brush.color;
    applyDiscreteTextProperty(textFillEnabledPatch(enabled, fallback));
  };
  const applyTextStrokeColor = (stroke: string) => {
    const width = textPropertyPresentation?.strokeWidth.kind === 'value'
      && textPropertyPresentation.strokeWidth.value > 0
      ? textPropertyPresentation.strokeWidth.value : 1;
    const patch = textStrokePatch(stroke, width);
    if (patch) queueTextPaintPreview(patch);
  };
  const applyTextStrokeWidth = (width: number) => {
    const stroke = textPropertyPresentation?.strokeColor.kind === 'value'
      ? textPropertyPresentation.strokeColor.value : '#000000';
    const patch = textStrokePatch(stroke, width);
    if (patch) applyTextPropertyPatch(patch);
  };
  const applyTextWritingMode = (
    writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr'
  ) => {
    const before = imageDocumentRef.current;
    const layerId = before?.activeLayerId;
    if (!before || !layerId) return;
    const layer = findDocumentLayer(before, layerId);
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow'
      || layer.text.source.layout.mode === 'path') return;
    textEditingController.finish();
    const after = setFlowTextLayout(before, layerId, {
      ...layer.text.source.layout,
      writingMode
    });
    if (after === before) return;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    activatePersistentTool(writingMode === 'horizontal-tb' ? 'text-point' : 'text-vertical');
  };
  useEffect(() => () => {
    pendingTextPaintPatchRef.current = null;
    if (textPaintPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(textPaintPreviewFrameRef.current);
      textPaintPreviewFrameRef.current = null;
    }
  }, []);
  const textPropertiesPanel = textPropertyPresentation ? {
    model: textPropertyPresentation,
    fonts: availableFontAssets,
    onFontAsset: applyTextFontAsset,
    onSize: (size: number) => applyTextPropertyPatch({ fontSize: size }),
    onFill: applyTextFill,
    onFillEnabled: applyTextFillEnabled,
    onStrokeColor: applyTextStrokeColor,
    onStrokeWidth: applyTextStrokeWidth,
    onTracking: (tracking: number) => applyTextPropertyPatch({ tracking }),
    onStyle: (patch: TextStylePatch) => applyTextPropertyPatch(patch),
    onWritingMode: applyTextWritingMode,
    onParagraph: (patch: ParagraphStylePatch) => applyTextPropertyPatch({}, patch),
    onBegin: beginTextPropertyGesture,
    onCommit: commitTextPropertyGesture,
    onCancel: cancelTextPropertyGesture,
    ...(positionedTextRecovery ? {
      recovery: {
        analysis: positionedTextRecovery,
        onRecover: () => {
          const layerId = activeTextPropertyLayer?.id;
          if (!layerId) return;
          textEditingController.finish();
          const recovered = positionedTextRecoveryController.recover(layerId);
          setGradeStatus(recovered
            ? 'Imported text recovered as editable flow text. Undo restores exact positioned glyphs.'
            : 'Imported text could not be recovered.');
        }
      }
    } : {})
  } : null;
  useEffect(() => {
    if (activeTextPropertyLayer?.type === 'text') {
      workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.text);
    }
  }, [activeTextPropertyLayer?.id, activeTextPropertyLayer?.type]);
  return (
    <LightTableEditorShell
      screenMode={screenMode}
      active={active}
      saving={saving}
      onClose={onClose}
      menuOptionsFor={createAppMenuOptions}
      activeTool={visibleTool}
      brush={editorSession.brush}
      gradient={gradientToolSettings}
      shape={editorSession.shape}
      pen={editorSession.pen}
      warp={editorSession.warp}
      vectorStyle={editorSession.vectorStyle}
      text={editorSession.text}
      textFonts={selectableTextFonts}
      textProperties={textPropertyPresentation}
      textLayoutMode={textLayoutMode}
      selectedVectorStyle={selectedVectorStyle}
      selectedShape={selectedShapeGeometry?.settings ?? null}
      selectedShapeKind={selectedShapeGeometry?.kind ?? null}
      selectionPixelSnap={editorSession.selectionPixelSnap}
      selectionCombineMode={editorSession.selectionCombineMode}
      selectionRowHeight={editorSession.selectionRowHeight}
      selectionColumnWidth={editorSession.selectionColumnWidth}
      zoomPercent={activeScale * 100}
      transformState={transformState}
      onBrushChange={updateBrush}
      onGradientChange={(change) => setEditorSession((current) => ({
        ...current,
        gradient: { ...(current.gradient ?? fallbackGradientSettingsRef.current), ...change }
      }))}
      onShapeChange={(change) => setEditorSession((current) => ({
        ...current, shape: { ...current.shape, ...change }
      }))}
      onPenChange={(change) => setEditorSession((current) => ({
        ...current, pen: { ...current.pen, ...change }
      }))}
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
      onTextFillPaintChange={applyTextFillPaint}
      onTextFillEnabledChange={applyTextFillEnabled}
      onTextStrokeColorChange={applyTextStrokeColor}
      onTextStrokeWidthChange={applyTextStrokeWidth}
      onTextAlignmentChange={(alignment) => applyDiscreteTextParagraph({ alignment })}
      onTextWritingModeChange={applyTextWritingMode}
      onTextPropertyBegin={beginTextPropertyGesture}
      onTextPropertyCommit={commitTextPropertyGesture}
      onTextPropertyCancel={cancelTextPropertyGesture}
      onTextLayoutModeChange={changeTextLayoutMode}
      onSelectedVectorStyleChange={updateSelectedVectorStyle}
      onSelectedShapeChange={updateSelectedShapeGeometry}
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
      onTransformChange={updateTransformMatrix}
      onTransformCommit={transformSession.commit}
      onTransformCancel={transformSession.cancel}
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
            textFontDiagnostics: fontDiagnostics,
            replacementFonts: selectableTextFonts,
            onResolveTextFont: (layerId) => {
              const layer = imageDocumentRef.current
                ? findDocumentLayer(imageDocumentRef.current, layerId)
                : null;
              layerPanelController.select(layerId);
              editorDialogs.closePsdReport();
              if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
              pointTextController.cancel();
              activatePersistentTool('text-point');
              requestExistingFlowTextEditing(layerId);
              workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.text);
            },
            onReplaceTextFont: (layerId, assetId, offset, affinity) => {
              void (async () => {
                const bundled = await registerBundledTextFontByAssetId(textFontRegistry, assetId);
                const asset = bundled
                  ?? textFontRegistry.availableAssets.find((candidate) => candidate.assetId === assetId);
                if (!asset) throw new Error('The selected replacement font is not available.');
                const before = imageDocumentRef.current;
                const layer = before ? findDocumentLayer(before, layerId) : null;
                if (!before || layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
                const requestedFont = fontDiagnostics.find((diagnostic) => (
                  diagnostic.layerId === layerId && diagnostic.issue === 'font-missing'
                ))?.requestedFont ?? undefined;
                const after = replaceMissingTextFont(before, layerId, asset, requestedFont);
                editorDialogs.closeMissingFontRecovery();
                if (after !== before) {
                  applyDocumentSnapshot(after);
                  pushDocumentHistory(before, after);
                }
                layerPanelController.select(layerId);
                activatePersistentTool('text-point');
                textEditingController.begin(layerId, offset, affinity ?? 'downstream');
                workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.text);
                setGradeStatus(`Replaced the unavailable font with ${asset.familyNames[0] ?? asset.styleName}.`);
              })().catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : 'The replacement font could not be applied.');
              });
            },
            onReplaceTextFonts: (layerIds, assetId, requestedFont) => {
              void (async () => {
                const bundled = await registerBundledTextFontByAssetId(textFontRegistry, assetId);
                const asset = bundled
                  ?? textFontRegistry.availableAssets.find((candidate) => candidate.assetId === assetId);
                if (!asset) throw new Error('The selected replacement font is not available.');
                const before = imageDocumentRef.current;
                if (!before) return;
                const after = replaceMissingTextFonts(before, layerIds, asset, requestedFont);
                if (after === before) return;
                applyDocumentSnapshot(after);
                pushDocumentHistory(before, after);
                setGradeStatus(
                  `Replaced ${layerIds.length} ${layerIds.length === 1 ? 'layer' : 'layers'} with ${asset.familyNames[0] ?? asset.styleName}.`
                );
              })().catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : 'The document font replacement could not be applied.');
              });
            },
            onFeather: featherCurrentSelection,
            foregroundColor: editorSession.brush.color,
            backgroundColor: editorSession.brush.backgroundColor,
            onFill: fillActiveTarget,
            onFlatten: commitFlattenRequest,
            onConvertTextToShape: commitTextToShape,
            onError: setError
          }}
          toolOptions={toolOptionsMenu ? {
            x: toolOptionsMenu.x,
            y: toolOptionsMenu.y,
            activeTool: visibleTool,
            brush: editorSession.brush,
            gradient: gradientToolSettings,
            shape: editorSession.shape,
            pen: editorSession.pen,
            warp: editorSession.warp,
            vectorStyle: editorSession.vectorStyle,
            text: editorSession.text,
            textFonts: selectableTextFonts,
            textProperties: textPropertyPresentation,
            textLayoutMode,
            selectedVectorStyle,
            selectedShape: selectedShapeGeometry?.settings ?? null,
            selectedShapeKind: selectedShapeGeometry?.kind ?? null,
            selectionPixelSnap: editorSession.selectionPixelSnap,
            selectionCombineMode: editorSession.selectionCombineMode,
            selectionRowHeight: editorSession.selectionRowHeight,
            selectionColumnWidth: editorSession.selectionColumnWidth,
            zoomPercent: activeScale * 100,
            onBrushChange: updateBrush,
            onGradientChange: (change) => setEditorSession((current) => ({
              ...current,
              gradient: { ...(current.gradient ?? fallbackGradientSettingsRef.current), ...change }
            })),
            onShapeChange: (change) => setEditorSession((current) => ({
              ...current, shape: { ...current.shape, ...change }
            })),
            onPenChange: (change) => setEditorSession((current) => ({
              ...current, pen: { ...current.pen, ...change }
            })),
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
            onTextFillPaintChange: applyTextFillPaint,
            onTextFillEnabledChange: applyTextFillEnabled,
            onTextStrokeColorChange: applyTextStrokeColor,
            onTextStrokeWidthChange: applyTextStrokeWidth,
            onTextAlignmentChange: (alignment) => applyDiscreteTextParagraph({ alignment }),
            onTextWritingModeChange: applyTextWritingMode,
            onTextPropertyBegin: beginTextPropertyGesture,
            onTextPropertyCommit: commitTextPropertyGesture,
            onTextPropertyCancel: cancelTextPropertyGesture,
            onTextLayoutModeChange: changeTextLayoutMode,
            onSelectedVectorStyleChange: updateSelectedVectorStyle,
            onSelectedShapeChange: updateSelectedShapeGeometry,
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
            onToolChange: activatePersistentTool,
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
                    temporaryZoomActive,
                    zoomOutActive: temporaryZoomOutActive
                      || (editorSession.activeTool === 'zoom' && altPressed),
                    preciseBrushCursor,
                    eyedropperActive: (editorSession.activeTool === 'brush'
                      || editorSession.activeTool === 'fill'
                      || editorSession.activeTool === 'gradient') && altPressed,
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
                      <FlowTextEditingRuntime
                        controller={textEditingController}
                        document={imageDocument}
                        renderer={engineRef.current}
                        active={active}
                        layoutPublicationRevision={textRenderPresentation.publicationRevision}
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
                    reportAvailable: statusBar.reportAvailable || fontDiagnostics.length > 0,
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
