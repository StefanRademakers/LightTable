import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useAdjustmentTransactionController } from './application/adjustments/useAdjustmentTransactionController';
import { createAdjustmentCommands } from './application/adjustments/createAdjustmentCommands';
import {
  createEditorMenuOptions,
  type EditorMenuId
} from './editor/menus/createEditorMenuOptions';
import { projectEditorMenuState } from './editor/menus/projectEditorMenuState';
import { createDocumentProjectionController } from './application/documents/documentProjectionController';
import { useViewportInteractionController } from './editor/hooks/useViewportInteractionController';
import { useEditorResizeController } from './editor/hooks/useEditorResizeController';
import { useLayerThumbnailController } from './editor/hooks/useLayerThumbnailController';
import { useEditorDiagnosticsController } from './editor/hooks/useEditorDiagnosticsController';
import { useDocumentFileCommands } from './editor/hooks/useDocumentFileCommands';
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
  type ReferenceDifferenceMetrics
} from './application/rendering/rendererTypes';
import type {
  DocumentOpenMode
} from './application/documents/documentSourceProbe';
import {
  useEditorDocumentLifecycleController
} from './composition/documents/useEditorDocumentLifecycleController';
import {
  useEditorKeyboardController
} from './composition/input/useEditorKeyboardController';
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
import { ScopesPanel } from './ScopesPanel';
import { LayerPanel } from './editor/ui/LayerPanel';
import { LayerStyleEditor } from './editor/ui/LayerStyleEditor';
import { EditorDialogs } from './editor/ui/EditorDialogs';
import { useEditorDialogController } from './editor/ui/useEditorDialogController';
import { LightTableEditorShell } from './editor/ui/LightTableEditorShell';
import { DebugPanel } from './editor/ui/DebugPanel';
import { DocumentViewportSurface } from './editor/ui/DocumentViewportSurface';
import { EditorStatusBar } from './editor/ui/EditorStatusBar';
import { GradePanel } from './editor/panels/GradePanel';
import { LensFxPanel } from './editor/panels/LensFxPanel';
import {
  LightTableDockWorkspace,
  type LightTableDockWorkspaceHandle
} from './editor/workspace/LightTableDockWorkspace';
import {
  createDefaultLightTableWorkspacePanels,
  LIGHTTABLE_WORKSPACE_PANEL_IDS
} from './editor/workspace/workspacePanelRegistry';
import { createEditorSession, type EditorSession, type ToolId } from './editor/session/editorSession';
import { TemporaryToolController } from './editor/tools/temporaryToolController';
import { useFillCommandController } from './application/tools/fill/useFillCommandController';
import { useLensBlurDepthController } from './application/effects/lensBlur/useLensBlurDepthController';
import { usePaintSessionController } from './application/tools/paint/usePaintSessionController';
import { useSelectionSessionController } from './application/tools/selection/useSelectionSessionController';
import { useTransformSessionController } from './application/tools/transform/useTransformSessionController';
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
  findRasterLayer
} from './editor/document/layerTree';
import {
  type PreservedSourceAssetBlob
} from './editor/persistence/layeredDocumentFormat';
import {
  imagePickerAccept,
  imagePickerFormatNames
} from './image-io/supportedImageFormats';
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from './editor/psd/psdDocumentAdapter';
import { PaintGestureController } from './editor/tools/paint/paintGestureController';
import {
  isPaintTool,
  steppedBrushSize
} from './editor/tools/toolCapabilities';
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
const IS_MAC_PLATFORM = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
const primaryShortcutLabel = (key: string, shift = false) => (
  IS_MAC_PLATFORM
    ? `${shift ? '⇧' : ''}⌘${key}`
    : `Ctrl+${shift ? 'Shift+' : ''}${key}`
);
export interface LightTableEditorOverlayProps {
  open: boolean;
  active?: boolean;
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
  onRequestOpenWorkspaceDocument?: (decodeMode: DocumentOpenMode) => Promise<void> | void;
  onOpenWorkspaceDocument?: (file: File, decodeMode: DocumentOpenMode) => void;
  onDocumentReady?: () => void;
  onDocumentError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  history?: DocumentCommandHistory;
  tasks?: DocumentTaskRegistry;
  rendererLifecycle?: DocumentRendererLifecycle;
  documentSession?: DocumentSession;
}

type ZoomMode = 'fit' | '100' | 'custom';
const cloneAdjustments = cloneAllAdjustments;

