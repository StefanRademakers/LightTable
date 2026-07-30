import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '../ui/ContextMenu';
import { SquareIconButton } from '../ui/SquareIconButton';
import { TextInputDialog } from '../ui/TextInputDialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { lightTableIcon } from '../assets/icons';
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
import { loadDocumentSource } from './application/documents/loadDocumentSource';
import { hydrateDocumentSource } from './application/documents/hydrateDocumentSource';
import { DocumentOpenController } from './application/documents/documentOpenController';
import { exportLightTableDocument } from './application/documents/exportLightTableDocument';
import { useDocumentMutationController } from './application/documents/useDocumentMutationController';
import {
  isTemporaryPanRelease,
  resolveEditorKeyboardCommand,
  type EditorKeyboardCommand
} from './application/input/editorKeyboardRouter';
import { useAdjustmentTransactionController } from './application/adjustments/useAdjustmentTransactionController';
import { createAdjustmentCommands } from './application/adjustments/createAdjustmentCommands';
import {
  createEditorMenuOptions,
  type EditorMenuId
} from './editor/menus/createEditorMenuOptions';
import { projectAdjustmentSnapshot } from './application/adjustments/projectAdjustmentSnapshot';
import { useEditorWindowInput } from './editor/hooks/useEditorWindowInput';
import { planPersistentToolActivation } from './application/tools/persistentToolActivation';
import { useAutoAlignController } from './application/tools/autoAlign/useAutoAlignController';
import { useLayerStyleEditorController } from './application/styles/useLayerStyleEditorController';
import { useLayerDocumentCommands } from './application/layers/useLayerDocumentCommands';
import {
  formatStartupTimings,
  type LightTableStartupTimings
} from './application/telemetry/editorTelemetry';
import { buildEditorStatus } from './application/telemetry/editorStatus';
import {
  type LightTableImageDecodeMode,
  type ReferenceDifferenceMetrics
} from './application/rendering/rendererTypes';
import {
  createWebGpuDocumentRenderer,
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
import type { DepthAnalysisProgress, DepthAnalysisResult } from './analysis/depth/types';
import { ScopesPanel } from './ScopesPanel';
import { EditorToolbar } from './editor/ui/EditorToolbar';
import {
  LayerPanel,
  type LayerThumbnailPreview,
  type LayerThumbnailSet
} from './editor/ui/LayerPanel';
import { LayerStyleEditor } from './editor/ui/LayerStyleEditor';
import { ToolOptionsBar } from './editor/ui/ToolOptionsBar';
import { DebugPanel } from './editor/ui/DebugPanel';
import { DocumentViewportSurface } from './editor/ui/DocumentViewportSurface';
import { EditorStatusBar } from './editor/ui/EditorStatusBar';
import { GradePanel } from './editor/panels/GradePanel';
import { LensFxPanel } from './editor/panels/LensFxPanel';
import {
  type LightTableDebugMessage,
  type LightTableDebugSeverity
} from './editor/debug/debugLog';
import {
  LightTableDockWorkspace,
  type LightTableDockWorkspaceHandle
} from './editor/workspace/LightTableDockWorkspace';
import { createEditorSession, type EditorSession, type ToolId } from './editor/session/editorSession';
import { TemporaryToolController } from './editor/tools/temporaryToolController';
import {
  executeFillOperation
} from './application/tools/fill/fillOperation';
import { usePaintSessionController } from './application/tools/paint/usePaintSessionController';
import { useSelectionSessionController } from './application/tools/selection/useSelectionSessionController';
import { useTransformSessionController } from './application/tools/transform/useTransformSessionController';
import {
  useDocumentImageState,
  useDocumentEditorSession,
  useDocumentViewportState
} from './editor/hooks/useDocumentEditorState';
import {
  applyGroupVisibility,
  createDefaultGroupVisibility,
  type GroupVisibility
} from './application/adjustments/groupVisibility';
import {
  type LensBlurViewportMode
} from './editor/config/adjustmentControls';
import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type Rect
} from './editor/document/documentTypes';
import {
  findDocumentLayer,
  findRasterLayer,
  rasterLayerCount,
  siblingLayers,
  walkLayerTree,
  walkRasterLayers
} from './editor/document/layerTree';
import {
  addLayerMask,
  createGroupLayer,
  createAdjustmentLayer,
  createRasterLayer,
  deleteLayer,
  deleteLayers,
  getFlattenGroupPlan,
  getFlattenImagePlan,
  groupLayers,
  moveLayerSelection,
  moveLayer,
  renameLayer,
  removeLayerMask,
  setActiveLayer,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerLocked,
  setLayerMaskEnabled,
  setLayerOpacity,
  setLayerVisibility,
  setLayersLock,
  setLayersVisibility,
  ungroupLayers
} from './editor/document/documentCommands';
import { BLEND_MODES } from './editor/document/blendModes';
import {
  clearLayerStyles,
  setLayerStyleEnabled,
  setLayerStyleStackEnabled
} from './editor/styles/layerStyleCommands';
import {
  type PreservedSourceAssetBlob
} from './editor/persistence/layeredDocumentFormat';
import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments,
  materializeBasicAdjustments
} from './processing/adjustmentStack';
import {
  imagePickerAccept,
  imagePickerFormatNames,
  pickSupportedImageFile
} from './image-io/supportedImageFormats';
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from './editor/psd/psdDocumentAdapter';
import { PsdImportReportDialog } from './editor/psd/PsdImportReportDialog';
import { paintTargetSourceToDocument } from './editor/tools/paint/paintCoordinates';
import { PaintGestureController } from './editor/tools/paint/paintGestureController';
import {
  isPaintTool,
  isSelectionTool,
  steppedBrushSize
} from './editor/tools/toolCapabilities';
import {
  resolveViewportPointerDownIntent,
  resolveViewportPointerEndIntent,
  resolveViewportPointerMoveIntent
} from './application/input/viewportPointerRouter';
import {
  clientToLocalPoint,
  localToDocumentPointer,
  panViewFromGesture,
  pointInsideRect,
  zoomViewAtPoint
} from './editor/tools/pointer/viewportCoordinates';
import { SelectionGestureController } from './editor/tools/selection/selectionGestureController';
import {
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
const MAX_SCALE = 16;
const VIEWPORT_RESIZE_INTERVAL_MS = 50;
const SCOPES_RESIZE_SETTLE_MS = 120;
const IS_MAC_PLATFORM = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
const primaryShortcutLabel = (key: string, shift = false) => (
  IS_MAC_PLATFORM
    ? `${shift ? '⇧' : ''}⌘${key}`
    : `Ctrl+${shift ? 'Shift+' : ''}${key}`
);
const isTextEditingTarget = (target: EventTarget | null) => (
  target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || (target instanceof HTMLInputElement && target.type !== 'range')
  || (target instanceof HTMLElement && target.isContentEditable)
);
export interface LightTableEditorOverlayProps {
  open: boolean;
  active?: boolean;
  projectId: string;
  sourceFileKey?: string | null;
  sourceBlob?: Blob | null;
  sourceDecodeMode?: LightTableImageDecodeMode;
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
  onRequestOpenWorkspaceDocument?: (decodeMode: LightTableImageDecodeMode) => Promise<void> | void;
  onOpenWorkspaceDocument?: (file: File, decodeMode: LightTableImageDecodeMode) => void;
  onDocumentReady?: () => void;
  onDocumentError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  history?: DocumentCommandHistory;
  tasks?: DocumentTaskRegistry;
  rendererLifecycle?: DocumentRendererLifecycle;
  documentSession?: DocumentSession;
}

interface LayerThumbnailCacheEntry extends LayerThumbnailPreview {
  revisionKey: string;
}

type ZoomMode = 'fit' | '100' | 'custom';
type LightTableAppMenuId = EditorMenuId;

const cloneAdjustments = cloneAllAdjustments;

const scopeEngineOptions = (visibility: ScopeVisibility, settings: ScopeSettings) => ({
  // The Hue Distribution also drives the compact Color Mixer picker. Keep
  // its inexpensive 256-bin analysis alive when the standalone scope is
  // collapsed so the editing control remains useful.
  hueDistributionVisible: true,
  paradeVisible: visibility.parade,
  vectorscopeVisible: visibility.vectorscope,
  quality: settings.quality,
  traceBrightness: settings.traceBrightness,
  vectorscopeRange: settings.vectorscopeRange,
  vectorscopeZoom2x: settings.vectorscopeZoom2x
});

const HISTORY_LIMIT = 100;
const GPU_HISTORY_BYTE_LIMIT = 512 * 1024 * 1024;
export const LightTableEditorOverlay: React.FC<LightTableEditorOverlayProps> = ({
  open,
  active = true,
  projectId,
  sourceFileKey = null,
  sourceBlob: initialSourceBlob = null,
  sourceDecodeMode = 'fast',
  loadSource,
  initialRecipe = null,
  fileNameBase,
  onClose,
  onSave,
  workspaceDocumentId = 'active-document',
  workspaceDocuments,
  onActivateWorkspaceDocument,
  onCloseWorkspaceDocument,
  onRequestOpenWorkspaceDocument,
  onOpenWorkspaceDocument,
  onDocumentReady,
  onDocumentError,
  onDirtyChange,
  history,
  tasks,
  rendererLifecycle: providedRendererLifecycle,
  documentSession
}) => {
  const localHistory = useMemo(
    () => new DocumentCommandHistory(workspaceDocumentId as DocumentSessionId, {
      maxEntries: HISTORY_LIMIT,
      maxBytes: GPU_HISTORY_BYTE_LIMIT
    }),
    [workspaceDocumentId]
  );
  const commandHistory = history ?? localHistory;
  const localTasks = useMemo(
    () => new DocumentTaskRegistry(workspaceDocumentId as DocumentSessionId),
    [workspaceDocumentId]
  );
  const taskRegistry = tasks ?? localTasks;
  const localRendererLifecycle = useMemo(
    () => new DocumentRendererLifecycle(),
    [workspaceDocumentId]
  );
  const rendererLifecycle = providedRendererLifecycle ?? localRendererLifecycle;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDocumentReadyRef = useRef(onDocumentReady);
  const onDocumentErrorRef = useRef(onDocumentError);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDocumentReadyRef.current = onDocumentReady;
  onDocumentErrorRef.current = onDocumentError;
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    if (history) return;
    return commandHistory.subscribe((snapshot) => {
      onDirtyChangeRef.current?.(snapshot.dirty);
    });
  }, [commandHistory, history]);
  useEffect(() => () => {
    if (!history) localHistory.dispose();
  }, [history, localHistory]);
  useEffect(() => () => {
    if (!tasks) localTasks.dispose();
  }, [localTasks, tasks]);
  useEffect(() => () => {
    if (!providedRendererLifecycle) localRendererLifecycle.dispose();
  }, [localRendererLifecycle, providedRendererLifecycle]);
  useEffect(() => {
    rendererLifecycle.setActive(active);
  }, [active, rendererLifecycle]);
  const hueDistributionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorMixerHueCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorMixerScopeContainerRef = useRef<HTMLDivElement | null>(null);
  const paradeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scopesColumnRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const advancedFileInputRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<DocumentRendererPort | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const adjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const documentAdjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const resetAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetDocumentTransactionRef = useRef<() => void>(() => undefined);
  const preservedSourceAssetsRef = useRef<PreservedSourceAssetBlob[]>([]);
  const paintGestureRef = useRef(new PaintGestureController());
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const brushCursorCenterRef = useRef<{ x: number; y: number } | null>(null);
  const selectionGestureRef = useRef(new SelectionGestureController());
  const commitTransformRef = useRef<() => void>(() => undefined);
  const cancelTransformRef = useRef<() => void>(() => undefined);
  const resetTransformRef = useRef<() => void>(() => undefined);
  const transformActiveRef = useRef<() => boolean>(() => false);
  const activateToolRef = useRef<(tool: ToolId) => void>(() => undefined);
  const cancelAutoAlignRef = useRef<() => void>(() => undefined);
  const copySelectedContentRef = useRef<() => void>(() => undefined);
  const pasteSelectedContentRef = useRef<() => void>(() => undefined);
  const layerViaCopyRef = useRef<() => void>(() => undefined);
  const invertActiveLayerColorsRef = useRef<() => void>(() => undefined);
  const fillActiveTargetRef = useRef<(color: string) => void>(() => undefined);
  const temporaryToolRef = useRef(new TemporaryToolController());
  const groupVisibilityRef = useRef<GroupVisibility>(createDefaultGroupVisibility());
  const scopeSettingsRef = useRef<ScopeSettings>({ ...DEFAULT_SCOPE_SETTINGS });
  const scopeVisibilityRef = useRef<ScopeVisibility>({ ...DEFAULT_SCOPE_VISIBILITY });
  const startupStartedAtRef = useRef(0);
  const startupAwaitingFirstFrameRef = useRef(false);
  const startupTimingsRef = useRef<LightTableStartupTimings>({});
  const workspaceRef = useRef<LightTableDockWorkspaceHandle | null>(null);
  const layerThumbnailCacheRef = useRef<Map<string, LayerThumbnailCacheEntry>>(new Map());
  const [metadata, setMetadata] = useState<LightTableImageMetadata | null>(null);
  const [adjustments, setAdjustments] = useState<BasicAdjustments>(createDefaultAdjustments);
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showDifference, setShowDifference] = useState(false);
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
  const [psdReportOpen, setPsdReportOpen] = useState(false);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceIdentity, setSourceIdentity] = useState('');
  const [depthResult, setDepthResult] = useState<DepthAnalysisResult | null>(null);
  const [depthIdentity, setDepthIdentity] = useState('');
  const [depthProgress, setDepthProgress] = useState<DepthAnalysisProgress>({ status: 'idle' });
  const [focusPickerActive, setFocusPickerActive] = useState(false);
  const [lensBlurViewportMode, setLensBlurViewportModeState] = useState<LensBlurViewportMode>('result');
  const [appMenu, setAppMenu] = useState<{ id: LightTableAppMenuId; x: number; y: number } | null>(null);
  const [imageDocument, setImageDocument, imageDocumentRef] =
    useDocumentImageState(documentSession);
  const [thumbnailDocumentReadyId, setThumbnailDocumentReadyId] = useState<string | null>(null);
  const [layerThumbnails, setLayerThumbnails] = useState<ReadonlyMap<LayerId, LayerThumbnailSet>>(
    () => new Map()
  );
  const [editorSession, setEditorSession] = useDocumentEditorSession(documentSession);
  const [selectionDraft, setSelectionDraft] = useState<SelectionShape | null>(null);
  const [featherDialogOpen, setFeatherDialogOpen] = useState(false);
  const [flattenRequest, setFlattenRequest] = useState<
    { kind: 'group'; groupId: LayerId } | { kind: 'image' } | null
  >(null);
  const [selectionClipboardAvailable, setSelectionClipboardAvailable] = useState(false);
  const [temporaryPanActive, setTemporaryPanActive] = useState(false);
  const [startupTimings, setStartupTimings] = useState<LightTableStartupTimings | null>(null);
  const [gpuMemoryBytes, setGpuMemoryBytes] = useState(0);
  const [accessoryWidthConstraintsEnabled, setAccessoryWidthConstraintsEnabled] = useState(true);
  const [editorResizeObserversEnabled, setEditorResizeObserversEnabled] = useState(true);
  /*
   * This deliberately is not React state. A synchronous state update from a
   * Dockview sash pointer event rerenders the workspace in the middle of
   * Dockview's own drag lifecycle and can cancel or roll back that resize.
   */
  const dockResizeActiveRef = useRef(false);
  const dockResizeFinishFrameRef = useRef<number | null>(null);
  const debugMessageIdRef = useRef(1);
  const [debugMessages, setDebugMessages] = useState<LightTableDebugMessage[]>([]);
  const copiedGrade = useLightTableGradeClipboard();

  useEffect(() => {
    temporaryToolRef.current.end();
    setTemporaryPanActive(false);
  }, [workspaceDocumentId]);

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
  const psdCompatibilitySummary = useMemo(() => {
    const counts = new Map<PsdImportCompatibilityEntry['support'], number>();
    psdCompatibility.forEach(({ support }) => {
      counts.set(support, (counts.get(support) ?? 0) + 1);
    });
    return [
      ['native', 'native'],
      ['approximate', 'approximate'],
      ['raster-preview', 'preview-backed'],
      ['preserved', 'preserved/no-op'],
      ['placeholder', 'transparent placeholder']
    ].map(([support, label]) => {
      const count = counts.get(support as PsdImportCompatibilityEntry['support']) ?? 0;
      return count > 0 ? `${count} ${label}` : null;
    }).filter(Boolean).join('; ');
  }, [psdCompatibility]);

  const appendDebugMessage = useCallback((
    severity: LightTableDebugSeverity,
    source: string,
    message: string,
    details?: string
  ) => {
    setDebugMessages((current) => {
      const previous = current.at(-1);
      if (
        previous
        && previous.severity === severity
        && previous.source === source
        && previous.message === message
        && previous.details === details
        && Date.now() - previous.timestamp < 250
      ) {
        return current;
      }
      return [...current.slice(-499), {
        id: debugMessageIdRef.current++,
        timestamp: Date.now(),
        severity,
        source,
        message,
        details
      }];
    });
  }, []);

  useEffect(() => {
    if (!error) return;
    appendDebugMessage('error', 'LightTable', error);
    onDocumentErrorRef.current?.(error);
  }, [appendDebugMessage, error]);

  useEffect(() => {
    if (scopeError) appendDebugMessage('error', 'Scopes', scopeError);
  }, [appendDebugMessage, scopeError]);

  useEffect(() => {
    if (gradeStatus) appendDebugMessage('info', 'Status', gradeStatus);
  }, [appendDebugMessage, gradeStatus]);

  useEffect(() => {
    if (!startupTimings) return;
    const timings = formatStartupTimings(startupTimings);
    if (timings) appendDebugMessage('info', 'Startup', `Image ready: ${sourceName}`, timings);
    onDocumentReadyRef.current?.();
  }, [appendDebugMessage, sourceName, startupTimings]);

  useEffect(() => {
    if (!psdImportInfo) return;
    const inventory = psdImportInfo.inventory;
    appendDebugMessage(
      'info',
      'PSD import',
      `Reconstructed ${inventory.layers} layers, ${inventory.groups} groups, ${inventory.masks} masks, `
        + `${inventory.layerStyles} styled layers, ${inventory.adjustments} adjustment layers and `
        + `${inventory.smartObjects} smart objects.`,
      psdCompatibilitySummary ? `Compatibility: ${psdCompatibilitySummary}.` : undefined
    );
    psdImportInfo.warnings.forEach((warning) => {
      appendDebugMessage('warning', 'PSD import', warning);
    });
  }, [appendDebugMessage, psdCompatibilitySummary, psdImportInfo]);

  useEffect(() => {
    if (!psdDifferenceMetrics) return;
    appendDebugMessage(
      'info',
      'PSD comparison',
      `${psdDifferenceMetrics.differingPixelPercentage.toFixed(3)}% pixels differ above `
        + `${Math.round(psdDifferenceMetrics.threshold * 255)}/255.`,
      `Mean RGB error ${(psdDifferenceMetrics.meanAbsoluteRgbError * 100).toFixed(3)}%; `
        + `maximum channel error ${(psdDifferenceMetrics.maximumChannelError * 100).toFixed(2)}%; `
        + `${psdDifferenceMetrics.sampledPixels.toLocaleString()} samples (stride ${psdDifferenceMetrics.stride}).`
    );
  }, [appendDebugMessage, psdDifferenceMetrics]);

  useEffect(() => {
    if (!imageDocument || thumbnailDocumentReadyId !== imageDocument.id || !engineRef.current) {
      const cached = layerThumbnailCacheRef.current;
      cached.forEach(({ url }) => URL.revokeObjectURL(url));
      cached.clear();
      setLayerThumbnails(new Map());
      return;
    }

    let canceled = false;
    const engine = engineRef.current;
    const desired = walkLayerTree(imageDocument.layers).flatMap(({ node }) => {
      const channels: Array<{
        identity: string;
        layerId: LayerId;
        mask: boolean;
        revisionKey: string;
      }> = [];
      if (node.type === 'raster') {
        channels.push({
          identity: `${node.id}:pixels`,
          layerId: node.id,
          mask: false,
          revisionKey: `pixels:${node.pixelRevision}`
        });
      }
      if (node.mask) {
        channels.push({
          identity: `${node.id}:mask`,
          layerId: node.id,
          mask: true,
          revisionKey: `mask:${node.mask.pixelRevision}`
        });
      }
      return channels;
    });

    void (async () => {
      const committedCache = layerThumbnailCacheRef.current;
      const nextCache = new Map<string, LayerThumbnailCacheEntry>();
      const createdUrls: string[] = [];

      for (const channel of desired) {
        const existing = committedCache.get(channel.identity);
        if (existing?.revisionKey === channel.revisionKey) {
          nextCache.set(channel.identity, existing);
          continue;
        }
        try {
          const result = await engine.exportLayerThumbnail(channel.layerId, channel.mask);
          if (!result) continue;
          const entry: LayerThumbnailCacheEntry = {
            revisionKey: channel.revisionKey,
            url: URL.createObjectURL(result.blob),
            width: result.width,
            height: result.height
          };
          createdUrls.push(entry.url);
          nextCache.set(channel.identity, entry);
        } catch (reason) {
          // A thumbnail is accessory UI. A layer being deleted during an
          // asynchronous readback must not make the editor or document fail.
          console.warn('LightTable layer thumbnail generation failed', reason);
        }
        if (canceled) break;
      }

      if (canceled) {
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      committedCache.forEach((entry, identity) => {
        if (nextCache.get(identity)?.url !== entry.url) URL.revokeObjectURL(entry.url);
      });
      layerThumbnailCacheRef.current = nextCache;

      const nextThumbnails = new Map<LayerId, LayerThumbnailSet>();
      desired.forEach(({ identity, layerId, mask }) => {
        const entry = nextCache.get(identity);
        if (!entry) return;
        const current = nextThumbnails.get(layerId) ?? {};
        nextThumbnails.set(layerId, mask
          ? { ...current, mask: entry }
          : { ...current, pixels: entry });
      });
      setLayerThumbnails(nextThumbnails);
    })();

    return () => {
      canceled = true;
    };
  }, [imageDocument, thumbnailDocumentReadyId]);

  useEffect(() => () => {
    layerThumbnailCacheRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
    layerThumbnailCacheRef.current.clear();
  }, []);

  useEffect(() => {
    const cursor = brushCursorRef.current;
    const center = brushCursorCenterRef.current;
    if (!cursor || !center) return;
    const diameter = Math.max(2, editorSession.brush.size * activeScale);
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate3d(${center.x - diameter / 2}px, ${center.y - diameter / 2}px, 0)`;
  }, [activeScale, editorSession.brush.size]);

  const effectiveDocumentAdjustments = useCallback((document: ImageDocument | null) => {
    void document;
    // Adjustment nodes are evaluated at their own stack positions by the
    // document compositor. The engine-level settings now contain only the
    // document/output grade and Lens Fx; resolving one visible layer here
    // would silently duplicate that layer and ignore the other Grade nodes.
    return documentAdjustmentsRef.current;
  }, []);

  const applyAdjustmentSnapshot = useCallback((
    snapshot: BasicAdjustments,
    targetLayerId: LayerId | null = null
  ) => {
    const projection = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId,
      document: imageDocumentRef.current,
      documentAdjustments: documentAdjustmentsRef.current
    });
    adjustmentsRef.current = projection.editorAdjustments;
    setAdjustments(projection.editorAdjustments);
    documentAdjustmentsRef.current = projection.documentAdjustments;
    if (projection.document !== imageDocumentRef.current) {
      imageDocumentRef.current = projection.document;
      setImageDocument(projection.document);
      if (projection.document) engineRef.current?.setDocument(projection.document);
    }
    const effective = effectiveDocumentAdjustments(projection.document);
    engineRef.current?.setAdjustments(applyGroupVisibility(effective, groupVisibilityRef.current));
  }, [effectiveDocumentAdjustments]);

  const finishOpenHistoryTransactions = useCallback(() => {
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

  const applyDocumentSnapshot = useCallback((snapshot: ImageDocument) => {
    imageDocumentRef.current = snapshot;
    setImageDocument(snapshot);
    engineRef.current?.setDocument(snapshot);
    engineRef.current?.setAdjustments(applyGroupVisibility(
      effectiveDocumentAdjustments(snapshot),
      groupVisibilityRef.current
    ));
  }, [effectiveDocumentAdjustments]);

  const documentMutationController = useDocumentMutationController({
    getDocument: () => imageDocumentRef.current,
    applySnapshot: applyDocumentSnapshot,
    pushHistoryEntry
  });
  resetDocumentTransactionRef.current = documentMutationController.reset;
  const pushDocumentHistory = documentMutationController.record;
  const beginDocumentTransaction = documentMutationController.begin;
  const endDocumentTransaction = documentMutationController.end;

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
      return active?.type === 'adjustment' ? active.id : null;
    },
    getRenderer: () => engineRef.current,
    applySnapshot: applyAdjustmentSnapshot,
    pushHistoryEntry
  });
  resetAdjustmentTransactionRef.current = adjustmentTransactionController.reset;

  const beginAdjustmentTransaction = adjustmentTransactionController.begin;
  const endAdjustmentTransaction = adjustmentTransactionController.end;
  const changeAdjustments = adjustmentTransactionController.change;

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
      groupVisibilityRef.current = visibility;
      setGroupVisibility(visibility);
      engineRef.current?.setAdjustments(
        applyGroupVisibility(adjustmentsRef.current, visibility)
      );
    },
    setFocusPickerActive,
    publishLensBlurViewportMode: (mode) => {
      setLensBlurViewportModeState(mode);
      engineRef.current?.setLensBlurDepthVisualization(mode === 'depth');
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

  const loadBlobIntoEngine = useCallback(async (
    blob: Blob,
    name: string,
    initialAdjustments: BasicAdjustments = createDefaultAdjustments(),
    cacheKey = `${name}:${blob.size}:${blob.type}:${blob instanceof File ? blob.lastModified : 0}`,
    isCanceled: () => boolean = () => false,
    decodeMode: LightTableImageDecodeMode = 'fast',
    signal?: AbortSignal
  ) => {
    const engine = engineRef.current;
    if (!engine) return;
    const loaded = await loadDocumentSource({
      renderer: engine,
      blob,
      name,
      cacheKey,
      decodeMode,
      signal,
      isCanceled
    });
    if (!loaded) return;
    const {
      document: nextDocument,
      metadata: nextMetadata,
      imageBlob,
      layeredAdjustmentStack,
      psdImport,
      psdWarnings,
      psdCompatibility,
      timings
    } = loaded;
    startupTimingsRef.current = {
      ...startupTimingsRef.current,
      ...timings
    };
    imageDocumentRef.current = nextDocument;
    // A PSD is converted into native LightTable layers/assets. Do not embed
    // the complete source document again in the native file.
    preservedSourceAssetsRef.current = [];
    setImageDocument(nextDocument);
    setThumbnailDocumentReadyId(nextDocument.id);
    if (isCanceled()) return;
    setMetadata(nextMetadata);
    setPsdImportInfo(psdImport
      ? { ...psdImport, warnings: [...psdWarnings] }
      : psdImport);
    setPsdCompatibility([...psdCompatibility]);
    setPsdDifferenceMetrics(null);
    setSourceName(name);
    setSourceBlob(imageBlob);
    setSourceIdentity(cacheKey);
    setDepthResult(null);
    setDepthIdentity('');
    setDepthProgress({ status: 'idle' });
    setFocusPickerActive(false);
    selectionGestureRef.current.reset();
    paintGestureRef.current.reset();
    setSelectionDraft(null);
    resetTransformRef.current();
    setEditorSession((current) => ({ ...current, selection: [] }));
    setSelectionClipboardAvailable(false);
    setFeatherDialogOpen(false);
    setLensBlurViewportModeState('result');
    engineRef.current?.setLensBlurDepthVisualization(false);
    clearEditorHistory();
    const hydration = await hydrateDocumentSource({
      renderer: engine,
      loaded,
      initialAdjustments,
      groupVisibility: groupVisibilityRef.current,
      isCanceled
    });
    if (!hydration) return;
    documentAdjustmentsRef.current = hydration.adjustments;
    adjustmentsRef.current = hydration.adjustments;
    setAdjustments(hydration.adjustments);
    setHistogram(null);
    setZoomMode('fit');
    setView({ scale: 1, panX: 0, panY: 0 });
    if (psdImport) {
      setPsdDifferenceMetrics(hydration.psdDifferenceMetrics);
      setGradeStatus(hydration.status);
      if (hydration.differenceError) {
        console.warn(
          'LightTable PSD difference measurement failed',
          hydration.differenceError
        );
      }
      if (psdWarnings.length) {
        console.warn('LightTable PSD semantic import warnings', psdWarnings);
      }
    }
  }, [clearEditorHistory]);

  useEffect(() => {
    if (!open || !canvasRef.current || !hueDistributionCanvasRef.current ||
      !colorMixerHueCanvasRef.current ||
      !paradeCanvasRef.current || !vectorscopeCanvasRef.current) return;
    let canceled = false;
    let engine: DocumentRendererPort | null = null;
    const hueDistributionCanvas = hueDistributionCanvasRef.current;
    const colorMixerHueDistributionCanvas = colorMixerHueCanvasRef.current;
    const paradeCanvas = paradeCanvasRef.current;
    const vectorscopeCanvas = vectorscopeCanvasRef.current;
    startupStartedAtRef.current = performance.now();
    startupAwaitingFirstFrameRef.current = true;
    startupTimingsRef.current = {};
    setStartupTimings(null);
    setLoading(true);
    setError(null);
    setMetadata(null);
    setPsdImportInfo(null);
    setPsdDifferenceMetrics(null);
    setPsdCompatibility([]);
    setPsdReportOpen(false);
    setSourceName(fileNameBase);
    imageDocumentRef.current = null;
    preservedSourceAssetsRef.current = [];
    setImageDocument(null);
    setThumbnailDocumentReadyId(null);
    setEditorSession(createEditorSession());
    selectionGestureRef.current.reset();
    paintGestureRef.current.reset();
    setSelectionDraft(null);
    setSelectionClipboardAvailable(false);
    setFeatherDialogOpen(false);
    resetTransformRef.current();
    setHistogram(null);
    setSourceBlob(null);
    setSourceIdentity('');
    setDepthResult(null);
    setDepthIdentity('');
    setDepthProgress({ status: 'idle' });
    setFocusPickerActive(false);
    setLensBlurViewportModeState('result');
    const startingAdjustments = initialRecipe
      ? cloneAdjustments(initialRecipe.settings)
      : createDefaultAdjustments();
    adjustmentsRef.current = startingAdjustments;
    setAdjustments(startingAdjustments);
    clearEditorHistory();
    setShowOriginal(false);
    setShowDifference(false);
    const startingScopeSettings = { ...DEFAULT_SCOPE_SETTINGS };
    const startingScopeVisibility = { ...DEFAULT_SCOPE_VISIBILITY };
    scopeSettingsRef.current = startingScopeSettings;
    scopeVisibilityRef.current = startingScopeVisibility;
    setScopeSettings(startingScopeSettings);
    setScopeVisibility(startingScopeVisibility);
    setScopeError(null);
    setGradeStatus(null);
    setGpuMemoryBytes(0);
    const startingVisibility = createDefaultGroupVisibility();
    groupVisibilityRef.current = startingVisibility;
    setGroupVisibility(startingVisibility);
    const openController = new DocumentOpenController<DocumentRendererPort>(
      taskRegistry,
      rendererLifecycle
    );
    const isCanceled = () => canceled;

    void openController.open({
      createRenderer: () => createWebGpuDocumentRenderer(canvasRef.current!, {
          onHistogram: (next) => { if (!isCanceled()) setHistogram(next); },
          onGpuMemoryEstimate: (bytes) => {
            if (!isCanceled()) {
              setGpuMemoryBytes(bytes);
              rendererLifecycle.setMemoryEstimate(bytes);
            }
          },
          onDeviceLost: (message) => {
            if (!isCanceled()) {
              setError(message);
              rendererLifecycle.markFailed(
                rendererLifecycle.getSnapshot().generation,
                message
              );
            }
          },
          onScopeError: (message) => { if (!isCanceled()) setScopeError(message); },
          onFeatureError: (featureId, message) => {
            if (isCanceled()) return;
            appendDebugMessage('error', `GPU feature: ${featureId}`, message);
            setGradeStatus(`${featureId} is unavailable; the image remains in bypass mode.`);
          },
          onFirstFrame: () => {
            if (isCanceled() || !startupAwaitingFirstFrameRef.current) return;
            startupAwaitingFirstFrameRef.current = false;
            startupTimingsRef.current.firstFrameMs = performance.now() - startupStartedAtRef.current;
            const completed = { ...startupTimingsRef.current };
            setStartupTimings(completed);
            console.info('[LightTable startup]', completed);
            const scopeStartedAt = performance.now();
            engine?.setScopeOptions(
              scopeVisibilityRef.current.histogram,
              scopeEngineOptions(scopeVisibilityRef.current, scopeSettingsRef.current)
            );
            void engine?.initializeScopes({
              hueDistribution: hueDistributionCanvas,
              colorMixerHueDistribution: colorMixerHueDistributionCanvas,
              parade: paradeCanvas,
              vectorscope: vectorscopeCanvas
            }).then(() => {
              if (isCanceled()) return;
              startupTimingsRef.current.scopesMs = performance.now() - scopeStartedAt;
              setStartupTimings({ ...startupTimingsRef.current });
            });
          }
      }),
      loadSource: (signal) => {
        if (!editorSourceFileKey && !initialSourceBlob) {
          return Promise.reject(
            new Error('No source image was supplied to LightTable.')
          );
        }
        return initialSourceBlob
          ? Promise.resolve(initialSourceBlob)
          : loadSource?.({
              projectId,
              sourceFileKey: editorSourceFileKey!,
              signal
            }) ?? Promise.reject(
              new Error('The LightTable host cannot read this source image.')
            );
      },
      hydrate: async (createdEngine, source, task) => {
        await loadBlobIntoEngine(
          source,
          initialSourceName,
          initialRecipe?.settings ?? createDefaultAdjustments(),
          `${editorSourceFileKey ?? initialSourceName}:${source.size}`,
          () => canceled || !task.isCurrent(),
          sourceDecodeMode,
          task.signal
        );
      },
      onRendererReady: (createdEngine, elapsedMs) => {
        engine = createdEngine;
        engineRef.current = createdEngine;
        startupTimingsRef.current.webGpuMs = elapsedMs;
        createdEngine.setLensBlurDepthVisualization(false);
        createdEngine.setScopeOptions(
          false,
          scopeEngineOptions(scopeVisibilityRef.current, scopeSettingsRef.current)
        );
      },
      onRendererDiscarded: (discardedEngine) => {
        if (engineRef.current === discardedEngine) engineRef.current = null;
        if (engine === discardedEngine) engine = null;
      },
      onSourceReady: (_source, elapsedMs) => {
        startupTimingsRef.current.downloadMs = elapsedMs;
      },
      onFailed: (failure) => {
        if (!canceled) {
          setError(failure.message || 'LightTable could not be initialized.');
        }
      },
      onSettled: () => {
        if (!canceled) setLoading(false);
      }
    });

    return () => {
      canceled = true;
      cancelAutoAlignRef.current();
      clearEditorHistory();
      engineRef.current = null;
      openController.close();
    };
  }, [clearEditorHistory, documentSurfaceRevision, editorSourceFileKey, initialRecipe, initialSourceBlob, initialSourceName, loadBlobIntoEngine, loadSource, open, projectId, rendererLifecycle, sourceDecodeMode, taskRegistry]);

  useEffect(() => {
    if (!open || !viewportRef.current) return;
    const element = viewportRef.current;
    let pendingSize: { width: number; height: number } | null = null;
    let updateTimer: number | null = null;
    let updateFrame: number | null = null;
    let lastUpdateAt = 0;

    const readSize = () => {
      const rect = element.getBoundingClientRect();
      return {
        // Sub-pixel sash values do not produce a different canvas allocation,
        // but did previously cause another full editor render.
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height))
      };
    };

    const commitPendingSize = () => {
      updateFrame = null;
      if (dockResizeActiveRef.current) {
        pendingSize = null;
        return;
      }
      const next = pendingSize;
      pendingSize = null;
      if (!next) return;
      lastUpdateAt = performance.now();
      setViewportSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };

    const scheduleSizeUpdate = () => {
      if (dockResizeActiveRef.current) return;
      pendingSize = readSize();
      if (updateTimer !== null || updateFrame !== null) return;
      const delay = Math.max(0, VIEWPORT_RESIZE_INTERVAL_MS - (performance.now() - lastUpdateAt));
      updateTimer = window.setTimeout(() => {
        updateTimer = null;
        updateFrame = window.requestAnimationFrame(commitPendingSize);
      }, delay);
    };

    pendingSize = readSize();
    commitPendingSize();
    if (!editorResizeObserversEnabled) {
      return;
    }
    const observer = new ResizeObserver(scheduleSizeUpdate);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (updateTimer !== null) window.clearTimeout(updateTimer);
      if (updateFrame !== null) window.cancelAnimationFrame(updateFrame);
    };
  }, [active, documentSurfaceRevision, editorResizeObserversEnabled, open]);

  useEffect(() => {
    if (!open || !active) return;
    const elements = [scopesColumnRef.current, colorMixerScopeContainerRef.current]
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    engineRef.current?.resizeScopes();
    if (!editorResizeObserversEnabled) return;
    let resizeTimer: number | null = null;
    let resizeFrame: number | null = null;
    const resizeAfterLayoutSettles = () => {
      if (dockResizeActiveRef.current) return;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          if (dockResizeActiveRef.current) return;
          engineRef.current?.resizeScopes();
        });
      }, SCOPES_RESIZE_SETTLE_MS);
    };
    const observer = new ResizeObserver(resizeAfterLayoutSettles);
    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [active, documentSurfaceRevision, editorResizeObserversEnabled, open]);

  const handleDockResizeInteractionChange = useCallback((active: boolean) => {
    dockResizeActiveRef.current = active;
    if (dockResizeFinishFrameRef.current !== null) {
      window.cancelAnimationFrame(dockResizeFinishFrameRef.current);
      dockResizeFinishFrameRef.current = null;
    }
    if (active) return;

    // Dockview has now committed its layout. Measure exactly once on the next
    // frame instead of reconnecting observers through a workspace rerender.
    dockResizeFinishFrameRef.current = window.requestAnimationFrame(() => {
      dockResizeFinishFrameRef.current = null;
      const viewport = viewportRef.current;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        setViewportSize((current) => (
          current.width === width && current.height === height
            ? current
            : { width, height }
        ));
      }
      engineRef.current?.resizeScopes();
    });
  }, []);

  useEffect(() => () => {
    if (dockResizeFinishFrameRef.current !== null) {
      window.cancelAnimationFrame(dockResizeFinishFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!metadata) return;
    engineRef.current?.resizeViewport(
      viewportSize.width,
      viewportSize.height,
      Math.max(1, window.devicePixelRatio || 1),
      imageRect
    );
  }, [imageRect, metadata, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!open || !sourceBlob || !sourceIdentity || !adjustments.effects.lensBlur.enabled) return;
    if (depthResult && depthIdentity === sourceIdentity) {
      engineRef.current?.setDepthMap(depthResult);
      setDepthProgress({ status: 'ready', message: `Depth ready (${depthResult.width} x ${depthResult.height})` });
      return;
    }
    let canceled = false;
    setDepthProgress({ status: 'loading-model', message: 'Preparing depth analysis…' });
    void lightTableDepthAnalysis.estimate(sourceBlob, sourceIdentity, (progress) => {
      if (!canceled) setDepthProgress(progress);
    }).then((result) => {
      if (canceled) return;
      setDepthResult(result);
      setDepthIdentity(sourceIdentity);
      engineRef.current?.setDepthMap(result);
      setDepthProgress({ status: 'ready', message: `Depth ready (${result.width} x ${result.height})` });
    }).catch((reason: unknown) => {
      if (canceled) return;
      setDepthProgress({
        status: 'error',
        message: reason instanceof Error ? reason.message : 'Depth analysis failed.'
      });
      changeAdjustments((current) => ({
        ...current,
        effects: {
          ...current.effects,
          lensBlur: { ...current.effects.lensBlur, enabled: false }
        }
      }));
    });
    return () => { canceled = true; };
  }, [adjustments.effects.lensBlur.enabled, changeAdjustments, depthIdentity, depthResult, open, sourceBlob, sourceIdentity]);

  useEffect(() => {
    engineRef.current?.setBefore(showOriginal);
    engineRef.current?.setDifference(showDifference);
  }, [showDifference, showOriginal]);

  useEffect(() => {
    scopeVisibilityRef.current = scopeVisibility;
    scopeSettingsRef.current = scopeSettings;
    engineRef.current?.setScopeOptions(
      scopeVisibility.histogram,
      scopeEngineOptions(scopeVisibility, scopeSettings)
    );
  }, [scopeSettings, scopeVisibility]);

  useEffect(() => {
    if (!gradeStatus) return;
    const timeout = window.setTimeout(() => setGradeStatus(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [gradeStatus]);

  const openAppMenu = useCallback((id: LightTableAppMenuId, target: EventTarget & HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setAppMenu({ id, x: rect.left, y: rect.bottom + 6 });
  }, []);

  const renderAppMenuButton = useCallback((id: LightTableAppMenuId, label: string) => (
    <button
      type="button"
      className={`shots-app-menu__button${appMenu?.id === id ? ' shots-app-menu__button--active' : ''}`}
      onClick={(event) => openAppMenu(id, event.currentTarget)}
    >
      {label}
    </button>
  ), [appMenu?.id, openAppMenu]);

  const selectAllContent = selectionSessionController.selectAll;
  const clearCurrentSelection = selectionSessionController.clear;
  const invertCurrentSelection = selectionSessionController.invert;
  const featherCurrentSelection = selectionSessionController.feather;

  const executeKeyboardCommand = (command: EditorKeyboardCommand): void => {
    if (typeof command === 'object') {
      if (transformActiveRef.current() && command.tool !== 'transform') {
        commitTransformRef.current();
      }
      activateToolRef.current(command.tool);
      return;
    }
    switch (command) {
      case 'undo':
        void undoEditor();
        return;
      case 'redo':
        void redoEditor();
        return;
      case 'temporary-pan-start':
        if (temporaryToolRef.current.begin('view')) {
          setTemporaryPanActive(true);
        }
        return;
      case 'fill-foreground':
      case 'fill-background':
        fillActiveTargetRef.current(command === 'fill-foreground'
          ? editorSession.brush.color
          : editorSession.brush.backgroundColor);
        return;
      case 'select-all':
        selectAllContent();
        return;
      case 'select-none':
        clearCurrentSelection();
        return;
      case 'select-invert':
        invertCurrentSelection();
        return;
      case 'selection-copy':
        copySelectedContentRef.current();
        return;
      case 'selection-paste':
        pasteSelectedContentRef.current();
        return;
      case 'layer-via-copy':
        layerViaCopyRef.current();
        return;
      case 'free-transform':
        activateToolRef.current('transform');
        return;
      case 'invert-active-target':
        invertActiveLayerColorsRef.current();
        return;
      case 'selection-feather':
        setFeatherDialogOpen(true);
        return;
      case 'swap-colors':
        setEditorSession((current) => ({
          ...current,
          brush: {
            ...current.brush,
            color: current.brush.backgroundColor,
            backgroundColor: current.brush.color
          }
        }));
        return;
      case 'toggle-original':
        setShowDifference(false);
        setShowOriginal((current) => !current);
        return;
      case 'brush-size-decrease':
      case 'brush-size-increase':
        setEditorSession((current) => ({
          ...current,
          brush: {
            ...current.brush,
            size: steppedBrushSize(
              current.brush.size,
              command === 'brush-size-decrease' ? -1 : 1
            )
          }
        }));
        return;
      case 'commit-transform':
        commitTransformRef.current();
        return;
      case 'cancel-or-close':
        if (appMenu) {
          setAppMenu(null);
          return;
        }
        if (transformActiveRef.current()) {
          cancelTransformRef.current();
          return;
        }
        if (autoAlignPreview) {
          cancelAutoAlignRef.current();
          return;
        }
        if (selectionSessionController.draft || editorSession.selection.length) {
          selectionSessionController.clear();
          return;
        }
        onClose();
    }
  };

  useEditorWindowInput(open && active, {
    onKeyDown: (event) => {
      const editable = isTextEditingTarget(event.target);
      const command = resolveEditorKeyboardCommand(event, {
        editable,
        saving,
        activeTool: editorSession.activeTool,
        hasActiveLayer: Boolean(imageDocumentRef.current?.activeLayerId),
        hasSelection: editorSession.selection.length > 0,
        hasSelectionClipboard: selectionClipboardAvailable,
        transforming: transformActiveRef.current()
      });
      if (!command) return false;
      executeKeyboardCommand(command);
      return true;
    },
    onKeyUp: (event) => {
      if (!isTemporaryPanRelease(event) || !temporaryToolRef.current.active) return false;
      if (temporaryToolRef.current.end('view')) setTemporaryPanActive(false);
      return true;
    },
    onShiftChange: setShiftPressed,
    onBlur: () => {
      if (temporaryToolRef.current.end()) setTemporaryPanActive(false);
    }
  });

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!metadata) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = clientToLocalPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top }
    );
    setZoomMode('custom');
    setView(zoomViewAtPoint({
      cursor,
      viewport: viewportSize,
      view: {
        scale: activeScale,
        panX: view.panX,
        panY: view.panY
      },
      wheelDelta: event.deltaY,
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE
    }));
  };

  const beginPan = (event: React.PointerEvent<HTMLDivElement>, forcePan = false) => {
    if (event.button !== 0 || !metadata) return;
    if (!forcePan && focusPickerActive && depthResult) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - bounds.left - imageRect.x) / Math.max(imageRect.width, 1);
      const y = (event.clientY - bounds.top - imageRect.y) / Math.max(imageRect.height, 1);
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        const sourceUv = mapLensDistortionUv(
          x,
          y,
          metadata.width,
          metadata.height,
          adjustments.effects.lensDistortion
        );
        const selectedDepth = sampleMedianDepth(depthResult, sourceUv.x, sourceUv.y);
        if (selectedDepth !== null) {
          changeAdjustments((current) => ({
            ...current,
            effects: {
              ...current.effects,
              lensBlur: {
                ...current.effects.lensBlur,
                focusDistance: selectedDepth
              }
            }
          }));
        }
      }
      setFocusPickerActive(false);
      event.preventDefault();
      return;
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pan = panViewFromGesture({
      origin: { x: drag.x, y: drag.y },
      current: { x: event.clientX, y: event.clientY },
      initialView: { panX: drag.panX, panY: drag.panY }
    });
    setView((current) => ({
      ...current,
      ...pan
    }));
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const documentPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!metadata) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return localToDocumentPointer(
      clientToLocalPoint(
        { x: event.clientX, y: event.clientY },
        { x: bounds.left, y: bounds.top }
      ),
      imageRect,
      activeScale,
      metadata,
      event.pressure
    );
  };

  const updateBrushCursor = (event: React.PointerEvent<HTMLDivElement>) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    if (!isPaintTool(editorSession.activeTool) || temporaryToolRef.current.active || focusPickerActive || !metadata) {
      brushCursorCenterRef.current = null;
      cursor.style.opacity = '0';
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = clientToLocalPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top }
    );
    if (!pointInsideRect(point, imageRect)) {
      brushCursorCenterRef.current = null;
      cursor.style.opacity = '0';
      return;
    }
    const diameter = Math.max(2, editorSession.brush.size * activeScale);
    brushCursorCenterRef.current = point;
    cursor.style.opacity = '1';
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate3d(${point.x - diameter / 2}px, ${point.y - diameter / 2}px, 0)`;
  };

  const fillActiveTarget = (color: string) => {
    const current = imageDocumentRef.current;
    const engine = engineRef.current;
    if (!current || !engine) return;
    const channel = editorSession.activeChannel;
    const result = executeFillOperation(current, engine, channel, color);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyDocumentSnapshot(result.document);
    pushHistoryEntry({
      byteSize: result.pixelEdit.byteSize,
      layerIds: [result.layerId],
      undo: () => {
        if (!engineRef.current?.applyPixelHistory(result.pixelEdit, 'undo')) {
          throw new Error('Fill undo is no longer available.');
        }
        applyDocumentSnapshot(current);
      },
      redo: () => {
        if (!engineRef.current?.applyPixelHistory(result.pixelEdit, 'redo')) {
          throw new Error('Fill redo is no longer available.');
        }
        applyDocumentSnapshot(result.document);
      },
      dispose: result.pixelEdit.destroy
    });
    setError(null);
    setGradeStatus(`${result.targetLabel} filled with ${color.toUpperCase()}`);
  };
  fillActiveTargetRef.current = fillActiveTarget;

  const paintSessionController = usePaintSessionController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setError
  }, paintGestureRef.current);

  const beginViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    updateBrushCursor(event);
    const point = documentPoint(event);
    const activeTool = editorSession.activeTool;
    const paintTarget = imageDocument
      ? editorSession.activeChannel === 'mask'
        ? findDocumentLayer(imageDocument, imageDocument.activeLayerId)
        : findRasterLayer(imageDocument, imageDocument.activeLayerId)
      : null;
    const intent = resolveViewportPointerDownIntent({
      activeTool,
      temporaryPan: temporaryToolRef.current.active,
      focusPickerActive,
      primaryButton: event.button === 0,
      hasMetadata: Boolean(metadata),
      hasDocument: Boolean(imageDocument),
      hasDocumentPoint: Boolean(point),
      hasPaintTarget: Boolean(paintTarget)
    });

    if (intent === 'temporary-pan') {
      beginPan(event, true);
      event.preventDefault();
      return;
    }
    if (intent === 'selection' && point && isSelectionTool(activeTool)) {
      if (selectionSessionController.begin(event.pointerId, activeTool, point)) {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
    if (intent === 'fill') {
      fillActiveTarget(editorSession.brush.color);
      event.preventDefault();
      return;
    }
    if (intent === 'view') {
      beginPan(event);
      return;
    }
    if (intent !== 'paint' || !point || !paintTarget) return;
    const started = paintSessionController.begin({
      pointerId: event.pointerId,
      layer: paintTarget,
      target: {
        layerId: paintTarget.id,
        channel: editorSession.activeChannel,
        erase: activeTool === 'erase',
        sourceToDocument: paintTargetSourceToDocument(
          paintTarget,
          editorSession.activeChannel
        )
      },
      brush: editorSession.brush,
      point
    });
    if (started) {
      setEditorSession((current) => ({ ...current, pointerId: event.pointerId }));
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  };

  const moveViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    updateBrushCursor(event);
    const point = documentPoint(event);
    const intent = resolveViewportPointerMoveIntent({
      activeTool: editorSession.activeTool,
      temporaryPan: temporaryToolRef.current.active,
      panGestureMatches: dragRef.current?.pointerId === event.pointerId,
      selectionGestureMatches: selectionSessionController.owns(event.pointerId),
      paintGestureMatches: paintSessionController.owns(event.pointerId),
      hasDocumentPoint: Boolean(point),
      hasPaintTarget: paintSessionController.active,
      hasStrokeBuilder: paintSessionController.active
    });
    if (intent === 'pan') {
      movePan(event);
      return;
    }
    if (intent === 'selection' && point) {
      if (!selectionSessionController.move(event.pointerId, point)) return;
      event.preventDefault();
      return;
    }
    if (intent !== 'paint' || !point) return;
    if (!paintSessionController.move(event.pointerId, point)) return;
    event.preventDefault();
  };

  const endViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const intent = resolveViewportPointerEndIntent({
      selectionGestureMatches: selectionSessionController.owns(event.pointerId),
      paintGestureMatches: paintSessionController.owns(event.pointerId)
    });
    if (intent === 'selection') {
      selectionSessionController.finish(event.pointerId, {
        shiftKey: event.shiftKey,
        altKey: event.altKey
      });
      event.preventDefault();
      return;
    }
    if (intent === 'paint') {
      paintSessionController.finish(event.pointerId);
      setEditorSession((current) => ({ ...current, pointerId: null }));
    }
    endPan(event);
  };

  const cancelViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    selectionSessionController.cancel(event.pointerId);
    paintSessionController.cancel(event.pointerId);
    setEditorSession((current) => ({ ...current, pointerId: null }));
    endPan(event);
  };

  const applyDocumentChange = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    documentMutationController.change(change, recordHistory);
  };

  const layerDocumentCommands = useLayerDocumentCommands({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    pushDocumentHistory,
    pushHistoryEntry,
    setActiveChannel: (activeChannel) => {
      setEditorSession((session) => ({ ...session, activeChannel }));
    },
    setSelectionClipboardAvailable,
    setStatus: setGradeStatus,
    setError
  });
  const duplicateActiveLayer = layerDocumentCommands.duplicateActiveLayer;
  const mergeSelectedRasterLayers = layerDocumentCommands.mergeSelectedRasterLayers;
  const mergeActiveLayerDown = layerDocumentCommands.mergeActiveLayerDown;

  const copySelectedContent = () => {
    layerDocumentCommands.copySelectedContent(editorSession.selection);
  };
  copySelectedContentRef.current = copySelectedContent;

  const pasteSelectedContent = () => {
    layerDocumentCommands.pasteSelectedContent(editorSession.selection);
  };
  pasteSelectedContentRef.current = pasteSelectedContent;

  const layerViaCopy = () => {
    layerDocumentCommands.layerViaCopy(editorSession.selection);
  };
  layerViaCopyRef.current = layerViaCopy;

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
  const styleEditorRequest = layerStyleEditor.request;
  const openLayerStyleEditor = layerStyleEditor.open;
  const previewLayerStyleStack = layerStyleEditor.preview;
  const cancelLayerStyleEditor = layerStyleEditor.cancel;
  const commitLayerStyleEditor = layerStyleEditor.commit;

  const transformSession = useTransformSessionController({
    activeTool: editorSession.activeTool,
    activeDocument: imageDocument,
    activeLayerId: imageDocument?.activeLayerId ?? null,
    selection: editorSession.selection,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyDocumentSnapshot,
    applyDocumentAndSelection: (document, selection) => {
      imageDocumentRef.current = document;
      setImageDocument(document);
      engineRef.current?.setDocument(document);
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
  const updateTransformMatrix = transformSession.update;
  commitTransformRef.current = transformSession.commit;
  cancelTransformRef.current = transformSession.cancel;
  resetTransformRef.current = transformSession.reset;
  transformActiveRef.current = transformSession.isActive;

  const activatePersistentTool = (requestedTool: ToolId) => {
    const plan = planPersistentToolActivation(
      editorSession.activeTool,
      requestedTool,
      transformSession.isActive()
    );
    if (plan.finishTransform) transformSession.commit();
    if (plan.nextTool) {
      setEditorSession((current) => (
        current.activeTool === plan.nextTool
          ? current
          : { ...current, activeTool: plan.nextTool as ToolId }
      ));
    }
  };
  activateToolRef.current = activatePersistentTool;

  const commitFlattenRequest = () => {
    const request = flattenRequest;
    setFlattenRequest(null);
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

  const exportOutput = async () => {
    const engine = engineRef.current;
    if (!engine) throw new Error('LightTable is not ready yet.');
    const document = imageDocumentRef.current;
    const recipeSourceKey = effectiveSourceFileKey;
    if (!document || !recipeSourceKey) throw new Error('The LightTable document is not ready yet.');
    return exportLightTableDocument({
      document,
      renderer: engine,
      recipeSourceKey,
      fileNameBase,
      flatAdjustments: adjustmentsRef.current,
      documentAdjustments: documentAdjustmentsRef.current,
      effectiveLayeredAdjustments: effectiveDocumentAdjustments(document),
      preservedSourceAssets: preservedSourceAssetsRef.current
    });
  };

  const handleSave = async () => {
    if (!metadata || !effectiveSourceFileKey || saving) return;
    setSaving(true);
    setError(null);
    const result = await taskRegistry.run('save', 'Save document', async (task) => {
      const output = await exportOutput();
      task.throwIfCanceled();
      const saved = await onSave(output.file, output.recipe);
      task.throwIfCanceled();
      if (saved !== false) {
        commandHistory.markSaved();
        onDirtyChangeRef.current?.(false);
        onClose();
      }
      return saved;
    });
    if (result.status === 'failed') {
      setError(result.error.message || 'LightTable image could not be saved.');
    }
    setSaving(false);
  };

  const handleDownload = async () => {
    setError(null);
    const result = await taskRegistry.run('export', 'Export image', async (task) => {
      const output = await exportOutput();
      task.throwIfCanceled();
      const url = URL.createObjectURL(output.file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = output.file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
    if (result.status === 'failed') {
      setError(result.error.message || 'LightTable export failed.');
    }
  };

  const openLocalFile = async (file: File | null, decodeMode: LightTableImageDecodeMode) => {
    if (!file) return;
    cancelAutoAlignPreview();
    setLoading(true);
    setError(null);
    const result = await taskRegistry.run('open', 'Open image', async (task) => {
      await loadBlobIntoEngine(
        file,
        file.name,
        createDefaultAdjustments(),
        `${file.name}:${file.size}:${file.type}:${file.lastModified}${decodeMode === 'preserve-precision' ? ':preserve-precision' : ''}`,
        () => !task.isCurrent(),
        decodeMode,
        task.signal
      );
      task.throwIfCanceled();
    });
    if (result.status === 'failed') {
      setError(result.error.message
        || (decodeMode === 'preserve-precision'
          ? 'The precision-preserving image import failed.'
          : 'The image could not be opened.'));
    }
    if (result.status !== 'canceled' || taskRegistry.getSnapshot().activeTaskIds.length === 0) {
      setLoading(false);
    }
  };

  const handleLocalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    await openLocalFile(file, 'fast');
  };

  const handleAdvancedLocalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    await openLocalFile(file, 'preserve-precision');
  };

  const chooseLocalFile = async (decodeMode: LightTableImageDecodeMode) => {
    try {
      setError(null);
      if (onRequestOpenWorkspaceDocument) {
        await onRequestOpenWorkspaceDocument(decodeMode);
        return;
      }
      const fallback = decodeMode === 'preserve-precision'
        ? advancedFileInputRef.current
        : fileInputRef.current;
      const file = await pickSupportedImageFile(decodeMode, fallback);
      if (!file) return;
      if (onOpenWorkspaceDocument) {
        onOpenWorkspaceDocument(file, decodeMode);
        return;
      }
      await openLocalFile(file, decodeMode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The image file dialog could not be opened.');
    }
  };

  const menuDocument = imageDocumentRef.current;
  const menuActiveLayer = menuDocument
    ? findDocumentLayer(menuDocument, menuDocument.activeLayerId)
    : null;
  const menuActiveSiblings = menuActiveLayer && menuDocument
    ? siblingLayers(menuDocument, menuActiveLayer.id)
    : [];
  const menuActiveIndex = menuActiveLayer
    ? menuActiveSiblings.findIndex((layer) => layer.id === menuActiveLayer.id)
    : -1;
  const menuLayerCount = menuDocument ? walkLayerTree(menuDocument.layers).length : 0;
  const menuAutoAlignTargets = menuActiveLayer && menuDocument
    ? walkRasterLayers(menuDocument.layers)
      .map(({ layer }) => layer)
      .filter((layer) => layer.id !== menuActiveLayer.id && layer.visible && layer.locks.all)
    : [];

  const appMenuOptions = appMenu ? createEditorMenuOptions(
    appMenu.id,
    {
      saving,
      hasDocument: Boolean(menuDocument),
      hasMetadata: Boolean(metadata),
      hasSourceKey: Boolean(effectiveSourceFileKey),
      layered: menuLayerCount > 1,
      copiedGradeName: copiedGrade?.name ?? null,
      hasSelection: editorSession.selection.length > 0,
      selectionClipboardAvailable,
      activeChannel: editorSession.activeChannel,
      layer: menuActiveLayer ? {
        type: menuActiveLayer.type,
        hasMask: Boolean(menuActiveLayer.mask),
        maskEnabled: Boolean(menuActiveLayer.mask?.enabled),
        visible: menuActiveLayer.visible,
        locked: layerIsLocked(menuActiveLayer, 'pixels'),
        clipping: menuActiveLayer.clipping,
        activeIndex: menuActiveIndex,
        siblingCount: menuActiveSiblings.length,
        belowIsRaster: menuActiveSiblings[menuActiveIndex - 1]?.type === 'raster',
        canFlattenGroup: menuActiveLayer.type === 'group'
          && Boolean(menuDocument && getFlattenGroupPlan(menuDocument, menuActiveLayer.id))
      } : null,
      rasterLayerCount: menuDocument ? rasterLayerCount(menuDocument) : 0,
      canFlattenImage: Boolean(menuDocument && getFlattenImagePlan(menuDocument)),
      autoAlignPreview: Boolean(autoAlignPreview),
      autoAlignAvailable: Boolean(
        menuActiveLayer
        && menuActiveLayer.type === 'raster'
        && !layerIsLocked(menuActiveLayer, 'position')
        && menuActiveLayer.visible
        && menuAutoAlignTargets.length === 1
      ),
      zoomMode,
      showOriginal,
      showDifference,
      blendModes: BLEND_MODES.map((mode) => ({
        ...mode,
        selected: menuActiveLayer?.blendMode === mode.id,
        separatorBefore: ['darken', 'lighten', 'overlay', 'difference', 'hue'].includes(mode.id)
      }))
    },
    {
      fastOpenFormats: imagePickerFormatNames('fast'),
      precisionOpenFormats: imagePickerFormatNames('preserve-precision'),
      primaryShortcut: primaryShortcutLabel
    },
    {
      openFast: () => void chooseLocalFile('fast'),
      openPrecision: () => void (async () => {
        const { getAdvancedImageIoCapabilities } = await import('./image-io/advancedImageIoCapabilities');
        const capabilities = getAdvancedImageIoCapabilities();
        if (!capabilities.available) {
          setError(`Precision-preserving import is unavailable: ${capabilities.reasons.join(' ')}`);
          return;
        }
        await chooseLocalFile('preserve-precision');
      })(),
      save: () => void handleSave(),
      download: () => void handleDownload(),
      reset: resetAll,
      copySelectedContent,
      pasteSelectedContent,
      pasteGrade: pasteCurrentGrade,
      copyGrade: copyCurrentGrade,
      selectAll: selectAllContent,
      clearSelection: clearCurrentSelection,
      invertSelection: invertCurrentSelection,
      featherSelection: () => setFeatherDialogOpen(true),
      createRasterLayer: () => {
        applyDocumentChange((current) => createRasterLayer(current));
        setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
      },
      duplicateLayer: duplicateActiveLayer,
      layerViaCopy,
      renameLayer: focusActiveLayerName,
      invertLayerColors: invertActiveLayerColors,
      beginAutoAlign: () => void beginAutoAlign(),
      applyAutoAlign: applyAutoAlignPreview,
      cancelAutoAlign: cancelAutoAlignPreview,
      toggleClipping: () => menuActiveLayer && applyDocumentChange((current) =>
        setLayerClipping(current, menuActiveLayer.id, !menuActiveLayer.clipping)),
      setBlendMode: (mode) => menuActiveLayer && applyDocumentChange((current) =>
        setLayerBlendMode(current, menuActiveLayer.id, mode)),
      editPixels: () => setEditorSession((current) => ({ ...current, activeChannel: 'pixels' })),
      editMask: () => setEditorSession((current) => ({ ...current, activeChannel: 'mask' })),
      addMask: () => {
        if (!menuActiveLayer) return;
        applyDocumentChange((current) => addLayerMask(current, menuActiveLayer.id));
        setEditorSession((current) => ({
          ...current,
          activeChannel: 'mask',
          brush: { ...current.brush, color: '#000000' }
        }));
      },
      toggleMask: () => menuActiveLayer?.mask && applyDocumentChange((current) =>
        setLayerMaskEnabled(current, menuActiveLayer.id, !menuActiveLayer.mask!.enabled)),
      removeMask: () => {
        if (!menuActiveLayer) return;
        applyDocumentChange((current) => removeLayerMask(current, menuActiveLayer.id));
        setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
      },
      moveLayerUp: () => menuActiveLayer && applyDocumentChange((current) =>
        moveLayer(current, menuActiveLayer.id, menuActiveIndex + 1)),
      moveLayerDown: () => menuActiveLayer && applyDocumentChange((current) =>
        moveLayer(current, menuActiveLayer.id, menuActiveIndex - 1)),
      mergeDown: mergeActiveLayerDown,
      flattenGroup: () => {
        if (menuActiveLayer?.type === 'group') {
          setFlattenRequest({ kind: 'group', groupId: menuActiveLayer.id });
        }
      },
      flattenImage: () => setFlattenRequest({ kind: 'image' }),
      toggleLayerVisibility: () => menuActiveLayer && applyDocumentChange((current) =>
        setLayerVisibility(current, menuActiveLayer.id, !menuActiveLayer.visible)),
      toggleLayerLock: () => menuActiveLayer && applyDocumentChange((current) =>
        setLayerLocked(current, menuActiveLayer.id, !menuActiveLayer.locks.all)),
      deleteLayer: () => {
        if (!menuActiveLayer) return;
        applyDocumentChange((current) => deleteLayer(current, menuActiveLayer.id));
        setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
      },
      fit: () => {
        setZoomMode('fit');
        setView({ scale: 1, panX: 0, panY: 0 });
      },
      actualSize: () => {
        setZoomMode('100');
        setView({ scale: 1, panX: 0, panY: 0 });
      },
      toggleOriginal: () => {
        setShowDifference(false);
        setShowOriginal((current) => !current);
      },
      toggleDifference: () => {
        setShowOriginal(false);
        setShowDifference((current) => !current);
      },
      showDebugPanel: () => workspaceRef.current?.showDebugPanel(),
      resetWorkspaceLayout: () => workspaceRef.current?.resetLayout()
    }
  ) : [];
  const layersPanel = imageDocument ? (
    <div className="lighttable-layers-panel">
      <LayerPanel
        document={imageDocument}
        thumbnails={layerThumbnails}
        activeChannel={editorSession.activeChannel}
        onSelect={(layerId) => {
          const current = imageDocumentRef.current;
          const layer = current ? findDocumentLayer(current, layerId) : null;
          applyDocumentChange((document) => setActiveLayer(document, layerId), false);
          const panelAdjustments = layer?.type === 'adjustment'
            ? {
              ...materializeBasicAdjustments(layer.adjustmentStack),
              effects: structuredClone(documentAdjustmentsRef.current.effects)
            }
            : documentAdjustmentsRef.current;
          adjustmentsRef.current = cloneAdjustments(panelAdjustments);
          setAdjustments(cloneAdjustments(panelAdjustments));
        }}
        onChannelChange={(activeChannel) => setEditorSession((current) => ({ ...current, activeChannel }))}
        onVisibility={(layerIds, visible) =>
          applyDocumentChange((current) => setLayersVisibility(current, layerIds, visible))}
        onRename={(layerId, name) => applyDocumentChange((current) => renameLayer(current, layerId, name))}
        onOpacity={(layerId, opacity) => applyDocumentChange((current) => setLayerOpacity(current, layerId, opacity))}
        onFillOpacity={(layerId, opacity) => applyDocumentChange((current) => setLayerFillOpacity(current, layerId, opacity))}
        onOpacityInteractionStart={beginDocumentTransaction}
        onOpacityInteractionEnd={endDocumentTransaction}
        onBlendMode={(layerId, blendMode) => applyDocumentChange((current) => setLayerBlendMode(current, layerId, blendMode))}
        onClipping={(layerId, clipping) =>
          applyDocumentChange((current) => setLayerClipping(current, layerId, clipping))}
        onReorder={(layerIds, targetLayerId, placement) =>
          applyDocumentChange((current) =>
            moveLayerSelection(current, layerIds, targetLayerId, placement))}
        onAddMask={() => {
          const layerId = imageDocumentRef.current?.activeLayerId;
          if (!layerId) return;
          applyDocumentChange((current) => addLayerMask(current, layerId));
          setEditorSession((current) => ({ ...current, activeChannel: 'mask', brush: { ...current.brush, color: '#000000' } }));
        }}
        onToggleMask={() => {
          const document = imageDocumentRef.current;
          const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
          if (!layer?.mask) return;
          applyDocumentChange((current) => setLayerMaskEnabled(current, layer.id, !layer.mask!.enabled));
        }}
        onLockChange={(layerIds, lock, locked) =>
          applyDocumentChange((current) => setLayersLock(current, layerIds, lock, locked))}
        onCreate={() => {
          applyDocumentChange((current) => createRasterLayer(current));
          setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
        }}
        onCreateAdjustment={() => {
          const current = imageDocumentRef.current;
          if (!current) return;
          const alreadyHasAdjustment = walkLayerTree(current.layers)
            .some(({ node }) => node.type === 'adjustment');
          const previousDocumentGrade = cloneAdjustments(documentAdjustmentsRef.current);
          // The first Grade layer migrates the current document grade into the
          // stack without changing the image. Later Grade layers start neutral,
          // like a newly-created Photoshop Adjustment Layer, so creating one
          // never doubles the currently selected layer's correction.
          const source = alreadyHasAdjustment
            ? {
              ...createDefaultAdjustments(),
              effects: structuredClone(previousDocumentGrade.effects)
            }
            : cloneAdjustments(adjustmentsRef.current);
          const stack = adjustmentStackForScope(
            createAdjustmentStackFromBasicAdjustments(source),
            'adjustment-layer'
          );
          const clearedDocumentGrade = alreadyHasAdjustment
            ? previousDocumentGrade
            : {
              ...createDefaultAdjustments(),
              effects: structuredClone(source.effects)
            };
          documentAdjustmentsRef.current = clearedDocumentGrade;
          const next = createAdjustmentLayer(current, stack, 'Grade', current.layers.at(-1)?.id);
          applyDocumentSnapshot(next);
          adjustmentsRef.current = source;
          setAdjustments(source);
          pushHistoryEntry({
            undo: () => {
              documentAdjustmentsRef.current = cloneAdjustments(previousDocumentGrade);
              applyDocumentSnapshot(current);
              const previousPanelGrade = alreadyHasAdjustment
                ? previousDocumentGrade
                : source;
              adjustmentsRef.current = cloneAdjustments(previousPanelGrade);
              setAdjustments(cloneAdjustments(previousPanelGrade));
            },
            redo: () => {
              documentAdjustmentsRef.current = cloneAdjustments(clearedDocumentGrade);
              applyDocumentSnapshot(next);
              adjustmentsRef.current = cloneAdjustments(source);
              setAdjustments(cloneAdjustments(source));
            }
          });
          setEditorSession((session) => ({ ...session, activeChannel: 'pixels' }));
        }}
        onCreateGroup={() => {
          applyDocumentChange((current) => createGroupLayer(current));
          setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
        }}
        onGroupSelection={(layerIds) => {
          applyDocumentChange((current) => groupLayers(current, layerIds));
          setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
        }}
        onUngroupSelection={(layerIds) => {
          applyDocumentChange((current) => ungroupLayers(current, layerIds));
          setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
        }}
        onDelete={(layerIds) => {
          applyDocumentChange((current) => deleteLayers(current, layerIds));
          setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
        }}
        onMergeDown={mergeActiveLayerDown}
        onMergeSelected={mergeSelectedRasterLayers}
        onFlattenGroup={(groupId) => setFlattenRequest({ kind: 'group', groupId })}
        onFlattenImage={() => setFlattenRequest({ kind: 'image' })}
        onEditStyles={openLayerStyleEditor}
        onStyleStackEnabled={(layerId, enabled) =>
          applyDocumentChange((current) => setLayerStyleStackEnabled(current, layerId, enabled))}
        onStyleEnabled={(layerId, effectId, enabled) =>
          applyDocumentChange((current) => setLayerStyleEnabled(current, layerId, effectId, enabled))}
        onClearStyles={(layerId) =>
          applyDocumentChange((current) => clearLayerStyles(current, layerId))}
      />
    </div>
  ) : (
    <div className="lighttable-layers-panel lighttable-layers-panel--empty">No document layers</div>
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

  return (
    <div
      className={`modal-backdrop lighttable-backdrop${active ? '' : ' lighttable-backdrop--inactive'}`}
      aria-hidden={!active}
      onClick={(event) => {
        // Context menus render through a portal. Their React events can still
        // bubble through this component tree, so only a direct backdrop click
        // is allowed to close the editor.
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modal lighttable"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header concept-art-editor__header lighttable__header">
          <div className="lighttable__header-left">
            <div className="shots-app-menu lighttable__app-menu" role="menubar" aria-label="LightTable menu">
              {renderAppMenuButton('file', 'File')}
              {renderAppMenuButton('edit', 'Edit')}
              {renderAppMenuButton('select', 'Select')}
              {renderAppMenuButton('layer', 'Layer')}
              {renderAppMenuButton('view', 'View')}
            </div>
          </div>
          <SquareIconButton
            className="lighttable__close-button"
            onClick={onClose}
            disabled={saving}
            title="Close editor"
            aria-label="Close editor"
            icon={<img src={lightTableIcon('close.png')} alt="" aria-hidden />}
          />
        </div>
        <ToolOptionsBar
          activeTool={temporaryPanActive ? 'view' : editorSession.activeTool}
          brush={editorSession.brush}
          onBrushChange={(change) => setEditorSession((current) => ({
            ...current,
            brush: { ...current.brush, ...change }
          }))}
        />
        <input ref={fileInputRef} type="file" accept={imagePickerAccept('fast')} hidden onChange={handleLocalFile} />
        <input ref={advancedFileInputRef} type="file" accept={imagePickerAccept('preserve-precision')} hidden onChange={handleAdvancedLocalFile} />

        <div className="lighttable__body">
          <EditorToolbar
            activeTool={temporaryPanActive ? 'view' : editorSession.activeTool}
            foregroundColor={editorSession.brush.color}
            backgroundColor={editorSession.brush.backgroundColor}
            onToolChange={activatePersistentTool}
            onForegroundColorChange={(color) => setEditorSession((current) => ({
              ...current,
              brush: { ...current.brush, color }
            }))}
            onBackgroundColorChange={(backgroundColor) => setEditorSession((current) => ({
              ...current,
              brush: { ...current.brush, backgroundColor }
            }))}
            onSwapColors={() => setEditorSession((current) => ({
              ...current,
              brush: {
                ...current.brush,
                color: current.brush.backgroundColor,
                backgroundColor: current.brush.color
              }
            }))}
            onResetColors={() => setEditorSession((current) => ({
              ...current,
              brush: { ...current.brush, color: '#000000', backgroundColor: '#ffffff' }
            }))}
          />
          <LightTableDockWorkspace
            ref={workspaceRef}
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
                <section className="lighttable__main">
                  <DocumentViewportSurface
                    viewportRef={viewportRef}
                    canvasRef={canvasRef}
                    brushCursorRef={brushCursorRef}
                    activeTool={editorSession.activeTool}
                    temporaryPanActive={temporaryPanActive}
                    dragging={Boolean(dragRef.current)}
                    focusPickerActive={focusPickerActive}
                    showBrushCursor={isPaintTool(editorSession.activeTool)}
                    selection={editorSession.selection}
                    selectionDraft={selectionDraft}
                    imageRect={imageRect}
                    scale={activeScale}
                    viewportSize={viewportSize}
                    transformState={transformState}
                    loading={loading}
                    unavailable={Boolean(error && !metadata)}
                    onWheel={handleWheel}
                    onPointerDown={beginViewportPointer}
                    onPointerMove={moveViewportPointer}
                    onPointerUp={endViewportPointer}
                    onPointerCancel={cancelViewportPointer}
                    onPointerLeave={() => {
                      if (!paintSessionController.active && brushCursorRef.current) {
                        brushCursorCenterRef.current = null;
                        brushCursorRef.current.style.opacity = '0';
                      }
                    }}
                    onTransformChange={updateTransformMatrix}
                  />

                  <EditorStatusBar
                    status={error ?? gradeStatus ?? ''}
                    error={Boolean(error)}
                    meta={statusBar.meta}
                    metaTitle={statusBar.title}
                    reportAvailable={statusBar.reportAvailable}
                    onOpenReport={() => setPsdReportOpen(true)}
                  />
                </section>
              ) : null
            }))}
            activeDocumentId={workspaceDocumentId}
            onActiveDocumentChange={onActivateWorkspaceDocument}
            accessoryWidthConstraintsEnabled={accessoryWidthConstraintsEnabled}
            onResizeInteractionChange={handleDockResizeInteractionChange}
            onDocumentSurfaceReady={handleDocumentSurfaceReady}
            scopes={(

              <ScopesPanel
                containerRef={scopesColumnRef}
                visibility={scopeVisibility}
                settings={scopeSettings}
                histogram={histogram}
                hueDistributionCanvasRef={hueDistributionCanvasRef}
                paradeCanvasRef={paradeCanvasRef}
                vectorscopeCanvasRef={vectorscopeCanvasRef}
                error={scopeError}
                onVisibilityChange={(scope, visible) => {
                  setScopeVisibility((current) => ({ ...current, [scope]: visible }));
                }}
                onSettingsChange={setScopeSettings}
              />
            )}
            layers={layersPanel}
            debug={(
              <DebugPanel
                messages={debugMessages}
                onClear={() => setDebugMessages([])}
                accessoryWidthConstraintsEnabled={accessoryWidthConstraintsEnabled}
                editorResizeObserversEnabled={editorResizeObserversEnabled}
                dockResizeActive={dockResizeActiveRef.current}
                onAccessoryWidthConstraintsChange={(enabled) => {
                  setAccessoryWidthConstraintsEnabled(enabled);
                  appendDebugMessage(
                    'info',
                    'Layout diagnostics',
                    `Accessory width constraints ${enabled ? 'enabled' : 'disabled'}.`
                  );
                }}
                onEditorResizeObserversChange={(enabled) => {
                  setEditorResizeObserversEnabled(enabled);
                  appendDebugMessage(
                    'info',
                    'Layout diagnostics',
                    `Editor ResizeObservers ${enabled ? 'enabled' : 'disabled'}.`
                  );
                }}
              />
            )}
            lensFx={(
              <LensFxPanel
                key={sourceIdentity || sourceName}
                model={{
                  adjustments,
                  metadata,
                  resetModifierActive: shiftPressed,
                  depthProgress,
                  depthResult,
                  viewportMode: lensBlurViewportMode,
                  focusPickerActive
                }}
                commands={{
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
                }}
              />
            )}
            grade={(
              <GradePanel
                key={sourceIdentity || sourceName}
                model={{
                  adjustments,
                  metadata,
                  visibility: groupVisibility,
                  histogram,
                  resetModifierActive: shiftPressed,
                  showOriginal,
                  colorMixerScopeContainerRef,
                  colorMixerHueCanvasRef
                }}
                commands={{
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
                }}
              />
            )}
          />
        </div>
      </div>
      {styleEditorRequest ? (() => {
        const current = imageDocumentRef.current;
        const layer = current ? findDocumentLayer(current, styleEditorRequest.layerId) : null;
        return layer?.type === 'raster' ? (
          <div className="lighttable-style-editor-shield">
            <LayerStyleEditor
              key={`${styleEditorRequest.layerId}:${styleEditorRequest.before.revision}`}
              layerName={layer.name}
              initialStack={layer.styleStack}
              initialEffectId={styleEditorRequest.effectId}
              onPreview={previewLayerStyleStack}
              onCancel={cancelLayerStyleEditor}
              onCommit={commitLayerStyleEditor}
            />
          </div>
        ) : null;
      })() : null}
      <ContextMenu
        open={Boolean(appMenu)}
        x={appMenu?.x ?? 0}
        y={appMenu?.y ?? 0}
        onClose={() => setAppMenu(null)}
        options={appMenuOptions}
      />
      <TextInputDialog
        open={featherDialogOpen}
        title="Select feather"
        initialValue="8.0"
        selectAllOnOpen
        compact
        backdropClassName="lighttable-dialog-backdrop"
        onCancel={() => setFeatherDialogOpen(false)}
        onConfirm={(value) => {
          const radius = Number(value);
          if (!Number.isFinite(radius) || radius < 0 || radius > 250) {
            setError('Feather radius must be a number between 0 and 250 pixels.');
            return;
          }
          setFeatherDialogOpen(false);
          featherCurrentSelection(radius);
        }}
      />
      <ConfirmDialog
        open={Boolean(flattenRequest)}
        title={flattenRequest?.kind === 'group' ? 'Flatten group?' : 'Flatten image?'}
        description={
          flattenRequest?.kind === 'group'
            ? 'The visible raster contents of this group will become one raster layer. This can be undone while the document remains open.'
            : 'The visible layer stack will become one raster layer. This can be undone while the document remains open.'
        }
        confirmLabel="Flatten"
        danger
        onCancel={() => setFlattenRequest(null)}
        onConfirm={commitFlattenRequest}
      />
      <PsdImportReportDialog
        open={psdReportOpen}
        report={imageDocument?.photoshopImportReport ?? null}
        metrics={psdDifferenceMetrics}
        onClose={() => setPsdReportOpen(false)}
      />
    </div>
  );
};
