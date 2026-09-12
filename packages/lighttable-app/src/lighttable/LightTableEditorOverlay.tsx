import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { filterDefinition } from '@lighttable/filter-core';
import { TEXT_CONTRACT_FIXTURE_COUNT, type TextPaint } from '@lighttable/text-core';
import { buildParagraphFrameOverlay } from '@lighttable/text-rendering';
import { useDocumentPalette, useLayerPalette } from './application/color/useDocumentPalette';
import { DocumentPaletteProvider } from '../ui/DocumentPaletteContext';
import { DocumentCommandHistory } from './application/commands/documentCommandHistory';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandId, type LightTableCommandPortRegistry, type LightTableCommandService } from './application/commands/lightTableCommandService';
import { useMountedAutomationGestures } from './composition/commands/useMountedAutomationGestures';
import { useGenAiReferenceHandoff } from './composition/genai/useGenAiReferenceHandoff';
import type {
  LightTableBitmapExportFormat,
  LightTableGradeClipboardCapture,
  LightTablePreviewEncoding
} from './application/commands/lightTableCommandContract';
import { isMountedDocumentCommand } from './application/commands/lightTableCommandOwnership';
import { commandDocumentTarget } from './application/commands/commandRequestScope';
import type { DocumentPixelRegion } from './editor/geometry/documentRegionPreview';
import { automationPaintOperatorFromPlan } from './application/commands/lightTableCommandValidation';
import { useDocumentHistoryController, type EditorHistoryEntry } from './application/commands/useDocumentHistoryController';
import type { DocumentSession, DocumentSessionId } from './application/documents/documentSession';
import type { EditorApplicationSession } from './application/workspace/editorApplicationSession';
import { createActionsPanelCallbacks } from './composition/workspace/createActionsPanelCallbacks';
import { DocumentTaskRegistry } from './application/tasks/documentTaskRegistry';
import { DocumentRendererLifecycle } from './application/rendering/documentRendererLifecycle';
import { captureRendererBinding } from './application/rendering/rendererBindingToken';
import { captureVectorTransformPreviewBinding } from './application/vectors/VectorTransformPreviewBinding';
import { useDocumentGpuRecovery } from './composition/documents/useDocumentGpuRecovery';
import { bindDocumentGpuResourceLifetime } from './application/rendering/documentGpuResourceRegistry';
import { resolveViewportImageRect } from './application/rendering/viewportRenderState';
import { useClipboardCommands } from './composition/clipboard/useClipboardCommands';
import { useDocumentRuntimeServices } from './application/documents/useDocumentRuntimeServices';
import { resetDocumentOpenPresentation } from './application/documents/resetDocumentOpenPresentation';
import { useDocumentMutationController } from './application/documents/useDocumentMutationController';
import { useEditorRecoveryJournal } from './application/documents/useEditorRecoveryJournal';
import { useWorkspaceDocumentPresentation } from './composition/documents/useWorkspaceDocumentPresentation';
import { documentPresentationAvailability } from './composition/documents/documentPresentationAvailability';
import { useEditorHostPresentationActivity } from './composition/rendering/useEditorHostPresentationActivity';
import { useEditorArtifactExportRefs } from './application/documents/useEditorArtifactExportRefs';
import { createInteractionTransitionCoordinator } from './application/interactions/InteractionTransitionCoordinator';
import { MountedDocumentAdmission } from './application/interactions/MountedDocumentAdmission';
import { deactivateHostPresentation } from './application/interactions/HostPresentationDeactivation';
import { useWorkspaceDocumentIntents } from './composition/workspace/useWorkspaceDocumentIntents';
import { exportEditorPreviewArtifact, exportEditorPsdArtifact } from './application/documents/editorArtifactExports';
import type { ExportedPsdDocument } from './application/documents/PsdExportClient';
import { DocumentLoadedSourceBinding } from './application/documents/DocumentLoadedSourceBinding';
import { DocumentInteractionResetPolicy } from './application/documents/DocumentInteractionResetPolicy';
import { useEditorDocumentFonts } from './composition/documents/useEditorDocumentFonts';
import { useAdjustmentTransactionController } from './application/adjustments/useAdjustmentTransactionController';
import { projectAdjustmentSnapshot } from './application/adjustments/projectAdjustmentSnapshot';
import { resolveAdjustmentContext } from './application/adjustments/resolveAdjustmentContext';
import { GradeInspectorController, projectGradeInspector } from './application/adjustments/GradeInspectorController';
import { DocumentProcessingBinding } from './application/adjustments/DocumentProcessingBinding';
import { AdjustmentPresentationRuntime } from './application/adjustments/AdjustmentPresentationRuntime';
import { GradeAssetCommandService } from './application/adjustments/GradeAssetCommandService';
import { createAdjustmentCommands } from './application/adjustments/createAdjustmentCommands';
import type { AdjustmentInteractionHandle } from './application/adjustments/AdjustmentInteractionCoordinator';
import { useAdjustmentGestures } from './composition/adjustments/useAdjustmentGestures';
import { createMountedAdjustmentCommandBinding } from './application/adjustments/MountedAdjustmentCommandBinding';
import {
  resolveContextualAdjustmentCreation,
  type SemanticAdjustmentCreationCommand
} from './application/commands/semanticAdjustmentCreationCommandContract';
import { useCanvasPickers } from './composition/adjustments/useCanvasPickers';
import type { PointColorSample } from './pointColor';
import { useAdjustmentPresentationSelector,
  type AdjustmentPresentationDomain } from './application/adjustments/adjustmentPresentationStore';
import { createDocumentProjectionBinding } from './application/documents/documentProjectionBinding';
import { useViewportInteractionController } from './editor/hooks/useViewportInteractionController';
import {
  zoomViewToScaleAtPoint
} from './editor/tools/pointer/viewportCoordinates';
import { steppedZoomPercent, zoomPercentToScale } from './editor/tools/zoom/zoomLevels';
import { useEditorResizeController } from './editor/hooks/useEditorResizeController';
import { useLayerThumbnailController } from './editor/hooks/useLayerThumbnailController';
import { useEditorDiagnosticsController } from './editor/hooks/useEditorDiagnosticsController';
import { useEditorNotifications } from './editor/notifications/useEditorNotifications';
import { createScopeRendererOptions, useRendererPresentationSync } from './editor/hooks/useRendererPresentationSync';
import { PersistentToolActivationOwner, applyPersistentToolPreference } from './application/tools/PersistentToolActivationOwner';
import { cancelActiveEditorOperation } from './application/interactions/cancelActiveEditorOperation';
import { captureInteractionScope } from './application/interactions/captureInteractionScope';
import { settleHistoryInteractions } from './application/interactions/settleHistoryInteractions';
import { useLayerDocumentInteractionOwner } from './application/layers/useLayerDocumentInteractionOwner';
import { useAutoAlignController } from './application/tools/autoAlign/useAutoAlignController';
import { SampledBrushSourceController } from './application/tools/paint/sampledBrush';
import { useSmartSelectionBinding } from './composition/selection/useSmartSelectionBinding';
import { useLayerStyleEditorController } from './application/styles/useLayerStyleEditorController';
import { layerStyleSnapshot } from './application/styles/completeLayerStyleSnapshot';
import { LayerStyleEntryIntent } from './application/styles/LayerStyleEntryIntent';
import { usePropertiesInspectorPresentation } from './composition/properties/usePropertiesInspectorPresentation';
import { useLayerDocumentCommands } from './application/layers/useLayerDocumentCommands';
import { useLayerFinalizationIntents } from './composition/workspace/useLayerFinalizationIntents';
import { createMountedLayerCommandBinding } from './application/layers/createMountedLayerCommandBinding';
import { createMountedSelectionCommandBinding } from './application/tools/selection/createMountedSelectionCommandBinding';
import { createLayerFinalizationCommandBinding } from './application/layers/LayerFinalizationCommandBinding';
import { captureLayerFinalizationScope } from './application/layers/captureLayerFinalizationScope';
import { useBackgroundRemovalController } from './application/backgroundRemoval/useBackgroundRemovalController';
import { useBackgroundRemovalTaskBridge } from './application/backgroundRemoval/useBackgroundRemovalTaskBridge';
import { useLayerPanelController, type LayerPanelController } from './application/layers/useLayerPanelController';
import { useCommandLayerPanelController } from './application/layers/useCommandLayerPanelController';
import { createLayerMaskCommandBridge } from './application/layers/createLayerMaskCommandBridge';
import { useP0FilterController } from './application/filters/useP0FilterController';
import { executeSemanticFilterSnapshot } from './application/filters/executeSemanticFilterSnapshot';
import { resolveFilterSnapshotOwner } from './application/filters/filterSnapshotOwner';
import { recordFilterSnapshotCheckpoint } from './application/filters/recordFilterSnapshotCheckpoint';
import { LayerNameRenameGestureController } from './application/layers/layerSelectionModel';
import {
  adjustmentStackHasLocalProcessing,
  materializeBasicAdjustments
} from './processing/adjustmentStack';
import {
  attachedAdjustmentOwnerId,
  parseAttachedAdjustmentOwnerId
} from './processing/attachedAdjustment';
import type { AdjustmentLayerKind } from './processing/adjustmentLayerCatalog';
import { useTextToShape } from './composition/text/useTextToShape';
import { PositionedTextRecoveryCommandController } from './application/text/PositionedTextRecoveryCommandController';
import { usePdfExportPreflight } from './composition/documents/usePdfExportPreflight';
import { readGenAiDocumentContext } from './composition/genai/readGenAiDocumentContext';
import { TextSelectionGestureController } from './application/text/TextSelectionGestureController';
import { textSelectionForGranularity } from './application/text/flowTextEditing';
import type { LightTableStartupTimings } from './application/telemetry/editorTelemetry';
import { DocumentStartupTelemetry } from './application/telemetry/documentStartupTelemetry';
import type { DocumentStartupTimeline } from './application/telemetry/documentStartupTimeline';
import { buildEditorStatus } from './application/telemetry/editorStatus';
import type { ReferenceDifferenceMetrics } from './application/rendering/rendererTypes';
import { formatRenderTelemetry } from './application/rendering/renderTelemetry';
import { createSupportDiagnosticArtifact } from './application/diagnostics/supportDiagnosticBundle';
import { sharedWebGpuDiagnostics } from './gpu/sharedWebGpuDevice';
import { useTextEngineDiagnostics } from './text/diagnostics/useTextEngineDiagnostics';
import { useTextRenderPresentation, useTextRenderPresentationDiagnostics } from './composition/telemetry/useTextRenderPresentation';
import {
  documentTextFontDiagnostics,
  summarizeTextFontDiagnostics
} from './text/fonts/textLayerFontStatus';
import type { DocumentOpenMode } from './application/documents/documentSourceProbe';
import { useEditorDocumentLifecycleController } from './composition/documents/useEditorDocumentLifecycleController';
import { useDocumentScopeCanvases } from './composition/documents/useDocumentScopeCanvases';
import { useViewportWheelBridge } from './composition/viewport/useViewportWheelBridge';
import { useEditorDocumentFileController } from './composition/documents/useEditorDocumentFileController';
import { useDocumentFileIntents } from './composition/documents/useDocumentFileIntents';
import { useEditorKeyboardController } from './composition/input/useEditorKeyboardController';
import { resolveDeleteTarget } from './application/input/resolveDeleteTarget';
import { LatestFrameValueScheduler } from './application/input/latestFrameValueScheduler';
import { createEditorMenuController } from './composition/menus/createEditorMenuController';
import { primaryShortcutLabel } from './application/input/editorShortcutPresentation';
import { LayersWorkspacePanel } from './composition/workspace/LayersWorkspacePanel';
import { ChannelsWorkspacePanel } from './composition/workspace/ChannelsWorkspacePanel';
import { createEditorWorkspacePanels } from './composition/workspace/createEditorWorkspacePanels';
import {
  gradePropertiesTitle,
  propertiesInspectorView,
  type PropertiesInspectorTarget
} from './application/properties/propertiesInspectorTarget';
import { EditorDocumentSurface } from './composition/workspace/EditorDocumentSurface';
import { EditorOverlayLayer } from './composition/workspace/EditorOverlayLayer';
import { type DocumentRendererPort } from './infrastructure/rendering/webGpuDocumentRenderer';
import {
  copyLightTableGrade,
  useLightTableGradeClipboard
} from './lightTableGradeClipboard';
import {
  resolveLightTableEditorSourceKey,
  resolveLightTableSaveSourceKey,
  type LightTableRecipe
} from './lightTableRecipe';
import { useEditorDialogController } from './editor/ui/useEditorDialogController';
import { BackgroundRemovalDialog } from './editor/ui/BackgroundRemovalDialog';
import type { ImageSizeRequest } from './application/imageSize/imageSizeModel';
import type { DocumentGeometryRequest } from './application/documentGeometry/documentGeometryModel';
import { DocumentSurfaceCommandService } from './application/documentGeometry/DocumentSurfaceCommandService';
import { beginDocumentCrop } from './application/documentGeometry/beginDocumentCrop';
import { DocumentSurfaceHistoryBinding } from './application/documentGeometry/DocumentSurfaceHistoryBinding';
import { LightTableEditorShell } from './editor/ui/LightTableEditorShell';
import { useTextCreation } from './composition/text/useTextCreation';
import { useTextPointerRouter } from './composition/text/useTextPointerRouter';
import { FlowTextEditingSessionController } from './application/text/flowTextEditingSession';
import { TextPropertyGestureController } from './application/text/TextPropertyGestureController';
import { ExistingTextHitController } from './application/text/ExistingTextHitController';
import { useExistingTextActivation } from './composition/text/useExistingTextActivation';
import { useTextEditingEntry } from './composition/text/useTextEditingEntry';
import { executeSemanticTextCommand } from './application/text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from './application/vectors/semanticVectorCommandExecutor';
import { exportSvgDocument } from './application/vectors/svgDocumentCodec';
import { createMountedSvgImportBinding } from './application/vectors/createMountedSvgImportBinding';
import { executeSemanticWarpStrokeCommand } from './application/commands/semanticWarpCommandExecutor';
import { VectorCommitPublisher } from './application/vectors/VectorCommitPublisher';
import { usePenPresentation } from './composition/vectors/usePenPresentation';
import { executeSemanticLayerStyleCommand } from './application/styles/semanticLayerStyleCommandExecutor';
import { executeSemanticLayerStyleSnapshot } from './application/styles/executeSemanticLayerStyleSnapshot';
import { executeAtomicCommandBatch } from './application/commands/atomicCommandBatchExecutor';
import { executeSemanticFaceWarpCommand } from './application/effects/faceWarp/semanticFaceWarpCommandExecutor';
import { useAgentActivity } from './application/commands/useAgentActivity';
import { waitForExactCommandRender } from './application/rendering/waitForExactCommandRender';
import { FlowTextEditingRuntime } from './application/text/FlowTextEditingRuntime';
import { ParagraphFrameResizeController } from './application/text/ParagraphFrameResizeController';
import { PathTextHandleController } from './application/text/PathTextHandleController';
import { useMissingFontReplacementActions } from './application/text/useMissingFontReplacementActions';
import { hitTestTextEditingLayout } from './application/text/textEditingHitTest';
import { TextLayerMoveGestureController } from './application/text/TextLayerMoveGestureController';
import { type ParagraphStylePatch, type TextStylePatch } from './application/text/flowTextFormatting';
import { resolveTextProperties } from './application/text/textPropertyPresentation';
import { useTextPropertyCommands } from './composition/text/useTextPropertyCommands';
import { lightTableTextEngine } from './text/wasm/TextEngineClient';
import {
  BUNDLED_TEXT_FONT_CATALOG,
  registerBundledTextFontsForDocument,
  registerBundledTextFontByAssetId,
  registerBundledTextFontForSettings
} from './text/fonts/bundledTextFont';
import { DEFAULT_TEXT_SUBSTITUTION_FAMILIES, documentNeedsFlowFontFallback } from './text/fonts/flowFontSelection';
import { bindRendererTextFontRuntime } from './composition/documents/bindRendererTextFontRuntime';
import {
  LightTableDockWorkspace,
  type LightTableDockWorkspaceHandle,
  type WorkspacePanelVisibility
} from './editor/workspace/LightTableDockWorkspace';
import { nextEditorScreenMode, type EditorScreenMode } from './editor/workspace/editorScreenMode';
import { LIGHTTABLE_WORKSPACE_PANEL_IDS } from './editor/workspace/workspacePanelRegistry';
import { useGenAiSetupController } from '../genai/application/useGenAiSetupController';
import { useGenAiJobsController } from '../genai/application/useGenAiJobsController';
import { useGenAiRemoveObject } from './composition/genai/useGenAiRemoveObject';
import type { GenAiGenerationJob } from '@lighttable/genai-core';

import {
  createEditorSession,
  createGradientToolSettings,
  documentEditorStateFrom,
  type EditorSession,
  type ToolId
} from './editor/session/editorSession';
import { useTemporaryTool } from './application/tools/useTemporaryTool';
import { useFillCommandController } from './application/tools/fill/useFillCommandController';
import {
  RasterGradientCommandController,
  type RasterGradientDependencies
} from './application/tools/gradient/RasterGradientCommandController';
import { browserImageClipboard, type LightTableImageClipboard } from '../platform/LightTableImageClipboard';
import type {
  LightTableProjectSummary,
  LightTableRecentFile,
  LightTableRecentProject,
  LightTableSaveResult
} from '../platform/LightTableHost';
import type { LightTableRecoveryStore } from '../platform/LightTableRecoveryStore';
import { useLensBlurDepthController } from './application/effects/lensBlur/useLensBlurDepthController';
import { usePaintSessionController } from './application/tools/paint/usePaintSessionController';
import { useWarpSessionController } from './application/tools/warp/useWarpSessionController';
import type { FaceWarpProtectedFeature } from './effects/faceWarp/faceWarpTypes';
import type { FaceWarpSemanticTarget } from './application/tools/faceWarp/FaceWarpToolOptions';
import { createFaceWarpInteractionSessionController } from './application/tools/faceWarp/FaceWarpInteractionSessionController';
import { FaceWarpDetectionReviewController } from './application/tools/faceWarp/FaceWarpDetectionReviewController';
import { resolveFaceWarpView } from './application/tools/faceWarp/faceWarpView';
import { useFaceWarpIntents } from './composition/faceWarp/useFaceWarpIntents';
import { useFaceWarpMeshPresentation } from './composition/faceWarp/useFaceWarpMeshPresentation';
import { useFaceWarpScope } from './composition/faceWarp/useFaceWarpScope';
import { useFaceWarpLifecycle } from './composition/faceWarp/useFaceWarpLifecycle';
import { useSelectionSessionController } from './application/tools/selection/useSelectionSessionController';
import { SelectionShapeCommandService } from './application/tools/selection/SelectionShapeCommandService';
import { DocumentSelectionStateStore } from './application/tools/selection/DocumentSelectionStateStore';
import { useTransformSessionController, type FixedTransformOperation } from './application/tools/transform/useTransformSessionController';
import { useTransformCanvasPickIntent } from './composition/transforms/useTransformCanvasPickIntent';
import { useTransformPresentation } from './composition/transforms/useTransformPresentation';
import { useGuideGridPresentation } from './composition/transforms/useGuideGridPresentation';
import { useDocumentGuideInteraction } from './composition/workspace/useDocumentGuideInteraction';
import { useSelectionHostBinding } from './composition/selection/useSelectionHostBinding';
import { DocumentSelectionPublicationBinding } from './application/documents/DocumentSelectionPublicationBinding';
import type { SnapMatch } from './application/tools/snapping/snapEngine';
import { useVectorToolSessionController } from './application/vectors/useVectorToolSessionController';
import { isVectorEditorTool } from './editor/tools/vectorToolCatalog';
import type { VectorElementCreationTransaction } from './application/vectors/VectorDocumentController';
import {
  selectedVectorStyle as resolveSelectedVectorStyle,
  selectedShapeGeometry as resolveSelectedShapeGeometry
} from './application/vectors/vectorPropertyProjection';
import { useVectorPropertyIntents } from './composition/vectors/useVectorPropertyIntents';
import {
  useDocumentImageState,
  useDocumentEditorSession,
  useDocumentViewportState
} from './editor/hooks/useDocumentEditorState';
import {
  type GroupVisibility
} from './application/adjustments/groupVisibility';
import {
  type LensBlurViewportMode
} from './editor/config/adjustmentControls';
import {
  layerIsLocked,
  type DocumentCreationSettings,
  type DocumentAssetId,
  type ImageDocument,
  type LayerId,
  type TextLayer,
  type Rect
} from './editor/document/documentTypes';
import {
  findDocumentLayer,
  findRasterLayer,
  walkLayerTree
} from './editor/document/layerTree';
import {
  imagePickerAccept
} from './image-io/supportedImageFormats';
import type { NativeBitmapFormatId } from './image-io/nativeBitmapFormats';
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from './editor/psd/psdDocumentAdapter';
import { PaintGestureController } from './editor/tools/paint/paintGestureController';
import { paintTargetSourceToDocument } from './editor/tools/paint/paintCoordinates';
import {
  replaceVectorElement,
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
  type SelectionOperation,
  type SelectionShape
} from './editor/selection/selectionTypes';
import { selectionEditingOverlayIsVisible } from './editor/selection/selectionEditingOverlay';
import { SelectionMaskSnapshot } from './editor/selection/SelectionMaskSnapshot';
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

export interface WorkspaceViewControls {
  readonly zoomPercent: number;
  readonly onZoomPreset: (percent: number) => void;
  readonly onZoomFit: () => void;
  readonly onZoomActual: () => void;
  readonly onZoomStep: (direction: -1 | 1) => void;
}

export interface WorkspaceDocumentSurfacePresentation {
  /** Effective tool, including a temporary Space/Ctrl+Space/Alt+Space override. */
  readonly activeTool: ToolId;
  readonly zoomOutActive: boolean;
}