export const LightTableEditorOverlay: React.FC<LightTableEditorOverlayProps> = ({
  open,
  active = true,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const advancedFileInputRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<DocumentRendererPort | null>(null);
  const adjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const documentAdjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const resetAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetDocumentTransactionRef = useRef<() => void>(() => undefined);
  const preservedSourceAssetsRef = useRef<PreservedSourceAssetBlob[]>([]);
  const paintGestureRef = useRef(new PaintGestureController());
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
  const startupTelemetryRef = useRef(new DocumentStartupTelemetry());
  const workspaceRef = useRef<LightTableDockWorkspaceHandle | null>(null);
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
  const [startupTimings, setStartupTimings] = useState<LightTableStartupTimings | null>(null);
  const [gpuMemoryBytes, setGpuMemoryBytes] = useState(0);
  const [accessoryWidthConstraintsEnabled, setAccessoryWidthConstraintsEnabled] = useState(true);
  const [editorResizeObserversEnabled, setEditorResizeObserversEnabled] = useState(true);
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
    getRenderer: () => engineRef.current
  });
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
      publishEditorAdjustments: (nextAdjustments) => {
        adjustmentsRef.current = nextAdjustments;
        setAdjustments(nextAdjustments);
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
    [setImageDocument]
  );
  const applyAdjustmentSnapshot = documentProjectionController.applyAdjustmentSnapshot;

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
  const {
    depthResult,
    depthProgress,
    reset: resetLensBlurDepth
  } = useLensBlurDepthController({
    open,
    enabled: adjustments.effects.lensBlur.enabled,
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
      }));
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
      setImageDocument(nextDocument);
      setThumbnailDocumentReadyId(nextDocument.id);
    },
    publishMetadata: setMetadata,
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
      adjustmentsRef.current = nextAdjustments;
      setAdjustments(nextAdjustments);
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
    resetLensBlurDepth,
    setEditorSession,
    setImageDocument,
    setView,
    setZoomMode
  ]);

  const beforeDocumentOpen = useCallback(() => {
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
          adjustmentsRef.current = startingAdjustments;
          setAdjustments(startingAdjustments);
        },
        resetHistory: clearEditorHistory,
        resetViewport: () => {
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


  useRendererPresentationSync({
    rendererRef: engineRef,
    showOriginal,
    showDifference,
    lensBlurViewportMode,
    scopeVisibility,
    scopeSettings,
    scopeVisibilityRef,
    scopeSettingsRef
  });

  useEffect(() => {
    if (!gradeStatus) return;
    const timeout = window.setTimeout(() => setGradeStatus(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [gradeStatus]);

  const selectAllContent = selectionSessionController.selectAll;
  const clearCurrentSelection = selectionSessionController.clear;
  const invertCurrentSelection = selectionSessionController.invert;
  const featherCurrentSelection = selectionSessionController.feather;

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
      isTransformActive: () => transformActiveRef.current(),
      commitTransform: () => commitTransformRef.current(),
      activateTool: (tool) => activateToolRef.current(tool),
      undo: () => { void undoEditor(); },
      redo: () => { void redoEditor(); },
      beginTemporaryPan: () => {
        if (temporaryToolRef.current.begin('view')) setTemporaryPanActive(true);
      },
      fillForeground: () =>
        fillActiveTargetRef.current(editorSession.brush.color),
      fillBackground: () =>
        fillActiveTargetRef.current(editorSession.brush.backgroundColor),
      selectAll: selectAllContent,
      selectNone: clearCurrentSelection,
      invertSelection: invertCurrentSelection,
      copySelection: () => copySelectedContentRef.current(),
      pasteSelection: () => pasteSelectedContentRef.current(),
      layerViaCopy: () => layerViaCopyRef.current(),
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
      toggleOriginal: () => {
        setShowDifference(false);
        setShowOriginal((current) => !current);
      },
      changeBrushSize: (direction) => setEditorSession((current) => ({
        ...current,
        brush: {
          ...current.brush,
          size: steppedBrushSize(current.brush.size, direction)
        }
      })),
      cancelOrClose: () => {
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
    },
    temporaryPanActive: () => temporaryToolRef.current.active,
    releaseTemporaryPan: () => {
      if (temporaryToolRef.current.end('view')) setTemporaryPanActive(false);
    },
    clearTemporaryTool: () => {
      if (temporaryToolRef.current.end()) setTemporaryPanActive(false);
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
        adjustments.effects.lensDistortion
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
      }));
    },
    onFocusPickerEnd: () => setFocusPickerActive(false),
    onFill: fillActiveTarget,
    selection: selectionSessionController,
    paint: paintSessionController,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE
  });

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
    setError,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    getPanelAdjustments: () => adjustmentsRef.current,
    publishDocumentAdjustments: (next) => {
      documentAdjustmentsRef.current = cloneAdjustments(next);
    },
    publishPanelAdjustments: (next) => {
      adjustmentsRef.current = cloneAdjustments(next);
      setAdjustments(cloneAdjustments(next));
    }
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
  const layerPanelController = useLayerPanelController({
    getDocument: () => imageDocumentRef.current,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    mutateDocument: applyDocumentChange,
    publishPanelAdjustments: (next) => {
      adjustmentsRef.current = cloneAdjustments(next);
      setAdjustments(cloneAdjustments(next));
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
    mergeActiveLayerDown,
    mergeSelectedRasterLayers,
    requestFlattenGroup: (groupId) =>
      editorDialogs.requestFlatten({ kind: 'group', groupId }),
    requestFlattenImage: () => editorDialogs.requestFlatten({ kind: 'image' }),
    editStyles: openLayerStyleEditor
  });

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
    download: handleDownload,
    handleFastFileInput: handleLocalFile,
    handlePrecisionFileInput: handleAdvancedLocalFile,
    chooseLocalFile
  } = useDocumentFileCommands({
    fileInputRef,
    advancedFileInputRef,
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
    hydrateLocalFile: async (file, decodeMode, signal, isCurrent) => {
      await documentLifecycleController.loadSource({
        blob: file,
        name: file.name,
        initialAdjustments: createDefaultAdjustments(),
        identity: `${file.name}:${file.type}:${file.lastModified}${decodeMode === 'preserve-precision' ? ':preserve-precision' : ''}`,
        isCanceled: () => !isCurrent(),
        decodeMode,
        signal
      });
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

  const menuDocument = imageDocumentRef.current;
  const menuActiveLayer = menuDocument
    ? findDocumentLayer(menuDocument, menuDocument.activeLayerId)
    : null;
  const menuState = projectEditorMenuState({
    document: menuDocument,
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
  });

  const createAppMenuOptions = (menuId: EditorMenuId) => createEditorMenuOptions(
    menuId,
    menuState,
    {
      openFormats: imagePickerFormatNames('fast'),
      primaryShortcut: primaryShortcutLabel
    },
    {
      // The application probe selects browser-native, wasm-vips, Photoshop or
      // layered-document import after reading the source signature.
      open: () => void chooseLocalFile('automatic'),
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
      featherSelection: editorDialogs.openFeather,
      createRasterLayer: layerPanelController.createRasterLayer,
      duplicateLayer: duplicateActiveLayer,
      layerViaCopy,
      renameLayer: focusActiveLayerName,
      invertLayerColors: invertActiveLayerColors,
      beginAutoAlign: () => void beginAutoAlign(),
      applyAutoAlign: applyAutoAlignPreview,
      cancelAutoAlign: cancelAutoAlignPreview,
      toggleClipping: () => menuActiveLayer
        && layerPanelController.setClipping(
          menuActiveLayer.id,
          !menuActiveLayer.clipping
        ),
      setBlendMode: (mode) => menuActiveLayer
        && layerPanelController.setBlendMode(menuActiveLayer.id, mode),
      editPixels: () => layerPanelController.changeChannel('pixels'),
      editMask: () => layerPanelController.changeChannel('mask'),
      addMask: layerPanelController.addMask,
      toggleMask: layerPanelController.toggleMask,
      removeMask: layerPanelController.removeMask,
      moveLayerUp: () => layerPanelController.moveActive('up'),
      moveLayerDown: () => layerPanelController.moveActive('down'),
      mergeDown: mergeActiveLayerDown,
      flattenGroup: () => {
        if (menuActiveLayer?.type === 'group') {
          editorDialogs.requestFlatten({
            kind: 'group',
            groupId: menuActiveLayer.id
          });
        }
      },
      flattenImage: () => editorDialogs.requestFlatten({ kind: 'image' }),
      toggleLayerVisibility: () => menuActiveLayer
        && layerPanelController.setVisibility(
          [menuActiveLayer.id],
          !menuActiveLayer.visible
        ),
      toggleLayerLock: () => menuActiveLayer
        && layerPanelController.setLock(
          [menuActiveLayer.id],
          'all',
          !menuActiveLayer.locks.all
        ),
      deleteLayer: () => menuActiveLayer
        && layerPanelController.deleteSelection([menuActiveLayer.id]),
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
      showDebugPanel: () => workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.debug),
      resetWorkspaceLayout: () => workspaceRef.current?.resetLayout()
    }
  );
  const layersPanel = imageDocument ? (
    <div className="lighttable-layers-panel">
      <LayerPanel
        document={imageDocument}
        thumbnails={layerThumbnails}
        activeChannel={editorSession.activeChannel}
        onSelect={layerPanelController.select}
        onChannelChange={layerPanelController.changeChannel}
        onVisibility={layerPanelController.setVisibility}
        onRename={layerPanelController.rename}
        onOpacity={layerPanelController.setOpacity}
        onFillOpacity={layerPanelController.setFillOpacity}
        onOpacityInteractionStart={layerPanelController.beginOpacityInteraction}
        onOpacityInteractionEnd={layerPanelController.endOpacityInteraction}
        onBlendMode={layerPanelController.setBlendMode}
        onClipping={layerPanelController.setClipping}
        onReorder={layerPanelController.reorder}
        onAddMask={layerPanelController.addMask}
        onToggleMask={layerPanelController.toggleMask}
        onLockChange={layerPanelController.setLock}
        onCreate={layerPanelController.createRasterLayer}
        onCreateAdjustment={layerPanelController.createAdjustmentLayer}
        onCreateGroup={layerPanelController.createGroup}
        onGroupSelection={layerPanelController.groupSelection}
        onUngroupSelection={layerPanelController.ungroupSelection}
        onDelete={layerPanelController.deleteSelection}
        onMergeDown={layerPanelController.mergeDown}
        onMergeSelected={layerPanelController.mergeSelected}
        onFlattenGroup={layerPanelController.flattenGroup}
        onFlattenImage={layerPanelController.flattenImage}
        onEditStyles={layerPanelController.editStyles}
        onStyleStackEnabled={layerPanelController.setStyleStackEnabled}
        onStyleEnabled={layerPanelController.setStyleEnabled}
        onClearStyles={layerPanelController.clearStyles}
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

  const visibleTool = temporaryPanActive ? 'view' : editorSession.activeTool;
  const updateBrush = (change: Partial<EditorSession['brush']>) => {
    setEditorSession((current) => ({
      ...current,
      brush: { ...current.brush, ...change }
    }));
  };

  return (
    <LightTableEditorShell
      active={active}
      saving={saving}
      onClose={onClose}
      menuOptionsFor={createAppMenuOptions}
      activeTool={visibleTool}
      brush={editorSession.brush}
      onBrushChange={updateBrush}
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
          <EditorDialogs
            controller={editorDialogs}
            photoshopReport={imageDocument?.photoshopImportReport ?? null}
            differenceMetrics={psdDifferenceMetrics}
            onFeather={featherCurrentSelection}
            onFlatten={commitFlattenRequest}
            onError={setError}
          />
        </>
      )}
    >
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
                    brushCursorRef={viewportInteraction.brushCursorRef}
                    activeTool={editorSession.activeTool}
                    temporaryPanActive={temporaryPanActive}
                    dragging={viewportInteraction.dragging}
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
                    onWheel={viewportInteraction.onWheel}
                    onPointerDown={viewportInteraction.onPointerDown}
                    onPointerMove={viewportInteraction.onPointerMove}
                    onPointerUp={viewportInteraction.onPointerUp}
                    onPointerCancel={viewportInteraction.onPointerCancel}
                    onPointerLeave={() => {
                      if (!paintSessionController.active) viewportInteraction.hideBrushCursor();
                    }}
                    onTransformChange={updateTransformMatrix}
                  />

                  <EditorStatusBar
                    status={error ?? gradeStatus ?? ''}
                    error={Boolean(error)}
                    meta={statusBar.meta}
                    metaTitle={statusBar.title}
                    reportAvailable={statusBar.reportAvailable}
                    onOpenReport={editorDialogs.openPsdReport}
                  />
                </section>
              ) : null
            }))}
            activeDocumentId={workspaceDocumentId}
            onActiveDocumentChange={onActivateWorkspaceDocument}
            accessoryWidthConstraintsEnabled={accessoryWidthConstraintsEnabled}
            onResizeInteractionChange={handleDockResizeInteractionChange}
            onDocumentSurfaceReady={handleDocumentSurfaceReady}
            panels={createDefaultLightTableWorkspacePanels({
              scopes: (

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
              ),
              layers: layersPanel,
              debug: (
              <DebugPanel
                messages={debugMessages}
                onClear={clearDebugMessages}
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
              ),
              lensFx: (
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
              ),
              grade: (
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
              )
            })}
          />
    </LightTableEditorShell>
  );
};