export interface LightTableEditorOverlayProps {
  open: boolean;
  active?: boolean;
  screenMode?: EditorScreenMode;
  onScreenModeChange?: (mode: EditorScreenMode) => void;
  projectId: string;
  sourceFileKey?: string | null;
  sourceBlob?: Blob | null;
  /** Typed non-image surfaces reuse the one application workspace shell. */
  documentSurfaceOverride?: React.ReactNode | ((
    presentation: WorkspaceDocumentSurfacePresentation
  ) => React.ReactNode);
  workspaceDocumentKind?: 'image' | 'video' | 'model-3d';
  workspaceViewControls?: WorkspaceViewControls;
  workspaceVideoControlsPanel?: React.ReactNode;
  /** Status-bar projection supplied by a non-image document runtime. */
  workspaceStatusMeta?: string;
  workspaceStatusTitle?: string;
  sourceDecodeMode?: DocumentOpenMode;
  documentCreationSettings?: DocumentCreationSettings;
  startupTimeline?: DocumentStartupTimeline;
  loadSource?: (request: {
    projectId: string;
    sourceFileKey: string;
    signal: AbortSignal;
  }) => Promise<Blob>;
  initialRecipe?: LightTableRecipe | null;
  fileNameBase: string;
  subjectLabel: string;
  onClose: () => void;
  onSave: (
    file: File,
    recipe: LightTableRecipe | null,
    transaction: { readonly id: string; readonly documentId: string; readonly revision: number },
    replaceSource?: { readonly path: string; readonly format: NativeBitmapFormatId }
  ) => Promise<LightTableSaveResult> | LightTableSaveResult;
  onExportFile?: (file: File) => Promise<LightTableSaveResult> | LightTableSaveResult;
  workspaceDocumentId?: string;
  workspaceDocuments?: ReadonlyArray<{
    id: string;
    title: string;
    dirty?: boolean;
    thumbnailUrl?: string;
    kind?: 'image' | 'video';
    onReveal?: () => Promise<void>;
  }>;
  onActivateWorkspaceDocument?: (documentId: string) => void;
  onCloseWorkspaceDocument?: (documentId: string) => void;
  onRequestNewWorkspaceDocument?: () => void;
  onStartGuidedSample?: () => void;
  onOpenSettings?: () => void;
  onOpenStyleGuide?: () => void;
  onRequestOpenWorkspaceDocument?: (decodeMode: DocumentOpenMode) => Promise<void> | void;
  onRequestPlaceWorkspaceArtifact?: (documentId: string) => Promise<void> | void;
  recentFiles?: readonly LightTableRecentFile[];
  onOpenRecentWorkspaceDocument?: (id: string) => Promise<void> | void;
  onClearRecentWorkspaceDocuments?: () => Promise<void> | void;
  recoveryFiles?: readonly { readonly id: string; readonly label: string }[];
  onOpenRecoveryFile?: (id: string) => Promise<void> | void;
  activeProject?: LightTableProjectSummary | null;
  recentProjects?: readonly LightTableRecentProject[];
  onRequestNewProject?: () => void;
  onRequestOpenProject?: () => void;
  onOpenRecentProject?: (recentId: string) => void;
  onClearRecentProjects?: () => void;
  onCloseProject?: () => void;
  onExitApplication?: () => void;
  onRevealProject?: () => void;
  onOpenWorkspaceDocument?: (file: File, decodeMode: DocumentOpenMode) => void;
  onDocumentReady?: () => void;
  onDocumentOpenFailed?: (message: string) => void;
  onDocumentThumbnailChange?: (thumbnail: Blob) => void;
  onDocumentError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  history?: DocumentCommandHistory;
  tasks: DocumentTaskRegistry;
  rendererLifecycle?: DocumentRendererLifecycle;
  documentSession?: DocumentSession;
  applicationEditorSession?: EditorApplicationSession;
  commandService: LightTableCommandService;
  commandPorts: LightTableCommandPortRegistry;
  imageClipboard?: LightTableImageClipboard;
  recoveryStore?: LightTableRecoveryStore;
  recoveryPreferences?: { readonly enabled: boolean; readonly intervalMs: number };
  onRegisterRecoveryFlush?: (
    documentId: string,
    flush: () => Promise<void>
  ) => (() => void) | void;
  toolPreferences?: {
    readonly zoomWithScrollWheel: boolean;
    readonly openMaskEditingOnDoubleClick: boolean;
    readonly preserveTransformLocalAxes: boolean;
  };
  genAiPreferences?: {
    readonly createProviderId: string;
    readonly editProviderId: string;
  };
  releaseService?: import('../platform/LightTableHost').LightTableReleaseService; hostKind?: import('../platform/LightTableHost').LightTableHost['kind'];
  developerService?: import('../platform/LightTableHost').LightTableHost['developer'];
  hostPresentationService?: import('../platform/LightTableHost').LightTableHost['presentation'];
  genAiService?: import('../platform/LightTableHost').LightTableGenAiService;
  onGenAiGenerationSucceeded?: (job: GenAiGenerationJob) => void;
  onGenAiOpenResult?: (job: GenAiGenerationJob) => void | Promise<unknown>;
  onGenAiOpenAsset?: (asset: import('@lighttable/genai-core').GenAiAssetReference) => void;
  recoveryNotice?: string | null;
  onRecoveryResolved?: () => Promise<void> | void;
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
  documentSurfaceOverride,
  workspaceDocumentKind = 'image',
  workspaceViewControls,
  workspaceVideoControlsPanel,
  workspaceStatusMeta,
  workspaceStatusTitle,
  sourceDecodeMode = 'automatic',
  documentCreationSettings,
  startupTimeline,
  loadSource,
  initialRecipe = null,
  fileNameBase,
  onClose,
  onSave,
  onExportFile,
  onRegisterRecoveryFlush,
  workspaceDocumentId = 'active-document',
  workspaceDocuments,
  onActivateWorkspaceDocument,
  onCloseWorkspaceDocument,
  onRequestNewWorkspaceDocument,
  onStartGuidedSample,
  onOpenSettings,
  onOpenStyleGuide,
  onRequestOpenWorkspaceDocument,
  onRequestPlaceWorkspaceArtifact,
  recentFiles = [],
  onOpenRecentWorkspaceDocument,
  onClearRecentWorkspaceDocuments,
  recoveryFiles = [],
  onOpenRecoveryFile,
  activeProject = null,
  recentProjects = [],
  onRequestNewProject,
  onRequestOpenProject,
  onOpenRecentProject,
  onClearRecentProjects,
  onCloseProject,
  onExitApplication,
  onRevealProject,
  onOpenWorkspaceDocument,
  onDocumentReady,
  onDocumentOpenFailed,
  onDocumentThumbnailChange,
  onDocumentError,
  onDirtyChange,
  history,
  tasks,
  rendererLifecycle: providedRendererLifecycle,
  documentSession,
  applicationEditorSession,
  commandService,
  commandPorts,
  imageClipboard: providedImageClipboard,
  recoveryStore,
  recoveryPreferences,
  toolPreferences,
  genAiPreferences,
  releaseService, developerService, hostPresentationService, genAiService, onGenAiGenerationSucceeded, onGenAiOpenResult, onGenAiOpenAsset, hostKind = 'web',
  recoveryNotice = null,
  onRecoveryResolved
}) => {
  // Ref-owned interaction controllers outlive document-tab switches. They
  // must resolve ownership at commit time instead of capturing the document
  // that was active when the persistent overlay first mounted.
  const workspaceDocumentIdRef = useRef(workspaceDocumentId);
  workspaceDocumentIdRef.current = workspaceDocumentId;
  const openArtProviderId = 'openart' as import('@lighttable/genai-core').GenAiProviderId;
  const editGenAiProviderId = (genAiPreferences?.editProviderId || openArtProviderId) as
    import('@lighttable/genai-core').GenAiProviderId;
  const createGenAiProviderId = (genAiPreferences?.createProviderId || openArtProviderId) as
    import('@lighttable/genai-core').GenAiProviderId;
  // The setup controller starts in text2image mode, so the first provider must be
  // the configured Create provider. Mode changes below deliberately switch to
  // the corresponding Edit/Create provider before loading its workflow.
  const [selectedGenAiProviderId, setSelectedGenAiProviderId] = React.useState(createGenAiProviderId);
  React.useEffect(() => {
    setSelectedGenAiProviderId(createGenAiProviderId);
  }, [createGenAiProviderId]);
  const [genAiProviderSnapshots, setGenAiProviderSnapshots] = React.useState<
    readonly import('@lighttable/genai-core').GenAiProviderSnapshot[]
  >([]);
  const fallbackGenAiProvider: import('@lighttable/genai-core').GenAiProviderSnapshot = {
    id: selectedGenAiProviderId,
    label: selectedGenAiProviderId === 'lighttable-local' ? 'Free Local AI'
      : selectedGenAiProviderId === 'higgsfield' ? 'Higgsfield' : 'OpenArt',
    status: 'disconnected'
  };
  const genAiProvider = genAiProviderSnapshots.find(({ id }) => id === selectedGenAiProviderId)
    ?? fallbackGenAiProvider;
  const openArtProvider = genAiProviderSnapshots.find(({ id }) => id === openArtProviderId)
    ?? { id: openArtProviderId, label: 'OpenArt', status: 'disconnected' as const };
  const updateGenAiProviderSnapshot = React.useCallback((snapshot: import('@lighttable/genai-core').GenAiProviderSnapshot) => {
    setGenAiProviderSnapshots((current) => [
      ...current.filter(({ id }) => id !== snapshot.id), snapshot
    ]);
  }, []);
  React.useEffect(() => {
    if (!genAiService) return;
    let active = true;
    void genAiService.getProviderSnapshots().then((snapshots) => {
      if (active) setGenAiProviderSnapshots(snapshots);
    }).catch((reason) => {
      if (active) updateGenAiProviderSnapshot({
        ...fallbackGenAiProvider,
        status: 'error',
        message: reason instanceof Error ? reason.message : String(reason)
      });
    });
    const unsubscribe = genAiService.subscribe((snapshot) => {
      if (active) updateGenAiProviderSnapshot(snapshot);
    });
    return () => { active = false; unsubscribe(); };
  }, [genAiService, selectedGenAiProviderId, updateGenAiProviderSnapshot]);
  const imageClipboard = providedImageClipboard ?? browserImageClipboard();
  const hostPresentationDeactivateRef = useRef<() => void>(() => undefined);
  const hostPresentationActivity = useEditorHostPresentationActivity(
    active,
    hostPresentationService,
    () => hostPresentationDeactivateRef.current()
  );
  const hostPresentationActive = hostPresentationActivity.active;
  const { registry: textFontRegistry, hydration: documentFontHydration,
    availabilityRevision: fontAvailabilityRevision, resetForOpen: resetDocumentFontsForOpen
  } = useEditorDocumentFonts(documentSession, workspaceDocumentId);
  const {
    history: commandHistory,
    tasks: taskRegistry,
    rendererLifecycle
  } = useDocumentRuntimeServices({
    documentId: workspaceDocumentId as DocumentSessionId,
    active: hostPresentationActive,
    history,
    tasks,
    rendererLifecycle: providedRendererLifecycle,
    onLocalDirtyChange: onDirtyChange
  });
  const historySnapshot = useSyncExternalStore(
    commandHistory.subscribe,
    commandHistory.getSnapshot,
    commandHistory.getSnapshot
  );
  const rendererSnapshot = useSyncExternalStore(
    rendererLifecycle.subscribe,
    rendererLifecycle.getSnapshot,
    rendererLifecycle.getSnapshot
  );
  const [rendererRecoverySequence, setRendererRecoverySequence] = useState(0);
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
  const mountedDocumentSessionRef = useRef(documentSession);
  mountedDocumentSessionRef.current = documentSession;
  const adjustmentPresentationRuntime = useMemo(() => new AdjustmentPresentationRuntime(), []);
  const processingBinding = useMemo(() => new DocumentProcessingBinding(documentSession, adjustmentPresentationRuntime, {
    isCurrent: () => mountedDocumentSessionRef.current === documentSession
      && workspaceDocumentIdRef.current === workspaceDocumentId,
    getRenderer: () => engineRef.current
  }), [documentSession, workspaceDocumentId, adjustmentPresentationRuntime]);
  const groupVisibility = useSyncExternalStore(processingBinding.subscribe, processingBinding.getGroupVisibility);
  useEffect(() => {
    if (documentSession) bindDocumentGpuResourceLifetime(documentSession);
  }, [documentSession]);
  const {
    presentedDocumentId: presentedWorkspaceDocumentId,
    residentDocumentId: residentWorkspaceDocumentId,
    publishCompositeRendered,
    publishInitialThumbnail: publishDocumentThumbnail
  } = useWorkspaceDocumentPresentation({
    documentId: workspaceDocumentId,
    active: hostPresentationActive,
    retainResidentPresentation: hostPresentationActivity.retainResidentPresentation,
    rendererGeneration: rendererSnapshot.generation,
    rendererLifecycle,
    rendererRef: engineRef,
    publishThumbnail: onDocumentThumbnailChange
  });
  const adjustmentPresentationStore = processingBinding.presentationStore;
  const adjustmentPresentation = processingBinding.presentation;
  const publishAdjustmentPresentation = processingBinding.publishPresentation;
  const resetAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetActiveAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetDocumentTransactionRef = useRef<() => Promise<void>>(async () => undefined);
  const resetFaceWarpSessionRef = useRef<() => void>(() => undefined);
  const [fontHydrationPending, setFontHydrationPending] = useState(false);
  const paintGestureRef = useRef(new PaintGestureController());
  const resetPaintSessionRef = useRef<() => void>(() => undefined);
  const selectionGestureRef = useRef(new SelectionGestureController());
  const commitTransformRef = useRef<() => void>(() => undefined);
  const commitTransformPendingRef = useRef<() => Promise<void>>(async () => undefined);
  const settlePixelInteractionRef = useRef<(isCurrent: () => boolean) => Promise<void>>(async () => undefined);
  const cancelTransformRef = useRef<() => void>(() => undefined);
  const resetTransformRef = useRef<() => void>(() => undefined);
  const transformActiveRef = useRef<() => boolean>(() => false);
  const repeatTransformRef = useRef<(duplicate?: boolean) => void>(() => undefined);
  const nudgeTransformRef = useRef<(x: number, y: number) => void>(() => undefined);
  const applyFixedTransformRef = useRef<(operation: FixedTransformOperation) => Promise<unknown>>(
    async () => null
  );
  const fixedTransformCommandRunningRef = useRef(false);
  const finishPenPathRef = useRef<() => void>(() => undefined);
  const cancelPenPathRef = useRef<() => boolean>(() => false);
  const undoPenAnchorRef = useRef<() => boolean>(() => false);
  const activateToolRef = useRef<(tool: ToolId) => void>(() => undefined);
  const persistentToolActivationRef = useRef(new PersistentToolActivationOwner());
  const cancelAutoAlignRef = useRef<() => void>(() => undefined);
  const cutSelectedContentRef = useRef<() => void>(() => undefined);
  const copySelectedContentRef = useRef<() => void>(() => undefined);
  const copyMergedContentRef = useRef<() => void>(() => undefined);
  const pasteSelectedContentRef = useRef<() => void>(() => undefined);
  const latestGradeClipboardArtifactRef = useRef<string | null>(null);
  const layerViaCopyRef = useRef<() => void>(() => undefined);
  const mergeActiveLayerDownRef = useRef<() => void>(() => undefined);
  const applyCurvesRef = useRef<() => void>(() => undefined);
  const applyAdjustmentRef = useRef<(kind: AdjustmentLayerKind) => void>(() => undefined);
  const executeAdjustmentCreationRef = useRef<(
    command: SemanticAdjustmentCreationCommand
  ) => unknown>(() => null);
  const rasterizeShapeRef = useRef<(
    transaction: VectorElementCreationTransaction,
    rendererGeneration: number
  ) => Promise<boolean>>(async () => false);
  const selectedLayerIdsRef = useRef<LayerId[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<LayerId[]>([]);
  const toggleSelectedLayerVisibilityRef = useRef<() => void>(() => undefined);
  const showAllLayersRef = useRef<() => void>(() => undefined);
  const [transformActivationRevision, setTransformActivationRevision] = useState(0);
  const layerNameRenameGestureControllerRef = useRef(new LayerNameRenameGestureController());
  const handleLayerNamePointerDown = useCallback((layerId: LayerId, activeLayerId: LayerId | null) => {
    layerNameRenameGestureControllerRef.current.begin(layerId, activeLayerId, performance.now());
  }, []);
  const consumeLayerNameRenameGesture = useCallback((layerId: LayerId) =>
    layerNameRenameGestureControllerRef.current.consume(layerId, performance.now()), []);
  const cancelLayerNameRenameGesture = useCallback(() =>
    layerNameRenameGestureControllerRef.current.cancel(), []);
  const invertActiveLayerColorsRef = useRef<() => void>(() => undefined);
  const fillActiveTargetRef = useRef<(
    color: string,
    preserveTransparency?: boolean
  ) => void>(() => undefined);
  const deleteActiveTargetRef = useRef<() => void>(() => undefined);
  const temporaryTool = useTemporaryTool(() => engineRef.current?.setZoomEditingOverlay(null));
  const beginSelectionContentMoveRef = useRef<(duplicate: boolean) => Promise<boolean>>(
    async () => false
  );
  const updateSelectionContentMoveRef = useRef<(x: number, y: number) => void>(() => undefined);
  const finishSelectionContentMoveRef = useRef<(commit: boolean) => void>(() => undefined);
  const scopeSettingsRef = useRef<ScopeSettings>({ ...DEFAULT_SCOPE_SETTINGS });
  const scopeVisibilityRef = useRef<ScopeVisibility>({ ...DEFAULT_SCOPE_VISIBILITY });
  const startupTelemetryRef = useRef(new DocumentStartupTelemetry());
  const workspaceRef = useRef<LightTableDockWorkspaceHandle | null>(null);
  const [workspacePanels, setWorkspacePanels] = useState<readonly WorkspacePanelVisibility[]>([]);
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
  const [metadata, setMetadata] = useState<LightTableImageMetadata | null>(
    () => documentSession?.getSnapshot().loadedSource.metadata ?? null
  );
  const [histogram, setHistogram] = useState<RgbHistogram | null>(null);
  const histogramPublicationRef = useRef<LatestFrameValueScheduler<RgbHistogram> | null>(null);
  useEffect(() => {
    const publication = new LatestFrameValueScheduler<RgbHistogram>(setHistogram);
    histogramPublicationRef.current = publication;
    return () => {
      if (histogramPublicationRef.current === publication) histogramPublicationRef.current = null;
      publication.dispose();
    };
  }, []);
  const publishHistogram = useCallback((next: RgbHistogram) => {
    histogramPublicationRef.current?.schedule(next);
  }, []);
  const resetHistogram = useCallback(() => {
    histogramPublicationRef.current?.cancel();
    setHistogram(null);
  }, []);
  const {
    zoomMode,
    setZoomMode,
    view,
    setView,
    setViewport
  } = useDocumentViewportState(documentSession);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [documentSurfaceRevision, setDocumentSurfaceRevision] = useState(0);
  const handleDocumentSurfaceReady = useCallback(() => {
    setDocumentSurfaceRevision((current) => current + 1);
  }, []);
  const [loading, setLoading] = useState(false);
  const {
    notifications: editorNotifications,
    status: gradeStatus,
    error,
    dismiss: dismissEditorNotification,
    setStatus: setGradeStatus,
    setError
  } = useEditorNotifications(workspaceDocumentId);
  const reportInteractionTransitionFailureRef = useRef(setError);
  reportInteractionTransitionFailureRef.current = setError;
  const interactionTransitionCoordinatorRef = useRef<
    ReturnType<typeof createInteractionTransitionCoordinator> | null
  >(null);
  if (!interactionTransitionCoordinatorRef.current) {
    interactionTransitionCoordinatorRef.current = createInteractionTransitionCoordinator({
      settleMountedInteraction: isCurrent => settlePixelInteractionRef.current(isCurrent),
      reportFailure: (message) => reportInteractionTransitionFailureRef.current(message)
    });
  }
  const interactionTransitions = interactionTransitionCoordinatorRef.current;
  const currentRendererLifecycleRef = useRef(rendererLifecycle);
  currentRendererLifecycleRef.current = rendererLifecycle;
  const captureMountedInteractionScope = useCallback(() => captureInteractionScope({
    getWorkspaceId: () => workspaceDocumentIdRef.current,
    getLifecycleIdentity: () => currentRendererLifecycleRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => currentRendererLifecycleRef.current.getSnapshot().generation
  }), []);
  const mountedDocumentAdmission = useMemo(() => new MountedDocumentAdmission({
    getSession: () => mountedDocumentSessionRef.current, getRenderer: () => engineRef.current,
    getImageDocument: () => imageDocumentRef.current,
    captureScope: captureMountedInteractionScope, transitions: interactionTransitions,
    reportFailure: message => reportInteractionTransitionFailureRef.current(message)
  }), [captureMountedInteractionScope, interactionTransitions]);
  const settleMountedDocumentInteraction = mountedDocumentAdmission.settle;
  const svgImportInputRef = useRef<HTMLInputElement | null>(null);
  const agentEvents = useAgentActivity(commandService, workspaceDocumentId);
  const actionRecording = useSyncExternalStore(
    commandService.subscribeActionRecording,
    commandService.actionRecordingSnapshot,
    commandService.actionRecordingSnapshot
  );
  const actionPlayback = useSyncExternalStore(
    commandService.subscribeActionPlayback,
    commandService.actionPlaybackSnapshot,
    commandService.actionPlaybackSnapshot
  );
  const actionLibrary = useSyncExternalStore(
    commandService.subscribeActionLibrary,
    commandService.actionLibrarySnapshot,
    commandService.actionLibrarySnapshot
  );
  const executeRegisteredCommand = useCallback((
    command: LightTableCommandId,
    parameters: unknown,
    reportError: ((message: string) => void) | null = setError
  ) => {
    const requestId = `ui-${workspaceDocumentId}-${++commandRequestSequenceRef.current}`;
    const execution = commandService.execute({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId,
      command,
      ...commandDocumentTarget(command, workspaceDocumentId),
      parameters
    });
    void execution.then((result) => {
      if (result.status === 'rejected') reportError?.(result.message);
    }).catch((reason: unknown) => {
      reportError?.(reason instanceof Error ? reason.message : 'The command could not be completed.');
    });
    return execution;
  }, [commandService, workspaceDocumentId]);
  const [showDifference, setShowDifference] = useState(false);
  const [isolatedMaskLayerId, setIsolatedMaskLayerId] = useState<LayerId | null>(null);
  const [isolatedCompositeChannel, setIsolatedCompositeChannel] =
    useState<CompositeColorChannel | null>(null);
  const [sourceName, setSourceName] = useState(
    () => documentSession?.getSnapshot().loadedSource.name ?? fileNameBase
  );
  const publishDocumentAdjustmentsState = processingBinding.publishDocumentAdjustments;
  const publishGroupVisibilityState = processingBinding.publishGroupVisibility;
  const [shiftPressed, setShiftPressed] = useState(false);
  const [altPressed, setAltPressed] = useState(false);
  const [preciseBrushCursor, setPreciseBrushCursor] = useState(false);
  const [scopeSettings, setScopeSettings] = useState<ScopeSettings>({ ...DEFAULT_SCOPE_SETTINGS });
  const [scopeVisibility, setScopeVisibility] = useState<ScopeVisibility>({ ...DEFAULT_SCOPE_VISIBILITY });
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [psdImportInfo, setPsdImportInfo] = useState<PsdDecodeSuccess | null>(null);
  const [psdDifferenceMetrics, setPsdDifferenceMetrics] = useState<ReferenceDifferenceMetrics | null>(null);
  const [psdCompatibility, setPsdCompatibility] = useState<PsdImportCompatibilityEntry[]>([]);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(
    () => documentSession?.getSnapshot().loadedSource.blob ?? null
  );
  const [sourceIdentity, setSourceIdentity] = useState(
    () => documentSession?.getSnapshot().loadedSource.identity ?? ''
  );
  const [pointColorRangeVisualization, setPointColorRangeVisualization] = useState<{
    readonly ownerId: string | null;
    readonly sample: PointColorSample;
  } | null>(null);
  const [lensBlurViewportMode, setLensBlurViewportModeState] = useState<LensBlurViewportMode>('result');
  const [imageDocument, setImageDocument, imageDocumentRef] =
    useDocumentImageState(documentSession);
  const loadedSourceScopeRef = useRef({ documentSession, workspaceDocumentId });
  loadedSourceScopeRef.current = { documentSession, workspaceDocumentId };
  const loadedSourceBinding = useMemo(() => new DocumentLoadedSourceBinding(documentSession, documentFontHydration, {
    isCurrent: () => loadedSourceScopeRef.current.documentSession === documentSession
      && loadedSourceScopeRef.current.workspaceDocumentId === workspaceDocumentId,
    getDocument: () => imageDocumentRef.current,
    metadata: setMetadata,
    source: (name, blob, identity) => {
      setSourceName(name); setSourceBlob(blob); setSourceIdentity(identity);
    },
    fontPending: setFontHydrationPending,
    fontError: setError
  }), [documentSession, documentFontHydration, workspaceDocumentId, imageDocumentRef, setError]);
  useEffect(loadedSourceBinding.connect, [loadedSourceBinding]);
  const activePresentationRef = useRef(active);
  activePresentationRef.current = active;
  const attachColorMixerHueCanvas = useDocumentScopeCanvases({
    renderer: engineRef,
    canvases: { viewport: canvasRef, hueDistribution: hueDistributionCanvasRef,
      colorMixerHueDistribution: colorMixerHueCanvasRef, parade: paradeCanvasRef, vectorscope: vectorscopeCanvasRef },
    ready: rendererSnapshot.status === 'ready', generation: rendererSnapshot.generation,
    lifecycle: rendererLifecycle, surfaceRevision: documentSurfaceRevision,
    captureScope: captureMountedInteractionScope, reportError: setScopeError
  });
  useEffect(() => {
    if (workspaceDocumentKind === 'image') return;
    // The application shell is retained across document kinds, but image
    // presentation must not leak into a video/model binding. Canonical image
    // data remains owned by its DocumentSession and is rebound when its tab
    // becomes active again.
    imageDocumentRef.current = null;
    setImageDocument(null);
    setMetadata(null);
    setSourceBlob(null);
    setSourceIdentity('');
  }, [setImageDocument, workspaceDocumentKind]);
  const loadDocumentPalette = useDocumentPalette(engineRef, imageDocumentRef), loadLayerPalette = useLayerPalette(engineRef, imageDocumentRef);
  const { owner: propertiesPresentation, target: propertiesTarget,
    targetRef: propertiesTargetRef, show: showProperties } = usePropertiesInspectorPresentation(
    documentSession, engineRef.current, rendererSnapshot.generation, imageDocument, () => {
      const scope = captureMountedInteractionScope(), workspace = workspaceRef.current;
      return { isCurrent: () => scope.isCurrent() && workspaceRef.current === workspace,
        reveal: () => workspace?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.properties) };
    });
  const propertiesView = propertiesInspectorView(imageDocument, propertiesTarget);
  // Provider/model choices belong to the project, while Image Edit dimensions
  // follow the active document identity and canvas size.
  const activeGenAiProjectId = activeProject?.id;
  const genAiDocumentContext = React.useMemo(() => imageDocument ? ({
    id: String(workspaceDocumentId),
    revision: documentSession?.getSnapshot().documentRevision ?? imageDocument.revision,
    width: imageDocument.width,
    height: imageDocument.height
  }) : undefined, [documentSession, imageDocument?.height, imageDocument?.revision,
    imageDocument?.width, workspaceDocumentId]);
  const genAiSetup = useGenAiSetupController(
    genAiService,
    genAiProvider,
    activeGenAiProjectId,
    { presentation: genAiDocumentContext,
      readCurrent: () => workspaceDocumentKind === 'image'
        ? readGenAiDocumentContext(mountedDocumentSessionRef.current) : undefined }
  );
  const genAiReferences = useGenAiReferenceHandoff({
    context: { projectId: activeGenAiProjectId, documentId: workspaceDocumentId, active,
      selectedMode: genAiSetup.selectedMode, workflow: genAiSetup.workflow,
      imageEditReady: genAiSetup.workflow?.mode === 'image2image'
        && genAiSetup.workflow.fields.some(({ kind }) => kind === 'asset') },
    workspaceDocuments: workspaceDocuments ?? [{ id: workspaceDocumentId, kind: workspaceDocumentKind }],
    status: rendererSnapshot.status, commandPorts,
    getSession: () => mountedDocumentSessionRef.current,
    getRenderer: () => engineRef.current, getImageDocument: () => imageDocumentRef.current,
    captureScope: captureMountedInteractionScope, captureImport: genAiSetup.captureAssetReferenceImport,
    activateDocument: id => activateWorkspaceDocument(id), reportError: setError
  });
  const genAiJobs = useGenAiJobsController(
    genAiService,
    activeGenAiProjectId,
    onGenAiGenerationSucceeded,
    genAiProvider.status
  );
  const [faceWarpSemanticTarget, setFaceWarpSemanticTarget] =
    useState<FaceWarpSemanticTarget>('both');
  const [faceWarpProtectedFeature, setFaceWarpProtectedFeature] =
    useState<FaceWarpProtectedFeature>('eyes');
  const [thumbnailDocumentReadyId, setThumbnailDocumentReadyId] = useState<string | null>(null);
  const [editorSession, setEditorSession, readEditorSession] = useDocumentEditorSession(
    documentSession,
    applicationEditorSession
  );
  const editorSessionRef = useRef(editorSession);
  editorSessionRef.current = editorSession;
  const gradientToolSettings = editorSession.gradient;
  const [gradientEditorRequest, setGradientEditorRequest] = useState<{
    revision: number;
    endpoint: 'start' | 'end';
  } | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionShape | null>(null);
  const [cropBounds, setCropBounds] = useState<Rect | null>(null);
  const editorDialogs = useEditorDialogController();
  const [duplicateImageBusy, setDuplicateImageBusy] = useState(false);
  const [duplicateImageError, setDuplicateImageError] = useState<string | null>(null);
  const [selectionClipboardAvailable, setSelectionClipboardAvailable] = useState(false);
  const temporaryPanActive = temporaryTool.snapshot.tool === 'view';
  const temporaryZoomActive = temporaryTool.snapshot.tool === 'zoom';
  const temporaryZoomOutActive = temporaryTool.snapshot.zoomOut;
  const [selectionSnapFeedback, setSelectionSnapFeedback] = useState<{
    matches: readonly SnapMatch[];
    bounds: Rect | null;
  }>({ matches: [], bounds: null });
  const [startupTimings, setStartupTimings] = useState<LightTableStartupTimings | null>(null);
  const [gpuMemoryBytes, setGpuMemoryBytes] = useState(0);
  const { owner: textRenderPresentationOwner, snapshot: textRenderPresentation } = useTextRenderPresentation();
  const [accessoryWidthConstraintsEnabled, setAccessoryWidthConstraintsEnabled] = useState(true);
  const [editorResizeObserversEnabled, setEditorResizeObserversEnabled] = useState(true);
  const [toolOptionsMenu, setToolOptionsMenu] = useState<{ x: number; y: number } | null>(null);
  const textCreationInteraction = useTextCreation(documentSession ?? workspaceDocumentId,
    editorSession.activeTool, rendererSnapshot.generation, textFontRegistry, {
    getDocument: () => imageDocumentRef.current,
    getTool: () => editorSessionRef.current.activeTool,
    getSettings: () => editorSessionRef.current.text,
    getColor: () => editorSessionRef.current.brush.color,
    getScale: () => activeScale,
    getRenderer: () => engineRef.current,
    rendererReady: () => currentRendererLifecycleRef.current.getSnapshot().status === 'ready',
    getFontRuntime: () => textFontRuntimePort,
    getFontRegistry: () => textFontRegistry,
    getFonts: () => textFontRegistry.availableAssets,
    prepareFont: settings => registerBundledTextFontForSettings(textFontRegistry, settings),
    probe: () => lightTableTextEngine.probe(),
    captureScope: captureMountedInteractionScope,
    execute: parameters => executeRegisteredCommand('text.create', parameters),
    beginEditing: layerId => { textEditingController.begin(layerId); textEditingController.selectAll(); },
    setStatus: setGradeStatus,
    reportFailure: reason => setError(reason instanceof Error ? reason.message : String(reason))
  });
  const finishTextEditingRef = useRef<() => boolean>(() => false);
  const { exportNativeArtifactRef, exportPngArtifactRef, exportBitmapArtifactRef,
    exportPreviewArtifactRef, exportPsdArtifactRef } = useEditorArtifactExportRefs();
  const textPropertyGestureControllerRef = useRef<TextPropertyGestureController | null>(null);
  const selectLayerRef = useRef<(layerId: LayerId) => void | Promise<void>>(() => undefined);
  const paragraphTextCreation = useSyncExternalStore(
    textCreationInteraction.subscribe,
    textCreationInteraction.getSnapshot,
    textCreationInteraction.getSnapshot
  );
  const copiedGrade = useLightTableGradeClipboard();
  const brushPercentInputRef = useRef(new BrushPercentInput());

  useEffect(() => () => {
    textEditingControllerRef.current?.finish();
  }, []);


  useEffect(() => {
    temporaryTool.clear();
    textEditingControllerRef.current?.reset();
    setAltPressed(false);
    brushPercentInputRef.current.clear();
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

  const viewportMetadata = useMemo(() => metadata ? {
    ...metadata,
    width: imageDocument?.width ?? metadata.width,
    height: imageDocument?.height ?? metadata.height
  } : null, [imageDocument?.height, imageDocument?.width, metadata]);
  const fitScale = useMemo(() => {
    if (!viewportMetadata) return 1;
    return Math.min(
      viewportSize.width / viewportMetadata.width,
      viewportSize.height / viewportMetadata.height
    ) * 0.94;
  }, [viewportMetadata, viewportSize.height, viewportSize.width]);
  const activeScale = zoomMode === 'fit' ? fitScale : zoomMode === '100' ? 1 : view.scale;
  const imageRect = useMemo(() => resolveViewportImageRect(
    viewportMetadata?.width ?? 1,
    viewportMetadata?.height ?? 1,
    viewportSize.width,
    viewportSize.height,
    activeScale,
    view.panX,
    view.panY
  ), [activeScale, viewportMetadata, view.panX, view.panY, viewportSize.height, viewportSize.width]);
  const {
    dockResizeActiveRef,
    handleDockResizeInteractionChange
  } = useEditorResizeController({
    open,
    active,
    documentSurfaceRevision,
    observersEnabled: editorResizeObserversEnabled,
    rendererReady: rendererSnapshot.status === 'ready',
    hasMetadata: Boolean(metadata),
    viewportRef,
    canvasRef,
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
    get loadedByteSize() { return textFontRegistry.byteSize; },
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
  useTextRenderPresentationDiagnostics(textRenderPresentationOwner, appendDebugMessage);
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
  useEffect(() => {
    if (!isPaintTool(editorSession.activeTool)) return;
    try {
      engineRef.current?.preparePaintTool();
    } catch (reason) {
      setError(reason instanceof Error
        ? `The paint engine could not be prepared: ${reason.message}`
        : 'The paint engine could not be prepared.');
    }
  }, [editorSession.activeTool, thumbnailDocumentReadyId]);
  useEffect(() => {
    if (editorSession.activeTool !== 'select-magic-wand') return;
    let current = true;
    void engineRef.current?.prepareMagicWandTool().catch((reason) => {
      if (!current) return;
      setError(reason instanceof Error
        ? `The Magic Wand engine could not be prepared: ${reason.message}`
        : 'The Magic Wand engine could not be prepared.');
    });
    return () => { current = false; };
  }, [editorSession.activeTool, thumbnailDocumentReadyId]);
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
    () => createDocumentProjectionBinding({
      presentation: adjustmentPresentation,
      getPropertiesTarget: () => propertiesTargetRef.current,
      resetActiveAdjustmentPreview: () => resetActiveAdjustmentTransactionRef.current(),
      getDocument: () => imageDocumentRef.current,
      publishDocument: (document) => {
        imageDocumentRef.current = document;
        setImageDocument(document);
      },
      getDocumentAdjustments: () => processingBinding.getDocumentAdjustments(),
      publishDocumentAdjustments: (nextAdjustments) => {
        publishDocumentAdjustmentsState(nextAdjustments);
      },
      publishEditorAdjustments: (nextAdjustments, domain) => {
        publishAdjustmentPresentation(nextAdjustments, domain);
      },
      stageEditorAdjustments: (nextAdjustments) => {
        processingBinding.stageEditorAdjustments(nextAdjustments);
      },
      getGroupVisibility: () => processingBinding.getGroupVisibility(),
      publishGroupVisibility: (visibility) => {
        publishGroupVisibilityState(visibility);
      },
      publishRendererDocument: (document) => {
        engineRef.current?.setDocument(document);
      },
      publishRendererAdjustments: (nextAdjustments) => {
        engineRef.current?.setAdjustments(nextAdjustments);
      }
    }),
    [adjustmentPresentation, processingBinding, publishAdjustmentPresentation, setImageDocument]
  );
  const applyAdjustmentSnapshot = documentProjectionController.applyAdjustmentSnapshot;
  const previewAdjustmentSnapshot = documentProjectionController.previewAdjustmentSnapshot;

  const finishOpenHistoryTransactions = () => settleHistoryInteractions({
    assertCurrent: captureMountedInteractionScope().assertCurrent,
    settlePixels: settleMountedDocumentInteraction,
    commitPointCreation: textCreationInteraction.commitPoint,
    commitParagraphCreation: textCreationInteraction.commitParagraph,
    finishTextEditing: finishTextEditingRef.current,
    resetAdjustment: resetAdjustmentTransactionRef.current,
    resetDocumentTransaction: resetDocumentTransactionRef.current
  });

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
  const applyCanonicalAdjustmentProjection = documentProjectionController.applyCanonicalAdjustmentProjection;

  const documentSelectionPublication = useMemo(() => new DocumentSelectionPublicationBinding(documentSession, {
    isSessionCurrent: () => mountedDocumentSessionRef.current === documentSession,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => currentRendererLifecycleRef.current.getSnapshot().generation,
    applyDocumentSnapshot,
    publishEditorProjection: (next) => {
      editorSessionRef.current = {
        ...editorSessionRef.current, pointerId: null, selection: [...next.selection],
        selectionMaskSnapshot: next.coverage, selectionRevision: next.selectionRevision,
        selectionSupportBounds: next.supportBounds
      };
    }
  }), [applyDocumentSnapshot, documentSession]);
  const publishDocumentSelection = documentSelectionPublication.publishSurface;
  const documentSurfaceHistory = useMemo(() => new DocumentSurfaceHistoryBinding(documentSession, {
    isSessionCurrent: () => mountedDocumentSessionRef.current === documentSession,
    getRenderer: () => engineRef.current,
    getGeneration: () => currentRendererLifecycleRef.current.getSnapshot().generation,
  }), [documentSession]);

  const isDocumentMutationBlocked = () => commandHistory.getSnapshot().busy
    || (documentSession ? !documentSession.isAcceptingMutations() : false);
  const documentMutationController = useDocumentMutationController({
    getDocument: () => imageDocumentRef.current,
      applySnapshot: applyDocumentSnapshot,
      previewSnapshot: documentProjectionController.previewDocumentSnapshot,
      discardPreview: documentProjectionController.discardDocumentPreview,
      pushHistoryEntry,
    isMutationBlocked: isDocumentMutationBlocked
  });
  const captureFaceWarpScope = useFaceWarpScope(documentSession, captureMountedInteractionScope);
  const faceWarpDetectionControllerRef = useRef<FaceWarpDetectionReviewController | null>(null);
  faceWarpDetectionControllerRef.current ??= new FaceWarpDetectionReviewController(() => ({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    captureScope: captureFaceWarpScope,
    changeDocument: documentMutationController.change,
    createId: (kind) => `${kind}-${crypto.randomUUID()}`,
    setStatus: setGradeStatus,
    setError
  }));
  const faceWarpDetectionController = faceWarpDetectionControllerRef.current;
  const faceWarpDetection = useSyncExternalStore(
    faceWarpDetectionController.subscribe,
    faceWarpDetectionController.getSnapshot,
    faceWarpDetectionController.getSnapshot
  );
  const {
    busy: faceWarpBusy,
    meshVisible: faceWarpMeshVisible
  } = faceWarpDetection;
  const faceWarpSessionControllerRef = useRef<ReturnType<
    typeof createFaceWarpInteractionSessionController
  > | null>(null);
  faceWarpSessionControllerRef.current ??= createFaceWarpInteractionSessionController(() => ({
    getDocument: () => imageDocumentRef.current,
    documentMutations: documentMutationController,
    acquireRendererBinding: () => {
      const renderer = engineRef.current;
      if (!renderer) return null;
      const scope = captureFaceWarpScope();
      return {
        isCurrent: scope.isCurrent,
        setMode: (mode) => renderer.setFaceWarpInteractionMode(mode)
      };
    },
    setError
  }));
  const faceWarpSessionController = faceWarpSessionControllerRef.current;
  resetFaceWarpSessionRef.current = faceWarpSessionController.reset;
  const layerDocumentInteractions = useLayerDocumentInteractionOwner(() => {
    const textProperties = textPropertyGestureControllerRef.current;
    if (!textProperties) throw new Error('Text property interaction owner is not initialized.');
    return {
      mutations: documentMutationController,
      assertCurrent: captureMountedInteractionScope().assertCurrent,
      resetFaceWarp: resetFaceWarpSessionRef.current,
      cancelTextProperties: () => { textProperties.cancelDocumentGesture(); },
      commitTextProperties: () => textProperties.commitDocumentGesture()
    };
  });
  resetDocumentTransactionRef.current = layerDocumentInteractions.resetForHistory;
  const commitActiveDocumentTransaction = layerDocumentInteractions.commitActive;
  const pushDocumentHistory = documentMutationController.record;
  const beginLayerDocumentTransaction = layerDocumentInteractions.begin;
  const changeLayerDocument = layerDocumentInteractions.change;
  const commitLayerDocumentTransaction = layerDocumentInteractions.commit;
  const cancelLayerDocumentTransaction = layerDocumentInteractions.cancel;
  const p0FilterController = useP0FilterController({
    document: imageDocument,
    target: propertiesTarget,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    documentMutations: documentMutationController,
    rendererGeneration: rendererSnapshot.generation,
    onCheckpoint: (_before, after, target) => recordFilterSnapshotCheckpoint(
      commandService, workspaceDocumentId as DocumentSessionId, after, target
    )
  });
  const activeFilterCenter = (() => {
    const model = p0FilterController.model;
    if (!model?.enabled) return null;
    const controls = filterDefinition(model.kind).controls;
    if (!controls.some(({ key }) => key === 'center.x')
      || !controls.some(({ key }) => key === 'center.y')) return null;
    const center = (model.settings as unknown as { center?: { x?: unknown; y?: unknown } }).center;
    const x = Number(center?.x);
    const y = Number(center?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  })();

  const faceWarpView = useMemo(() => resolveFaceWarpView(imageDocument, faceWarpDetection),
    [imageDocument, faceWarpDetection]);
  const {
    source: currentFaceWarpReviewSource,
    pending: pendingFaceWarpDetectionForActiveLayer,
    faces: visibleFaceWarpFaces,
    selectedFaceId: effectiveFaceWarpFaceId
  } = faceWarpView;
  const faceWarpIntents = useFaceWarpIntents(faceWarpSessionController, faceWarpDetectionController,
    documentSession, engineRef.current, rendererSnapshot.generation, rendererLifecycle, captureMountedInteractionScope,
    () => ({ document: imageDocumentRef.current, brush: readEditorSession().brush,
      target: faceWarpSemanticTarget }), setError);
  useFaceWarpLifecycle(faceWarpSessionController, faceWarpDetectionController, documentSession,
    rendererLifecycle, rendererSnapshot.generation, editorSession.activeTool === 'face-warp', currentFaceWarpReviewSource);
  const detectFacesForActiveLayer = () => faceWarpDetectionController.detect();
  const acceptPendingFaceWarpDetection = () => faceWarpDetectionController.accept();
  const cancelPendingFaceWarpDetection = faceWarpIntents.cancelReview;
  const changeFaceWarpMeshVisible = faceWarpDetectionController.setMeshVisible;
  const updateFaceWarpParameters = faceWarpIntents.properties.parameters;
  const updateFaceWarpProtection = faceWarpIntents.properties.protection;
  const resetSelectedFaceWarp = faceWarpIntents.properties.reset;
  const beginFaceWarpGesture = faceWarpIntents.gesture.begin;
  const moveFaceWarpGesture = faceWarpIntents.gesture.move;
  const finishFaceWarpGesture = faceWarpIntents.gesture.finish;
  const cancelFaceWarpGesture = faceWarpIntents.gesture.cancel;
  useFaceWarpMeshPresentation(engineRef.current, documentSession, rendererSnapshot.generation,
    rendererLifecycle, captureMountedInteractionScope, {
      active: editorSession.activeTool === 'face-warp', visible: faceWarpMeshVisible, view: faceWarpView
    });

  const documentSurfaceCommands = new DocumentSurfaceCommandService({
    session: documentSession,
    mutations: documentMutationController,
    captureScope: captureMountedInteractionScope,
    settleInteraction: finishOpenHistoryTransactions,
    getRenderer: () => engineRef.current,
    getDocument: () => imageDocumentRef.current,
    getSelection: () => editorSessionRef.current,
    publication: {
      publishDocumentSelection,
      pushHistoryEntry,
      publishHistoryState: documentSurfaceHistory.publish
    }
  });
  const presentSurfaceEdit = (changed: boolean) => {
    if (changed) {
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
    }
    return changed;
  };
  const commitImageSize = async (request: ImageSizeRequest) => {
    const changed = await documentSurfaceCommands.resizeImage(request);
    editorDialogs.closeImageSize();
    return presentSurfaceEdit(changed);
  };
  const commitDocumentGeometry = async (request: DocumentGeometryRequest) => {
    const changed = await documentSurfaceCommands.applyGeometry(request);
    editorDialogs.closeCanvasSize();
    return presentSurfaceEdit(changed);
  };
  const runImageSizeCommand = (request: ImageSizeRequest) => {
    void executeRegisteredCommand('document.resizeImage', request);
  };
  const runDocumentGeometryCommand = (request: DocumentGeometryRequest) => {
    void executeRegisteredCommand('document.applyGeometry', request);
  };
  const beginCrop = () => {
    void beginDocumentCrop({
      session: documentSession,
      captureScope: captureMountedInteractionScope,
      settleInteraction: finishOpenHistoryTransactions,
      applySelectionCrop: bounds => runDocumentGeometryCommand({ operation: 'crop', bounds }),
      presentInteractiveCrop: setCropBounds
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Crop could not be prepared.');
    });
  };
  const cancelCrop = () => setCropBounds(null);
  const commitCrop = () => {
    if (!cropBounds) return;
    const bounds = { ...cropBounds };
    setCropBounds(null);
    runDocumentGeometryCommand({ operation: 'crop', bounds });
  };
  const positionedTextRecoveryControllerRef = useRef<PositionedTextRecoveryCommandController | null>(null);
  positionedTextRecoveryControllerRef.current ??= new PositionedTextRecoveryCommandController(() => ({
    getDocument: () => imageDocumentRef.current,
    documentMutations: documentMutationController
  }));
  const positionedTextRecoveryController = positionedTextRecoveryControllerRef.current;
  const textEditingPortsRef = useRef({
    commandService,
    documentMutations: documentMutationController,
    reportError: setError
  });
  textEditingPortsRef.current = {
    commandService,
    documentMutations: documentMutationController,
    reportError: setError
  };
  const textEditingControllerRef = useRef<FlowTextEditingSessionController | null>(null);
  textEditingControllerRef.current ??= new FlowTextEditingSessionController(() => ({
    getDocument: () => imageDocumentRef.current,
    documentMutations: textEditingPortsRef.current.documentMutations,
    onCommitted: (entry) => {
      const ports = textEditingPortsRef.current;
      if (entry.semanticReplacement) {
        ports.commandService.recordObservedCommand(
          'text.replaceRange',
          workspaceDocumentIdRef.current as DocumentSessionId,
          entry.semanticReplacement,
          { layerId: entry.semanticReplacement.layerId }
        );
      }
    },
    reportError: (message) => textEditingPortsRef.current.reportError(message),
    requestPreviewFrame: (callback) => window.requestAnimationFrame(callback),
    cancelPreviewFrame: (frame) => window.cancelAnimationFrame(frame)
  }));
  const textEditingController = textEditingControllerRef.current;
  textPropertyGestureControllerRef.current ??= new TextPropertyGestureController(() => ({
    getDocument: () => imageDocumentRef.current,
    getCommandDocumentId: () => workspaceDocumentIdRef.current as DocumentSessionId,
    documentMutations: textEditingPortsRef.current.documentMutations,
    textEditing: textEditingController,
    recordObservedCommand: (commandId, documentId, parameters, result) => {
      textEditingPortsRef.current.commandService.recordObservedCommand(
        commandId, documentId, parameters, result
      );
    },
    reportError: (message) => textEditingPortsRef.current.reportError(message),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frame) => window.cancelAnimationFrame(frame)
  }));
  const textPropertyGestureController = textPropertyGestureControllerRef.current;
  const textToShape = useTextToShape({
    lifecycle: rendererLifecycle, generation: rendererSnapshot.generation,
    getSession: () => mountedDocumentSessionRef.current, getRenderer: () => engineRef.current,
    getProjectedDocument: () => imageDocumentRef.current, captureScope: captureMountedInteractionScope,
    documentMutations: documentMutationController, text: textPropertyGestureController,
    creation: textCreationInteraction, dialogs: editorDialogs,
    execute: (documentId, layerId, expectedDocumentRevision) => commandService.execute({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId: `ui-${documentId}-${++commandRequestSequenceRef.current}`,
      documentId, expectedDocumentRevision, command: 'text.convertToShape', parameters: { layerId }
    }), status: setGradeStatus, error: setError
  });
  const workspaceDocumentIntents = useWorkspaceDocumentIntents({
    getActiveDocumentId: () => workspaceDocumentIdRef.current,
    getSession: () => mountedDocumentSessionRef.current, captureScope: captureMountedInteractionScope,
    text: textPropertyGestureController, activateDocument: onActivateWorkspaceDocument,
    closeDocument: onCloseWorkspaceDocument, closeEditor: onClose, reportFailure: setError
  });
  const activateWorkspaceDocument = workspaceDocumentIntents.activate;
  const closeWorkspaceDocument = workspaceDocumentIntents.close;
  const existingTextHitControllerRef = useRef<ExistingTextHitController | null>(null);
  existingTextHitControllerRef.current ??= new ExistingTextHitController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => currentRendererLifecycleRef.current.getSnapshot().generation,
    reportFailure: reason => setError(reason instanceof Error ? reason.message : String(reason))
  });
  const existingTextHitController = existingTextHitControllerRef.current;
  useEffect(() => () => {
    textPropertyGestureController.dispose();
    textEditingController.reset();
  }, [textEditingController, textPropertyGestureController]);
  const textSelectionGestureControllerRef = useRef<TextSelectionGestureController | null>(null);
  textSelectionGestureControllerRef.current ??= new TextSelectionGestureController(() => ({
    focusAt: (layerId, point) => {
      const layout = engineRef.current?.textEditingLayout(layerId);
      return layout
        ? hitTestTextEditingLayout(layout, point, Number.POSITIVE_INFINITY)?.offset ?? null
        : null;
    },
    rangeAt: (layerId, offset, granularity) => {
      const document = imageDocumentRef.current;
      const layer = document ? findDocumentLayer(document, layerId) : null;
      const layout = engineRef.current?.textEditingLayout(layerId)?.layout;
      return layer?.type === 'text' && layer.text.source.kind === 'flow' && layout
        ? textSelectionForGranularity(layer.text.source.text, layout, offset, granularity)
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
    documentMutations: documentMutationController
  }));
  const textLayerMoveGestureController = textLayerMoveGestureControllerRef.current;
  const paragraphFrameResizeControllerRef = useRef<ParagraphFrameResizeController | null>(null);
  paragraphFrameResizeControllerRef.current ??= new ParagraphFrameResizeController(() => ({
    getDocument: () => imageDocumentRef.current,
    getEditingLayerId: () => {
      const snapshot = textEditingController.getSnapshot();
      return snapshot.status === 'editing' ? snapshot.layerId : null;
    },
    captureRealization: (layerId) => {
      const renderer = engineRef.current;
      const generation = rendererLifecycle.getSnapshot().generation;
      const localToDocument = renderer?.currentTextEditingLayout(layerId)?.localToDocument;
      return renderer && localToDocument ? {
        localToDocument,
        isCurrent: () => engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === generation
      } : null;
    },
    documentMutations: documentMutationController
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
      const renderer = engineRef.current;
      const generation = rendererLifecycle.getSnapshot().generation;
      const editingLayout = renderer?.currentTextEditingLayout(layerId);
      return editingLayout?.path ? {
        table: editingLayout.path.table,
        projection: editingLayout.path.projection,
        localToDocument: editingLayout.localToDocument,
        isCurrent: () => engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === generation
      } : null;
    },
    documentMutations: documentMutationController
  }));
  const pathTextHandleController = pathTextHandleControllerRef.current;
  const textEditing = useSyncExternalStore(
    textEditingController.subscribeShell,
    textEditingController.getShellSnapshot,
    textEditingController.getShellSnapshot
  );
  finishTextEditingRef.current = () => textEditingController.finish();

  useEffect(() => () => {
    textSelectionGestureController.dispose();
  }, [textSelectionGestureController]);

  useEffect(() => {
    textSelectionGestureController.dispose();
  }, [textSelectionGestureController, workspaceDocumentId]);

  useEffect(() => () => {
    textLayerMoveGestureController.cancel();
  }, [textLayerMoveGestureController]);

  useEffect(() => () => {
    paragraphFrameResizeController.cancel();
  }, [paragraphFrameResizeController]);

  useEffect(() => () => {
    pathTextHandleController.cancel();
  }, [pathTextHandleController]);

  useLayoutEffect(() => {
    textLayerMoveGestureController.cancel();
    paragraphFrameResizeController.cancel();
    pathTextHandleController.cancel();
    textPropertyGestureController.cancel();
    textEditingController.reset();
  }, [
    paragraphFrameResizeController,
    pathTextHandleController,
    textLayerMoveGestureController,
    textEditingController,
    textPropertyGestureController,
    workspaceDocumentId
  ]);

  useEffect(() => {
    textPropertyGestureController.finishIfEditingLayerChanged(imageDocument?.activeLayerId ?? null);
  }, [imageDocument?.activeLayerId, textEditing.layerId, textEditing.status,
    textPropertyGestureController]);

  const selectionShapeCommandService = useMemo(() => documentSession
    ? new SelectionShapeCommandService(
      documentSession,
      () => engineRef.current,
      () => activePresentationRef.current
        && documentSession.getSnapshot().document === imageDocumentRef.current,
    )
    : null, [documentSession]);
  const selectionHost = useSelectionHostBinding(documentSession, engineRef.current,
    rendererSnapshot.generation, rendererLifecycle, captureMountedInteractionScope, commandService,
    () => ({ document: imageDocumentRef.current, editor: readEditorSession(),
      selectedLayerIds: selectedLayerIdsRef.current, scale: activeScale }), {
      updateEditor: (update) => setEditorSession(current => {
        const next = update(current);
        editorSessionRef.current = next;
        return next;
      }),
      draft: setSelectionDraft,
      snapFeedback: (matches, bounds) => setSelectionSnapFeedback({ matches, bounds })
    });
  const selectionSessionController = useSelectionSessionController({
    getDocument: selectionHost.gesture.getDocument,
    getRenderer: () => engineRef.current,
    getSelection: selectionHost.gesture.getSelection,
    getSelectionMaskSnapshot: selectionHost.gesture.getSelectionMaskSnapshot,
    getSelectionSupportBounds: selectionHost.gesture.getSelectionSupportBounds,
    publishPointer: selectionHost.gesture.publishPointer,
    publishDraft: selectionHost.gesture.publishDraft,
    setError,
    commitShape: (command) => selectionShapeCommandService
      ? selectionShapeCommandService.execute(command) : Promise.resolve(false),
    commitTranslation: (command) => selectionShapeCommandService
      ? selectionShapeCommandService.executeTranslation(command) : Promise.resolve(false),
    commitPaint: (command) => selectionShapeCommandService
      ? selectionShapeCommandService.executePaint(command) : Promise.resolve(false),
    commitMagicWand: (command, signal) => selectionShapeCommandService
      ? selectionShapeCommandService.executeMagicWand(command, signal) : Promise.resolve(false),
    commitOperation: (command) => selectionShapeCommandService
      ? selectionShapeCommandService.executeOperation(command) : Promise.resolve(false),
    commitRasterMask: (command, signal) => selectionShapeCommandService
      ? selectionShapeCommandService.executeRasterMask(command, signal) : Promise.resolve(false),
    getSnapContext: selectionHost.gesture.getSnapContext,
    publishSnapFeedback: selectionHost.gesture.publishSnapFeedback,
    onShapeCommitted: selectionHost.observation.shape,
    onMagicWandCommitted: selectionHost.observation.magicWand,
    onPaintCommitted: selectionHost.observation.paint
  }, selectionGestureRef.current);
  const { controller: smartSelectionController, backendIdentity: smartSelectionBackendIdentity,
    preparation: smartSelectionPreparation } = useSmartSelectionBinding({
    session: documentSession, renderer: engineRef.current, lifecycle: rendererLifecycle,
    generation: rendererSnapshot.generation, ready: rendererSnapshot.status === 'ready',
    sourceReady: Boolean(imageDocument && thumbnailDocumentReadyId === imageDocument.id),
    enabled: editorSession.activeTool === 'select-object', document: imageDocument,
    sampleAllLayers: editorSession.smartSelection.sampleAllLayers
  }, {
    selection: selectionSessionController, commands: commandService,
    getOptions: () => editorSessionRef.current.smartSelection,
    setStatus: setGradeStatus, setDraft: setSelectionDraft,
    captureRendererScope: captureMountedInteractionScope
  });

  const readAdjustmentContext = (document: ImageDocument | null = imageDocumentRef.current,
    target: PropertiesInspectorTarget = propertiesTargetRef.current) =>
    resolveAdjustmentContext(document, processingBinding.getDocumentAdjustments(), target);
  const resolveAdjustmentTargetLayerId = (document: ImageDocument) => readAdjustmentContext(document)?.ownerId ?? null;
  const resolveAdjustmentTargetIdentity = (document: ImageDocument) => readAdjustmentContext(document)?.identity ?? null;
  const resolveCanonicalAdjustmentSnapshot = (document: ImageDocument) => readAdjustmentContext(document)?.readAdjustments() ?? null;
  const adjustmentTransactionController = useAdjustmentTransactionController({
    isMutationBlocked: isDocumentMutationBlocked,
    getDocumentId: () => imageDocumentRef.current?.id ?? null,
    getDocument: () => imageDocumentRef.current,
    getDocumentAdjustments: () => processingBinding.getDocumentAdjustments(),
    getCanonicalAdjustments: () => {
      const document = imageDocumentRef.current;
      return document ? resolveCanonicalAdjustmentSnapshot(document) : null;
    },
    getActiveTargetLayerId: () => {
      const document = imageDocumentRef.current;
      return document ? resolveAdjustmentTargetLayerId(document) : null;
    },
    getActiveTargetIdentity: () => {
      const document = imageDocumentRef.current;
      if (!document) return null;
      return resolveAdjustmentTargetIdentity(document);
    },
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation,
    documentMutations: documentMutationController,
    previewDocumentProcessing: (snapshot, domain) =>
      previewAdjustmentSnapshot(snapshot, null, domain),
    commitDocumentProcessing: (snapshot, domain) =>
      applyAdjustmentSnapshot(snapshot, null, domain),
    stageEditorAdjustments: (snapshot) => {
      processingBinding.stageEditorAdjustments(snapshot);
    },
    restoreStagedSnapshot: (snapshot) => {
      processingBinding.stageEditorAdjustments(cloneAdjustments(snapshot));
    },
    discardPreview: documentProjectionController.discardAdjustmentPreview,
    pushProcessingHistoryEntry: pushHistoryEntry,
    onCommitted: ({ after, targetLayerId, domain }) => {
      const attached = targetLayerId
        ? parseAttachedAdjustmentOwnerId(targetLayerId)
        : null;
      const target = attached
        ? { kind: 'attached' as const, layerId: attached.layerId,
          adjustmentId: attached.adjustmentId }
        : targetLayerId
          ? { kind: 'layer' as const, layerId: targetLayerId }
          : { kind: 'document' as const,
            owner: domain === 'lens-fx' ? 'lens-fx' as const : 'grade' as const };
      commandService.recordObservedCommand(
        'adjustment.setSnapshot',
        workspaceDocumentId as DocumentSessionId,
        { target, snapshot: after },
        { target, changed: true }
      );
    }
  });
  const { interactions: adjustmentInteractions, beginAdjustment: beginAdjustmentTransaction,
    endAdjustment: endAdjustmentTransaction, cancelAdjustment: cancelAdjustmentTransaction,
    changeAdjustments } = useAdjustmentGestures(documentSession ?? workspaceDocumentId, {
    controller: adjustmentTransactionController,
    requestAdmission: mountedDocumentAdmission.request,
    captureScope: captureMountedInteractionScope,
    getTargetIdentity: () => readAdjustmentContext()?.identity ?? null,
    reportFailure: error => setError(error instanceof Error ? error.message : String(error))
  });
  resetAdjustmentTransactionRef.current = adjustmentInteractions.reset;
  resetActiveAdjustmentTransactionRef.current = adjustmentTransactionController.reset;
  const gradeAssetCommands = new GradeAssetCommandService({
    mutations: documentMutationController,
    captureScope: captureMountedInteractionScope,
    getSession: () => mountedDocumentSessionRef.current,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    finishAdjustment: endAdjustmentTransaction,
    settleInteraction: finishOpenHistoryTransactions,
    getDocumentAdjustments: processingBinding.getDocumentAdjustments,
    resolveTarget: (document) => ({
      identity: resolveAdjustmentTargetIdentity(document),
      layerId: resolveAdjustmentTargetLayerId(document),
      adjustments: resolveCanonicalAdjustmentSnapshot(document)
    }),
    applyCanonicalProjection: (projection) => applyCanonicalAdjustmentProjection(projection, 'grade'),
    pushHistoryEntry,
    changeGrade: (recipe) => adjustmentTransactionController.change(recipe, 'grade')
  });
  const loadCubeAsset = async (file: File, purpose: 'photoshop-color-lookup' | 'grade-look') => {
    const loaded = await gradeAssetCommands.load(file, purpose);
    setGradeStatus(`Loaded ${loaded.name} · ${loaded.size}³ LUT`);
  };
  const loadColorLookup = (file: File) => loadCubeAsset(file, 'photoshop-color-lookup');
  const loadGradeLook = (file: File) => loadCubeAsset(file, 'grade-look');
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
    documentIdentity: documentSession ?? workspaceDocumentId,
    rendererGeneration: rendererSnapshot.generation,
    rendererReady: rendererSnapshot.status === 'ready' || rendererSnapshot.status === 'suspended',
    captureScope: captureMountedInteractionScope,
    getTargetIdentity: () => imageDocumentRef.current
      ? resolveAdjustmentTargetIdentity(imageDocumentRef.current) : null,
    finishAdjustment: endAdjustmentTransaction,
    settleInteraction: finishOpenHistoryTransactions,
    change: (recipe, domain) => adjustmentTransactionController.change(recipe, domain),
    reportFailure: (reason) => setError(reason instanceof Error ? reason.message : String(reason))
  });

  const { controller: canvasPickers, pointColorActive: pointColorPickerActive, focusActive: focusPickerActive } = useCanvasPickers(documentSession ?? workspaceDocumentId, {
    captureScope: captureMountedInteractionScope,
    getTargetIdentity: () => imageDocumentRef.current
      ? resolveAdjustmentTargetIdentity(imageDocumentRef.current) : null,
    getBrushIntent: () => editorSessionRef.current.activeTool,
    getRenderer: () => engineRef.current,
    getFocusSource: () => depthResult && metadata ? {
      depth: depthResult, width: metadata.width, height: metadata.height,
      distortion: processingBinding.getEditorAdjustments().effects.lensDistortion
    } : null,
    finishAdjustment: endAdjustmentTransaction,
    settleInteraction: finishOpenHistoryTransactions,
    change: (recipe, domain) => adjustmentTransactionController.change(recipe, domain),
    publishBrushColor: (color) => updateBrush({ color })
  });

  const adjustmentCommands = useMemo(() => createAdjustmentCommands({
    endAdjustment: endAdjustmentTransaction,
    changeAdjustments,
    getAdjustments: () => processingBinding.getEditorAdjustments(),
    setFocusPickerActive: canvasPickers.setFocusActive,
    publishLensBlurViewportMode: (mode) => {
      setLensBlurViewportModeState(mode);
    },
    getSourceName: () => sourceName,
    publishGradeStatus: setGradeStatus
  }), [
    beginAdjustmentTransaction,
    changeAdjustments,
    documentProjectionController,
    endAdjustmentTransaction,
    sourceName
  ]);
  const {
    updateAdjustment,
    resetAdjustment,
    updateDetail,
    resetDetailControl,
    resetDetail,
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
    updateVignette: updateVignetteAdjustment,
    resetVignetteControl: resetVignetteAdjustment,
    resetVignette,
    setVignetteEnabled,
    updateLensBlur: updateLensBlurAdjustment,
    resetLensBlurControl: resetLensBlurAdjustment,
    resetLensBlur,
    setLensBlurEnabled,
    setLensBlurShape,
    setLensBlurQuality,
    setLensBlurViewportMode,
    updateColorMixer: updateColorMixerAdjustment,
    resetColorMixer: resetColorMixerAdjustment,
    setBlackWhiteMixEnabled,
    updateBlackWhiteMix,
    resetBlackWhiteMix,
    updatePointColorSample,
    resetPointColorSample,
    removePointColorSample,
    updateColorGradingWheel,
    updateColorGradingLuminance,
    updateColorGradingControl,
    resetColorGradingControl,
    resetColorGradingZone,
    resetColorGradingLuminance,
    updateCurve,
    resetCurve,
    updateGradientMap,
    resetGradientMap,
    updatePhotoshopAdjustment,
    resetPhotoshopAdjustment,
    resetAll,
    resetGroup
  } = adjustmentCommands;
  const captureCurrentGrade = async (): Promise<LightTableGradeClipboardCapture> => {
    const document = imageDocumentRef.current;
    const renderer = engineRef.current;
    const canonical = document ? resolveCanonicalAdjustmentSnapshot(document) : null;
    const settings = cloneAdjustments(canonical ?? processingBinding.getDocumentAdjustments());
    const assetId = settings.gradeLook.assetId;
    let gradeLookAsset: LightTableGradeClipboardCapture['gradeLookAsset'];
    if (assetId && document && renderer) {
      const source = renderer.getColorLookupAssetSource(
        document.id,
        assetId as DocumentAssetId
      );
      const metadata = document.assets.colorLookups.find((asset) => asset.id === assetId);
      if (source && metadata) {
        gradeLookAsset = { assetId, name: metadata.name, source };
      }
    }
    const capture = {
      name: document?.name ?? 'Copied grade',
      settings,
      ...(gradeLookAsset ? { gradeLookAsset } : {})
    };
    copyLightTableGrade(settings, capture.name, gradeLookAsset);
    setGradeStatus('Grade copied');
    return capture;
  };
  const applyGradeCapture = async (capture: LightTableGradeClipboardCapture) => {
    const result = await gradeAssetCommands.paste(capture);
    setGradeStatus(`Loaded ${capture.name}`);
    return result;
  };
  const copyCurrentGrade = async () => {
    try {
      const execution = executeRegisteredCommand('grade.copy', {});
      const result = await execution;
      const value = result.status === 'completed' && typeof result.value === 'object'
        && result.value !== null ? result.value as Record<string, unknown> : null;
      const artifact = value && typeof value.artifact === 'object' && value.artifact !== null
        ? value.artifact as Record<string, unknown> : null;
      if (typeof artifact?.id === 'string') latestGradeClipboardArtifactRef.current = artifact.id;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not copy the Grade.');
    }
  };
  const pasteCurrentGrade = async () => {
    try {
      let artifactId = latestGradeClipboardArtifactRef.current;
      if (artifactId && !commandService.queryArtifact(artifactId)) {
        latestGradeClipboardArtifactRef.current = null;
        artifactId = null;
      }
      if (!artifactId && copiedGrade) {
        artifactId = commandService.registerGradeClipboardArtifact(copiedGrade).id;
        latestGradeClipboardArtifactRef.current = artifactId;
      }
      if (!artifactId) return;
      await executeRegisteredCommand('grade.paste', { artifactId });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not paste the Grade.');
    }
  };

  const applyUndoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    commitActiveDocumentTransaction();
    // An active transform remains one transaction across pointer gestures.
    // Confirm it before navigating history so the renderer cannot keep a stale
    // transform source while the document moves to another revision.
    return documentHistoryController.undo();
  }, [documentHistoryController, endAdjustmentTransaction, commitActiveDocumentTransaction]);

  const applyRedoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    commitActiveDocumentTransaction();
    return documentHistoryController.redo();
  }, [documentHistoryController, endAdjustmentTransaction, commitActiveDocumentTransaction]);

  const undoEditor = useCallback(() => {
    void executeRegisteredCommand('history.undo', {});
  }, [executeRegisteredCommand]);

  const redoEditor = useCallback(() => {
    void executeRegisteredCommand('history.redo', {});
  }, [executeRegisteredCommand]);

  const documentInteractionReset = useMemo(() => new DocumentInteractionResetPolicy({
    finishTextEditing: () => { finishTextEditingRef.current(); },
    selection: {
      resetGesture: () => selectionGestureRef.current.reset(),
      clearDraft: () => setSelectionDraft(null),
      clearClipboardFeedback: () => setSelectionClipboardAvailable(false),
      closeDialogs: () => { editorDialogs.closeFeather(); editorDialogs.closeSelectionMorphology(); },
      publishNewEditorSession: setEditorSession,
      clearPublishedGeometry: () => setEditorSession(current => ({ ...current, selection: [] }))
    },
    resetPaint: () => resetPaintSessionRef.current(),
    resetTransform: () => resetTransformRef.current(),
    lensBlur: {
      resetDepth: resetLensBlurDepth,
      clearPickers: canvasPickers.reset,
      showResult: () => setLensBlurViewportModeState('result')
    }
  }), [setEditorSession, resetLensBlurDepth, editorDialogs.closeFeather, editorDialogs.closeSelectionMorphology]);

  const documentOpenGeneration = useMemo(() => ({}), [
    editorSourceFileKey,
    initialRecipe,
    initialSourceBlob,
    initialSourceName,
    loadSource,
    projectId,
    sourceDecodeMode,
    documentCreationSettings,
    rendererRecoverySequence
  ]);
  const canReuseRenderer = useDocumentGpuRecovery({
    session: documentSession, lifecycle: rendererLifecycle, renderer: engineRef,
    snapshot: rendererSnapshot, opening: documentOpenGeneration, reportError: setError,
    requestReopen: () => setRendererRecoverySequence(value => value + 1)
  });

  const getDocumentPublicationPorts = useCallback(() => ({
    commitPublication: (publish: () => void) => {
      if (documentSession) documentSession.runPublication(publish);
      else publish();
    },
    mergeStartupTimings: (timings: LightTableStartupTimings) => {
      startupTelemetryRef.current.merge(timings);
      // PSD/PDF source-stage timings arrive after the embedded preview's first
      // frame. Publish the merged snapshot as well as retaining it, otherwise
      // the toolbar only exposes the earlier WebGPU/download/first-frame slice.
      setStartupTimings(startupTelemetryRef.current.snapshot());
    },
    publishDocument: (nextDocument: ImageDocument) => {
      imageDocumentRef.current = nextDocument;
      setImageDocument(nextDocument);
      setThumbnailDocumentReadyId(nextDocument.id);
    },
    publishMetadata: loadedSourceBinding.publishMetadata,
    publishBinaryAssets: loadedSourceBinding.publishBinaryAssets,
    publishPsdImport: setPsdImportInfo,
    publishPsdCompatibility: (entries: readonly PsdImportCompatibilityEntry[]) =>
      setPsdCompatibility([...entries]),
    publishPsdDifference: setPsdDifferenceMetrics,
    publishSource: loadedSourceBinding.publishSource,
    resetDocumentInteraction: () => {
      documentInteractionReset.sourcePublished();
      clearEditorHistory();
      resetHistogram();
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
    },
    publishAdjustments: (nextAdjustments: BasicAdjustments) => {
      processingBinding.publishLoadedProcessing(documentOpenGeneration, nextAdjustments);
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
    loadedSourceBinding,
    documentInteractionReset,
    processingBinding,
    documentOpenGeneration,
    resetHistogram,
    resetLensBlurDepth,
    setEditorSession,
    setImageDocument,
    setView,
    setZoomMode
  ]);

  const beforeDocumentOpen = useCallback(() => {
    processingBinding.prepareNewSource(documentOpenGeneration, initialRecipe?.globalGradeStrength ?? 100);
    documentInteractionReset.prepareNewSource();
    resetDocumentFontsForOpen();
    resetDocumentOpenPresentation({
      initialAdjustments: initialRecipe?.settings,
      port: {
        resetTelemetry: () => {
          startupTelemetryRef.current.begin(startupTimeline);
          setStartupTimings(null);
          setLoading(true);
        },
        resetSource: () => loadedSourceBinding.resetPresentation(fileNameBase),
        resetDocument: () => {
          imageDocumentRef.current = null;
          setImageDocument(null);
          setThumbnailDocumentReadyId(null);
        },
        resetSelection: documentInteractionReset.initializeNewSelection,
        resetLensBlur: documentInteractionReset.initializeLensBlur,
        publishAdjustments: (startingAdjustments) => {
          publishAdjustmentPresentation(startingAdjustments);
        },
        resetHistory: clearEditorHistory,
        resetViewport: () => {
          setIsolatedMaskLayerId(null);
          setIsolatedCompositeChannel(null);
          setShowDifference(false);
          setView({ scale: 1, panX: 0, panY: 0 });
        },
        resetScopes: (settings, visibility) => {
          scopeSettingsRef.current = settings;
          scopeVisibilityRef.current = visibility;
          setScopeSettings(settings);
          setScopeVisibility(visibility);
          resetHistogram();
        },
        resetDiagnostics: () => {
          setError(null);
          setScopeError(null);
          setGradeStatus(null);
          setGpuMemoryBytes(0);
          textRenderPresentationOwner.reset();
          setPsdImportInfo(null);
          setPsdDifferenceMetrics(null);
          setPsdCompatibility([]);
          editorDialogs.reset();
        },
        publishGroupVisibility: (visibility) => {
          processingBinding.stageOpeningVisibility(documentOpenGeneration, visibility);
        }
      }
    });
  }, [
    clearEditorHistory,
    documentSession,
    fileNameBase,
    initialRecipe,
    processingBinding,
    documentOpenGeneration,
    loadedSourceBinding,
    documentInteractionReset,
    resetDocumentFontsForOpen,
    resetHistogram,
    resetLensBlurDepth,
    textRenderPresentationOwner,
    setEditorSession,
    setImageDocument,
    setView,
    startupTimeline
  ]);

  const beforeExistingDocumentRebind = useCallback(() => {
    const snapshot = documentSession?.getSnapshot();
    const existingDocument = snapshot?.document;
    if (!snapshot || !existingDocument) return;

    documentInteractionReset.rebindExisting();
    setError(null);
    setScopeError(null);
    setGradeStatus(null);

    loadedSourceBinding.presentExisting();

    processingBinding.presentExisting(documentOpenGeneration, existingDocument, propertiesTargetRef.current);
    imageDocumentRef.current = existingDocument;
    setImageDocument(existingDocument);
    setThumbnailDocumentReadyId(existingDocument.id);
  }, [
    documentSession,
    loadedSourceBinding,
    documentInteractionReset,
    processingBinding,
    documentOpenGeneration,
    setImageDocument
  ]);

  const getDocumentOpenScopeOptions = useCallback(() => ({
    histogramVisible: scopeVisibilityRef.current.histogram,
    options: createScopeRendererOptions(
      scopeVisibilityRef.current,
      scopeSettingsRef.current
    )
  }), []);

  const existingDocumentForRebind = documentSession?.getSnapshot().document ?? null;
  const existingMetadataForRebind = documentSession?.getSnapshot().loadedSource.metadata ?? null;

  const afterDocumentClose = useCallback(() => {
    processingBinding.retireOpening(documentOpenGeneration);
    cancelAutoAlignRef.current();
  }, [processingBinding, documentOpenGeneration]);

  const restoreDocumentSelectionState = useCallback(async (
    renderer: DocumentRendererPort
  ) => {
    if (!documentSession || !selectionShapeCommandService) {
      throw new Error('The canonical selection owner is unavailable for this image document.');
    }
    if (!await selectionShapeCommandService.projectCurrent(renderer)) {
      throw new Error('The canonical document selection could not be projected.');
    }
  }, [documentSession, selectionShapeCommandService]);

  const documentLifecycleController = useEditorDocumentLifecycleController({
    enabled: open && workspaceDocumentKind === 'image',
    documentResourceKey: String(workspaceDocumentId),
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
      initialAdjustments: initialRecipe?.settings ?? createDefaultAdjustments(),
      creationSettings: documentCreationSettings,
      existingDocument: existingDocumentForRebind,
      existingMetadata: existingMetadataForRebind
    },
    getGroupVisibility: () => processingBinding.getGroupVisibility(),
    getPublicationPorts: getDocumentPublicationPorts,
    projectProcessing: processingBinding.projectReadyRenderer,
    getScopeOptions: getDocumentOpenScopeOptions,
    publishHistogram,
    publishGpuMemory: setGpuMemoryBytes,
    publishTextRenderPresentation: textRenderPresentationOwner.receive,
    publishCompositeRendered,
    publishInitialThumbnail: publishDocumentThumbnail,
    restoreSelectionState: restoreDocumentSelectionState,
    publishError: setError,
    publishOpenFailure: (message) => {
      processingBinding.retireOpening(documentOpenGeneration);
      onDocumentOpenFailed?.(message);
    },
    publishScopeError: setScopeError,
    publishFeatureError: (featureId, message) => {
      appendDebugMessage('error', `GPU feature: ${featureId}`, message);
      setGradeStatus(`${featureId} is unavailable; the image remains in bypass mode.`);
    },
    publishTimings: setStartupTimings,
    publishLoading: setLoading,
    logTimings: (timings) => console.info('[LightTable startup]', timings),
    beforeOpen: existingDocumentForRebind
      ? beforeExistingDocumentRebind
      : beforeDocumentOpen,
    afterClose: afterDocumentClose,
    canReuseRenderer
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

  const lensBlurDepthVisualizationOwnerId = propertiesView === 'lens-fx'
    ? propertiesTarget.kind === 'attached-processing'
      ? attachedAdjustmentOwnerId(propertiesTarget.layerId, propertiesTarget.adjustmentId)
      : 'layerId' in propertiesTarget
        ? propertiesTarget.layerId
        : null
    : null;
  useRendererPresentationSync({
    rendererRef: engineRef,
    showDifference,
    isolatedMaskLayerId,
    isolatedCompositeChannel,
    pointColorRangeVisualization,
    lensBlurViewportMode,
    lensBlurDepthVisualizationOwnerId,
    warpDebugView: editorSession.warp.debugView,
    vectorSelection: editorSession.vectorSelection,
    vectorEditingOverlayVisible: isVectorEditorTool(editorSession.activeTool),
    selection: editorSession.selection,
    selectionDraft,
    selectionOverlayVisible: selectionEditingOverlayIsVisible(
      editorSession.snap.extrasVisible
    ),
    selectionPaintOverlayVisible: editorSession.activeTool === 'select-paint-brush',
    selectionPaintOverlayColor: editorSession.selectionPaintBrush.overlayColor,
    scopeVisibility,
    histogramConsumerVisible: propertiesView === 'grade'
      || propertiesView === 'levels'
      || propertiesView === 'curves',
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
    engineRef.current?.setActive(hostPresentationActive);
  }, [hostPresentationActive]);

  const selectAllContent = () => {
    mountedDocumentAdmission.runAfter(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'all'
      });
    });
  };
  const clearCurrentSelection = () => {
    mountedDocumentAdmission.runAfter(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'clear'
      });
    });
  };
  const invertCurrentSelection = () => {
    mountedDocumentAdmission.runAfter(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'invert'
      });
    });
  };
  const selectSimilarColors = () => {
    mountedDocumentAdmission.runAfter(() => {
      const document = imageDocumentRef.current;
      if (!document?.activeLayerId) return;
      try {
        if (!selectionHost.hasActiveSelection()) return;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'The current selection is unavailable.');
        return;
      }
      const magicWand = editorSessionRef.current.magicWand;
      const parameters = {
        kind: 'modify' as const,
        operation: 'similar' as const,
        layerId: document.activeLayerId,
        tolerance: magicWand.tolerance,
        antiAlias: magicWand.antiAlias,
        sampleAllLayers: magicWand.sampleAllLayers
      };
      void executeRegisteredCommand('selection.modify', parameters);
    });
  };
  const featherCurrentSelection = (radius: number, applyAtCanvasBounds: boolean) => {
    mountedDocumentAdmission.runAfter(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'feather', radius, applyAtCanvasBounds
      });
    });
  };
  const modifyCurrentSelection = (
    operation: 'border' | 'smooth' | 'expand' | 'contract',
    amount: number,
    applyAtCanvasBounds: boolean
  ) => {
    mountedDocumentAdmission.runAfter(() => {
      const parameters = operation === 'border'
        ? { kind: 'modify' as const, operation, width: amount }
        : { kind: 'modify' as const, operation, radius: amount, applyAtCanvasBounds };
      void executeRegisteredCommand('selection.modify', parameters);
    });
  };
  const presentViewportImmediately = useCallback((
    scale: number,
    panX: number,
    panY: number
  ) => {
    if (!viewportMetadata) return;
    engineRef.current?.resizeViewport(
      viewportSize.width,
      viewportSize.height,
      Math.max(1, window.devicePixelRatio || 1),
      resolveViewportImageRect(
        viewportMetadata.width,
        viewportMetadata.height,
        viewportSize.width,
        viewportSize.height,
        scale,
        panX,
        panY
      )
    );
  }, [viewportMetadata, viewportSize.height, viewportSize.width]);
  const applyExactZoom = useCallback((percent: number) => {
    const nextView = zoomViewToScaleAtPoint({
      cursor: {
        x: viewportSize.width / 2,
        y: viewportSize.height / 2
      },
      viewport: viewportSize,
      view: { scale: activeScale, panX: view.panX, panY: view.panY },
      scale: zoomPercentToScale(percent)
    });
    presentViewportImmediately(nextView.scale, nextView.panX, nextView.panY);
    setViewport((current) => ({ ...current, zoomMode: 'custom', ...nextView }));
  }, [activeScale, presentViewportImmediately, setViewport, view.panX, view.panY, viewportSize]);
  const applyFitZoom = useCallback(() => {
    presentViewportImmediately(fitScale, 0, 0);
    setViewport((current) => ({
      ...current, zoomMode: 'fit', scale: 1, panX: 0, panY: 0
    }));
  }, [fitScale, presentViewportImmediately, setViewport]);
  const applyActualZoom = useCallback(() => {
    presentViewportImmediately(1, 0, 0);
    setViewport((current) => ({
      ...current, zoomMode: '100', scale: 1, panX: 0, panY: 0
    }));
  }, [presentViewportImmediately, setViewport]);
  const setExactZoom = useCallback((percent: number) => {
    void executeRegisteredCommand('view.setZoom', { mode: 'custom', percent });
  }, [executeRegisteredCommand]);
  const fitZoom = useCallback(() => {
    void executeRegisteredCommand('view.setZoom', { mode: 'fit' });
  }, [executeRegisteredCommand]);
  const actualZoom = useCallback(() => {
    void executeRegisteredCommand('view.setZoom', { mode: '100' });
  }, [executeRegisteredCommand]);

  useEditorKeyboardController({
    enabled: open && active,
    getContext: () => ({
      documentKind: workspaceDocumentKind,
      saving,
      activeTool: editorSession.activeTool,
      preferredTools: persistentToolActivationRef.current.preferredTools,
      hasActiveLayer: Boolean(imageDocumentRef.current?.activeLayerId),
      hasSelection: editorSession.selectionMaskSnapshot?.active === true,
      hasSelectionClipboard: selectionClipboardAvailable,
      transforming: transformActiveRef.current() || transformSession.ownsTemporaryMove(),
      editingBlocked: historySnapshot.busy
    }),
    commands: {
      openFile: () => { finishTextEditingRef.current(); void chooseLocalFile('automatic'); },
      saveFile: () => { void documentFileIntents.save(); },
      quickExportPng: () => { void documentFileIntents.exportPng(); },
      openImageSize: editorDialogs.openImageSize,
      openCanvasSize: editorDialogs.openCanvasSize,
      applyAdjustment: (kind) => applyAdjustmentRef.current(kind),
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
      beginTemporaryPan: temporaryTool.beginPan,
      beginTemporaryZoom: temporaryTool.beginZoom,
      beginTemporaryErase: temporaryTool.beginErase,
      fillForeground: (preserveTransparency) =>
        fillActiveTargetRef.current(editorSession.brush.color, preserveTransparency),
      fillBackground: (preserveTransparency) =>
        fillActiveTargetRef.current(editorSession.brush.backgroundColor, preserveTransparency),
      openFillDialog: editorDialogs.openFill,
      deleteActiveTarget: () => deleteActiveTargetRef.current(),
      selectAll: selectAllContent,
      selectNone: clearCurrentSelection,
      invertSelection: invertCurrentSelection,
      cutSelection: () => cutSelectedContentRef.current(),
      copySelection: () => copySelectedContentRef.current(),
      copyMergedSelection: () => copyMergedContentRef.current(),
      pasteSelection: () => pasteSelectedContentRef.current(),
      layerViaCopy: () => layerViaCopyRef.current(),
      toggleActiveLayerVisibility: () => toggleSelectedLayerVisibilityRef.current(),
      showAllLayers: () => showAllLayersRef.current(),
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
      toggleExtras: () => setEditorSession((current) => ({
        ...current,
        snap: { ...current.snap, extrasVisible: current.snap.extrasVisible === false }
      })),
      toggleRulers: () => setEditorSession((current) => ({
        ...current,
        snap: { ...current.snap, rulersVisible: !current.snap.rulersVisible }
      })),
      toggleSnap: () => setEditorSession((current) => ({
        ...current,
        snap: { ...current.snap, enabled: !current.snap.enabled }
      })),
      toggleScreenMode,
      changeBrushSize: (direction) => setEditorSession((current) => current.activeTool === 'warp'
        ? {
            ...current,
            warp: {
              ...current.warp,
              diameterPx: steppedBrushSize(current.warp.diameterPx, direction)
            }
          }
        : current.activeTool === 'select-paint-brush' ? {
            ...current,
            selectionPaintBrush: {
              ...current.selectionPaintBrush,
              size: steppedBrushSize(current.selectionPaintBrush.size, direction)
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
        : current.activeTool === 'select-paint-brush' ? {
            ...current,
            selectionPaintBrush: {
              ...current.selectionPaintBrush,
              hardness: steppedBrushHardness(
                current.selectionPaintBrush.hardness * 100,
                direction
              ) / 100
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
        setEditorSession((current) => current.activeTool === 'select-paint-brush'
          ? {
              ...current,
              selectionPaintBrush: {
                ...current.selectionPaintBrush,
                opacity: percent / 100
              }
            }
          : {
              ...current,
              brush: { ...current.brush, [target]: percent / 100 }
            });
      },
      setActiveLayerOpacity: (percent) => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) void executeRegisteredCommand('layer.setOpacity', {
          layerId, opacity: percent / 100
        });
      },
      nudgeSelectionMask: (x, y) => selectionSessionController.translate(x, y),
      nudgeContent: (x, y, duplicate, continueTransform) => {
        void selectionSessionController.settle().then(() => {
          transformSession.applyNudge(x, y, duplicate, continueTransform);
        });
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
          activateWorkspaceDocument(nextDocument.id);
        }
      },
      closeActiveDocument: () => closeWorkspaceDocument(workspaceDocumentId),
      changeZoom: (direction) => {
        if (workspaceViewControls) workspaceViewControls.onZoomStep(direction);
        else setExactZoom(steppedZoomPercent(activeScale * 100, direction));
      },
      fitZoom: workspaceViewControls?.onZoomFit ?? fitZoom,
      actualZoom: workspaceViewControls?.onZoomActual ?? actualZoom,
      cancelActiveOperation: () => cancelActiveEditorOperation({
        faceDetection: {
          isActive: () => Boolean(pendingFaceWarpDetectionForActiveLayer),
          cancel: cancelPendingFaceWarpDetection
        },
        toolMenu: { isActive: () => Boolean(toolOptionsMenu), cancel: () => setToolOptionsMenu(null) },
        crop: { isActive: () => Boolean(cropBounds), cancel: () => setCropBounds(null) },
        textEditing: {
          isActive: () => textEditingController.getSnapshot().status === 'editing',
          cancel: () => textEditingController.finish()
        },
        cancelParagraphCreation: () => textCreationInteraction.cancelParagraph(),
        cancelPointCreation: () => textCreationInteraction.cancelPoint(),
        transform: { isActive: () => transformActiveRef.current(), cancel: () => cancelTransformRef.current() },
        autoAlign: { isActive: () => Boolean(autoAlignPreview), cancel: () => cancelAutoAlignRef.current() },
        warp: { isActive: () => warpSessionController.active, cancel: () => warpSessionController.reset() },
        selectionDraft: {
          isActive: () => Boolean(selectionSessionController.draft), cancel: () => selectionSessionController.reset()
        },
        cancelPenPath: () => cancelPenPathRef.current(),
        selection: { isActive: selectionHost.hasAvailableActiveSelection, cancel: clearCurrentSelection }
      })
    },
    temporaryPanActive: () => temporaryTool.controller.activeTool === 'view',
    releaseTemporaryPan: temporaryTool.releasePan,
    temporaryZoomActive: () => temporaryTool.controller.activeTool === 'zoom',
    releaseTemporaryZoom: temporaryTool.releaseZoom,
    temporaryEraseActive: () => temporaryTool.controller.activeTool === 'erase',
    releaseTemporaryErase: temporaryTool.releaseErase,
    clearTemporaryTool: () => {
      temporaryTool.clear();
      brushPercentInputRef.current.clear();
    },
    onShiftChange: setShiftPressed,
    onAltChange: setAltPressed,
    onCapsLockChange: setPreciseBrushCursor
  });

  const fillCommandController = useFillCommandController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    documentMutations: documentMutationController,
    getChannel: () => editorSession.activeChannel,
    applyDocumentSnapshot,
    reserveHistoryEntry: documentHistoryController.reserve,
    setStatus: setGradeStatus,
    setError,
    onFillCommitted: (parameters, result) => commandService.recordObservedCommand(
      'raster.fill',
      workspaceDocumentId as DocumentSessionId,
      parameters,
      result
    )
  });
  const fillActiveTarget = fillCommandController.fill;
  fillActiveTargetRef.current = (color, preserveTransparency) => {
    mountedDocumentAdmission.runAfter(() => {
      fillActiveTarget(color, preserveTransparency);
    });
  };

  const rasterGradientPortsRef = useRef<RasterGradientDependencies>({
    getDocument: () => null,
    getRenderer: () => null,
    documentMutations: documentMutationController,
    getChannel: () => 'pixels',
    getSettings: createGradientToolSettings,
    getSelectionRevision: () => 0,
    applyDocumentSnapshot: () => undefined,
    reserveHistoryEntry: () => ({ commit: () => false, cancel: () => undefined }),
    setStatus: () => undefined,
    setError: () => undefined
  });
  rasterGradientPortsRef.current = {
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    documentMutations: documentMutationController,
    getChannel: () => editorSession.activeChannel,
    getSettings: () => gradientToolSettings,
    getSelectionRevision: () => documentSession?.getSnapshot().editor.selectionRevision
      ?? editorSessionRef.current.selectionRevision,
    applyDocumentSnapshot,
    reserveHistoryEntry: documentHistoryController.reserve,
    setStatus: setGradeStatus,
    setError,
    onGradientCommitted: (parameters, result) => commandService.recordObservedCommand(
      'raster.applyGradient',
      workspaceDocumentId as DocumentSessionId,
      parameters,
      result
    )
  };
  const publishGlobalGradeStrength = processingBinding.publishStrength;

  const rasterGradientControllerRef = useRef<RasterGradientCommandController | null>(null);
  rasterGradientControllerRef.current ??= new RasterGradientCommandController(
    () => rasterGradientPortsRef.current
  );
  const rasterGradientController = rasterGradientControllerRef.current;

  const paintSessionController = usePaintSessionController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    documentMutations: documentMutationController,
    applyDocumentSnapshot,
    reserveHistoryEntry: documentHistoryController.reserve,
    acquireHistoryAdmissionBarrier: commandHistory.acquireAdmissionBarrier.bind(commandHistory),
    getSelectionRevision: () => documentSession?.getSnapshot().editor.selectionRevision
      ?? editorSessionRef.current.selectionRevision,
    setError,
    onStrokeCommitted: ({ target, brush, operator, samples }) => {
      commandService.recordObservedCommand(
        'tool.commitGesture',
        workspaceDocumentId as DocumentSessionId,
        {
          kind: 'brush-stroke',
          parameters: {
            layerId: target.layerId,
            channel: target.channel,
            erase: target.erase,
            brush,
            ...(operator ? { operator: automationPaintOperatorFromPlan(operator) } : {})
          },
          samples
        },
        { kind: 'brush-stroke', sampleCount: samples.length }
      );
    }
  }, paintGestureRef.current);
  resetPaintSessionRef.current = paintSessionController.reset;
  const sampledBrushSourceController = useMemo(
    () => new SampledBrushSourceController(),
    [workspaceDocumentId]
  );

  const warpSessionController = useWarpSessionController({
    getDocument: () => imageDocumentRef.current,
    documentMutations: documentMutationController,
    setError,
    createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`,
    acquireInteractionBinding: (layerId) => {
      const renderer = engineRef.current;
      if (!renderer) return null;
      const generation = rendererLifecycle.getSnapshot().generation;
      return {
        isCurrent: () => engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === generation,
        setActive: (active, moduleId) => renderer.setWarpInteractionActive(
          active,
          layerId,
          moduleId
        ),
        requestCanonicalProjection: (moduleId, moduleRevision) => {
          if (engineRef.current !== renderer
            || rendererLifecycle.getSnapshot().generation !== generation) return null;
          return renderer.requestCanonicalWarpProjection(layerId, moduleId, moduleRevision);
        }
      };
    },
    onStrokeCommitted: (layerId, stroke, command) => commandService.recordObservedCommand(
      'warp.applyStroke',
      workspaceDocumentId as DocumentSessionId,
      command,
      { layerId, strokeId: stroke.id, sampleCount: stroke.samples.length }
    )
  });

  const transformCanvasPick = useTransformCanvasPickIntent({
    session: documentSession, renderer: engineRef.current, lifecycle: rendererLifecycle,
    generation: rendererSnapshot.generation,
    ready: rendererSnapshot.status === 'ready' && workspaceDocumentKind === 'image'
      && imageDocument?.id === documentSession?.getSnapshot().document?.id
  }, {
    read: () => ({ document: imageDocumentRef.current, selectedLayerIds: selectedLayerIdsRef.current,
      autoSelect: readEditorSession().transformAutoSelectLayer, historyBusy: commandHistory.getSnapshot().busy,
      tool: readEditorSession().activeTool }),
    commitTransform: () => commitTransformPendingRef.current(),
    publishSelection: layerIds => {
      selectedLayerIdsRef.current = [...layerIds]; setSelectedLayerIds([...layerIds]);
    },
    selectLayer: (layerId, isCurrent, onSelected) => layerPanelController.selectIfCurrent(layerId, isCurrent, onSelected),
    activateTransform: () => setTransformActivationRevision(current => current + 1),
    reportError: setError
  }, captureMountedInteractionScope);
  const replaceLayerSelection = useCallback((layerId: LayerId) => {
    transformCanvasPick.cancel();
    selectedLayerIdsRef.current = [layerId];
    setSelectedLayerIds([layerId]);
  }, [transformCanvasPick]);

  const vectorCommitPublisher = useMemo(() => new VectorCommitPublisher({
    documentId: workspaceDocumentId as DocumentSessionId,
    selectLayer: replaceLayerSelection,
    record: (...args) => commandService.recordObservedCommand(...args)
  }), [workspaceDocumentId, replaceLayerSelection, commandService]);
  const vectorToolSessionController = useVectorToolSessionController({
    document: imageDocument,
    rendererGeneration: rendererSnapshot.generation,
    sessionIdentity: documentSession,
    rendererIdentity: engineRef.current,
    lifecycleIdentity: rendererLifecycle,
    getSessionIdentity: () => mountedDocumentSessionRef.current,
    getRendererGeneration: () => currentRendererLifecycleRef.current.getSnapshot().generation,
    captureScope: captureMountedInteractionScope,
    getDocument: () => imageDocumentRef.current,
    getSession: readEditorSession,
    documentMutations: documentMutationController,
    publishSelection: (vectorSelection) => {
      setEditorSession((current) => ({ ...current, vectorSelection }));
    },
    captureTransformPreview: () => captureVectorTransformPreviewBinding({
      getDocument: () => imageDocumentRef.current,
      getRenderer: () => engineRef.current,
      getRendererGeneration: () => rendererLifecycle.getSnapshot().generation
    }),
    reportError: setError,
    requestGradientColorEditor: (endpoint) => {
      setGradientEditorRequest((current) => ({
        revision: (current?.revision ?? 0) + 1,
        endpoint
      }));
    },
    rasterizeShape: (transaction, rendererGeneration) => rasterizeShapeRef.current(
      transaction,
      rendererGeneration
    ),
    onLiveShapeCommitted: vectorCommitPublisher.shape,
    onPenPathCommitted: vectorCommitPublisher.pen,
    onPathMutationCommitted: vectorCommitPublisher.path,
    onGradientCommitted: vectorCommitPublisher.gradient
  });
  const penPresentation = usePenPresentation(vectorToolSessionController, engineRef.current,
    documentSession, rendererSnapshot.generation, rendererLifecycle, captureMountedInteractionScope);
  finishPenPathRef.current = penPresentation.finish;
  cancelPenPathRef.current = penPresentation.cancel;
  undoPenAnchorRef.current = penPresentation.undoAnchor;
  const selectedVectorStyle = useMemo(() => resolveSelectedVectorStyle(imageDocument,
    editorSession.vectorSelection), [imageDocument, editorSession.vectorSelection]);
  const selectedShapeGeometry = useMemo(() => resolveSelectedShapeGeometry(imageDocument,
    editorSession.vectorSelection, editorSession.shape),
    [imageDocument, editorSession.vectorSelection, editorSession.shape]);
  const vectorProperties = useVectorPropertyIntents({
    getDocument: () => imageDocumentRef.current,
    getSession: readEditorSession,
    setShapeDefaults: change => setEditorSession(current => ({
      ...current, shape: { ...current.shape, ...change }
    })),
    setGradientDefaults: change => setEditorSession(current => ({
      ...current, gradient: { ...current.gradient, ...change }
    })),
    edits: vectorToolSessionController
  });
  const updateSelectedVectorStyle = vectorProperties.updateStyle;
  const updateSelectedShapeGeometry = vectorProperties.updateShape;
  const updateGradientSettings = vectorProperties.updateGradient;

  const textEditingEntry = useTextEditingEntry(documentSession ?? workspaceDocumentId,
    editorSession.activeTool, rendererSnapshot.generation, textFontRegistry, {
    getDocument: () => imageDocumentRef.current,
    getTool: () => readEditorSession().activeTool,
    getFontRegistry: () => textFontRegistry,
    getFonts: () => textFontRegistry.availableAssets,
    substitutionFamilies: DEFAULT_TEXT_SUBSTITUTION_FAMILIES,
    captureScope: captureMountedInteractionScope,
    selectLayer: layerId => layerPanelController.select(layerId),
    activateType: after => activatePersistentTool('text-point', after),
    cancelCreation: textCreationInteraction.cancel,
    beginEditing: (layerId, offset, affinity) => textEditingController.begin(layerId, offset, affinity),
    requestRecovery: editorDialogs.requestMissingFontRecovery,
    showProperties: layerId => showProperties({ kind: 'layer', layerId }),
    closeReport: editorDialogs.closePsdReport,
    reportFailure: reason => setError(reason instanceof Error ? reason.message : String(reason))
  });
  const requestExistingFlowTextEditing = textEditingEntry.request;

  const missingFontReplacementActions = useMissingFontReplacementActions({
    documentId: workspaceDocumentId,
    getDocument: () => imageDocumentRef.current,
    registry: textFontRegistry,
    substitutionFamilies: DEFAULT_TEXT_SUBSTITUTION_FAMILIES,
    documentMutations: documentMutationController,
    closeRecovery: editorDialogs.closeMissingFontRecovery,
    requestRecovery: editorDialogs.requestMissingFontRecovery,
    beginEditing: (layerId, offset, affinity) => {
      void textEditingEntry.selectAndEnter(layerId, { offset, affinity });
    },
    setStatus: setGradeStatus,
    setError
  });
  const existingTextActivation = useExistingTextActivation(documentSession ?? workspaceDocumentId,
    editorSession.activeTool, rendererSnapshot.generation, {
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getTool: () => editorSessionRef.current.activeTool,
    getScale: () => activeScale,
    captureScope: captureMountedInteractionScope,
    hit: existingTextHitController,
    editing: textEditingController,
    selection: textSelectionGestureController,
    cancelCreation: () => { textCreationInteraction.cancelPoint(); textCreationInteraction.cancelParagraph(); },
    requestEditing: requestExistingFlowTextEditing,
    selectLayer: layerId => Promise.resolve(selectLayerRef.current(layerId)),
    reportFailure: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    miss: (intent, context) => textPointerRouter.miss(intent, context)
  });
  const textPointerRouter = useTextPointerRouter({
    getDocument: () => imageDocumentRef.current,
    getTool: () => readEditorSession().activeTool,
    getScale: () => activeScale,
    getVectorSelection: () => readEditorSession().vectorSelection,
    activation: existingTextActivation,
    pendingHit: existingTextHitController,
    layerMove: textLayerMoveGestureController,
    pathHandle: pathTextHandleController,
    frameResize: paragraphFrameResizeController,
    selection: textSelectionGestureController,
    creation: textCreationInteraction,
    finishEditing: () => { textEditingController.finish(); },
    reportFailure: setError
  });

  const pickTransformAtPoint = transformCanvasPick.request;

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
    temporaryTools: temporaryTool.controller,
    temporaryZoomOut: temporaryZoomOutActive,
    onTransformPick: pickTransformAtPoint,
    selectionContentMove: {
      begin: (duplicate) => beginSelectionContentMoveRef.current(duplicate),
      update: (x, y) => updateSelectionContentMoveRef.current(x, y),
      finish: (commit) => finishSelectionContentMoveRef.current(commit)
    },
    preciseBrushCursor,
    eyedropperActive: pointColorPickerActive || ((editorSession.activeTool === 'brush'
      || editorSession.activeTool === 'fill'
      || editorSession.activeTool === 'gradient') && altPressed),
    sampleSourceActive: (editorSession.activeTool === 'clone-stamp'
      || editorSession.activeTool === 'healing-brush') && altPressed,
    onColorPick: (point) => {
      void canvasPickers.pickColor(point).catch((reason: unknown) => {
        setGradeStatus(reason instanceof Error ? reason.message : 'The color could not be sampled.');
      });
    },
    focusPickerActive: focusPickerActive && Boolean(depthResult),
    onFocusPick: (point) => {
      void canvasPickers.pickFocus(point).catch((reason: unknown) => {
        setGradeStatus(reason instanceof Error ? reason.message : 'The focus could not be sampled.');
      });
    },
    onFocusPickerEnd: canvasPickers.disarmFocus,
    onFill: fillActiveTarget,
    onPointTextCreate: textPointerRouter.createAtPoint,
    textGesture: textPointerRouter,
    selection: selectionSessionController,
    smartSelection: smartSelectionController,
    paint: paintSessionController,
    sampledBrushSource: sampledBrushSourceController,
    onSampledBrushError: setError,
    onSampledBrushSourceSet: ({ x, y }) => {
      setGradeStatus(`Sample source set at ${Math.round(x)}, ${Math.round(y)}.`);
    },
    warp: warpSessionController,
    faceWarp: {
      begin: beginFaceWarpGesture,
      owns: faceWarpSessionController.owns,
      move: moveFaceWarpGesture,
      finish: finishFaceWarpGesture,
      cancel: cancelFaceWarpGesture
    },
    vector: vectorToolSessionController,
    rasterGradient: rasterGradientController,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
    zoomWithScrollWheel: toolPreferences?.zoomWithScrollWheel ?? true,
    editingBlocked: historySnapshot.busy,
    recordPaintCommit: actionRecording.status === 'recording',
    onBrushCursorChange: (cursor) => {
      engineRef.current?.setBrushCursorOverlay(cursor);
    },
    onZoomDraftChange: (draft) => {
      engineRef.current?.setZoomEditingOverlay(draft);
    },
    onPenRubberBandChange: penPresentation.setRubberBand,
    onPenEditingOverlayChange: penPresentation.setOverlay
  });
  useViewportWheelBridge(() => ({
    active, zoomWithScrollWheel: toolPreferences?.zoomWithScrollWheel ?? true,
    viewport: viewportRef.current, pan: viewportInteraction.onHorizontalWheel,
    report: appendDebugMessage
  }));

  const applyDocumentChange = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    textEditingController.finish();
    return changeLayerDocument(change, recordHistory);
  };

  const layerDocumentCommands = useLayerDocumentCommands({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation,
    captureFinalizationScope: () => captureLayerFinalizationScope(documentSession, engineRef.current, {
      getCurrentSession: () => mountedDocumentSessionRef.current,
      getCurrentRenderer: () => engineRef.current,
      captureRendererScope: captureMountedInteractionScope
    }),
    getImageClipboard: () => imageClipboard,
    getDocumentId: () => workspaceDocumentId,
    getSelectionLease: () => {
      if (!documentSession) return null;
      return new DocumentSelectionStateStore(documentSession).acquire(
        documentSession.getSnapshot().documentRevision,
      );
    },
    documentMutations: documentMutationController,
    applyDocumentSnapshot,
    pushDocumentHistory,
    pushHistoryEntry,
    reserveHistoryEntry: documentHistoryController.reserve,
    setActiveChannel: (activeChannel) => {
      setEditorSession((session) => ({ ...session, activeChannel }));
    },
    setSelectionClipboardAvailable,
    setStatus: setGradeStatus,
    setError,
    getDocumentAdjustments: () => processingBinding.getDocumentAdjustments(),
    getPanelAdjustments: () => processingBinding.getEditorAdjustments(),
    publishDocumentAdjustments: (next) => {
      publishDocumentAdjustmentsState(next);
    },
    publishPanelAdjustments: (next) => {
      publishAdjustmentPresentation(cloneAdjustments(next));
    },
    getGlobalGradeStrength: () => processingBinding.getStrength(),
    publishGlobalGradeStrength
  });
  const {
    startTask: startBackgroundRemovalTask,
    cancelTask: cancelBackgroundRemovalTask,
    clearCompletedTask: clearCompletedBackgroundRemovalTask
  } = useBackgroundRemovalTaskBridge(executeRegisteredCommand);
  const backgroundRemovalController = useBackgroundRemovalController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyMask: layerDocumentCommands.applyBackgroundRemovalMask,
    setStatus: setGradeStatus,
    setError,
    startTask: startBackgroundRemovalTask,
    cancelTask: cancelBackgroundRemovalTask,
    subscribeDocument: (listener) => documentSession?.subscribe(() => listener()) ?? (() => undefined),
    lifetimeKey: `${workspaceDocumentId}:${rendererSnapshot.generation}`
  });

  useEffect(() => {
    if (backgroundRemovalController.state.phase === 'idle') {
      clearCompletedBackgroundRemovalTask();
    }
  }, [backgroundRemovalController.state.phase, clearCompletedBackgroundRemovalTask]);
  rasterizeShapeRef.current = (transaction, rendererGeneration) => {
    return layerDocumentCommands.rasterizeVectorCreation(transaction, rendererGeneration);
  };
  const duplicateActiveLayer = layerDocumentCommands.duplicateActiveLayer;
  const layerFinalizationIntents = useLayerFinalizationIntents({
    getSession: () => mountedDocumentSessionRef.current,
    getRenderer: () => engineRef.current, getProjectedDocument: () => imageDocumentRef.current,
    captureScope: captureMountedInteractionScope, getSelectedLayerIds: () => selectedLayerIdsRef.current,
    text: textPropertyGestureController,
    requestAdmission: mountedDocumentAdmission.request,
    execute: (documentId, command, parameters) => commandService.execute({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION,
      requestId: `ui-${documentId}-${++commandRequestSequenceRef.current}`, documentId, command, parameters
    }), reportFailure: setError
  });
  const mergeSelectionOrActiveDown = layerFinalizationIntents.mergeDown;
  const handleLayerSelectionChange = useCallback((layerIds: LayerId[]) => {
    // A layer-panel selection made after an asynchronous canvas hit supersedes
    // that hit and must never be overwritten when its GPU readback resolves.
    transformCanvasPick.cancel();
    selectedLayerIdsRef.current = layerIds;
    setSelectedLayerIds(layerIds);
  }, [transformCanvasPick]);

  const clipboardCommands = useClipboardCommands({
    getSession: () => mountedDocumentSessionRef.current,
    getRenderer: () => engineRef.current,
    captureScope: captureMountedInteractionScope,
    getPlacementView: () => ({ viewportSize, imageRect }),
    settleInteraction: settleMountedDocumentInteraction,
    clipboard: imageClipboard,
    commands: commandService,
    nextRequestId: id => `ui-${id}-${++commandRequestSequenceRef.current}`,
    copySelected: selection => layerDocumentCommands.copySelectedContent(selection),
    fill: fillCommandController,
    reportError: setError,
    reportStatus: setGradeStatus
  });
  const copySelectedContent = () => { void clipboardCommands.host.copy('active-layer'); };
  const cutSelectedContent = () => { void clipboardCommands.host.cut(); };
  const copyMergedContent = () => { void clipboardCommands.host.copy('merged'); };
  const pasteSelectedContent = () => { void clipboardCommands.host.paste(); };
  const layerViaCopy = () => { void clipboardCommands.host.layerViaCopy(); };
  copySelectedContentRef.current = copySelectedContent;
  cutSelectedContentRef.current = cutSelectedContent;
  copyMergedContentRef.current = copyMergedContent;
  pasteSelectedContentRef.current = pasteSelectedContent;
  layerViaCopyRef.current = layerViaCopy;
  mergeActiveLayerDownRef.current = mergeSelectionOrActiveDown;

  const autoAlignController = useAutoAlignController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    documentMutations: documentMutationController,
    setStatus: setGradeStatus,
    setError
  });
  const autoAlignPreview = autoAlignController.preview;
  const cancelAutoAlignPreview = autoAlignController.cancel;
  const applyAutoAlignPreview = useCallback(() => {
    if (!autoAlignPreview) return;
    void executeRegisteredCommand('layer.autoAlign', {
      referenceLayerId: autoAlignPreview.referenceLayerId,
      targetLayerId: autoAlignPreview.targetLayerId
    });
  }, [autoAlignPreview, executeRegisteredCommand]);
  const beginAutoAlign = autoAlignController.begin;
  cancelAutoAlignRef.current = cancelAutoAlignPreview;

  const layerStyleEditor = useLayerStyleEditorController({
    activeDocument: imageDocument,
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    rendererGeneration: rendererSnapshot.generation,
    documentMutations: documentMutationController,
    onCheckpoint: (before, after, layerId) => {
      const current = findDocumentLayer(after, layerId);
      if (!findDocumentLayer(before, layerId) || !current) return;
      commandService.recordObservedCommand(
        'layer.style.setSnapshot', workspaceDocumentId as DocumentSessionId,
        { layerId, snapshot: layerStyleSnapshot(current.styleStack) },
        { layerId, changed: true }
      );
    }
  });
  const styleEntry = useMemo(() => new LayerStyleEntryIntent(() => {
    const session = documentSession, renderer = engineRef.current, scope = captureMountedInteractionScope();
    return { isCurrent: () => Boolean(renderer) && mountedDocumentSessionRef.current === session && engineRef.current === renderer
        && scope.isCurrent() && session?.getSnapshot().lifecycle === 'ready'
        && imageDocumentRef.current?.id === session.getSnapshot().document?.id,
      getDocument: () => session?.getSnapshot().document ?? null,
      beginPresentation: propertiesPresentation.beginIntent, openEditor: layerStyleEditor.open,
      execute: (layerId, effectKind) => executeRegisteredCommand('layer.effect.add', { layerId, effectKind }, null),
      reportFailure: setError };
  }), [documentSession, captureMountedInteractionScope, propertiesPresentation, layerStyleEditor.open, executeRegisteredCommand]);
  const openLayerStyleEditor = styleEntry.open, addLayerEffectFromMenu = styleEntry.add;
  const layerMaskCommandBridge = useMemo(() => createLayerMaskCommandBridge(() => {
    const scope = captureMountedInteractionScope();
    const session = documentSession;
    return {
      isCurrent: () => Boolean(session && mountedDocumentSessionRef.current === session
        && session.getSnapshot().lifecycle === 'ready' && scope.isCurrent()
        && imageDocumentRef.current?.id === session.getSnapshot().document?.id),
      getDocument: () => imageDocumentRef.current,
      hasSelection: selectionHost.hasActiveSelection,
      execute: (parameters) => executeRegisteredCommand('layer.setMask', parameters, null),
      setPaintTarget: (activeChannel, brushColor) => setEditorSession((current) => ({
        ...current,
        activeChannel,
        brush: brushColor ? { ...current.brush, color: brushColor } : current.brush
      })),
      setError
    };
  }), [executeRegisteredCommand, selectionHost, documentSession, captureMountedInteractionScope]);
  const layerPanelController = useLayerPanelController({
    getDocument: () => imageDocumentRef.current,
    getDocumentAdjustments: () => processingBinding.getDocumentAdjustments(),
    mutateDocument: applyDocumentChange,
    presentation: adjustmentPresentation,
    getPropertiesTarget: () => propertiesTargetRef.current,
    properties: propertiesPresentation,
    reportError: setError,
    captureSelectionScope: () => {
      const session = documentSession, renderer = engineRef.current, scope = captureMountedInteractionScope();
      return { isCurrent: () => Boolean(renderer && session && mountedDocumentSessionRef.current === session
        && session.getSnapshot().lifecycle === 'ready' && scope.isCurrent()
        && imageDocumentRef.current?.id === session.getSnapshot().document?.id) };
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
    beginDocumentTransaction: beginLayerDocumentTransaction,
    endDocumentTransaction: commitLayerDocumentTransaction,
    cancelDocumentTransaction: cancelLayerDocumentTransaction,
    createAdjustmentLayer: layerDocumentCommands.createAdjustmentLayer,
    createCurvesAdjustmentLayer: layerDocumentCommands.createCurvesAdjustmentLayer,
    createLensFxLayer: layerDocumentCommands.createLensFxLayer,
    createAdjustmentLayerOfKind: layerDocumentCommands.createAdjustmentLayerOfKind,
    createAttachedAdjustment: layerDocumentCommands.createAttachedAdjustment,
    setAttachedFilterEnabled: (layerId, adjustmentId, enabled) => {
      const document = imageDocumentRef.current;
      const target = { kind: 'attached' as const, layerId, adjustmentId };
      const owner = document ? resolveFilterSnapshotOwner(document, target) : null;
      return Boolean(owner && executeRegisteredCommand('filter.setSnapshot', {
        target,
        snapshot: { ...owner.snapshot, enabled }
      }));
    },
    requestAddLayerMask: layerMaskCommandBridge.add,
    requestToggleLayerMask: layerMaskCommandBridge.toggle,
    requestSetLayerMaskLinked: layerMaskCommandBridge.setLinked,
    requestRemoveLayerMask: layerMaskCommandBridge.remove,
    duplicateActiveLayer,
    rasterizeActiveLayer: async () => {
      const layerId = imageDocumentRef.current?.activeLayerId;
      const execution = layerId
        ? executeRegisteredCommand('layer.rasterize', { layerId })
        : null;
      if (!execution) {
        setError('Select a layer to rasterize.');
        return false;
      }
      try {
        return (await execution).status === 'completed';
      } catch {
        return false;
      }
    },
    loadLayerMaskSelection: async (layerId) => {
      await executeRegisteredCommand('layer.setMask', {
        layerId, operation: 'load-selection'
      });
    },
    loadLayerTransparencySelection: async (layerId) => {
      await executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'load-transparency', layerId
      });
    },
    mergeActiveLayerDown: mergeSelectionOrActiveDown,
    mergeSelectedLayers: layerFinalizationIntents.mergeSelected,
    flattenGroup: layerFinalizationIntents.flattenGroup,
    flattenImage: layerFinalizationIntents.flattenImage,
    editStyles: openLayerStyleEditor,
    setStyleStackEnabled: (layerId, enabled) => {
      void executeRegisteredCommand('layer.style.setEnabled', { layerId, enabled });
    },
    setStyleEnabled: (layerId, effectId, enabled) => {
      void executeRegisteredCommand('layer.effect.setEnabled', { layerId, effectId, enabled });
    },
    removeStyle: (layerId, effectId) => {
      void executeRegisteredCommand('layer.effect.remove', { layerId, effectId });
    },
    clearStyles: (layerId) => {
      const document = imageDocumentRef.current;
      const layer = document ? findDocumentLayer(document, layerId) : null;
      if (!layer) {
        setError('The layer is unavailable.');
        return;
      }
      void executeRegisteredCommand('layer.style.setSnapshot', {
        layerId, snapshot: { ...layerStyleSnapshot(layer.styleStack), effects: [] }
      });
    },
    finishStyleEditing: layerStyleEditor.commit,
    finishProcessingEditing: () => {
      endAdjustmentTransaction();
      commitLayerDocumentTransaction();
    },
    prepareActiveLayerChange: async (layerId, isCurrent) => {
      // Finish the active document transaction before changing its target.
      // The transform tool owns only a disposable preview; committing after
      // setActiveLayer() would make that preview race a newer document revision.
      if (transformActiveRef.current()) await commitTransformPendingRef.current();
      if (!isCurrent()) return;
      if (textEditingController.getSnapshot().layerId !== layerId) {
        textEditingController.finish();
      }
      vectorToolSessionController.prepareActiveLayerChange(layerId);
    },
    finishTextEditing: () => { textEditingController.finish(); }
  });
  applyCurvesRef.current = () => {
    const document = imageDocumentRef.current;
    if (!document) return;
    const command = resolveContextualAdjustmentCreation(document, 'curves');
    if (command.placement === 'local') {
      const layer = findDocumentLayer(document, command.layerId);
      if (layer?.type === 'raster'
        && adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'curves')) {
        showProperties({ kind: 'processing', layerId: command.layerId, owner: 'curves' });
        return;
      }
    }
    void executeRegisteredCommand('adjustment.create', command);
  };
  executeAdjustmentCreationRef.current = (command) => {
    const before = imageDocumentRef.current;
    if (!before) return null;
    if (command.placement === 'local') {
      layerPanelController.createLocalProcessing(command.layerId, command.kind);
      const after = imageDocumentRef.current;
      if (!after || after.revision === before.revision) return null;
      showProperties({ kind: 'processing', layerId: command.layerId, owner: command.kind });
      return { kind: command.kind, placement: command.placement, layerId: command.layerId };
    }
    if (command.placement === 'attached') {
      const adjustmentId = layerPanelController.createAttachedAdjustment(
        command.layerId, command.kind, command.settings
      );
      if (!adjustmentId) return null;
      showProperties({ kind: 'attached-processing', layerId: command.layerId, adjustmentId });
      return { kind: command.kind, placement: command.placement,
        layerId: command.layerId, adjustmentId };
    }
    if (!layerPanelController.createAdjustmentLayerOfKind(
      command.kind, command.aboveLayerId, command.settings
    )) {
      return null;
    }
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (!layerId) return null;
    showProperties({ kind: 'layer', layerId });
    return { kind: command.kind, placement: command.placement, layerId };
  };
  applyAdjustmentRef.current = (kind) => {
    const document = imageDocumentRef.current;
    if (!document) return;
    const command = resolveContextualAdjustmentCreation(document, kind);
    if (command.placement === 'local') {
      const layer = findDocumentLayer(document, command.layerId);
      if (layer?.type === 'raster'
        && adjustmentStackHasLocalProcessing(layer.adjustmentStack, command.kind)) {
        showProperties({ kind: 'processing', layerId: command.layerId, owner: command.kind });
        return;
      }
    }
    void executeRegisteredCommand('adjustment.create', command);
  };
  deleteActiveTargetRef.current = () => {
    const document = imageDocumentRef.current;
    if (!document) return;
    const session = editorSessionRef.current;
    const vectorSelection = session.vectorSelection;
    let hasPixelSelection: boolean;
    try {
      hasPixelSelection = selectionHost.hasActiveSelection();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The current document selection is unavailable.');
      return;
    }
    const target = resolveDeleteTarget({
      activeTool: session.activeTool,
      hasVectorSelection: vectorSelection.elements.length > 0
        || vectorSelection.paths.length > 0
        || vectorSelection.anchors.length > 0,
      hasPixelSelection,
      hasActiveLayer: Boolean(document?.activeLayerId)
    });
    if (!target) return;

    if (target === 'vector-selection') {
      vectorToolSessionController.deleteSelection();
      return;
    }
    if (target === 'pixel-selection') {
      mountedDocumentAdmission.runAfter(() => {
        fillCommandController.clearSelection();
      });
      return;
    }

    if (transformActiveRef.current()) cancelTransformRef.current();

    const layerIds = selectedLayerIdsRef.current.length > 0
      ? selectedLayerIdsRef.current
      : document?.activeLayerId
        ? [document.activeLayerId]
        : [];
    if (layerIds.length > 0) void executeRegisteredCommand('layer.delete', { layerIds });
  };
  const automationGestures = useMountedAutomationGestures({
    session: documentSession, renderer: engineRef.current, lifecycle: rendererLifecycle,
    generation: rendererSnapshot.generation,
    ready: rendererSnapshot.status === 'ready' && workspaceDocumentKind === 'image'
      && imageDocument?.id === documentSession?.getSnapshot().document?.id
  }, {
    getDocument: () => imageDocumentRef.current, getBrush: () => editorSessionRef.current.brush,
    documentMutations: documentMutationController,
    selection: selectionSessionController, paint: paintSessionController
  }, captureMountedInteractionScope);
  useLayoutEffect(() => {
    if (!commandPorts || workspaceDocumentKind !== 'image'
      || rendererSnapshot.status !== 'ready') return;
    // A tab activation publishes workspace state before the persistent GPU
    // renderer has rebound to that document. During that short hand-off the
    // registry keeps resolving the document-owned canonical ports; mounting
    // the previous renderer under the new document ID can otherwise export
    // pixels from the tab we just left.
    if (documentSession
      && imageDocument?.id !== documentSession.getSnapshot().document?.id) return;
    const registeredRenderer = engineRef.current;
    const settleRegisteredInteraction = mountedDocumentAdmission.bindOwner(
      documentSession, registeredRenderer, captureMountedInteractionScope()
    );
    const adjustmentCommands = createMountedAdjustmentCommandBinding({
      session: documentSession, renderer: registeredRenderer, registration: captureMountedInteractionScope(),
      getSession: () => mountedDocumentSessionRef.current, getRenderer: () => engineRef.current,
      getProjectedDocument: () => imageDocumentRef.current,
      isRendererReady: () => currentRendererLifecycleRef.current.getSnapshot().status === 'ready',
      adjustments: adjustmentInteractions, structure: layerDocumentInteractions,
      mutations: documentMutationController, projection: documentProjectionController, history: documentHistoryController
    });
    const { waitForPresentation, ...layerFinalizationCommands } = createLayerFinalizationCommandBinding({
      captureScope: () => captureLayerFinalizationScope(documentSession, registeredRenderer, {
        getCurrentSession: () => mountedDocumentSessionRef.current,
        getCurrentRenderer: () => engineRef.current,
        captureRendererScope: captureMountedInteractionScope
      }),
      getDocument: () => imageDocumentRef.current,
      waitForFrame: () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())),
      settlePixels: settleMountedDocumentInteraction,
      commands: layerDocumentCommands
    });
    return commandPorts.register(workspaceDocumentId as DocumentSessionId, {
      settleInteractionBeforeCommand: async (command) => {
        // Zoom does not change canonical content and may remain available
        // during a transform. All semantic document commands first publish
        // presentation-owned selection/transform state through its owner.
        if (command === 'view.setZoom') return;
        if (command === 'file.exportNative' || command === 'file.exportPng' || command === 'file.exportBitmap'
          || command === 'file.exportPsd' || command === 'file.exportSvg') {
          await documentFileIntents.prepareForCommand(documentSession);
          return;
        }
        await settleRegisteredInteraction();
      },
      supportsCommand: isMountedDocumentCommand,
      resizeImage: commitImageSize,
      applyDocumentGeometry: commitDocumentGeometry,
      assignDocumentProfile: ({ profile }) => {
        const changed = documentMutationController.change((document) => (
          document.colorSettings.workingProfile === profile
            && document.colorSettings.profileState === 'assigned'
            ? document
            : {
                ...document,
                colorSettings: {
                  ...document.colorSettings,
                  workingProfile: profile,
                  profileState: 'assigned'
                },
                revision: document.revision + 1,
                modifiedAt: Date.now()
              }
        ));
        return { profile, profileState: 'assigned', changed };
      },
      setZoom: (viewport) => {
        if (viewport.zoomMode === 'fit') applyFitZoom();
        else if (viewport.zoomMode === '100') applyActualZoom();
        else applyExactZoom(viewport.scale * 100);
      },
      createRasterLayer: layerPanelController.createRasterLayer,
      copyPixels: async (source) => {
        await settleMountedDocumentInteraction();
        return source === 'active-layer'
          ? layerDocumentCommands.copySelectedContent(editorSessionRef.current.selection)
          : layerDocumentCommands.copyMergedContent(editorSessionRef.current.selection);
      },
      cutPixels: () => clipboardCommands.cut.execute(),
      pastePixels: async (file, command, fastPasteToken) => {
        return layerDocumentCommands.pastePixelArtifact(
          file, { ...command.bounds, name: command.name,
            target: command.target ? { ...command.target,
              layerId: command.target.layerId as LayerId | undefined } : undefined }, fastPasteToken
        );
      },
      copyGrade: captureCurrentGrade,
      pasteGrade: applyGradeCapture,
      placeArtifact: layerDocumentCommands.placeImageArtifact,
      renameLayer: layerPanelController.rename,
      setLayerVisibility: layerPanelController.setVisibility,
      setLayerFillOpacity: layerPanelController.setFillOpacity,
      setLayerStyleEnabled: (layerId, enabled) => {
        const document = imageDocumentRef.current;
        const layer = document ? findDocumentLayer(document, layerId) : null;
        if (!layer) throw new Error('The Layer Style owner does not exist.');
        void executeSemanticLayerStyleSnapshot({
          layerId,
          snapshot: { ...layerStyleSnapshot(layer.styleStack), enabled }
        }, { changeDocument: documentMutationController.change });
      },
      setLayerEffectEnabled: (layerId, effectId, enabled) => executeSemanticLayerStyleCommand(
        { kind: 'toggle', layerId, effectId, enabled }, {
          changeDocument: documentMutationController.change
        }),
      executeTextCommand: async (command) => {
        const result = await executeSemanticTextCommand(command, {
          fontRegistry: textFontRegistry,
          getDocument: () => imageDocumentRef.current,
          getTextSettings: () => editorSessionRef.current.text, getForegroundColor: () => editorSessionRef.current.brush.color,
          changeDocument: documentMutationController.change
        });
        if (!result) return null;
        if (!await waitForExactCommandRender(engineRef.current)) {
          console.warn('[LightTable render] Text edit committed while its exact render source is still pending.');
        }
        return result;
      },
      executeVectorCommand: (command) => executeSemanticVectorCommand(command, {
        changeDocument: documentMutationController.change
      }),
      executeSvgImport: createMountedSvgImportBinding(documentSession, {
        getCurrentSession: () => mountedDocumentSessionRef.current,
        captureRendererScope: captureMountedInteractionScope,
        changeDocument: documentMutationController.change
      }),
      executeWarpStrokeCommand: (command) => executeSemanticWarpStrokeCommand(command, {
        getDocument: () => imageDocumentRef.current,
        changeDocument: documentMutationController.change,
        createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`,
      }),
      executeFillCommand: async (command) => {
        await settleMountedDocumentInteraction();
        return fillCommandController.apply(command);
      },
      executeRasterGradientCommand: async (command) => {
        await settleMountedDocumentInteraction();
        return rasterGradientController.apply(command);
      },
      executeLayerStyleCommand: (command) => executeSemanticLayerStyleCommand(command, {
        changeDocument: documentMutationController.change
      }),
      executeLayerStyleSnapshot: (command) => executeSemanticLayerStyleSnapshot(command, {
        changeDocument: documentMutationController.change
      }),
      executeFilterSnapshot: (command) => executeSemanticFilterSnapshot(command, {
        changeDocument: documentMutationController.change
      }),
      executeFaceWarpCommand: (command) => executeSemanticFaceWarpCommand(command, {
        getDocument: () => imageDocumentRef.current,
        changeDocument: documentMutationController.change
      }),
      executeLayerCommand: createMountedLayerCommandBinding(documentSession, engineRef.current, {
        getCurrentSession: () => mountedDocumentSessionRef.current,
        getCurrentRenderer: () => engineRef.current,
        captureRendererScope: captureMountedInteractionScope
      }, {
        panel: layerPanelController, pixels: layerDocumentCommands,
        mutations: documentMutationController,
        settlePixels: settleMountedDocumentInteraction,
        waitForPresentation: async () => { await waitForPresentation(); },
        loadMaskAsSelection: selectionSessionController.selectLayerMask
      }),
      executeSelectionCommand: createMountedSelectionCommandBinding({
        session: documentSession, renderer: registeredRenderer, registration: captureMountedInteractionScope(),
        getSession: () => mountedDocumentSessionRef.current, getRenderer: () => engineRef.current,
        getProjectedDocument: () => imageDocumentRef.current, captureScope: captureMountedInteractionScope,
        settle: settleRegisteredInteraction, selection: selectionSessionController
      }),
      executeSubjectSelection: (command, signal, report) => (
        smartSelectionController.executeSubjectSelection(command, signal, report)
      ),
      ...adjustmentCommands,
      executeFixedTransform: (command) => applyFixedTransformRef.current(command.operation),
      executeAdjustmentCreation: (command) => executeAdjustmentCreationRef.current(command),
      executeRasterInvert: async (command) => {
        await settleMountedDocumentInteraction();
        return layerDocumentCommands.invertLayerColors(
          command.layerId, command.channel
        ) ? command : null;
      },
      ...layerFinalizationCommands,
      executeTextToShape: async (command) => (
        await textToShape.command.convert(command.layerId)
          ? { layerId: command.layerId, outputType: 'vector' as const }
          : null
      ),
      executeBackgroundRemoval: async (command, signal, report) => {
        return await backgroundRemovalController.removeBackgroundFromLayer(
          command.layerId,
          command.mode,
          { signal, onProgress: (progress) => report(
            Math.max(0, Math.min(1, (progress.percent ?? 0) / 100)), progress.message
          ) }
        );
      },
      executeAutoAlign: (command, signal) => autoAlignController.execute(command, signal),
      executeAtomicBatch: async (batch, signal, report) => {
        const result = await executeAtomicCommandBatch(batch, {
          fontRegistry: textFontRegistry, documentMutations: documentMutationController,
          getTextSettings: () => editorSessionRef.current.text,
          getForegroundColor: () => editorSessionRef.current.brush.color
        }, signal, report);
        if (!await waitForExactCommandRender(engineRef.current, signal)) {
          console.warn('[LightTable render] Batch committed while an exact render source is still pending.');
        }
        return result;
      },
      exportNativeArtifact: () => exportNativeArtifactRef.current(),
      exportPngArtifact: () => exportPngArtifactRef.current(),
      exportBitmapArtifact: (format) => exportBitmapArtifactRef.current(format),
      exportPreviewArtifact: async (maxEdge, encoding, region) => {
        return exportPreviewArtifactRef.current(maxEdge, encoding, region);
      },
      getDocumentPalette: (colorCount) => loadDocumentPalette(colorCount),
      getLayerPalette: (layerId, colorCount) => loadLayerPalette(layerId, colorCount),
      exportLayerPreviewArtifact: async (layerId, channel, maxEdge, encoding) => {
        const preview = await engineRef.current?.exportLayerThumbnail(
          layerId, channel === 'mask', maxEdge, maxEdge, encoding
        );
        if (!preview) throw new Error(`Layer ${layerId} has no renderable ${channel} content.`);
        const mediaType = encoding.format === 'webp' ? 'image/webp' : 'image/png';
        return { file: new File([preview.blob], `layer-${channel}.${encoding.format}`, { type: mediaType }),
          width: preview.width, height: preview.height, sourceToOutput: preview.sourceToOutput };
      },
      exportPsdArtifact: (signal) => exportPsdArtifactRef.current(signal),
      exportSvgArtifact: () => {
        const document = imageDocumentRef.current;
        if (!document) throw new Error('The SVG export document is unavailable.');
        return exportSvgDocument(document, fileNameBase);
      },
      ...automationGestures,
      undo: applyUndoEditor,
      redo: applyRedoEditor,
      queryRenderTelemetry: () => engineRef.current?.renderTelemetrySnapshot() ?? null,
      resetRenderTelemetry: () => engineRef.current?.resetRenderTelemetry(),
      forceDeviceLossForAutomation: () => engineRef.current?.forceDeviceLossForAutomation() ?? false
    });
  }, [applyActualZoom, applyExactZoom, applyFitZoom, applyRedoEditor, applyUndoEditor,
    automationGestures, commandPorts, documentSession, imageDocument?.id, layerDocumentCommands,
    layerPanelController, rendererSnapshot.status, workspaceDocumentId,
    workspaceDocumentKind]);

  const resolveLayerPanelDocument = useCallback(() => imageDocumentRef.current, []);
  const commandLayerPanelController = useCommandLayerPanelController({
    controller: layerPanelController,
    commandService,
    documentId: workspaceDocumentId as DocumentSessionId,
    executeCommand: executeRegisteredCommand,
    getDocument: resolveLayerPanelDocument,
    reportError: setError
  });

  toggleSelectedLayerVisibilityRef.current = () => {
    const document = imageDocumentRef.current;
    if (!document) return;
    const activeLayer = findDocumentLayer(document, document.activeLayerId);
    if (!activeLayer) return;
    const selected = selectedLayerIdsRef.current.filter((layerId) =>
      Boolean(findDocumentLayer(document, layerId)));
    commandLayerPanelController.setVisibility(
      selected.length ? selected : [activeLayer.id],
      !activeLayer.visible
    );
  };
  showAllLayersRef.current = () => commandLayerPanelController.setAllLayersVisibility(true);
  selectLayerRef.current = layerPanelController.select;

  const gradeInspector = new GradeInspectorController({
    getContext: () => readAdjustmentContext(),
    getVisibility: processingBinding.getGroupVisibility,
    publishVisibility: documentProjectionController.applyGroupVisibilitySnapshot,
    layers: commandLayerPanelController
  });
  const { ownerId: gradeOwnerId, usesDocumentVisibility: gradeUsesDocumentVisibility,
    sectionVisibility: gradeSectionVisibility, masterEnabled: gradeMasterEnabled } =
    projectGradeInspector(readAdjustmentContext(imageDocument, propertiesTarget), groupVisibility);
  const updatePointColorRangeVisualization = useCallback((sample: PointColorSample | null) => {
    if (!sample) {
      setPointColorRangeVisualization(null);
      return;
    }
    if (!gradeUsesDocumentVisibility && !gradeOwnerId) {
      setPointColorRangeVisualization(null);
      return;
    }
    setPointColorRangeVisualization({
      ownerId: gradeUsesDocumentVisibility ? null : gradeOwnerId,
      sample: { ...sample }
    });
  }, [gradeOwnerId, gradeUsesDocumentVisibility]);

  const guideInteraction = useDocumentGuideInteraction(documentSession, engineRef.current,
    rendererLifecycle, rendererSnapshot.generation, rendererSnapshot.status === 'ready', imageDocument?.id,
    captureMountedInteractionScope, { changeDocument: documentMutationController.change, reportFailure: setError,
      getRenderer: () => engineRef.current });

  const transformSession = useTransformSessionController({
    activeTool: editorSession.activeTool,
    activeDocument: imageDocument,
    activeLayerId: imageDocument?.activeLayerId ?? null,
    activeChannel: editorSession.activeChannel,
    selectedLayerIds,
    activationRevision: transformActivationRevision,
    selectionRevision: documentSession?.getSnapshot().editor.selectionRevision
      ?? editorSession.selectionRevision,
    getSelectionLease: () => {
      if (!documentSession || !imageDocumentRef.current) return null;
      return new DocumentSelectionStateStore(documentSession).acquire(
        documentSession.getSnapshot().documentRevision
      );
    },
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation,
    rendererGeneration: rendererSnapshot.generation,
    documentMutations: documentMutationController,
    applyDocumentSnapshot,
    applyDocumentAndSelection: documentSelectionPublication.publishTransform,
    reserveHistoryEntry: documentHistoryController.reserve,
    setError,
    setStatus: setGradeStatus,
    transformFrameMode: toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document',
    onLayerTransformCommitted: (layerId, transform) => {
      if (!fixedTransformCommandRunningRef.current) {
        commandService.recordObservedCommand(
          'layer.setTransform', workspaceDocumentId as DocumentSessionId,
          { layerId, transform }, { layerId, transform }
        );
      }
    }
  });
  beginSelectionContentMoveRef.current = (duplicate) =>
    transformSession.beginTemporaryMove(duplicate);
  updateSelectionContentMoveRef.current = (x, y) => {
    transformSession.update({ a: 1, b: 0, c: 0, d: 1, tx: x, ty: y });
  };
  finishSelectionContentMoveRef.current = (commit) => {
    if (commit) transformSession.commit();
    else transformSession.cancel();
  };
  const transformState = transformSession.state;
  const temporarySelectionMoveActive = transformSession.ownsTemporaryMove();
  const transformPresentation = useTransformPresentation(engineRef.current, documentSession,
    rendererSnapshot.generation, rendererLifecycle, captureMountedInteractionScope,
    () => ({ state: transformSession.state, frameOverride: transformSession.frameOverride,
      temporaryMove: transformSession.ownsTemporaryMove(), scale: activeScale,
      frameMode: toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document',
      snap: readEditorSession().snap, selectionFeedback: selectionSnapFeedback,
      document: imageDocumentRef.current, selectedLayerIds: selectedLayerIdsRef.current }),
    transformSession);
  useGuideGridPresentation(engineRef.current, documentSession, rendererSnapshot.generation,
    rendererLifecycle, captureMountedInteractionScope, guideInteraction, () => {
      const state = mountedDocumentSessionRef.current?.getSnapshot(), snap = readEditorSession().snap;
      return { document: state?.lifecycle === 'ready' && state.document?.id === imageDocumentRef.current?.id ? state.document : null,
        guidesVisible: snap.extrasVisible !== false && snap.guidesVisible,
        gridVisible: snap.extrasVisible !== false && snap.gridVisible,
        gridSpacing: snap.gridSpacing / Math.max(1, snap.gridSubdivisions),
        gridOriginX: snap.gridOriginX, gridOriginY: snap.gridOriginY, zoom: activeScale };
    }, () => engineRef.current);
  const panTransformViewport = useCallback((deltaX: number, deltaY: number) => {
    setZoomMode('custom');
    setView((current) => ({
      ...current,
      panX: current.panX + deltaX,
      panY: current.panY + deltaY
    }));
  }, [setView, setZoomMode]);
  commitTransformRef.current = transformSession.commit;
  commitTransformPendingRef.current = transformSession.commitPending;
  settlePixelInteractionRef.current = async isCurrent => {
    await selectionSessionController.settle();
    if (!isCurrent()) return;
    await transformSession.commitPending();
  };
  const resetMountedTransform = transformSession.reset;
  useLayoutEffect(() => {
    const toolActivation = persistentToolActivationRef.current;
    return () => {
      toolActivation.retire();
      interactionTransitions.retire(() => {
        selectionSessionController.retire();
        resetMountedTransform();
      });
    };
  }, [interactionTransitions, selectionSessionController, resetMountedTransform, workspaceDocumentId, documentSession]);
  cancelTransformRef.current = transformSession.cancel;
  resetTransformRef.current = transformSession.reset;
  transformActiveRef.current = transformSession.isActive;
  repeatTransformRef.current = transformSession.repeat;
  nudgeTransformRef.current = transformSession.nudge;
  hostPresentationDeactivateRef.current = () => deactivateHostPresentation({
    interactions: interactionTransitions, viewport: viewportInteraction,
    adjustments: adjustmentInteractions, rasterGradient: rasterGradientController,
    cancelAutoAlign: cancelAutoAlignRef.current
  });
  applyFixedTransformRef.current = async (operation) => {
    if (fixedTransformCommandRunningRef.current) return null;
    const before = imageDocumentRef.current;
    if (!before) return null;
    fixedTransformCommandRunningRef.current = true;
    try {
      const target = await transformSession.applyFixed(operation);
      const after = imageDocumentRef.current;
      return target && after && after.id === before.id && after.revision !== before.revision
        ? { operation, target, documentRevision: after.revision }
        : null;
    } finally {
      fixedTransformCommandRunningRef.current = false;
    }
  };

  const activatePersistentTool = (requestedTool: ToolId, afterActivation?: () => void) => {
    const scope = captureMountedInteractionScope();
    const operation = persistentToolActivationRef.current.activate(requestedTool, {
      isCurrent: scope.isCurrent,
      currentTool: () => readEditorSession().activeTool,
      clearCrop: () => setCropBounds(null),
      text: {
        cancelCreation: textCreationInteraction.cancel,
        finishEditing: () => textEditingController.finish()
      },
      warp: { isActive: () => warpSessionController.active, reset: () => warpSessionController.reset() },
      faceWarp: { reset: () => faceWarpSessionController.reset(), resetDetection: () => faceWarpDetectionController.reset() },
      transform: {
        isActive: transformSession.isActive, hasPendingWork: transformSession.hasPendingWork,
        begin: transformSession.begin
      },
      settleInteraction: settleMountedDocumentInteraction,
      selection: { hasDraft: () => Boolean(selectionSessionController.draft), reset: selectionSessionController.reset },
      publishTool: (tool) => setEditorSession((current) => applyPersistentToolPreference(current, tool))
    }, afterActivation);
    void operation.then(undefined, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Tool activation failed.');
    });
    return operation;
  };
  activateToolRef.current = activatePersistentTool;

  const invertActiveLayerColors = () => {
    mountedDocumentAdmission.runAfter(() => {
      const layerId = imageDocumentRef.current?.activeLayerId;
      const channel = editorSessionRef.current.activeChannel;
      if (layerId) void executeRegisteredCommand('raster.invert', { layerId, channel });
    });
  };
  invertActiveLayerColorsRef.current = invertActiveLayerColors;

  const rasterizeActiveTextLayerCommand = () => {
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (!layerId) {
      setError('Select a layer to rasterize.');
      return;
    }
    textEditingController.finish();
    textCreationInteraction.cancelPoint();
    textCreationInteraction.cancelParagraph();
    executeRegisteredCommand('layer.rasterize', { layerId });
  };

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
    exportBitmapArtifact,
    save: handleSave,
    exportJpeg: handleExportJpeg,
    exportWebp: handleExportWebp,
    exportTiff: handleExportTiff,
    exportPsd: handleExportPsd,
    exportPsdMaximumAppearance: handleExportPsdMaximumAppearance,
    exportSvg: handleExportSvg,
    handleFastFileInput: handleLocalFile,
    handlePrecisionFileInput: handleAdvancedLocalFile,
    chooseLocalFile,
    deliverExportFile,
    fileInputRef,
    advancedFileInputRef
  } = useEditorDocumentFileController({
    lifecycle: documentLifecycleController,
    taskRegistry,
    commandHistory,
    effectiveSourceFileKey,
    fileNameBase,
    sourceFile: initialSourceBlob instanceof File ? initialSourceBlob : null,
    hasMetadata: Boolean(metadata),
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation,
    getFlatAdjustments: () => processingBinding.getEditorAdjustments(),
    getDocumentAdjustments: () => processingBinding.getDocumentAdjustments(),
    getEffectiveLayeredAdjustments: () => processingBinding.getDocumentAdjustments(),
    getGlobalGradeStrength: () => processingBinding.getStrength(),
    getPreservedSourceAssets: () => [...loadedSourceBinding.getPreservedSources()],
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
    onExportFile,
    getDocumentRevision: () => documentSession?.getSnapshot().documentRevision
      ?? commandHistory.getSnapshot().currentStateId,
    getIsDirty: () => documentSession?.getSnapshot().dirty
      ?? commandHistory.getSnapshot().dirty,
    commitSavedRevision: (revision) => {
      if (documentSession) documentSession.markSaved(revision);
      else commandHistory.markSaved();
    },
    onSaveCommitted: recoveryStore
      ? async (savedRevision) => {
          await recoveryStore.remove(workspaceDocumentId, savedRevision);
          await onRecoveryResolved?.();
        }
      : undefined,
    onRequestOpenWorkspaceDocument,
    onOpenWorkspaceDocument,
    setLoading,
    setError,
    setStatus: setGradeStatus
  });
  const recoveryJournal = useEditorRecoveryJournal({ store: recoveryStore,
    canCaptureSnapshot: () => !documentMutationController.active,
    enabled: recoveryPreferences?.enabled ?? true,
    intervalMs: recoveryPreferences?.intervalMs,
    documentId: workspaceDocumentId,
    sourceKey: effectiveSourceFileKey, sourceName: initialSourceName, sourceBlob: initialSourceBlob, active, commandHistory,
    documentSession, exportOutput,
    workspaceOrder: Math.max(0, workspaceDocuments?.findIndex(({ id }) => id === workspaceDocumentId) ?? 0),
    getCanonicalRevision: () => documentSession?.getSnapshot().documentRevision ?? commandHistory.getSnapshot().currentStateId,
    setStatus: setGradeStatus });
  useEffect(() => onRegisterRecoveryFlush?.(workspaceDocumentId, recoveryJournal.flush), [
    onRegisterRecoveryFlush,
    recoveryJournal,
    workspaceDocumentId
  ]);
  exportNativeArtifactRef.current = async () => (await exportOutput({ forceLayered: true })).file;
  const captureCurrentRendererBinding = () => captureRendererBinding({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation
  });
  // Keep UI, command/MCP and GenAI document-reference PNGs on the same native
  // bitmap path so a 16-bit document is not silently quantized by one route.
  exportPngArtifactRef.current = () => exportBitmapArtifact('png');
  exportBitmapArtifactRef.current = (format) => exportBitmapArtifact(format);
  exportPreviewArtifactRef.current = (maxEdge, encoding, region) => {
    const binding = captureCurrentRendererBinding();
    return exportEditorPreviewArtifact(
      binding.renderer, binding.document, fileNameBase, maxEdge, encoding, region, binding
    );
  };
  exportPsdArtifactRef.current = (signal) => {
    const binding = captureCurrentRendererBinding();
    return exportEditorPsdArtifact(binding.renderer, binding.document, fileNameBase, binding, signal);
  };

  const documentFileIntents = useDocumentFileIntents({
    getSession: () => mountedDocumentSessionRef.current,
    getRenderer: () => engineRef.current,
    captureScope: captureMountedInteractionScope,
    settlePixels: settleMountedDocumentInteraction,
    commitAdjustments: adjustmentInteractions.finishForFile,
    commitLayerDocument: layerDocumentInteractions.finishForFile,
    finishTextCreation: textCreationInteraction.finishForFile,
    assertTextCreationCommandReady: textCreationInteraction.assertFileCommandReady,
    finishTextEditing: () => textEditingController.finishForFile(),
    commands: commandService,
    nextRequestId: id => `ui-${id}-${++commandRequestSequenceRef.current}`,
    save: handleSave,
    exportJpeg: handleExportJpeg,
    exportWebp: handleExportWebp,
    exportTiff: handleExportTiff,
    exportPsd: handleExportPsd,
    exportPsdMaximumAppearance: handleExportPsdMaximumAppearance,
    exportSvg: handleExportSvg,
    deliverExportFile,
    reportError: setError
  });

  const removeSelectedObject = useGenAiRemoveObject({
    service: genAiService, projectId: activeGenAiProjectId,
    preferredProviderIds: [editGenAiProviderId, selectedGenAiProviderId],
    documentName: initialSourceName, fileIntents: documentFileIntents,
    getSession: () => mountedDocumentSessionRef.current,
    getRenderer: () => engineRef.current, getDocument: () => imageDocumentRef.current,
    captureScope: captureMountedInteractionScope,
    hasActiveMutation: () => documentMutationController.active || adjustmentTransactionController.active,
    projectProcessing: processingBinding.projectReadyRenderer,
    status: setGradeStatus, error: setError
  });

  const openPdfExportPreflight = usePdfExportPreflight({
    fileIntents: documentFileIntents,
    getSession: () => mountedDocumentSessionRef.current,
    getRenderer: () => imageDocumentRef.current?.id === mountedDocumentSessionRef.current?.getSnapshot().document?.id
      ? engineRef.current : null,
    getFonts: () => textFontRegistry,
    getFileName: () => fileNameBase,
    captureScope: captureMountedInteractionScope,
    deliver: deliverExportFile,
    openDialog: editorDialogs.openPdfExportPreflight,
    reportError: setError
  });

  const duplicateImage = useCallback(async (name: string) => {
    if (!commandService || duplicateImageBusy) return;
    setDuplicateImageBusy(true);
    setDuplicateImageError(null);
    try {
      const result = await commandService.execute({
        protocolVersion: 1,
        requestId: `duplicate-document-${crypto.randomUUID()}`,
        command: 'document.duplicate',
        documentId: workspaceDocumentId,
        parameters: { name }
      });
      if (result.status === 'rejected') throw new Error(result.message);
      editorDialogs.closeDuplicateImage();
    } catch (reason) {
      setDuplicateImageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDuplicateImageBusy(false);
    }
  }, [commandService, duplicateImageBusy, editorDialogs, workspaceDocumentId]);

  const editorMenuController = createEditorMenuController({
    aiProviders: {
      openArt: openArtProvider.status === 'connected' ? 'connected' : 'disconnected'
    },
    projection: {
      document: imageDocumentRef.current,
      saving,
      hasMetadata: Boolean(metadata),
      hasSourceKey: Boolean(effectiveSourceFileKey),
      hasCompatibilityReport: Boolean(
        imageDocument?.photoshopImportReport || fontDiagnostics.length > 0
      ),
      copiedGradeName: copiedGrade?.name ?? null,
      hasSelection: editorSession.selectionMaskSnapshot?.active === true,
      selectionClipboardAvailable,
      activeChannel: editorSession.activeChannel,
      autoAlignPreview: Boolean(autoAlignPreview),
      zoomMode,
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
      place: () => { finishTextEditingRef.current(); void Promise.resolve(onRequestPlaceWorkspaceArtifact?.(workspaceDocumentId)).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); },
      importSvg: () => { finishTextEditingRef.current(); svgImportInputRef.current?.click(); },
      recentFiles,
      openRecent: (id) => {
        finishTextEditingRef.current();
        void onOpenRecentWorkspaceDocument?.(id);
      },
      clearRecent: () => { void onClearRecentWorkspaceDocuments?.(); },
      recoveryFiles,
      openRecovery: (id) => { void onOpenRecoveryFile?.(id); },
      projectsAvailable: Boolean(onRequestNewProject && onRequestOpenProject),
      activeProject,
      recentProjects,
      newProject: () => onRequestNewProject?.(),
      openProject: () => onRequestOpenProject?.(),
      openRecentProject: (recentId) => onOpenRecentProject?.(recentId),
      clearRecentProjects: () => onClearRecentProjects?.(),
      closeProject: () => onCloseProject?.(),
      exitApplication: onExitApplication,
      save: () => { void documentFileIntents.save(); },
      exportPng: () => { void documentFileIntents.exportPng(); },
      exportJpeg: () => { void documentFileIntents.exportJpeg(); },
      exportWebp: () => { void documentFileIntents.exportWebp(); },
      exportTiff: () => { void documentFileIntents.exportTiff(); },
      exportPsd: () => { void documentFileIntents.exportPsd(); },
      exportPsdMaximumAppearance: () => { void documentFileIntents.exportPsdMaximumAppearance(); },
      exportSvg: () => { void documentFileIntents.exportSvg(); },
      openFormatSupport: editorDialogs.openFormatSupport,
      pdfExportPreflight: () => { void openPdfExportPreflight(); }
    },
    edit: {
      cutSelectedContent,
      copySelectedContent,
      copyMergedContent,
      pasteSelectedContent,
      pasteGrade: pasteCurrentGrade,
      copyGrade: copyCurrentGrade,
      applyFixedTransform: (operation) => {
        void executeRegisteredCommand('transform.applyFixed', { operation });
      }
    },
    selection: {
      selectAll: selectAllContent,
      clear: clearCurrentSelection,
      invert: invertCurrentSelection,
      selectSimilar: selectSimilarColors,
      removeObject: removeSelectedObject,
      removeBackground: backgroundRemovalController.request
    },
    image: {
      openSize: editorDialogs.openImageSize,
      openCanvasSize: editorDialogs.openCanvasSize,
      openArbitraryRotation: editorDialogs.openArbitraryRotation,
      applyDocumentGeometry: runDocumentGeometryCommand,
      beginCrop,
      duplicate: () => {
        setDuplicateImageError(null);
        editorDialogs.openDuplicateImage();
      },
      applyCurves: () => applyCurvesRef.current(),
      applyAdjustment: (kind) => applyAdjustmentRef.current(kind),
      createAdjustmentLayer: (kind) => {
        const document = imageDocumentRef.current;
        if (!document) return;
        const active = findDocumentLayer(document, document.activeLayerId);
        const command = {
          kind,
          placement: 'adjustment-layer' as const,
          ...(active ? { aboveLayerId: active.id } : {})
        };
        void executeRegisteredCommand('adjustment.create', command);
      },
      attachAdjustment: (kind) => {
        const document = imageDocumentRef.current;
        if (!document) return;
        const active = findDocumentLayer(document, document.activeLayerId);
        if (active?.type !== 'raster' || layerIsLocked(active, 'pixels')) return;
        const command = { kind, placement: 'attached' as const, layerId: active.id };
        void executeRegisteredCommand('adjustment.create', command);
      },
      assignSrgbProfile: () => {
        void executeRegisteredCommand('document.assignProfile', { profile: 'srgb' });
      }
    },
    layers: {
      panel: commandLayerPanelController,
      duplicate: commandLayerPanelController.duplicateActive,
      rasterizeText: rasterizeActiveTextLayerCommand,
      convertTextToShape: () => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) textToShape.intent.request(layerId);
      },
      layerViaCopy,
      rename: focusActiveLayerName,
      invertColors: invertActiveLayerColors,
      loadMaskSelection: () => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) executeRegisteredCommand('layer.setMask', {
          layerId, operation: 'load-selection'
        });
      },
      invertMask: () => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) executeRegisteredCommand('layer.setMask', {
          layerId, operation: 'invert'
        });
      },
      applyMask: () => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) executeRegisteredCommand('layer.setMask', {
          layerId, operation: 'apply'
        });
      },
      addEffect: addLayerEffectFromMenu,
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
      fit: workspaceViewControls?.onZoomFit ?? fitZoom,
      actualSize: workspaceViewControls?.onZoomActual ?? actualZoom,
      setShowDifference,
      snap: editorSession.snap,
      setSnap: (action) => setEditorSession((current) => ({
        ...current,
        snap: typeof action === 'function' ? action(current.snap) : action
      })),
      clearGuides: guideInteraction.clear,
      newGuide: editorDialogs.openNewGuide
    },
    workspace: {
      showDebugPanel: () => workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.debug),
      showActionsPanel: () => workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.actions),
      showGenAiPanel: () => workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi),
      showAiHistoryPanel: () => workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory),
      connectOpenArtProvider: () => {
        workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi);
        if (genAiService) {
          void genAiService.connectProvider(openArtProviderId).then(updateGenAiProviderSnapshot);
        }
      },
      disconnectOpenArtProvider: () => {
        if (genAiService) {
          void genAiService.disconnectProvider(openArtProviderId).then(updateGenAiProviderSnapshot);
        }
      },
      openStyleGuide: onOpenStyleGuide,
      reloadUi: developerService?.reloadUi,
      toggleDeveloperTools: developerService?.toggleDeveloperTools,
      toggleScreenMode,
      resetLayout: () => workspaceRef.current?.resetLayout(),
      applyPhotoEditWorkspace: () => workspaceRef.current?.applyPreset('photo-edit'),
      applyGradingWorkspace: () => workspaceRef.current?.applyPreset('grading'),
      applyAiGenerationWorkspace: () => workspaceRef.current?.applyPreset('ai-generation'),
      applyVideoWorkspace: () => workspaceRef.current?.applyPreset('video'),
      workspacePanels,
      toggleWorkspacePanel: (panelId) => workspaceRef.current?.togglePanel(panelId),
      startGuidedSample: onStartGuidedSample,
      openSettings: onOpenSettings
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
      openMaskEditingOnDoubleClick={toolPreferences?.openMaskEditingOnDoubleClick ?? true}
      controller={commandLayerPanelController}
      onAddStyle={addLayerEffectFromMenu}
      selectedLayerIds={selectedLayerIds}
      onLayerNamePointerDown={handleLayerNamePointerDown}
      consumeLayerNameRenameGesture={consumeLayerNameRenameGesture}
      cancelLayerNameRenameGesture={cancelLayerNameRenameGesture}
      editingTextLayerId={textEditing.layerId}
      onEditText={(layerId) => {
        void textEditingEntry.selectAndEnter(layerId);
      }}
      onOpenFontReport={() => editorDialogs.openPsdReport()}
      onConvertTextToShape={textToShape.intent.request}
      onRemoveBackground={backgroundRemovalController.request}
      onSelectionChange={handleLayerSelectionChange}
      inspectorTarget={propertiesTarget}
      onInspectLayer={(layerId, channel) => {
        showProperties(channel === 'mask'
          ? { kind: 'mask', layerId }
          : { kind: 'layer', layerId });
      }}
      onInspectProcessing={(layerId, owner) => {
        showProperties({ kind: 'processing', layerId, owner });
      }}
      onInspectAttachedAdjustment={layerPanelController.inspectAttachedAdjustment}
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
      onSelectCompositeChannel={(channel) => {
        mountedDocumentAdmission.runAfter(() => {
          void selectionSessionController.selectCompositeChannel(channel);
        });
      }}
      onSelectLayerMask={(layerId) => {
        void executeRegisteredCommand('layer.setMask', {
          layerId, operation: 'load-selection'
        });
      }}
    />
  );

  const statusBar = buildEditorStatus({
    metadata: viewportMetadata,
    document: imageDocument,
    scale: activeScale,
    startupTimings,
    gpuMemoryBytes,
    photoshopImport: psdImportInfo,
    photoshopCompatibilitySummary: psdCompatibilitySummary,
    referenceDifference: psdDifferenceMetrics,
    reportAvailable: Boolean(imageDocument?.photoshopImportReport)
  });

  if (!open) return null;

  const visibleTool = temporaryTool.snapshot.tool ?? editorSession.activeTool;
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
  const { layer: activeTextPropertyLayer, model: textPropertyPresentation,
    layoutMode: textLayoutMode } = resolveTextProperties(imageDocument, textEditingController, availableFontAssets);
  const positionedTextRecovery = activeTextPropertyLayer?.type === 'text'
    && activeTextPropertyLayer.text.source.kind === 'positioned'
    ? positionedTextRecoveryController.analyze(activeTextPropertyLayer.id) : null;
  const textPropertyCommands = useTextPropertyCommands(documentSession ?? workspaceDocumentId, {
    getDocument: () => imageDocumentRef.current,
    getTool: () => editorSessionRef.current.activeTool,
    captureScope: captureMountedInteractionScope,
    getFontRegistry: () => textFontRegistry,
    getFonts: () => selectableTextFonts,
    loadFont: async assetId => await registerBundledTextFontByAssetId(textFontRegistry, assetId)
      ?? textFontRegistry.availableAssets.find(font => font.assetId === assetId) ?? null,
    getPresentation: () => textPropertyPresentation,
    getBrushColor: () => editorSessionRef.current.brush.color,
    updateBrushColor: color => updateBrush({ color }),
    updateDefaults: recipe => setEditorSession(current => ({ ...current, text: recipe(current.text) })),
    getFirstBaselineOffset: layerId => engineRef.current?.textEditingLayout(layerId)?.layout.firstBaselineOffset ?? 0,
    gestures: textPropertyGestureController,
    editing: textEditingController,
    mutations: documentMutationController,
    execute: executeRegisteredCommand,
    activateTool: activatePersistentTool,
    reportFailure: reason => setError(reason instanceof Error ? reason.message : String(reason))
  });
  const {
    updateDefaults: updateText, begin: beginTextPropertyGesture, apply: applyTextPropertyPatch,
    commit: commitTextPropertyGesture, cancel: cancelTextPropertyGesture,
    applyStyle: applyDiscreteTextProperty, applyParagraph: applyDiscreteTextParagraph,
    applyFill: applyTextFill, applyFillPaint: applyTextFillPaint, applyFillEnabled: applyTextFillEnabled,
    applyStrokeColor: applyTextStrokeColor, applyStrokeWidth: applyTextStrokeWidth, changeLayoutMode: changeTextLayoutMode
  } = textPropertyCommands;
  const applyTextFontAsset = (assetId: string) => {
    void textPropertyCommands.applyFont(assetId).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  const applyTextWritingMode = (mode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr') => {
    void textPropertyCommands.applyWritingMode(mode).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  };
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
  const faceWarpToolOptions = {
    faces: visibleFaceWarpFaces,
    selectedFaceId: effectiveFaceWarpFaceId,
    busy: faceWarpBusy,
    reviewPending: pendingFaceWarpDetectionForActiveLayer !== null,
    meshVisible: faceWarpMeshVisible,
    brushSize: editorSession.brush.size,
    brushStrength: editorSession.brush.opacity,
    semanticTarget: faceWarpSemanticTarget,
    protectedFeature: faceWarpProtectedFeature,
    onDetect: () => { void detectFacesForActiveLayer(); },
    onAcceptDetection: acceptPendingFaceWarpDetection,
    onCancelDetection: cancelPendingFaceWarpDetection,
    onSelectFace: faceWarpDetectionController.setSelectedFaceId,
    onMeshVisibleChange: changeFaceWarpMeshVisible,
    onBrushChange: ({ size, strength }: { size?: number; strength?: number }) => {
      setEditorSession((current) => ({
        ...current,
        brush: {
          ...current.brush,
          ...(size === undefined ? {} : { size }),
          ...(strength === undefined ? {} : { opacity: strength })
        }
      }));
    },
    onSemanticTargetChange: setFaceWarpSemanticTarget,
    onProtectedFeatureChange: setFaceWarpProtectedFeature,
    onProtectionChange: updateFaceWarpProtection,
    onParametersChange: updateFaceWarpParameters,
    onInteractionStart: faceWarpIntents.properties.begin,
    onInteractionEnd: faceWarpIntents.properties.commit,
    onInteractionCancel: faceWarpIntents.properties.cancel,
    onReset: resetSelectedFaceWarp
  };
  useEffect(() => {
    if (activeTextPropertyLayer?.type === 'text') {
      showProperties({ kind: 'layer', layerId: activeTextPropertyLayer.id });
    }
  }, [activeTextPropertyLayer?.id, activeTextPropertyLayer?.type, showProperties]);
  const currentDocumentPresentation = documentPresentationAvailability({
    documentId: workspaceDocumentId,
    presentedDocumentId: presentedWorkspaceDocumentId,
    residentDocumentId: residentWorkspaceDocumentId,
    rendererStatus: rendererSnapshot.status
  });
  const imageDocumentSurface = (
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
        eyedropperActive: pointColorPickerActive || ((editorSession.activeTool === 'brush'
          || editorSession.activeTool === 'fill'
          || editorSession.activeTool === 'gradient') && altPressed),
        dragging: viewportInteraction.dragging,
        focusPickerActive,
        selection: editorSession.selection,
        selectionDraft,
        extrasVisible: editorSession.snap.extrasVisible !== false,
        imageRect,
        scale: activeScale,
        viewportSize,
        transformState: temporarySelectionMoveActive ? null : transformState,
        presentationReady: currentDocumentPresentation.ready,
        presentationResident: currentDocumentPresentation.resident,
        presentationError: rendererSnapshot.status === 'failed' ? rendererSnapshot.error : null,
        loading,
        unavailable: Boolean(error && !metadata),
        inputBridge: textEditing.status === 'editing' ? (
          <FlowTextEditingRuntime
            controller={textEditingController}
            document={imageDocument}
            renderer={engineRef.current}
            active={active}
            foregroundColor={editorSession.brush.color}
            layoutPublicationRevision={textRenderPresentation.publicationRevision}
          />
        ) : null,
        cropBounds,
        documentWidth: imageDocument?.width ?? 0,
        documentHeight: imageDocument?.height ?? 0,
        onCropChange: setCropBounds,
        onCropCommit: commitCrop,
        onCropCancel: cancelCrop,
        filterCenter: activeFilterCenter,
        onFilterCenterChange: (center, handle) => {
          p0FilterController.commands.updateSetting(
            'center', center, handle as ReturnType<typeof p0FilterController.commands.beginAdjustment>
          );
        },
        onFilterCenterInteractionStart: p0FilterController.commands.beginAdjustment,
        onFilterCenterInteractionEnd: p0FilterController.commands.endAdjustment,
        onFilterCenterInteractionCancel: p0FilterController.commands.cancelAdjustment,
        onWheel: viewportInteraction.onWheel,
        onPointerDown: viewportInteraction.onPointerDown,
        onPointerMove: viewportInteraction.onPointerMove,
        onPointerUp: viewportInteraction.onPointerUp,
        onPointerCancel: viewportInteraction.onPointerCancel,
        onPointerLeave: () => {
          if (editorSessionRef.current.activeTool === 'select-object') {
            smartSelectionController.clearHoverPreview();
          }
          if (!paintSessionController.active && !warpSessionController.active) {
            viewportInteraction.hideBrushCursor();
          }
        },
        onContextMenu: (event) => {
          event.preventDefault();
          event.stopPropagation();
          setToolOptionsMenu({ x: event.clientX, y: event.clientY });
        },
        onTransformChange: transformPresentation.update,
        onTransformProjectiveChange: transformPresentation.updateProjective,
        onTransformCommitGesture: transformSession.checkpoint,
        onTransformDuplicateChange: transformSession.setDuplicate,
        onTransformPick: pickTransformAtPoint,
        getTransformSnapTargets: transformPresentation.getSnapTargets,
        transformSnapEnabled: editorSession.snap.enabled,
        transformSnapGrid: editorSession.snap.targets.grid && editorSession.snap.gridVisible ? {
          spacing: editorSession.snap.gridSpacing / Math.max(1, editorSession.snap.gridSubdivisions),
          originX: editorSession.snap.gridOriginX,
          originY: editorSession.snap.gridOriginY
        } : null,
        transformFrameMode: toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document',
        transformFrameOverride: transformSession.frameOverride,
        onTransformSnapMatches: transformPresentation.setSnapMatches,
        onTransformViewportPan: panTransformViewport,
        documentGuides: imageDocument?.guides ?? [],
        rulersVisible: editorSession.snap.rulersVisible,
        guidesVisible: editorSession.snap.extrasVisible !== false && editorSession.snap.guidesVisible,
        guidesLocked: editorSession.snap.guidesLocked,
        guideInteraction
      }}
    />
  );
  const overriddenDocumentSurface = typeof documentSurfaceOverride === 'function'
    ? documentSurfaceOverride({
        activeTool: visibleTool,
        zoomOutActive: temporaryZoomOutActive
      })
    : documentSurfaceOverride;
  const documentSurface = (
    <div className="lighttable-document-surface-stack">
      <div
        className={`lighttable-document-surface-stack__image${overriddenDocumentSurface ? ' lighttable-document-surface-stack__image--inactive' : ''}`}
        aria-hidden={Boolean(overriddenDocumentSurface)}
      >
        {imageDocumentSurface}
      </div>
      {overriddenDocumentSurface ? (
        <div
          className="lighttable-document-surface-override"
          onContextMenu={(event) => {
            if (workspaceDocumentKind !== 'video'
              || (visibleTool !== 'view' && visibleTool !== 'zoom')) return;
            event.preventDefault();
            event.stopPropagation();
            setToolOptionsMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          {overriddenDocumentSurface}
        </div>
      ) : null}
    </div>
  );
  return (
    <DocumentPaletteProvider
      loadPalette={loadDocumentPalette}
      revisionKey={`${imageDocument?.id ?? workspaceDocumentId}:${imageDocument?.revision ?? 0}`}
    >
    <LightTableEditorShell
      workspaceDocumentKind={workspaceDocumentKind}
      screenMode={screenMode}
      active={active}
      saving={saving}
      recoveryNotice={recoveryNotice}
      projectName={activeProject?.name}
      onRevealProject={onRevealProject}
      onClose={onClose}
      menuOptionsFor={createAppMenuOptions}
      activeTool={visibleTool}
      brush={editorSession.brush}
      sampledBrush={editorSession.sampledBrush}
      toneBrush={editorSession.toneBrush}
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
      transformAutoSelectLayer={editorSession.transformAutoSelectLayer}
      selectionCombineMode={editorSession.selectionCombineMode}
      selectionFeather={editorSession.selectionFeather}
      selectionAntiAlias={editorSession.selectionAntiAlias}
      selectionMarqueeStyle={editorSession.selectionMarqueeStyle}
      selectionMarqueeWidth={editorSession.selectionMarqueeWidth}
      selectionMarqueeHeight={editorSession.selectionMarqueeHeight}
      selectionRowHeight={editorSession.selectionRowHeight}
      selectionColumnWidth={editorSession.selectionColumnWidth}
      selectionSmooth={editorSession.selectionSmooth}
      magicWand={editorSession.magicWand}
      smartSelection={editorSession.smartSelection}
      selectionPaintBrush={editorSession.selectionPaintBrush}
      smartSelectionBackendIdentity={import.meta.env.DEV ? smartSelectionBackendIdentity : null}
      smartSelectionPreparation={smartSelectionPreparation}
      zoomPercent={workspaceViewControls?.zoomPercent ?? activeScale * 100}
      gradientEditorRequest={gradientEditorRequest}
      onBrushChange={updateBrush}
      onSampledBrushChange={(change) => setEditorSession((current) => ({
        ...current,
        sampledBrush: { ...current.sampledBrush, ...change }
      }))}
      onToneBrushChange={(change) => setEditorSession((current) => ({
        ...current,
        toneBrush: { ...current.toneBrush, ...change }
      }))}
      onGradientChange={updateGradientSettings}
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
      faceWarp={faceWarpToolOptions}
      onSelectionPixelSnapChange={(selectionPixelSnap) => {
        setEditorSession((current) => ({ ...current, selectionPixelSnap }));
      }}
      onTransformAutoSelectLayerChange={(transformAutoSelectLayer) => {
        setEditorSession((current) => ({ ...current, transformAutoSelectLayer }));
      }}
      onSelectionCombineModeChange={(selectionCombineMode) => {
        setEditorSession((current) => ({ ...current, selectionCombineMode }));
      }}
      onSelectionFeatherChange={(selectionFeather) => {
        setEditorSession((current) => ({ ...current, selectionFeather }));
      }}
      onSelectionAntiAliasChange={(selectionAntiAlias) => {
        setEditorSession((current) => ({ ...current, selectionAntiAlias }));
      }}
      onSelectionMarqueeStyleChange={(selectionMarqueeStyle) => {
        setEditorSession((current) => ({ ...current, selectionMarqueeStyle }));
      }}
      onSelectionMarqueeWidthChange={(selectionMarqueeWidth) => {
        setEditorSession((current) => ({ ...current, selectionMarqueeWidth }));
      }}
      onSelectionMarqueeHeightChange={(selectionMarqueeHeight) => {
        setEditorSession((current) => ({ ...current, selectionMarqueeHeight }));
      }}
      onSelectionMarqueeRatioChange={(selectionMarqueeWidth, selectionMarqueeHeight) => {
        setEditorSession((current) => ({
          ...current,
          selectionMarqueeWidth,
          selectionMarqueeHeight
        }));
      }}
      onSelectionRowHeightChange={(selectionRowHeight) => {
        setEditorSession((current) => ({ ...current, selectionRowHeight }));
      }}
      onSelectionColumnWidthChange={(selectionColumnWidth) => {
        setEditorSession((current) => ({ ...current, selectionColumnWidth }));
      }}
      onSelectionSmoothChange={(selectionSmooth) => {
        setEditorSession((current) => ({ ...current, selectionSmooth }));
      }}
      onMagicWandChange={(change) => {
        setEditorSession((current) => ({
          ...current,
          magicWand: { ...current.magicWand, ...change }
        }));
      }}
      onSmartSelectionChange={(change) => {
        setEditorSession((current) => ({
          ...current,
          smartSelection: { ...current.smartSelection, ...change }
        }));
      }}
      onSelectionPaintBrushChange={(change) => {
        setEditorSession((current) => ({
          ...current,
          selectionPaintBrush: { ...current.selectionPaintBrush, ...change }
        }));
      }}
      onSmartSelectionSelectSubject={() => {
        void smartSelectionController.selectSubject(editorSessionRef.current.selectionCombineMode);
      }}
      onZoomPreset={workspaceViewControls?.onZoomPreset ?? setExactZoom}
      onZoomFit={workspaceViewControls?.onZoomFit ?? fitZoom}
      onZoomActual={workspaceViewControls?.onZoomActual ?? actualZoom}
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
      fastFileAccept={`${imagePickerAccept('fast')},video/mp4,video/webm,.mp4,.webm`}
      precisionFileAccept={imagePickerAccept('preserve-precision')}
      onFastFileChange={handleLocalFile}
      onPrecisionFileChange={handleAdvancedLocalFile}
      overlays={(
        <>
          <input
            ref={svgImportInputRef}
            type="file"
            accept="image/svg+xml,.svg"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = '';
              if (!file) return;
              if (file.type !== 'image/svg+xml' && !file.name.toLowerCase().endsWith('.svg')) {
                setError('Choose an SVG file to import as editable vectors.');
                return;
              }
              void file.text().then((svg) => executeRegisteredCommand('vector.importSvg', {
                svg, placement: 'document', layerName: file.name.replace(/\.[^.]+$/u, '') || 'Imported SVG'
              })).catch((reason: unknown) => setError(
                reason instanceof Error ? reason.message : 'The SVG file could not be read.'
              ));
            }}
          />
          <EditorOverlayLayer
          dialogs={{
            controller: editorDialogs,
            photoshopReport: imageDocument?.photoshopImportReport ?? null,
            differenceMetrics: psdDifferenceMetrics,
            textFontDiagnostics: fontDiagnostics,
            replacementFonts: selectableTextFonts,
            onSelectCompatibilityLayer: (layerId) => {
              void layerPanelController.select(layerId).then(editorDialogs.closePsdReport);
            },
            onResolveTextFont: (layerId) => {
              void textEditingEntry.selectAndEnter(layerId, { closeReport: true });
            },
            onPreviewTextFont: missingFontReplacementActions.preview,
            onCancelTextFontPreview: missingFontReplacementActions.cancelPreview,
            onReplaceTextFont: missingFontReplacementActions.replace,
            onReplaceTextFonts: missingFontReplacementActions.replaceDocument,
            onFeather: featherCurrentSelection,
            onSelectionModify: modifyCurrentSelection,
            foregroundColor: editorSession.brush.color,
            backgroundColor: editorSession.brush.backgroundColor,
            onFill: fillActiveTarget,
            onError: setError,
            release: releaseService,
            dirtyDocuments: Boolean(workspaceDocuments?.some(({ dirty }) => dirty)),
            document: imageDocument,
            onResizeImage: runImageSizeCommand,
            onApplyDocumentGeometry: runDocumentGeometryCommand,
            duplicateImageBusy,
            duplicateImageError,
            duplicateImageSourceName: documentSession?.getSnapshot().title ?? initialSourceName,
            onDuplicateImage: (name) => { void duplicateImage(name); },
            onCreateGuide: guideInteraction.add
          }}
          toolOptions={toolOptionsMenu ? {
            x: toolOptionsMenu.x,
            y: toolOptionsMenu.y,
            activeTool: visibleTool,
            brush: editorSession.brush,
            sampledBrush: editorSession.sampledBrush,
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
            transformAutoSelectLayer: editorSession.transformAutoSelectLayer,
            selectionCombineMode: editorSession.selectionCombineMode,
            selectionFeather: editorSession.selectionFeather,
            selectionAntiAlias: editorSession.selectionAntiAlias,
            selectionMarqueeStyle: editorSession.selectionMarqueeStyle,
            selectionMarqueeWidth: editorSession.selectionMarqueeWidth,
            selectionMarqueeHeight: editorSession.selectionMarqueeHeight,
            selectionRowHeight: editorSession.selectionRowHeight,
            selectionColumnWidth: editorSession.selectionColumnWidth,
            selectionSmooth: editorSession.selectionSmooth,
            toneBrush: editorSession.toneBrush,
            magicWand: editorSession.magicWand,
            smartSelection: editorSession.smartSelection,
            selectionPaintBrush: editorSession.selectionPaintBrush,
            smartSelectionBackendIdentity: import.meta.env.DEV
              ? smartSelectionBackendIdentity
              : null,
            smartSelectionPreparation,
            zoomPercent: workspaceViewControls?.zoomPercent ?? activeScale * 100,
            onBrushChange: updateBrush,
            onSampledBrushChange: (change) => setEditorSession((current) => ({
              ...current,
              sampledBrush: { ...current.sampledBrush, ...change }
            })),
            onToneBrushChange: (change) => setEditorSession((current) => ({
              ...current,
              toneBrush: { ...current.toneBrush, ...change }
            })),
            onGradientChange: updateGradientSettings,
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
            faceWarp: faceWarpToolOptions,
            onSelectionPixelSnapChange: (selectionPixelSnap) => {
              setEditorSession((current) => ({ ...current, selectionPixelSnap }));
            },
            onTransformAutoSelectLayerChange: (transformAutoSelectLayer) => {
              setEditorSession((current) => ({ ...current, transformAutoSelectLayer }));
            },
            onAlignTransformAxesToDocument: transformSession.alignFrameToDocument,
            onSelectionCombineModeChange: (selectionCombineMode) => {
              setEditorSession((current) => ({ ...current, selectionCombineMode }));
            },
            onSelectionFeatherChange: (selectionFeather) => {
              setEditorSession((current) => ({ ...current, selectionFeather }));
            },
            onSelectionAntiAliasChange: (selectionAntiAlias) => {
              setEditorSession((current) => ({ ...current, selectionAntiAlias }));
            },
            onSelectionMarqueeStyleChange: (selectionMarqueeStyle) => {
              setEditorSession((current) => ({ ...current, selectionMarqueeStyle }));
            },
            onSelectionMarqueeWidthChange: (selectionMarqueeWidth) => {
              setEditorSession((current) => ({ ...current, selectionMarqueeWidth }));
            },
            onSelectionMarqueeHeightChange: (selectionMarqueeHeight) => {
              setEditorSession((current) => ({ ...current, selectionMarqueeHeight }));
            },
            onSelectionMarqueeRatioChange: (selectionMarqueeWidth, selectionMarqueeHeight) => {
              setEditorSession((current) => ({
                ...current,
                selectionMarqueeWidth,
                selectionMarqueeHeight
              }));
            },
            onSelectionRowHeightChange: (selectionRowHeight) => {
              setEditorSession((current) => ({ ...current, selectionRowHeight }));
            },
            onSelectionColumnWidthChange: (selectionColumnWidth) => {
              setEditorSession((current) => ({ ...current, selectionColumnWidth }));
            },
            onSelectionSmoothChange: (selectionSmooth) => {
              setEditorSession((current) => ({ ...current, selectionSmooth }));
            },
            onMagicWandChange: (change) => {
              setEditorSession((current) => ({
                ...current,
                magicWand: { ...current.magicWand, ...change }
              }));
            },
            onSmartSelectionChange: (change) => {
              setEditorSession((current) => ({
                ...current,
                smartSelection: { ...current.smartSelection, ...change }
              }));
            },
            onSelectionPaintBrushChange: (change) => {
              setEditorSession((current) => ({
                ...current,
                selectionPaintBrush: { ...current.selectionPaintBrush, ...change }
              }));
            },
            onSmartSelectionSelectSubject: () => {
              void smartSelectionController.selectSubject(
                editorSessionRef.current.selectionCombineMode
              );
            },
            onZoomPreset: workspaceViewControls?.onZoomPreset ?? setExactZoom,
            onZoomFit: workspaceViewControls?.onZoomFit ?? fitZoom,
            onToolChange: activatePersistentTool,
            onClose: () => setToolOptionsMenu(null)
          } : null}
          />
          <BackgroundRemovalDialog
            state={backgroundRemovalController.state}
            onCancel={backgroundRemovalController.cancel}
            onChoose={backgroundRemovalController.choose}
          />
        </>
      )}
    >
          <LightTableDockWorkspace
            ref={workspaceRef}
            canvasOnly={screenMode === 'canvas-only'}
            persistenceEnabled={active}
            documentKind={workspaceDocumentKind}
            status={{
              status: fontDiagnosticStatus,
              error: false,
              meta: workspaceStatusMeta ?? statusBar.meta,
              metaTitle: workspaceStatusTitle ?? statusBar.title,
              reportAvailable: statusBar.reportAvailable || fontDiagnostics.length > 0,
              onOpenReport: editorDialogs.openPsdReport
            }}
            notifications={editorNotifications}
            onDismissNotification={dismissEditorNotification}
            documents={(workspaceDocuments ?? [{
              id: workspaceDocumentId,
              title: sourceName
            }]).map((workspaceDocument) => ({
              ...workspaceDocument,
              ready: workspaceDocument.id === workspaceDocumentId && workspaceDocumentKind === 'image'
                ? currentDocumentPresentation.available
                : true,
              presentationError: workspaceDocument.id === workspaceDocumentId && rendererSnapshot.status === 'failed'
                ? rendererSnapshot.error ?? 'The document could not be presented.' : undefined,
              getPreviewBounds: workspaceDocument.id === workspaceDocumentId && workspaceDocumentKind === 'image' ? () => {
                const bounds = viewportRef.current?.getBoundingClientRect();
                return bounds ? { left: bounds.left + imageRect.x, top: bounds.top + imageRect.y,
                  width: imageRect.width, height: imageRect.height } : undefined;
              } : undefined,
              contextMenu: [
                { value: 'reveal', label: 'Open file location', disabled: !workspaceDocument.onReveal,
                  disabledReason: 'This document has no file location in this host.',
                  onClick: () => { void workspaceDocument.onReveal?.().catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); } },
                { value: 'reference', label: 'Add as reference',
                  disabled: workspaceDocument.kind === 'video' || !genAiService || genAiReferences.pendingTabReference
                    || !genAiSetup.workflow?.fields.some(field => field.kind === 'asset')
                    || !workspacePanels.some(panel => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi && panel.visible),
                  disabledReason: 'Open GenAI with a model that accepts image references.',
                  onClick: () => {
                    genAiReferences.requestTabReference(workspaceDocument.id);
                  } }
              ],
              onClose: () => {
                closeWorkspaceDocument(workspaceDocument.id);
              },
              content: workspaceDocument.id === workspaceDocumentId ? documentSurface : null
            }))}
            activeDocumentId={workspaceDocumentId}
            onActiveDocumentChange={activateWorkspaceDocument}
            accessoryWidthConstraintsEnabled={accessoryWidthConstraintsEnabled}
            onResizeInteractionChange={handleDockResizeInteractionChange}
            onDocumentSurfaceReady={handleDocumentSurfaceReady}
            onPanelVisibilityChange={setWorkspacePanels}
            panels={createEditorWorkspacePanels({
              documentKind: workspaceDocumentKind,
              videoControls: workspaceVideoControlsPanel,
              scopes: {
                containerRef: scopesColumnRef,
                visibility: scopeVisibility,
                settings: scopeSettings,
                histogram,
                hueDistributionCanvasRef,
                paradeCanvasRef,
                vectorscopeCanvasRef,
                onCanvasesReady: handleDocumentSurfaceReady,
                error: scopeError,
                onVisibilityChange: (scope, visible) => {
                  setScopeVisibility((current) => ({ ...current, [scope]: visible }));
                },
                onSettingsChange: setScopeSettings
              },
              layers: layersPanel,
              channels: channelsPanel,
              color: {
                value: editorSession.brush.color,
                onChange: (color) => updateBrush({ color })
              },
              debug: {
                messages: debugMessages,
                onClear: clearDebugMessages,
                gpuSupport: sharedWebGpuDiagnostics()?.support ?? null,
                onCollectSupportDiagnostics: async (options) => createSupportDiagnosticArtifact({ hostKind, release: await releaseService?.info().catch(() => null) ?? null, gpu: sharedWebGpuDiagnostics(), metadata, sourceFileName: initialSourceName, document: imageDocument, startupTimings, gpuMemoryBytes: metadata ? gpuMemoryBytes : null, textRender: metadata ? textRenderPresentation : null, events: debugMessages, betaDiagnostics: options.betaDiagnostics }, options),
                onExportSupportDiagnostics: onExportFile,
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
              propertiesView,
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
                  cancelAdjustment: cancelAdjustmentTransaction,
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
                  vignette: {
                    setEnabled: setVignetteEnabled,
                    update: updateVignetteAdjustment,
                    resetControl: resetVignetteAdjustment,
                    reset: resetVignette
                  },
                  lensBlur: {
                    setEnabled: setLensBlurEnabled,
                    update: updateLensBlurAdjustment,
                    resetControl: resetLensBlurAdjustment,
                    reset: resetLensBlur,
                    setShape: setLensBlurShape,
                    setQuality: setLensBlurQuality,
                    setViewportMode: setLensBlurViewportMode,
                    toggleFocusPicker: canvasPickers.toggleFocus
                  }
                }
              },
              grade: {
                gradeTitle: gradePropertiesTitle(imageDocument, propertiesTarget),
                model: {
                  adjustmentStore: adjustmentPresentationStore,
                  metadata,
                  visibility: gradeSectionVisibility,
                  histogram,
                  resetModifierActive: shiftPressed,
                  masterEnabled: gradeMasterEnabled,
                  colorMixerScopeContainerRef,
                  colorMixerHueCanvasRef: attachColorMixerHueCanvas,
                  colorLookupAssets: imageDocument?.assets.colorLookups ?? [],
                  pointColorPickerActive,
                  pointColorRangeVisualizationActive: pointColorRangeVisualization !== null
                },
                  commands: {
                  resetAll,
                  toggleMasterEnabled: gradeInspector.toggleMaster,
                  toggleVisibility: gradeInspector.toggleSection,
                  resetGroup,
                  beginAdjustment: beginAdjustmentTransaction,
                  endAdjustment: endAdjustmentTransaction,
                  cancelAdjustment: cancelAdjustmentTransaction,
                  updateAdjustment,
                  resetAdjustment,
                  updateDetail,
                  resetDetailControl,
                  resetDetail,
                  updateColorMixer: updateColorMixerAdjustment,
                  resetColorMixer: resetColorMixerAdjustment,
                  setBlackWhiteMixEnabled,
                  updateBlackWhiteMix,
                  resetBlackWhiteMix,
                  setGradeLookAsset: adjustmentCommands.setGradeLookAsset,
                  updateGradeLookStrength: adjustmentCommands.updateGradeLookStrength,
                  resetGradeLook: adjustmentCommands.resetGradeLook,
                  updatePointColorSample,
                  resetPointColorSample,
                  removePointColorSample,
                  togglePointColorPicker: canvasPickers.togglePointColor,
                  setPointColorRangeVisualization: updatePointColorRangeVisualization,
                  updateColorGradingWheel,
                  updateColorGradingLuminance,
                  updateColorGradingControl,
                  resetColorGradingControl,
                  resetColorGradingZone,
                  resetColorGradingLuminance,
                  updateCurve,
                  resetCurve,
                  updateGradientMap,
                  resetGradientMap,
                  updatePhotoshopAdjustment,
                  resetPhotoshopAdjustment,
                  loadColorLookup,
                  loadGradeLook
                }
                },
              effects: {
                document: imageDocument,
                controller: layerStyleEditor
              },
              text: textPropertiesPanel,
              p0Filter: p0FilterController.model
                ? {
                    model: p0FilterController.model,
                    commands: p0FilterController.commands
                  }
                : null,
              agent: { events: agentEvents,
                onCancel: (taskId) => { void executeRegisteredCommand('task.cancel', { taskId }); } },
              actions: {
                recording: actionRecording,
                playback: actionPlayback,
                library: actionLibrary,
                ...createActionsPanelCallbacks(commandService)
              },
              history: {
                history: historySnapshot,
                documentName: initialSourceName,
                onNavigate: (position) => { void documentHistoryController.navigateTo(position); },
                onDeleteFrom: (position) => { void documentHistoryController.deleteFrom(position); },
                onClear: documentHistoryController.purge
              },
              genAi: {
                interactionActive: active,
                providerId: genAiProvider.id,
                providerName: genAiProvider.label,
                status: genAiProvider.status,
                message: genAiProvider.message,
                projectName: activeProject?.name,
                models: genAiSetup.models,
                workflow: genAiSetup.workflow,
                selectedModelId: genAiSetup.selectedModelId,
                onModelChange: genAiSetup.setModel,
                selectedMode: genAiSetup.selectedMode,
                onModeChange: genAiSetup.setMode,
                loading: genAiSetup.loading,
                setupError: genAiSetup.error,
                values: genAiSetup.values,
                onFieldChange: genAiSetup.setValue,
                assets: genAiSetup.assets,
                mentionOptions: genAiSetup.mentionOptions,
                assetPreviews: genAiSetup.assetPreviews,
                onRequestAssetPreview: genAiSetup.requestAssetPreview,
                generating: genAiSetup.generating,
                generationError: genAiSetup.generationError,
                costEstimate: genAiSetup.costEstimate,
                submission: genAiSetup.submission,
                canGenerate: genAiSetup.canGenerate,
                generationReadiness: genAiSetup.generationReadiness,
                onGenerate: () => { void genAiSetup.generate(); },
                baseImageSelected: genAiReferences.baseImageSelected,
                baseImageAssetId: genAiReferences.baseImageAssetId,
                onBaseImageSelectedChange: genAiReferences.setBaseImageSelected,
                onImportReferenceFile: genAiReferences.importReferenceFile,
                onImportDocumentReference: genAiReferences.importDocumentReference,
                onConnect: genAiService ? () => {
                  void genAiService.connectProvider(selectedGenAiProviderId).then(updateGenAiProviderSnapshot);
                } : undefined
              },
              aiHistory: {
                ...genAiJobs,
                assets: genAiSetup.assets,
                sections: genAiSetup.assetSections,
                previews: genAiSetup.assetPreviews,
                onRequestPreview: genAiSetup.requestAssetPreview,
                onRefreshAssets: genAiSetup.refreshAssets,
                onOpenResult: onGenAiOpenResult,
                onOpenAsset: onGenAiOpenAsset,
                onAddReference: (asset) => {
                  genAiSetup.addAssetReference(asset.id);
                  workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi);
                },
                onRecreate: (job) => {
                  genAiSetup.restoreRequest(job.request);
                  workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi);
                },
                onDeleteJob: genAiService && activeGenAiProjectId ? (job) =>
                  genAiService.deleteJob(activeGenAiProjectId, job.id) : undefined,
                onRevealAsset: genAiService && activeGenAiProjectId ? (asset) =>
                  genAiService.revealProjectAsset(activeGenAiProjectId, asset.id) : undefined,
                onRenameAsset: genAiService && activeGenAiProjectId ? (asset, name) =>
                  genAiService.renameProjectAsset(activeGenAiProjectId, asset.id, name) : undefined,
                onDeleteAsset: genAiService && activeGenAiProjectId ? (asset) =>
                  genAiService.deleteProjectAsset(activeGenAiProjectId, asset.id) : undefined,
              }
            })}
          />
    </LightTableEditorShell>
    </DocumentPaletteProvider>
  );
};
