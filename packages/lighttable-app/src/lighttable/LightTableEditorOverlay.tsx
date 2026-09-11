import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { filterDefinition } from '@lighttable/filter-core';
import { cloneGradientPaint } from '@lighttable/paint-core';
import { TEXT_CONTRACT_FIXTURE_COUNT, type TextPaint } from '@lighttable/text-core';
import { buildParagraphFrameOverlay } from '@lighttable/text-rendering';
import { textLayerSourceKey } from './text/rendering/TextLayerRenderer';
import { useDocumentPalette, useLayerPalette } from './application/color/useDocumentPalette';
import { DocumentPaletteProvider } from '../ui/DocumentPaletteContext';
import { DocumentCommandHistory } from './application/commands/documentCommandHistory';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandId, type LightTableCommandPortRegistry, type LightTableCommandService, type LightTableGestureKind, type LightTableGestureSample } from './application/commands/lightTableCommandService';
import type {
  LightTableBitmapExportFormat,
  LightTableGradeClipboardCapture,
  LightTablePreviewEncoding
} from './application/commands/lightTableCommandContract';
import { isMountedDocumentCommand } from './application/commands/lightTableCommandOwnership';
import { commandDocumentTarget } from './application/commands/commandRequestScope';
import type { DocumentPixelRegion } from './editor/geometry/documentRegionPreview';
import {
  automationPaintOperatorFromPlan,
  parseAutomationBrushSettings,
  parseAutomationPaintOperator
} from './application/commands/lightTableCommandValidation';
import { useDocumentHistoryController, type EditorHistoryEntry } from './application/commands/useDocumentHistoryController';
import type { DocumentSession, DocumentSessionId } from './application/documents/documentSession';
import type { EditorApplicationSession } from './application/workspace/editorApplicationSession';
import { createActionsPanelCallbacks } from './composition/workspace/createActionsPanelCallbacks';
import { DocumentTaskRegistry } from './application/tasks/documentTaskRegistry';
import { DocumentRendererLifecycle } from './application/rendering/documentRendererLifecycle';
import { captureRendererBinding } from './application/rendering/rendererBindingToken';
import { captureVectorTransformPreviewBinding } from './application/vectors/VectorTransformPreviewBinding';
import { resolveDocumentGpuRecoveryPolicy } from './application/rendering/documentGpuRecoveryPolicy';
import { releaseDocumentGpuResources } from './application/rendering/documentGpuResourceRegistry';
import { resolveViewportImageRect } from './application/rendering/viewportRenderState';
import {
  centerClipboardBounds,
  visibleDocumentBounds
} from './application/clipboard/pastePlacement';
import { useDocumentRuntimeServices } from './application/documents/useDocumentRuntimeServices';
import { resetDocumentOpenPresentation } from './application/documents/resetDocumentOpenPresentation';
import {
  useDocumentMutationController,
  type DocumentMutationTransaction
} from './application/documents/useDocumentMutationController';
import { useEditorRecoveryJournal } from './application/documents/useEditorRecoveryJournal';
import { useWorkspaceDocumentPresentation } from './composition/documents/useWorkspaceDocumentPresentation';
import { documentPresentationAvailability } from './composition/documents/documentPresentationAvailability';
import { useEditorHostPresentationActivity } from './composition/rendering/useEditorHostPresentationActivity';
import { useEditorArtifactExportRefs } from './application/documents/useEditorArtifactExportRefs';
import { createInteractionTransitionCoordinator } from './application/interactions/InteractionTransitionCoordinator';
import { exportEditorPreviewArtifact, exportEditorPsdArtifact } from './application/documents/editorArtifactExports';
import type { ExportedPsdDocument } from './application/documents/PsdExportClient';
import { hydrateDocumentFonts } from './application/documents/hydrateDocumentFonts';
import { useAdjustmentTransactionController } from './application/adjustments/useAdjustmentTransactionController';
import { projectAdjustmentSnapshot } from './application/adjustments/projectAdjustmentSnapshot';
import {
  materializeAdjustmentPresentationSource,
  resolveAdjustmentPresentation,
  resolveAdjustmentPresentationSource,
  type AdjustmentPresentationSource
} from './application/adjustments/resolveAdjustmentPresentation';
import {
  commitColorLookupAssetTransaction,
  type ColorLookupCanonicalProjection
} from './application/adjustments/commitColorLookupAssetTransaction';
import { createAdjustmentCommands } from './application/adjustments/createAdjustmentCommands';
import {
  createAdjustmentInteractionCoordinator,
  type AdjustmentInteractionHandle
} from './application/adjustments/AdjustmentInteractionCoordinator';
import { resolveBasicAdjustmentTarget } from './application/adjustments/basicAdjustmentTarget';
import { projectBasicAdjustmentValues } from './application/adjustments/basicAdjustmentQuery';
import { projectAdjustmentQuery } from './application/adjustments/adjustmentQuery';
import { executeSemanticGradePatch } from './application/adjustments/executeSemanticGradePatch';
import { executeSemanticAdjustmentSnapshot } from './application/adjustments/executeSemanticAdjustmentSnapshot';
import { executeSemanticProcessingStructure } from './application/adjustments/executeSemanticProcessingStructure';
import { adjustmentTargetIsPresented } from './application/adjustments/adjustmentTargetIsPresented';
import { runEditorOperationTransaction } from './application/commands/editorOperationTransaction';
import {
  resolveContextualAdjustmentCreation,
  type SemanticAdjustmentCreationCommand
} from './application/commands/semanticAdjustmentCreationCommandContract';
import { linearRgbToOklab, srgbToLinear } from './colorMath';
import type { PointColorSample } from './pointColor';
import { AdjustmentPresentationStore, useAdjustmentPresentationSelector,
  type AdjustmentPresentationDomain } from './application/adjustments/adjustmentPresentationStore';
import { createDocumentProjectionController } from './application/documents/documentProjectionController';
import { useViewportInteractionController } from './editor/hooks/useViewportInteractionController';
import {
  resolveWheelPanDeltas,
  zoomViewToScaleAtPoint
} from './editor/tools/pointer/viewportCoordinates';
import { steppedZoomPercent, zoomPercentToScale } from './editor/tools/zoom/zoomLevels';
import {
  selectionOperationsBounds,
  selectionOperationsSupportBounds
} from './editor/tools/transform/selectionTransform';
import { useEditorResizeController } from './editor/hooks/useEditorResizeController';
import { useLayerThumbnailController } from './editor/hooks/useLayerThumbnailController';
import { useEditorDiagnosticsController } from './editor/hooks/useEditorDiagnosticsController';
import { useEditorNotifications } from './editor/notifications/useEditorNotifications';
import { createScopeRendererOptions, useRendererPresentationSync } from './editor/hooks/useRendererPresentationSync';
import { planPersistentToolActivation } from './application/tools/persistentToolActivation';
import { cancelActiveEditorOperation } from './application/interactions/cancelActiveEditorOperation';
import { toolShortcutGroupFor } from './editor/tools/toolRegistry';
import { brushPresetChange, resolveBrushPreset } from './editor/tools/brush/brushPresets';
import { useAutoAlignController } from './application/tools/autoAlign/useAutoAlignController';
import { SampledBrushSourceController } from './application/tools/paint/sampledBrush';
import type { PaintBrushStrokePlan } from './editor/tools/paint/sampledBrushTypes';
import { SmartSelectionToolController } from './application/tools/smartSelection/SmartSelectionToolController';
import type {
  SmartSelectionBackendIdentity,
  SmartSelectionPreparationState
} from './application/tools/smartSelection/SmartSelectionBackend';
import {
  configuredSmartSelectionBackendProfile,
  createSmartSelectionBackend
} from './application/tools/smartSelection/smartSelectionBackendFactory';
import { useLayerStyleEditorController } from './application/styles/useLayerStyleEditorController';
import { layerStyleSnapshot } from './application/styles/completeLayerStyleSnapshot';
import type { LayerStyleId, LayerStyleKind } from './editor/styles/layerStyleTypes';
import { useLayerDocumentCommands } from './application/layers/useLayerDocumentCommands';
import { executeSemanticMaskCommand } from './application/layers/executeSemanticMaskCommand';
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
  adjustmentStackLocalProcessingIsEnabled,
  adjustmentStackGradeGroupIsEnabled,
  adjustmentStackOwnerHasAuthoredSettings,
  type GradeModuleGroup,
  materializeBasicAdjustments
} from './processing/adjustmentStack';
import {
  attachedAdjustmentOwnerId,
  parseAttachedAdjustmentOwnerId
} from './processing/attachedAdjustment';
import type { AdjustmentLayerKind } from './processing/adjustmentLayerCatalog';
import { TextToShapeCommandController } from './application/text/TextToShapeCommandController';
import { PositionedTextRecoveryCommandController } from './application/text/PositionedTextRecoveryCommandController';
import { buildPdfTextExportPreflight } from './application/pdf/pdfTextExportPreflight';
import { buildPdfNativeTextPage } from './application/pdf/buildPdfNativeTextPage';
import { buildPdfNativeVectorLayerPage, buildPdfNativeVectorExportPage } from './application/pdf/buildPdfNativeVectorPage';
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
import { textSelectionForGranularity, type TextSelectionGranularity } from './application/text/flowTextEditing';
import type { LightTableStartupTimings } from './application/telemetry/editorTelemetry';
import { DocumentStartupTelemetry } from './application/telemetry/documentStartupTelemetry';
import type { DocumentStartupTimeline } from './application/telemetry/documentStartupTimeline';
import { buildEditorStatus } from './application/telemetry/editorStatus';
import type { ReferenceDifferenceMetrics, TextRenderPresentationSnapshot } from './application/rendering/rendererTypes';
import { formatRenderTelemetry } from './application/rendering/renderTelemetry';
import { createSupportDiagnosticArtifact } from './application/diagnostics/supportDiagnosticBundle';
import { sharedWebGpuDiagnostics } from './gpu/sharedWebGpuDevice';
import { useTextEngineDiagnostics } from './text/diagnostics/useTextEngineDiagnostics';
import {
  documentTextFontDiagnostics,
  summarizeTextFontDiagnostics,
  textLayerFontStatus
} from './text/fonts/textLayerFontStatus';
import type { DocumentOpenMode } from './application/documents/documentSourceProbe';
import { useEditorDocumentLifecycleController } from './composition/documents/useEditorDocumentLifecycleController';
import { useEditorDocumentFileController } from './composition/documents/useEditorDocumentFileController';
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
  reconcilePropertiesTarget,
  type PropertiesInspectorTarget
} from './application/properties/propertiesInspectorTarget';
import { EditorDocumentSurface } from './composition/workspace/EditorDocumentSurface';
import { EditorOverlayLayer } from './composition/workspace/EditorOverlayLayer';
import { type DocumentRendererPort } from './infrastructure/rendering/webGpuDocumentRenderer';
import {
  copyLightTableGrade,
  pasteGradeSettings,
  useLightTableGradeClipboard
} from './lightTableGradeClipboard';
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
import { BackgroundRemovalDialog } from './editor/ui/BackgroundRemovalDialog';
import { createResizePlan, resizeImageDocumentSemantics, type ImageSizeRequest } from './application/imageSize/imageSizeModel';
import {
  createDocumentGeometryPlan,
  projectDocumentGeometry,
  projectSelectionGeometry,
  projectSelectionTransform,
  type DocumentGeometryRequest
} from './application/documentGeometry/documentGeometryModel';
import { commitDocumentSurfaceMutation } from './application/documentGeometry/commitDocumentSurfaceMutation';
import { LightTableEditorShell } from './editor/ui/LightTableEditorShell';
import {
  ParagraphTextCreationController,
  PointTextCreationController,
  defaultTextStyleForFamily,
  resolvePathTextCreationTargetAtPoint,
  type PathTextCreationTarget,
  resolveTextToolFont,
  textCreationKind
} from './application/text/pointTextCreation';
import { FlowTextEditingSessionController } from './application/text/flowTextEditingSession';
import { TextPropertyGestureController } from './application/text/TextPropertyGestureController';
import { ExistingTextHitController } from './application/text/ExistingTextHitController';
import { executeSemanticTextCommand, paragraphTextCreateCommand, pathTextCreateCommand,
  pointTextCreateCommand,
  textCreateCommandParameters,
  semanticParagraphPatchFromCanonical, semanticStylePatchFromCanonical } from './application/text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from './application/vectors/semanticVectorCommandExecutor';
import { executeSvgImport, exportSvgDocument } from './application/vectors/svgDocumentCodec';
import { executeSemanticWarpStrokeCommand } from './application/commands/semanticWarpCommandExecutor';
import { observedLiveShapeCreateCommand, observedLiveShapeUpdateCommand, observedVectorPathCreateCommand,
  observedVectorPathUpdateCommand } from './application/vectors/semanticVectorObservation';
import { executeSemanticLayerStyleCommand } from './application/styles/semanticLayerStyleCommandExecutor';
import { executeSemanticLayerStyleSnapshot } from './application/styles/executeSemanticLayerStyleSnapshot';
import { executeAtomicCommandBatch } from './application/commands/atomicCommandBatchExecutor';
import { applySemanticFaceWarpCommandToDocument, executeSemanticFaceWarpCommand } from './application/effects/faceWarp/semanticFaceWarpCommandExecutor';
import { resolveFaceWarpEligibility } from './application/effects/faceWarp/faceWarpEligibility';
import { useAgentActivity } from './application/commands/useAgentActivity';
import { waitForExactCommandRender } from './application/rendering/waitForExactCommandRender';
import { FlowTextEditingRuntime } from './application/text/FlowTextEditingRuntime';
import { visibleTextLayersTopmostFirst } from './application/geometry/layerGeometryQuery';
import { ParagraphFrameResizeController } from './application/text/ParagraphFrameResizeController';
import { PathTextHandleController } from './application/text/PathTextHandleController';
import { useMissingFontReplacementActions } from './application/text/useMissingFontReplacementActions';
import { hitTestTextEditingLayout } from './application/text/textEditingHitTest';
import { TextLayerMoveGestureController } from './application/text/TextLayerMoveGestureController';
import { type ParagraphStylePatch, type TextStylePatch } from './application/text/flowTextFormatting';
import {
  buildTextPropertyPresentation,
  textFillEnabledPatch,
  textFillPatchFromHex,
  textFontPatch,
  textStrokePatch
} from './application/text/textPropertyPresentation';
import {
  convertParagraphTextToPoint,
  convertPointTextToParagraph
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
import { executeRemoveObject } from '../genai/application/removeObjectCommand';
import type { GenAiGenerationJob } from '@lighttable/genai-core';

import {
  createEditorSession,
  createGradientToolSettings,
  documentEditorStateFrom,
  type EditorSession,
  type ToolId
} from './editor/session/editorSession';
import { TemporaryToolController } from './editor/tools/temporaryToolController';
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
import { buildFaceWarpMeshOverlay } from './effects/faceWarp/faceWarpMeshOverlay';
import {
  applyFaceWarpBrush,
  findDeformedFaceHit,
  refineFaceWarpBrush,
  relaxFaceWarpBrush,
  restoreFaceWarpBrush
} from './effects/faceWarp/faceWarpDeformer';
import {
  createDefaultFaceWarpParameters,
  findFaceWarpModuleInstance,
  readFaceWarpNodeSettings,
  setFaceWarpNodeSettings,
  type FaceWarpFace,
  type FaceWarpProtectedFeature,
  type FaceWarpParameters
} from './effects/faceWarp/faceWarpTypes';
import type { FaceWarpSemanticTarget } from './application/tools/faceWarp/FaceWarpToolOptions';
import {
  createFaceWarpInteractionSessionController,
  type FaceWarpGestureContext
} from './application/tools/faceWarp/FaceWarpInteractionSessionController';
import { FaceWarpDetectionReviewController } from './application/tools/faceWarp/FaceWarpDetectionReviewController';
import { useSelectionSessionController } from './application/tools/selection/useSelectionSessionController';
import { SelectionShapeCommandService } from './application/tools/selection/SelectionShapeCommandService';
import { DocumentSelectionStateStore } from './application/tools/selection/DocumentSelectionStateStore';
import { useTransformSessionController, type FixedTransformOperation } from './application/tools/transform/useTransformSessionController';
import { pickCurrentTransformLayer } from './application/tools/transform/transformLayerPicker';
import { resolveTransformCanvasLayerSelection } from './application/tools/transform/transformCanvasLayerSelection';
import { buildTransformEditingFrame } from './editor/tools/transform/transformEditingFrame';
import { transformSessionFrame } from './editor/tools/transform/transformSessionFrame';
import type {
  AffineMatrix,
  TransformQuad,
  TransformSessionState
} from './editor/tools/transform/transformTypes';
import { buildSmartGuideEditingFrame } from './editor/tools/transform/smartGuideEditingFrame';
import { buildDocumentGridFrame, buildDocumentGuideFrame } from './editor/tools/transform/layoutGuideEditingFrame';
import { buildLayerSnapTargets } from './application/tools/snapping/layerSnapGeometry';
import { publishBoundSelection } from './application/tools/transform/BoundSelectionPublication';
import {
  publishTransformDocumentSelection as publishTransformSelectionTransaction
}
  from './application/tools/transform/publishTransformDocumentSelection';
import type { SnapMatch } from './application/tools/snapping/snapEngine';
import { addDocumentGuide, clearDocumentGuides, replaceDocumentGuides } from './editor/document/guideCommands';
import { useVectorToolSessionController } from './application/vectors/useVectorToolSessionController';
import { isVectorEditorTool } from './editor/tools/vectorToolCatalog';
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
  layerIsLocked,
  type DocumentGuide,
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
  siblingLayers,
  walkLayerTree
} from './editor/document/layerTree';
import {
  type FontAssetBlob,
  type PreservedSourceAssetBlob
} from './editor/persistence/layeredDocumentFormat';
import { parseCubeLut } from './processing/colorLookupCube';
import {
  imagePickerAccept
} from './image-io/supportedImageFormats';
import type { NativeBitmapFormatId } from './image-io/nativeBitmapFormats';
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from './editor/psd/psdDocumentAdapter';
import { PaintGestureController } from './editor/tools/paint/paintGestureController';
import { paintTargetSourceToDocument } from './editor/tools/paint/paintCoordinates';
import {
  setRasterLayerAdjustmentStack,
  setLayerTransform,
  replaceVectorElement,
} from './editor/document/documentCommands';
import { invertMatrix, transformPoint } from './editor/geometry/affine';
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
const DEVICE_LOSS_RECOVERY_LIMIT = 2;
const DEVICE_LOSS_STABILITY_WINDOW_MS = 30_000;
const waitForCommandArtifact = (
  service: LightTableCommandService,
  documentId: DocumentSessionId,
  taskId: string
) => new Promise<File>((resolve, reject) => {
  const startedAt = performance.now();
  const inspect = () => {
    const task = service.queryTask(documentId, taskId);
    if (!task) {
      reject(new Error('The export task was not published.'));
      return;
    }
    if (task.status === 'running' || (task.status === 'completed' && !task.artifact)) {
      if (performance.now() - startedAt >= 30_000) {
        reject(new Error('The export did not finish within 30 seconds.'));
      } else {
        setTimeout(inspect, 16);
      }
      return;
    }
    if (task.status !== 'completed' || !task.artifact) {
      reject(new Error(task.error ?? 'The export did not complete.'));
      return;
    }
    const file = service.resolveArtifact(task.artifact.id);
    if (!file) reject(new Error('The exported artifact is unavailable.'));
    else resolve(file);
  };
  inspect();
});
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
  const recoveredFailureGenerationRef = useRef<number | null>(null);
  const consecutiveDeviceLossRecoveriesRef = useRef(0);
  const replaceRendererOnNextOpenRef = useRef(false);
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
  const resourceDisposerSessionsRef = useRef(new WeakSet<DocumentSession>());
  useEffect(() => {
    if (!documentSession || resourceDisposerSessionsRef.current.has(documentSession)) return;
    resourceDisposerSessionsRef.current.add(documentSession);
    // The disposer belongs to the canonical document session, not to this
    // active React binding. Deliberately do not unregister it on a tab switch.
    documentSession.registerDisposer(() => {
      releaseDocumentGpuResources(String(documentSession.id));
    });
  }, [documentSession]);
  const [globalGradeStrength, setGlobalGradeStrengthState] = React.useState(
    () => documentSession?.getSnapshot().processing.globalGradeStrength
      ?? initialRecipe?.globalGradeStrength
      ?? 100
  );
  const globalGradeStrengthRef = useRef(globalGradeStrength);
  const globalGradeStrengthGestureRef = useRef<number | null>(null);
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
  const adjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const adjustmentPresentationStoreRef = useRef<AdjustmentPresentationStore | null>(null);
  if (!adjustmentPresentationStoreRef.current) {
    adjustmentPresentationStoreRef.current = new AdjustmentPresentationStore(
      adjustmentsRef.current
    );
  }
  const adjustmentPresentationStore = adjustmentPresentationStoreRef.current;
  const adjustmentPresentationSourceRef = useRef<AdjustmentPresentationSource | null>(null);
  const publishAdjustmentPresentation = useCallback((
    next: BasicAdjustments,
    domain: AdjustmentPresentationDomain = 'all'
  ) => {
    adjustmentPresentationSourceRef.current = null;
    adjustmentsRef.current = next;
    adjustmentPresentationStore.publish(next, domain);
  }, [adjustmentPresentationStore]);
  const documentAdjustmentsRef = useRef<BasicAdjustments>(
    documentSession?.getSnapshot().processing.adjustments ?? createDefaultAdjustments()
  );
  const resetAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetActiveAdjustmentTransactionRef = useRef<() => void>(() => undefined);
  const resetDocumentTransactionRef = useRef<() => Promise<void>>(async () => undefined);
  const layerDocumentTransactionRef = useRef<DocumentMutationTransaction | null>(null);
  const resetFaceWarpSessionRef = useRef<() => void>(() => undefined);
  const preservedSourceAssetsRef = useRef<PreservedSourceAssetBlob[]>(
    [...(documentSession?.getSnapshot().loadedSource.preservedSources ?? [])]
  );
  const fontAssetsRef = useRef<FontAssetBlob[]>(
    [...(documentSession?.getSnapshot().loadedSource.fontAssets ?? [])]
  );
  const [fontAvailabilityRevision, setFontAvailabilityRevision] = useState(0);
  const [fontHydrationPending, setFontHydrationPending] = useState(false);
  const fontHydrationGenerationRef = useRef(0);
  const paintGestureRef = useRef(new PaintGestureController());
  const resetPaintSessionRef = useRef<() => void>(() => undefined);
  const selectionGestureRef = useRef(new SelectionGestureController());
  const commitTransformRef = useRef<() => void>(() => undefined);
  const commitTransformPendingRef = useRef<() => Promise<void>>(async () => undefined);
  const settlePixelInteractionRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelPixelInteractionRef = useRef<() => void>(() => undefined);
  const cancelTransformRef = useRef<() => void>(() => undefined);
  const transformPickRevisionRef = useRef(0);
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
  const preferredToolByShortcutRef = useRef<Partial<Record<string, ToolId>>>({});
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
  const temporaryToolRef = useRef(new TemporaryToolController());
  const beginSelectionContentMoveRef = useRef<(duplicate: boolean) => Promise<boolean>>(
    async () => false
  );
  const updateSelectionContentMoveRef = useRef<(x: number, y: number) => void>(() => undefined);
  const finishSelectionContentMoveRef = useRef<(commit: boolean) => void>(() => undefined);
  const groupVisibilityRef = useRef<GroupVisibility>(
    documentSession?.getSnapshot().processing.groupVisibility ?? createDefaultGroupVisibility()
  );
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
      settleMountedInteraction: () => settlePixelInteractionRef.current(),
      cancelMountedInteraction: () => cancelPixelInteractionRef.current(),
      reportFailure: (message) => reportInteractionTransitionFailureRef.current(message)
    });
  }
  const interactionTransitions = interactionTransitionCoordinatorRef.current;
  const settleMountedDocumentInteraction = async () => {
    const admission = await interactionTransitions.request('commit-before-mutation');
    if (admission.status === 'rejected') throw new Error(admission.reason);
  };
  const runAfterMountedDocumentAdmission = (
    action: () => void
  ) => {
    void interactionTransitions.request('commit-before-mutation').then((admission) => {
      if (admission.status === 'admitted') action();
    });
  };
  useLayoutEffect(() => () => {
    void interactionTransitions.request('cancel-on-document-retire');
  }, [interactionTransitions, workspaceDocumentId]);
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
    parameters: unknown
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
      if (result.status === 'rejected') setError(result.message);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The command could not be completed.');
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
  const [groupVisibility, setGroupVisibility] = useState<GroupVisibility>(
    () => documentSession?.getSnapshot().processing.groupVisibility
      ?? createDefaultGroupVisibility()
  );
  const publishDocumentAdjustmentsState = useCallback((next: BasicAdjustments) => {
    const cloned = cloneAdjustments(next);
    documentAdjustmentsRef.current = cloned;
    documentSession?.updateProcessing((current) => ({
      ...current,
      adjustments: cloned
    }));
  }, [documentSession]);
  const publishGroupVisibilityState = useCallback((next: GroupVisibility) => {
    const cloned = { ...next };
    groupVisibilityRef.current = cloned;
    setGroupVisibility(cloned);
    documentSession?.updateProcessing((current) => ({
      ...current,
      groupVisibility: cloned
    }));
  }, [documentSession]);
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
  const [focusPickerActive, setFocusPickerActive] = useState(false);
  const [pointColorPickerActive, setPointColorPickerActive] = useState(false);
  const [pointColorRangeVisualization, setPointColorRangeVisualization] = useState<{
    readonly ownerId: string | null;
    readonly sample: PointColorSample;
  } | null>(null);
  const [lensBlurViewportMode, setLensBlurViewportModeState] = useState<LensBlurViewportMode>('result');
  const [imageDocument, setImageDocument, imageDocumentRef] =
    useDocumentImageState(documentSession);
  const activePresentationRef = useRef(active);
  activePresentationRef.current = active;
  useEffect(() => {
    if (rendererSnapshot.status !== 'ready') return;
    const renderer = engineRef.current;
    const hueDistribution = hueDistributionCanvasRef.current;
    const parade = paradeCanvasRef.current;
    const vectorscope = vectorscopeCanvasRef.current;
    if (!renderer || !hueDistribution || !parade || !vectorscope) return;
    // Scopes may mount after the first image (for example when leaving Gen AI).
    let current = true;
    void renderer.initializeScopes({
      hueDistribution, parade, vectorscope,
      ...(colorMixerHueCanvasRef.current ? { colorMixerHueDistribution: colorMixerHueCanvasRef.current } : {})
    }).catch((reason: unknown) => {
      if (current) setScopeError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { current = false; };
  }, [documentSurfaceRevision, rendererSnapshot.status, rendererSnapshot.generation]);
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
  useEffect(() => {
    if (rendererSnapshot.status === 'ready') {
      // A renderer that merely submitted one frame is not proof that the new
      // device is stable. Keep the consecutive-loss budget across short
      // recover/fail loops and only forgive it after a sustained ready period.
      const timer = window.setTimeout(() => {
        consecutiveDeviceLossRecoveriesRef.current = 0;
      }, DEVICE_LOSS_STABILITY_WINDOW_MS);
      return () => window.clearTimeout(timer);
    }
    if (rendererSnapshot.status !== 'failed'
      || !/^WebGPU device lost:/u.test(rendererSnapshot.error ?? '')
      || recoveredFailureGenerationRef.current === rendererSnapshot.generation) return undefined;
    recoveredFailureGenerationRef.current = rendererSnapshot.generation;
    // Recovery is a document lifecycle decision. React and tool projections
    // may trail an in-flight commit, so consult the canonical session first.
    const recoveryDocument = documentSession?.getSnapshot().document
      ?? imageDocumentRef.current;
    if (recoveryDocument) {
      const recovery = resolveDocumentGpuRecoveryPolicy(recoveryDocument);
      if (recovery.mode === 'checkpoint-required') {
        setError(
          `${rendererSnapshot.error} Automatic renderer recovery was stopped to protect `
          + `${recovery.reasons.join(', ')}. Restore the document from its recovery checkpoint `
          + 'or reopen the saved source; LightTable will not present missing pixels as recovered.'
        );
        return undefined;
      }
    }
    if (consecutiveDeviceLossRecoveriesRef.current >= DEVICE_LOSS_RECOVERY_LIMIT) {
      setError(
        `${rendererSnapshot.error} Automatic renderer recovery was stopped after `
        + `${DEVICE_LOSS_RECOVERY_LIMIT} consecutive device-loss recoveries. `
        + 'Reopen the saved source or restore its recovery checkpoint.'
      );
      return undefined;
    }
    consecutiveDeviceLossRecoveriesRef.current += 1;
    replaceRendererOnNextOpenRef.current = true;
    const timer = window.setTimeout(() => setRendererRecoverySequence(value => value + 1), 50);
    return () => window.clearTimeout(timer);
  }, [
    documentSession,
    rendererSnapshot.error,
    rendererSnapshot.generation,
    rendererSnapshot.status
  ]);
  const loadDocumentPalette = useDocumentPalette(engineRef, imageDocumentRef), loadLayerPalette = useLayerPalette(engineRef, imageDocumentRef);
  const attachColorMixerHueCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    colorMixerHueCanvasRef.current = canvas;
    if (!canvas) return;
    const renderer = engineRef.current;
    const hueDistribution = hueDistributionCanvasRef.current;
    const parade = paradeCanvasRef.current;
    const vectorscope = vectorscopeCanvasRef.current;
    if (!renderer || !hueDistribution || !parade || !vectorscope) return;
    void renderer.initializeScopes({
      hueDistribution,
      colorMixerHueDistribution: canvas,
      parade,
      vectorscope
    });
  }, []);
  const [propertiesTarget, setPropertiesTarget] = useState<PropertiesInspectorTarget>({
    kind: 'none'
  });
  const propertiesTargetRef = useRef(propertiesTarget);
  propertiesTargetRef.current = propertiesTarget;
  const showProperties = useCallback((target: PropertiesInspectorTarget) => {
    setPropertiesTarget(target);
    requestAnimationFrame(() => {
      workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.properties);
    });
  }, []);
  useEffect(() => {
    setPropertiesTarget((current) => reconcilePropertiesTarget(imageDocument, current));
  }, [imageDocument?.activeLayerId, imageDocument?.id, imageDocument?.revision]);
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
    genAiDocumentContext
  );
  const [genAiBaseImageSelected, setGenAiBaseImageSelected] = useState(false);
  const [genAiBaseImageAssetId, setGenAiBaseImageAssetId] =
    useState<import('@lighttable/genai-core').GenAiAssetId>();
  React.useEffect(() => {
    setGenAiBaseImageSelected(genAiSetup.selectedMode === 'image2image');
  }, [genAiSetup.selectedMode]);
  const genAiBaseImageScopeRef = useRef<string | undefined>(undefined);
  const genAiBaseImageImportPendingRef = useRef(false);
  const importGenAiReferenceFile = React.useCallback(async (file: File) => {
    const imported = await genAiSetup.importAssetReference(file);
    if (imported) genAiSetup.requestAssetPreview(imported.id);
    return imported;
  }, [genAiSetup.importAssetReference, genAiSetup.requestAssetPreview]);
  const importGenAiDocumentReference = React.useCallback(async (documentId: string) => {
    if (!commandPorts) return undefined;
    const artifact = await commandPorts.exportPngArtifact(documentId as DocumentSessionId);
    return importGenAiReferenceFile(artifact);
  }, [commandPorts, importGenAiReferenceFile]);
  const [pendingTabReference, setPendingTabReference] = useState<{ id: string; origin: string } | null>(null);
  useEffect(() => {
    if (!pendingTabReference) return;
    const { id, origin } = pendingTabReference;
    if (!workspaceDocuments?.some(item => item.id === id)
      || (workspaceDocumentId !== id && workspaceDocumentId !== origin)
      || (workspaceDocumentId === id && rendererSnapshot.status === 'failed')) {
      setPendingTabReference(null);
      return;
    }
    if (workspaceDocumentId !== id || rendererSnapshot.status !== 'ready'
      || !imageDocument || imageDocument.id !== documentSession?.getSnapshot().document?.id
      || !commandPorts?.supportsPort(id as DocumentSessionId, 'exportPngArtifact')) return;
    // Registration is a layout effect: the current document's presentation port
    // is bound before this effect. Never export the tab we just switched away from.
    setPendingTabReference(null);
    void importGenAiDocumentReference(id).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [pendingTabReference, workspaceDocumentId, workspaceDocuments, rendererSnapshot.status,
    imageDocument, documentSession, commandPorts, importGenAiDocumentReference]);
  const genAiBaseImageScope = `${activeGenAiProjectId ?? 'session'}:${String(workspaceDocumentId)}`;
  React.useEffect(() => {
    const previousScope = genAiBaseImageScopeRef.current;
    genAiBaseImageScopeRef.current = genAiBaseImageScope;
    if (!previousScope || previousScope === genAiBaseImageScope || !genAiBaseImageAssetId) return;
    genAiSetup.removeAssetReference(genAiBaseImageAssetId);
    setGenAiBaseImageAssetId(undefined);
  }, [genAiBaseImageAssetId, genAiBaseImageScope, genAiSetup.removeAssetReference]);
  React.useEffect(() => {
    if (!genAiBaseImageSelected || !genAiBaseImageAssetId
      || genAiSetup.workflow?.mode !== 'image2image') return;
    genAiSetup.addAssetReference(genAiBaseImageAssetId, false);
  }, [genAiBaseImageAssetId, genAiBaseImageSelected,
    genAiSetup.addAssetReference, genAiSetup.workflow?.id]);
  React.useEffect(() => {
    const imageEditWorkflowReady = genAiSetup.workflow?.mode === 'image2image'
      && genAiSetup.workflow.fields.some(({ kind }) => kind === 'asset');
    if (!active || !genAiBaseImageSelected || !imageEditWorkflowReady
      || genAiBaseImageAssetId || genAiBaseImageImportPendingRef.current) return;
    let current = true;
    genAiBaseImageImportPendingRef.current = true;
    void importGenAiDocumentReference(String(workspaceDocumentId)).then((asset) => {
      if (current && asset) setGenAiBaseImageAssetId(asset.id);
    }).finally(() => { genAiBaseImageImportPendingRef.current = false; });
    return () => { current = false; };
  }, [active, genAiBaseImageSelected,
    genAiBaseImageAssetId, genAiSetup.workflow?.id,
    importGenAiDocumentReference, workspaceDocumentId]);
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
  const [editorSession, setEditorSession] = useDocumentEditorSession(
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
  const [temporaryPanActive, setTemporaryPanActive] = useState(false);
  const [temporaryEraseActive, setTemporaryEraseActive] = useState(false);
  const [temporaryZoomActive, setTemporaryZoomActive] = useState(false);
  const [temporaryZoomOutActive, setTemporaryZoomOutActive] = useState(false);
  const transformSnapMatchesRef = useRef<readonly SnapMatch[]>([]);
  const [selectionSnapFeedback, setSelectionSnapFeedback] = useState<{
    matches: readonly SnapMatch[];
    bounds: Rect | null;
  }>({ matches: [], bounds: null });
  const [guideDraft, setGuideDraft] = useState<readonly DocumentGuide[] | null>(null);
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
  const commitPointTextRef = useRef<(beginEditing?: boolean) => boolean>(() => false);
  const cancelPointTextRef = useRef<() => boolean>(() => false);
  const commitParagraphTextRef = useRef<() => boolean>(() => false);
  const commitParagraphCanvasTextRef = useRef<() => boolean>(() => false);
  const cancelParagraphTextRef = useRef<() => boolean>(() => false);
  const paragraphCanvasCreationPendingRef = useRef(false);
  const finishTextEditingRef = useRef<() => boolean>(() => false);
  const quickExportPngRef = useRef<() => Promise<void>>(async () => undefined);
  const { exportNativeArtifactRef, exportPngArtifactRef, exportBitmapArtifactRef,
    exportPreviewArtifactRef, exportPsdArtifactRef } = useEditorArtifactExportRefs();
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
    readonly transaction: DocumentMutationTransaction;
    readonly layerId: LayerId;
    readonly start: LightTableGestureSample;
  } | null>(null);
  const textPropertyGestureControllerRef = useRef<TextPropertyGestureController | null>(null);
  const selectLayerRef = useRef<(layerId: LayerId) => void | Promise<void>>(() => undefined);
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
  }, [paragraphTextController, pointTextController]);

  const standaloneFontRegistryDisposalGenerationRef = useRef(0);
  useEffect(() => {
    standaloneFontRegistryDisposalGenerationRef.current += 1;
    return () => {
      // React StrictMode performs a synthetic setup/cleanup/setup cycle. A
      // synchronous dispose here leaves that same mounted render holding a
      // dead registry, which is especially visible when a video is the first
      // document and the image editor surface never opens. Delay actual
      // destruction until a microtask and cancel it when the overlay acquires
      // the resource again during StrictMode replay.
      const generation = ++standaloneFontRegistryDisposalGenerationRef.current;
      queueMicrotask(() => {
        if (standaloneFontRegistryDisposalGenerationRef.current !== generation) return;
        standaloneFontRegistryRef.current?.dispose();
        standaloneFontRegistryRef.current = null;
      });
    };
  }, []);

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
  const removeObjectPendingRef = useRef(false);
  const removeSelectedObject = React.useCallback(() => {
    if (removeObjectPendingRef.current) return;
    const renderer = engineRef.current;
    const document = imageDocumentRef.current;
    if (!genAiService || !activeGenAiProjectId || !renderer || !document) {
      setError('Open a project and a ready document before using Remove Object.');
      return;
    }
    removeObjectPendingRef.current = true;
    setError(null);
    setGradeStatus('Removing the selected object...');
    void executeRemoveObject({
      service: genAiService,
      projectId: activeGenAiProjectId,
      renderer,
      preferredProviderIds: [editGenAiProviderId, selectedGenAiProviderId],
      documentName: initialSourceName,
      documentWidth: document.width,
      documentHeight: document.height
    }).then(() => {
      setGradeStatus('Remove Object submitted.');
    }).catch((reason) => {
      setGradeStatus(null);
      setError(reason instanceof Error ? reason.message : 'Remove Object could not be submitted.');
    }).finally(() => {
      removeObjectPendingRef.current = false;
    });
  }, [activeGenAiProjectId, editGenAiProviderId, genAiService, imageDocumentRef,
    initialSourceName, selectedGenAiProviderId]);

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
    () => createDocumentProjectionController({
      getDocument: () => imageDocumentRef.current,
      publishDocument: (document) => {
        imageDocumentRef.current = document;
        setImageDocument(document);
      },
      getDocumentAdjustments: () => documentAdjustmentsRef.current,
      publishDocumentAdjustments: (nextAdjustments) => {
        publishDocumentAdjustmentsState(nextAdjustments);
      },
      publishEditorAdjustments: (nextAdjustments, domain) => {
        publishAdjustmentPresentation(nextAdjustments, domain);
      },
      stageEditorAdjustments: (nextAdjustments) => {
        adjustmentsRef.current = nextAdjustments;
      },
      getGroupVisibility: () => groupVisibilityRef.current,
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
    [publishAdjustmentPresentation, setImageDocument]
  );
  const applyAdjustmentSnapshot = documentProjectionController.applyAdjustmentSnapshot;
  const previewAdjustmentSnapshot = documentProjectionController.previewAdjustmentSnapshot;

  const finishOpenHistoryTransactions = useCallback(async () => {
    // Undo/redo must retire pending selection work as well as the renderer's
    // active transform preview before either can restore shared GPU state.
    await settleMountedDocumentInteraction();
    commitPointTextRef.current();
    commitParagraphTextRef.current();
    finishTextEditingRef.current();
    resetAdjustmentTransactionRef.current();
    await resetDocumentTransactionRef.current();
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

  const applyDocumentSnapshot = useCallback((document: ImageDocument) => {
    // A canonical document command supersedes any pointer-rate adjustment
    // preview. Hidden contextual panels can receive a later blur event; that
    // event must not commit an interaction that belonged to the old layer.
    // Canonical publication retires only a preview that already owns the old
    // document. A successor adjustment may currently be waiting for this
    // transform publication through InteractionTransitionCoordinator; do not
    // cancel that admitted-next gesture here.
    resetActiveAdjustmentTransactionRef.current();
    documentProjectionController.applyDocumentSnapshot(document);
    const source = resolveAdjustmentPresentationSource(
      document,
      documentAdjustmentsRef.current,
      propertiesTargetRef.current
    );
    const previousSource = adjustmentPresentationSourceRef.current;
    if (source && (source.key !== previousSource?.key
      || source.source !== previousSource.source)) {
      const presentation = materializeAdjustmentPresentationSource(source);
      publishAdjustmentPresentation(presentation.adjustments, presentation.domain);
      adjustmentPresentationSourceRef.current = source;
    }
  }, [documentProjectionController, publishAdjustmentPresentation]);
  const applyCanonicalAdjustmentProjection = useCallback((
    projection: ColorLookupCanonicalProjection,
    domain: AdjustmentPresentationDomain
  ) => {
    documentProjectionController.applyProjectedAdjustmentSnapshot(
      { ...projection, editorAdjustments: projection.documentAdjustments },
      domain,
      false
    );
    if (!projection.document) return;
    const source = resolveAdjustmentPresentationSource(
      projection.document,
      projection.documentAdjustments,
      propertiesTargetRef.current
    );
    if (!source) return;
    const presentation = materializeAdjustmentPresentationSource(source);
    publishAdjustmentPresentation(presentation.adjustments, presentation.domain);
    adjustmentPresentationSourceRef.current = source;
  }, [documentProjectionController, publishAdjustmentPresentation]);

  const publishDocumentSelection = useCallback((
    document: ImageDocument,
    selection: readonly SelectionOperation[],
    selectionMaskSnapshot: SelectionMaskSnapshot,
    expectedSelectionRevision?: number,
    bindingIsCurrent: () => boolean = () => true
  ) => {
    const supportBounds = selectionMaskSnapshot.active
      ? selectionOperationsSupportBounds([...selection], {
          x: 0, y: 0, width: document.width, height: document.height
        })
      : null;
    const publish = () => {
      if (documentSession) {
        const store = new DocumentSelectionStateStore(documentSession);
        const sessionSnapshot = documentSession.getSnapshot();
        const expectedDocument = sessionSnapshot.document;
        if (!expectedDocument) throw new Error('The selection document is unavailable.');
        const lease = store.acquire(sessionSnapshot.documentRevision);
        if ((expectedSelectionRevision !== undefined
          && Number(lease.selection.revision) !== expectedSelectionRevision) || !bindingIsCurrent())
          throw new Error('The selection publication lease is no longer current.');
        const committed = store.compareAndSwapForDocument(lease.selection.revision, expectedDocument, {
          ...lease.selection,
          revision: (Number(lease.selection.revision) + 1) as typeof lease.selection.revision,
          canvas: { width: document.width, height: document.height },
          active: selectionMaskSnapshot.active,
          coverage: selectionMaskSnapshot,
          supportBounds,
          provenance: [...selection]
        }, document);
        if (!committed) throw new Error('The selection changed during compound publication.');
        if (!bindingIsCurrent()) throw new Error('The renderer changed during compound publication.');
        applyDocumentSnapshot(document);
        editorSessionRef.current = {
          ...editorSessionRef.current,
          pointerId: null,
          selection: [...selection],
          selectionMaskSnapshot,
          selectionRevision: editorSessionRef.current.selectionRevision + 1,
          selectionSupportBounds: supportBounds
        };
      } else {
        if ((expectedSelectionRevision !== undefined
          && editorSessionRef.current.selectionRevision !== expectedSelectionRevision)
          || !bindingIsCurrent()) {
          throw new Error('The selection publication lease is no longer current.');
        }
        applyDocumentSnapshot(document);
        setEditorSession((current) => ({
          ...current,
          pointerId: null,
          selection: [...selection],
          selectionMaskSnapshot,
          selectionRevision: current.selectionRevision + 1,
          selectionSupportBounds: supportBounds
        }));
      }
    };
    if (documentSession) documentSession.runPublication(publish);
    else publish();
  }, [applyDocumentSnapshot, documentSession, setEditorSession]);

  const publishTransformDocumentSelection = useCallback((
    document: ImageDocument,
    selection: readonly SelectionOperation[],
    selectionMaskSnapshot: SelectionMaskSnapshot,
    expectedLease: import('./application/tools/selection/DocumentSelectionStateStore')
      .LightTableSelectionReadLease,
    bindingIsCurrent: () => boolean,
    rendererIsAddressable: () => boolean,
    publishPixels: () => () => void
  ) => {
    if (!documentSession) throw new Error('The transform selection document is unavailable.');
    publishTransformSelectionTransaction({
      session: documentSession,
      document,
      selection,
      coverage: selectionMaskSnapshot,
      expectedLease,
      bindingIsCurrent,
      rendererIsAddressable,
      publishPixels,
      getProjectedDocument: () => imageDocumentRef.current,
      applyDocumentSnapshot,
      publishEditorProjection: (next) => {
        editorSessionRef.current = {
          ...editorSessionRef.current,
          pointerId: null,
          selection: [...next.selection],
          selectionMaskSnapshot: next.coverage,
          selectionRevision: next.selectionRevision,
          selectionSupportBounds: next.supportBounds
        };
      }
    });
  }, [applyDocumentSnapshot, documentSession]);

  const documentMutationController = useDocumentMutationController({
    getDocument: () => imageDocumentRef.current,
      applySnapshot: applyDocumentSnapshot,
      previewSnapshot: documentProjectionController.previewDocumentSnapshot,
      discardPreview: documentProjectionController.discardDocumentPreview,
      pushHistoryEntry,
    isMutationBlocked: () => commandHistory.getSnapshot().busy
      || (documentSession ? !documentSession.isAcceptingMutations() : false)
  });
  const faceWarpDetectionControllerRef = useRef<FaceWarpDetectionReviewController | null>(null);
  faceWarpDetectionControllerRef.current ??= new FaceWarpDetectionReviewController(() => ({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation,
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
    selectedFaceId: faceWarpSelectedFaceId,
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
      const generation = rendererLifecycle.getSnapshot().generation;
      return {
        isCurrent: () => engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === generation,
        setMode: (mode) => renderer.setFaceWarpInteractionMode(mode)
      };
    },
    setError
  }));
  const faceWarpSessionController = faceWarpSessionControllerRef.current;
  resetFaceWarpSessionRef.current = faceWarpSessionController.reset;
  useEffect(() => () => faceWarpSessionController.reset(), [faceWarpSessionController]);
  useEffect(() => () => faceWarpDetectionController.dispose(), [faceWarpDetectionController]);
  useEffect(() => {
    faceWarpSessionController.reset();
    faceWarpDetectionController.reset();
  }, [
    faceWarpDetectionController,
    faceWarpSessionController,
    rendererSnapshot.generation,
    workspaceDocumentId
  ]);
  useEffect(() => {
    if (editorSession.activeTool !== 'face-warp') {
      faceWarpSessionController.reset();
      faceWarpDetectionController.reset();
    }
  }, [editorSession.activeTool, faceWarpDetectionController, faceWarpSessionController]);
  resetDocumentTransactionRef.current = async () => {
    await documentMutationController.waitForIdle();
    layerDocumentTransactionRef.current = null;
    resetFaceWarpSessionRef.current();
    textPropertyGestureControllerRef.current?.cancelDocumentGesture();
    documentMutationController.cancelActive();
  };
  const commitActiveDocumentTransaction = () => {
    layerDocumentTransactionRef.current = null;
    const textPropertyCommit = textPropertyGestureControllerRef.current?.commitDocumentGesture();
    if (textPropertyCommit !== null && textPropertyCommit !== undefined) return textPropertyCommit;
    return documentMutationController.commitActive();
  };
  const pushDocumentHistory = documentMutationController.record;
  const beginLayerDocumentTransaction = () => {
    if (layerDocumentTransactionRef.current?.active) return false;
    const transaction = documentMutationController.begin('layer-panel');
    layerDocumentTransactionRef.current = transaction;
    return transaction !== null;
  };
  const changeLayerDocument = (
    change: (document: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    const transaction = layerDocumentTransactionRef.current;
    return transaction?.active
      ? transaction.change(change)
      : documentMutationController.change(change, recordHistory);
  };
  const commitLayerDocumentTransaction = () => {
    const transaction = layerDocumentTransactionRef.current;
    layerDocumentTransactionRef.current = null;
    return transaction?.commit() ?? false;
  };
  const cancelLayerDocumentTransaction = () => {
    const transaction = layerDocumentTransactionRef.current;
    layerDocumentTransactionRef.current = null;
    return transaction?.cancel() ?? false;
  };
  const beginFaceWarpDocumentTransaction = () => {
    return faceWarpSessionController.beginEdit();
  };
  const changeFaceWarpDocument = (
    change: (document: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    return faceWarpSessionController.changeDocument(change, recordHistory);
  };
  const commitFaceWarpDocumentTransaction = () => {
    return faceWarpSessionController.commitEdit();
  };
  const cancelFaceWarpDocumentTransaction = () => {
    return faceWarpSessionController.cancelEdit();
  };
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

  const activeFaceWarpLayer = imageDocument
    ? findRasterLayer(imageDocument, imageDocument.activeLayerId)
    : null;
  const activeFaceWarpInstance = activeFaceWarpLayer
    ? findFaceWarpModuleInstance(activeFaceWarpLayer.adjustmentStack)
    : null;
  const activeFaceWarpSettings = activeFaceWarpInstance
    ? readFaceWarpNodeSettings(activeFaceWarpInstance)
    : null;
  const activeFaceWarpFaces = activeFaceWarpSettings?.faces ?? [];
  const currentFaceWarpReviewSource = imageDocument
    && activeFaceWarpLayer
    ? {
      documentId: imageDocument.id,
      layerId: activeFaceWarpLayer.id,
      pixelRevision: activeFaceWarpLayer.pixelRevision,
      transform: activeFaceWarpLayer.transform
    }
    : null;
  const pendingFaceWarpDetectionForActiveLayer = faceWarpDetectionController.pendingFor(
    currentFaceWarpReviewSource
  );
  const visibleFaceWarpFaces = pendingFaceWarpDetectionForActiveLayer?.settings.faces
    ?? activeFaceWarpFaces;
  const effectiveFaceWarpFaceId = visibleFaceWarpFaces.some(({ id }) => id === faceWarpSelectedFaceId)
    ? faceWarpSelectedFaceId
    : visibleFaceWarpFaces[0]?.id ?? null;
  const updateFaceWarpParameters = useCallback((change: Partial<FaceWarpParameters>) => {
    const currentDocument = imageDocumentRef.current;
    const eligibility = currentDocument?.activeLayerId
      ? resolveFaceWarpEligibility(currentDocument, currentDocument.activeLayerId)
      : null;
    if (!eligibility?.ok) {
      if (eligibility) setError(eligibility.reason);
      return;
    }
    const faceId = faceWarpSelectedFaceId
      ?? (() => {
        const document = imageDocumentRef.current;
        const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
        const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
        return instance ? readFaceWarpNodeSettings(instance).faces[0]?.id ?? null : null;
      })();
    if (!faceId) return;
    changeFaceWarpDocument((document) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      if (!layer?.adjustmentStack || !instance) return document;
      return applySemanticFaceWarpCommandToDocument(document, {
        layerId: layer.id,
        operation: { kind: 'set-semantic', faceId, target: faceWarpSemanticTarget, change }
      });
    });
  }, [changeFaceWarpDocument, faceWarpSelectedFaceId, faceWarpSemanticTarget, imageDocumentRef]);

  const updateFaceWarpProtection = useCallback((
    feature: FaceWarpProtectedFeature,
    locked: boolean
  ) => {
    const currentDocument = imageDocumentRef.current;
    const eligibility = currentDocument?.activeLayerId
      ? resolveFaceWarpEligibility(currentDocument, currentDocument.activeLayerId)
      : null;
    if (!eligibility?.ok) {
      if (eligibility) setError(eligibility.reason);
      return;
    }
    const faceId = faceWarpSelectedFaceId ?? effectiveFaceWarpFaceId;
    if (!faceId) return;
    changeFaceWarpDocument((document) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      if (!layer?.adjustmentStack || !instance) return document;
      return applySemanticFaceWarpCommandToDocument(document, {
        layerId: layer.id,
        operation: { kind: 'set-protection', faceId, feature, locked }
      });
    });
  }, [changeFaceWarpDocument, effectiveFaceWarpFaceId, faceWarpSelectedFaceId]);

  useEffect(() => {
    faceWarpDetectionController.synchronize(currentFaceWarpReviewSource);
  }, [currentFaceWarpReviewSource, faceWarpDetectionController]);

  const detectFacesForActiveLayer = useCallback(
    () => faceWarpDetectionController.detect(),
    [faceWarpDetectionController]
  );
  const acceptPendingFaceWarpDetection = useCallback(
    () => faceWarpDetectionController.accept(),
    [faceWarpDetectionController]
  );
  const cancelPendingFaceWarpDetection = useCallback(
    () => faceWarpDetectionController.cancel(activeFaceWarpFaces),
    [activeFaceWarpFaces, faceWarpDetectionController]
  );

  const resetSelectedFaceWarp = useCallback(() => {
    const currentDocument = imageDocumentRef.current;
    const eligibility = currentDocument?.activeLayerId
      ? resolveFaceWarpEligibility(currentDocument, currentDocument.activeLayerId)
      : null;
    if (!eligibility?.ok) {
      if (eligibility) setError(eligibility.reason);
      return;
    }
    const faceId = effectiveFaceWarpFaceId;
    if (!faceId) return;
    changeFaceWarpDocument((document) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      if (!layer?.adjustmentStack || !instance) return document;
      const current = readFaceWarpNodeSettings(instance);
      const faces = current.faces.map((face) => face.id === faceId ? {
        ...face,
        parameters: createDefaultFaceWarpParameters(),
        featureOverrides: undefined,
        displacements: []
      } : face);
      return setRasterLayerAdjustmentStack(document, layer.id,
        setFaceWarpNodeSettings(layer.adjustmentStack, { ...current, faces }));
    });
  }, [changeFaceWarpDocument, effectiveFaceWarpFaceId]);

  const changeFaceWarpMeshVisible = useCallback((visible: boolean) => {
    faceWarpDetectionController.setMeshVisible(visible);
  }, [faceWarpDetectionController]);

  useEffect(() => {
    const renderer = engineRef.current;
    if (!renderer) return;
    if (
      editorSession.activeTool !== 'face-warp'
      || !faceWarpMeshVisible
      || !activeFaceWarpLayer
      || visibleFaceWarpFaces.length === 0
    ) {
      renderer.setFaceWarpEditingOverlay(null);
      return;
    }
    renderer.setFaceWarpEditingOverlay(buildFaceWarpMeshOverlay(
      visibleFaceWarpFaces,
      activeFaceWarpLayer.transform,
      pendingFaceWarpDetectionForActiveLayer?.settings.topology.triangleIndices
        ?? activeFaceWarpSettings?.topology.triangleIndices
        ?? [],
      effectiveFaceWarpFaceId
    ));
  }, [
    visibleFaceWarpFaces,
    activeFaceWarpLayer,
    activeFaceWarpSettings,
    editorSession.activeTool,
    effectiveFaceWarpFaceId,
    faceWarpMeshVisible,
    pendingFaceWarpDetectionForActiveLayer
  ]);

  const beginFaceWarpGesture = (pointerId: number, documentPoint: { x: number; y: number }) => {
    if (pendingFaceWarpDetectionForActiveLayer) return false;
    const document = imageDocumentRef.current;
    if (!document?.activeLayerId) return false;
    const eligibility = resolveFaceWarpEligibility(document, document.activeLayerId);
    if (!eligibility.ok) {
      setError(eligibility.reason);
      return false;
    }
    const { layer, settings } = eligibility;
    const inverse = invertMatrix(layer.transform);
    if (!inverse) return false;
    const sourcePoint = transformPoint(inverse, documentPoint);
    const orderedFaces = [
      ...settings.faces.filter(({ id }) => id === effectiveFaceWarpFaceId),
      ...settings.faces.filter(({ id }) => id !== effectiveFaceWarpFaceId)
    ];
    const hit = orderedFaces
      .map((face) => ({
        face,
        hit: findDeformedFaceHit(face, settings.topology.triangleIndices, sourcePoint)
      }))
      .find((candidate) => candidate.hit !== null);
    if (!hit?.hit) return false;
    const gesture: FaceWarpGestureContext = {
      pointerId,
      faceId: hit.face.id,
      seedSource: hit.hit.sourcePoint,
      startPointerSource: sourcePoint,
      originalDisplacements: hit.face.displacements,
      latestRadius: 0,
      mode: 'sculpt'
    };
    if (!faceWarpSessionController.beginGesture(document.id, layer.id, gesture)) return false;
    faceWarpDetectionController.setSelectedFaceId(hit.face.id);
    return true;
  };

  const moveFaceWarpGesture = (
    pointerId: number,
    documentPoint: { x: number; y: number },
    mode: 'sculpt' | 'relax' | 'restore'
  ) => {
    return faceWarpSessionController.changeGesture(pointerId, mode, (document, gesture) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      const inverse = layer ? invertMatrix(layer.transform) : null;
      if (!layer?.adjustmentStack || !instance || !inverse) return document;
      const settings = readFaceWarpNodeSettings(instance);
      const sourcePoint = transformPoint(inverse, documentPoint);
      const sourceScale = Math.sqrt(Math.max(1e-8, Math.abs(
        layer.transform.a * layer.transform.d - layer.transform.b * layer.transform.c
      )));
      const radius = editorSession.brush.size * 0.5 / sourceScale;
      gesture.latestRadius = radius;
      gesture.mode = mode;
      const faces = settings.faces.map((face) => {
        if (face.id !== gesture.faceId) return face;
        return {
          ...face,
          displacements: mode === 'relax'
            ? relaxFaceWarpBrush(face, settings.topology.triangleIndices, sourcePoint, radius, 0.35)
            : mode === 'restore'
              ? restoreFaceWarpBrush(face, settings.topology.triangleIndices, sourcePoint, radius, 0.5)
              : applyFaceWarpBrush(
                { ...face, displacements: gesture.originalDisplacements },
                settings.topology.triangleIndices,
                gesture.seedSource,
                {
                  x: sourcePoint.x - gesture.startPointerSource.x,
                  y: sourcePoint.y - gesture.startPointerSource.y
                },
                radius,
                editorSession.brush.opacity
              )
        };
      });
      return setRasterLayerAdjustmentStack(
        document,
        layer.id,
        setFaceWarpNodeSettings(layer.adjustmentStack, { ...settings, faces })
      );
    });
  };

  const finishFaceWarpGesture = (pointerId: number) => {
    const gesture = faceWarpSessionController.gesture;
    if (!gesture || gesture.pointerId !== pointerId) return false;
    if (gesture.mode === 'sculpt' && gesture.latestRadius > 0) {
      const refinement = {
        faceId: gesture.faceId,
        seedSource: gesture.seedSource,
        radius: gesture.latestRadius
      };
      return faceWarpSessionController.finishGesture(pointerId, (currentDocument) => {
          const layer = findRasterLayer(currentDocument, currentDocument.activeLayerId);
          const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
          if (!layer?.adjustmentStack || !instance) return currentDocument;
          const settings = readFaceWarpNodeSettings(instance);
          const faces = settings.faces.map((face) => face.id === refinement.faceId
            ? {
              ...face,
              displacements: refineFaceWarpBrush(
                face,
                settings.topology.triangleIndices,
                refinement.seedSource,
                refinement.radius
              )
            }
            : face);
          return setRasterLayerAdjustmentStack(
            currentDocument,
            layer.id,
            setFaceWarpNodeSettings(layer.adjustmentStack, { ...settings, faces })
          );
      });
    }
    return faceWarpSessionController.finishGesture(pointerId);
  };

  const cancelFaceWarpGesture = (pointerId: number) => (
    faceWarpSessionController.cancelGesture(pointerId)
  );

  const commitImageSize = async (request: ImageSizeRequest, reportError = true) => {
    await finishOpenHistoryTransactions();
    if (!documentSession) {
      const reason = new Error('Image Size requires an admitted document session.');
      if (!reportError) throw reason;
      setError(reason.message);
      return false;
    }
    const renderer = engineRef.current;
    if (!renderer) {
      const reason = new Error('The document renderer is unavailable.');
      if (!reportError) throw reason;
      setError(reason.message);
      return false;
    }
    const history = { type: 'document.image-size', label: 'Image Size' } as const;
    const transaction = documentMutationController.begin(
      'document.image-size',
      history,
      undefined,
      'cancel'
    );
    if (!transaction) {
      const reason = new Error('Image Size could not acquire the active document.');
      if (!reportError) throw reason;
      setError(reason.message);
      return false;
    }
    const before = transaction.before;
    const rendererGeneration = rendererLifecycle.getSnapshot().generation;
    const selectionIdentity = editorSessionRef.current.selection;
    const selectionMaskIdentity = editorSessionRef.current.selectionMaskSnapshot;
    const beforeSelection = [...selectionIdentity];
    try {
      const plan = createResizePlan(before, request);
      const after = resizeImageDocumentSemantics(before, request);
      if (after === before) {
        transaction.cancel();
        editorDialogs.closeImageSize();
        return false;
      }
      const afterSelection = plan.targetWidth === plan.sourceWidth
        && plan.targetHeight === plan.sourceHeight
        ? beforeSelection
        : projectSelectionTransform(beforeSelection, {
            a: plan.scaleX, b: 0, c: 0, d: plan.scaleY, tx: 0, ty: 0
          });
      const committed = await commitDocumentSurfaceMutation({
        transaction,
        afterDocument: after,
        beforeSelection,
        afterSelection,
        beforeSelectionMask: selectionMaskIdentity,
        history,
        acquirePublicationAdmission: () => documentSession.acquirePublicationAdmission(
          'Image Size is preparing a document-wide publication.'
        ),
        originIsCurrent: () => imageDocumentRef.current === before
          && engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === rendererGeneration
          && editorSessionRef.current.selection === selectionIdentity
          && editorSessionRef.current.selectionMaskSnapshot === selectionMaskIdentity,
        runtimeIsCurrent: () => engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === rendererGeneration,
        captureSelectionSnapshot: () => renderer.captureSelectionSnapshot(),
        restoreSelectionSnapshot: (snapshot) => renderer.restoreSelectionSnapshot(snapshot),
        createRuntimeMutation: () => renderer.resizeImagePixels(
          before,
          plan,
          request.preserveDetailsNoiseReduction
        ),
        resizeDocumentSurface: (document) => renderer.resizeDocumentSurface(document),
        publishDocumentSelection,
        pushHistoryEntry
      });
      if (!committed) throw new Error('Image Size did not complete.');
      editorDialogs.closeImageSize();
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
      return true;
    } catch (reason) {
      transaction.cancel();
      if (!reportError) throw reason;
      setError(reason instanceof Error ? reason.message : 'The image could not be resized.');
      return false;
    }
  };
  const commitDocumentGeometry = async (request: DocumentGeometryRequest, reportError = true) => {
    await finishOpenHistoryTransactions();
    if (!documentSession) {
      const reason = new Error('Document geometry requires an admitted document session.');
      if (!reportError) throw reason;
      setError(reason.message);
      return false;
    }
    const renderer = engineRef.current;
    if (!renderer) {
      const reason = new Error('The document renderer is unavailable.');
      if (!reportError) throw reason;
      setError(reason.message);
      return false;
    }
    const history = {
      type: `document.${request.operation}`,
      label: request.operation === 'canvas-size' ? 'Canvas Size'
        : request.operation === 'crop' ? 'Crop'
          : request.operation === 'flip' ? 'Flip Canvas' : 'Image Rotation'
    } as const;
    const transaction = documentMutationController.begin(
      `document.${request.operation}`,
      history,
      undefined,
      'cancel'
    );
    if (!transaction) {
      const reason = new Error(`${history.label} could not acquire the active document.`);
      if (!reportError) throw reason;
      setError(reason.message);
      return false;
    }
    const before = transaction.before;
    const rendererGeneration = rendererLifecycle.getSnapshot().generation;
    const selectionIdentity = editorSessionRef.current.selection;
    const selectionMaskIdentity = editorSessionRef.current.selectionMaskSnapshot;
    const beforeSelection = [...selectionIdentity];
    try {
      const plan = createDocumentGeometryPlan(before, request);
      const matrix = plan.oldDocumentToNewDocument;
      if (plan.targetWidth === before.width && plan.targetHeight === before.height
        && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1
        && matrix.tx === 0 && matrix.ty === 0) {
        transaction.cancel();
        editorDialogs.closeCanvasSize();
        return false;
      }
      const after = projectDocumentGeometry(before, plan);
      const afterSelection = projectSelectionGeometry(beforeSelection, plan);
      const committed = await commitDocumentSurfaceMutation({
        transaction,
        afterDocument: after,
        beforeSelection,
        afterSelection,
        beforeSelectionMask: selectionMaskIdentity,
        history,
        acquirePublicationAdmission: () => documentSession.acquirePublicationAdmission(
          `${history.label} is preparing a document-wide publication.`
        ),
        originIsCurrent: () => imageDocumentRef.current === before
          && engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === rendererGeneration
          && editorSessionRef.current.selection === selectionIdentity
          && editorSessionRef.current.selectionMaskSnapshot === selectionMaskIdentity,
        runtimeIsCurrent: () => engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === rendererGeneration,
        captureSelectionSnapshot: () => renderer.captureSelectionSnapshot(),
        restoreSelectionSnapshot: (snapshot) => renderer.restoreSelectionSnapshot(snapshot),
        createRuntimeMutation: () => renderer.applyDocumentGeometryPixels(before, plan),
        resizeDocumentSurface: (document) => renderer.resizeDocumentSurface(document),
        publishDocumentSelection,
        pushHistoryEntry
      });
      if (!committed) throw new Error(`${history.label} did not complete.`);
      editorDialogs.closeCanvasSize();
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
      return true;
    } catch (reason) {
      transaction.cancel();
      if (!reportError) throw reason;
      setError(reason instanceof Error ? reason.message : 'Document geometry could not be changed.');
      return false;
    }
  };
  const runImageSizeCommand = (request: ImageSizeRequest) => {
    void executeRegisteredCommand('document.resizeImage', request);
  };
  const runDocumentGeometryCommand = (request: DocumentGeometryRequest) => {
    void executeRegisteredCommand('document.applyGeometry', request);
  };
  const beginCrop = async () => {
    await finishOpenHistoryTransactions();
    const document = imageDocumentRef.current;
    if (!document) return;
    const selection = editorSessionRef.current.selection;
    if (selection.length) {
      const renderer = engineRef.current;
      if (!renderer) return;
      void renderer.measureSelectionBounds().then((coverage) => {
        if (imageDocumentRef.current !== document
          || editorSessionRef.current.selection !== selection) return;
        if (!coverage) {
          setError('The active selection has no crop area.');
          return;
        }
        runDocumentGeometryCommand({ operation: 'crop', bounds: coverage.supportBounds });
      }).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'The selection bounds could not be measured.');
      });
      return;
    }
    setCropBounds({ x: 0, y: 0, width: document.width, height: document.height });
  };
  const cancelCrop = () => setCropBounds(null);
  const commitCrop = () => {
    if (!cropBounds) return;
    const bounds = { ...cropBounds };
    setCropBounds(null);
    runDocumentGeometryCommand({ operation: 'crop', bounds });
  };
  const textToShapeControllerRef = useRef<TextToShapeCommandController | null>(null);
  textToShapeControllerRef.current ??= new TextToShapeCommandController(() => ({
    getDocument: () => imageDocumentRef.current,
    documentMutations: documentMutationController,
    resolveVectorPaths: (layerId, signal) => (
      engineRef.current?.vectorPathsForTextLayer(layerId, signal) ?? Promise.resolve(null)
    )
  }));
  const textToShapeController = textToShapeControllerRef.current;
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
  const activateWorkspaceDocument = useCallback((documentId: string) => {
    if (!onActivateWorkspaceDocument || documentId === workspaceDocumentId) return;
    textPropertyGestureController.finishBeforeTransition(() => {
      onActivateWorkspaceDocument(documentId);
    });
  }, [onActivateWorkspaceDocument, textPropertyGestureController, workspaceDocumentId]);
  const closeWorkspaceDocument = useCallback((documentId: string) => {
    const close = () => {
      if (onCloseWorkspaceDocument) onCloseWorkspaceDocument(documentId);
      else if (documentId === workspaceDocumentId) onClose();
    };
    if (documentId !== workspaceDocumentId) {
      close();
      return;
    }
    textPropertyGestureController.finishBeforeTransition(close);
  }, [onClose, onCloseWorkspaceDocument, textPropertyGestureController, workspaceDocumentId]);
  const existingTextHitControllerRef = useRef<ExistingTextHitController | null>(null);
  existingTextHitControllerRef.current ??= new ExistingTextHitController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation
  });
  const existingTextHitController = existingTextHitControllerRef.current;
  const existingTextActivationRevisionRef = useRef(0);
  useEffect(() => () => {
    textPropertyGestureController.dispose();
    textEditingController.reset();
    existingTextHitController.cancel();
  }, [existingTextHitController, textEditingController, textPropertyGestureController]);
  useEffect(() => {
    existingTextActivationRevisionRef.current += 1;
    existingTextHitController.cancel();
  }, [editorSession.activeTool, existingTextHitController, rendererSnapshot.generation,
    workspaceDocumentId]);
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
    textToShapeController.cancel();
  }, [textToShapeController]);

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
  const selectionSessionController = useSelectionSessionController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getSelection: () => editorSessionRef.current.selection,
    getSelectionMaskSnapshot: () => editorSessionRef.current.selectionMaskSnapshot,
    getSelectionSupportBounds: () => editorSessionRef.current.selectionSupportBounds,
    publishSelection: (selection, pointerId, selectionMaskSnapshot, commit) => {
      const nextMask = selectionMaskSnapshot === undefined
        ? editorSessionRef.current.selectionMaskSnapshot
        : selectionMaskSnapshot;
      editorSessionRef.current = {
        ...editorSessionRef.current,
        pointerId,
        selection,
        selectionMaskSnapshot: nextMask,
        ...(commit ? {
          selectionRevision: editorSessionRef.current.selectionRevision + 1,
          selectionSupportBounds: commit.supportBounds,
        } : {}),
      };
      setEditorSession((current) => ({
        ...current,
        pointerId,
        selection,
        selectionMaskSnapshot: selectionMaskSnapshot === undefined
          ? current.selectionMaskSnapshot
          : selectionMaskSnapshot,
        ...(commit ? {
          selectionRevision: current.selectionRevision + 1,
          selectionSupportBounds: commit.supportBounds,
        } : {}),
      }));
    },
    publishPointer: (pointerId) => {
      editorSessionRef.current = { ...editorSessionRef.current, pointerId };
      setEditorSession((current) => ({ ...current, pointerId }));
    },
    publishDraft: setSelectionDraft,
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
    getSnapContext: (movingBounds) => {
      const document = imageDocumentRef.current;
      const snap = editorSessionRef.current.snap;
      const excludedLayerIds = new Set<LayerId>(selectedLayerIdsRef.current);
      if (document?.activeLayerId) excludedLayerIds.add(document.activeLayerId);
      return {
        targets: document ? buildLayerSnapTargets(document, {
          excludedLayerIds,
          includeCanvas: snap.targets.documentBounds,
          includeLayers: snap.targets.layers,
          includeGuides: snap.targets.guides,
          includeGrid: snap.targets.grid && snap.gridVisible,
          gridSpacing: snap.gridSpacing / Math.max(1, snap.gridSubdivisions),
          gridOriginX: snap.gridOriginX,
          gridOriginY: snap.gridOriginY,
          movingBounds
        }) : [],
        zoom: activeScale,
        enabled: snap.enabled
      };
    },
    publishSnapFeedback: (matches, bounds) => setSelectionSnapFeedback({ matches, bounds }),
    onShapeCommitted: (parameters) => {
      commandService.recordObservedCommand(
        'selection.applyShape',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { mode: parameters.mode, shape: parameters.shape,
          featherRadius: parameters.featherRadius, antiAlias: parameters.antiAlias }
      );
    },
    onMagicWandCommitted: (parameters) => {
      commandService.recordObservedCommand(
        'selection.applyMagicWand',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId: parameters.layerId, mode: parameters.mode, point: parameters.point,
          options: parameters.options }
      );
    },
    onPaintCommitted: (parameters) => {
      commandService.recordObservedCommand(
        'tool.commitGesture',
        workspaceDocumentId as DocumentSessionId,
        {
          kind: 'selection-paint',
          parameters: {
            mode: parameters.mode,
            size: parameters.size,
            hardness: parameters.hardness,
            opacity: parameters.opacity,
            smooth: parameters.smooth
          },
          samples: parameters.samples.map(({ x, y, pressure }) => ({ x, y, pressure }))
        },
        { kind: 'selection-paint', sampleCount: parameters.samples.length }
      );
    }
  }, selectionGestureRef.current);
  const smartSelectionControllerRef = useRef<SmartSelectionToolController | null>(null);
  const smartSelectionBackendRef = useRef<ReturnType<typeof createSmartSelectionBackend> | null>(null);
  smartSelectionBackendRef.current ??= createSmartSelectionBackend(configuredSmartSelectionBackendProfile());
  const [smartSelectionBackendIdentity, setSmartSelectionBackendIdentity] =
    useState<SmartSelectionBackendIdentity>(smartSelectionBackendRef.current.identity);
  const [smartSelectionPreparation, setSmartSelectionPreparation] =
    useState<SmartSelectionPreparationState>({ phase: 'idle' });
  smartSelectionControllerRef.current ??= new SmartSelectionToolController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    isRendererReady: () => rendererLifecycle.getSnapshot().status === 'ready',
    getOptions: () => editorSessionRef.current.smartSelection,
    selection: selectionSessionController,
    setStatus: setGradeStatus,
    setDraft: setSelectionDraft,
    onBackendIdentityChange: setSmartSelectionBackendIdentity,
    onPreparationChange: setSmartSelectionPreparation,
    onSelectionCommitted: (parameters, result) => commandService.recordObservedCommand(
      'selection.selectSubject',
      workspaceDocumentId as DocumentSessionId,
      parameters,
      result
    ) ?? false
  }, smartSelectionBackendRef.current);
  const smartSelectionController = smartSelectionControllerRef.current;
  const smartSelectionDisposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // React development strict effects run setup -> cleanup -> setup without
    // recreating this ref-owned controller. Defer disposal by one task so the
    // second setup can retain the live worker; a real unmount still disposes it.
    if (smartSelectionDisposeTimerRef.current) {
      clearTimeout(smartSelectionDisposeTimerRef.current);
      smartSelectionDisposeTimerRef.current = null;
    }
    return () => {
      smartSelectionDisposeTimerRef.current = setTimeout(() => {
        smartSelectionController.dispose();
        smartSelectionDisposeTimerRef.current = null;
      }, 0);
    };
  }, [smartSelectionController]);
  useEffect(() => {
    smartSelectionController.invalidate();
    if (editorSession.activeTool !== 'select-object') return;
    setSmartSelectionPreparation({
      phase: 'preparing',
      message: 'Loading Object Selection model…'
    });
    if (rendererSnapshot.status !== 'ready'
      || !imageDocument
      || thumbnailDocumentReadyId !== imageDocument.id) return;
    void smartSelectionController.prepare();
    return () => smartSelectionController.clearPreview();
  }, [
    editorSession.activeTool,
    editorSession.smartSelection.sampleAllLayers,
    imageDocument?.activeLayerId,
    imageDocument?.id,
    imageDocument?.revision,
    rendererSnapshot.status,
    smartSelectionController,
    thumbnailDocumentReadyId
  ]);

  const resolveAdjustmentTargetLayerId = (
    document: ImageDocument,
    target: PropertiesInspectorTarget = propertiesTargetRef.current
  ): LayerId | null => {
    if (target.kind === 'document-processing') return null;
    if (target.kind === 'attached-processing') {
      return attachedAdjustmentOwnerId(
        target.layerId,
        target.adjustmentId
      );
    }
    const active = findDocumentLayer(document, document.activeLayerId);
    return active?.type === 'adjustment' || active?.type === 'raster'
      ? active.id
      : null;
  };
  const resolveAdjustmentTargetIdentity = (
    document: ImageDocument,
    target: PropertiesInspectorTarget = propertiesTargetRef.current
  ) => JSON.stringify(reconcilePropertiesTarget(document, target));
  const resolveCanonicalAdjustmentSnapshot = (
    document: ImageDocument,
    target: PropertiesInspectorTarget = propertiesTargetRef.current
  ) => resolveAdjustmentPresentation(
    document,
    documentAdjustmentsRef.current,
    target
  )?.adjustments ?? null;
  const adjustmentTransactionController = useAdjustmentTransactionController({
    getDocumentId: () => imageDocumentRef.current?.id ?? null,
    getDocument: () => imageDocumentRef.current,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
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
      adjustmentsRef.current = snapshot;
    },
    restoreStagedSnapshot: (snapshot) => {
      adjustmentsRef.current = cloneAdjustments(snapshot);
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
  const adjustmentInteractions = useMemo(
    () => createAdjustmentInteractionCoordinator(
      adjustmentTransactionController,
      () => interactionTransitions.request('commit-before-mutation'),
      () => {
        const document = imageDocumentRef.current;
        if (!document) return null;
        return JSON.stringify({
          documentId: document.id,
          targetLayerId: resolveAdjustmentTargetLayerId(document),
          targetIdentity: resolveAdjustmentTargetIdentity(document),
          rendererGeneration: rendererLifecycle.getSnapshot().generation
        });
      }
    ),
    [adjustmentTransactionController, interactionTransitions]
  );
  resetAdjustmentTransactionRef.current = adjustmentInteractions.reset;
  resetActiveAdjustmentTransactionRef.current = adjustmentTransactionController.reset;

  const beginAdjustmentTransaction = adjustmentInteractions.begin;
  const endAdjustmentTransaction = (handle?: AdjustmentInteractionHandle | void) => {
    if (handle) adjustmentInteractions.end(handle);
    else adjustmentInteractions.finish();
  };
  const cancelAdjustmentTransaction = (handle?: AdjustmentInteractionHandle | void) => {
    if (handle) adjustmentInteractions.cancel(handle);
    else adjustmentInteractions.reset();
  };
  const changeAdjustments = (
    recipe: Parameters<typeof adjustmentTransactionController.change>[0],
    domain?: Parameters<typeof adjustmentTransactionController.change>[1],
    interactionHandle?: AdjustmentInteractionHandle | void
  ) => interactionHandle
    ? adjustmentInteractions.change(interactionHandle, recipe, domain)
    : adjustmentInteractions.discreteChange(recipe, domain);
  const loadCubeAsset = async (file: File, purpose: 'photoshop-color-lookup' | 'grade-look') => {
    if (!/\.cube$/i.test(file.name)) throw new Error('Choose a 3D .cube LUT file.');
    if (file.size <= 0 || file.size > 32 * 1024 * 1024) {
      throw new Error('A .cube LUT must be between 1 byte and 32 MiB.');
    }
    endAdjustmentTransaction();
    const renderer = engineRef.current;
    const beforeDocument = imageDocumentRef.current;
    if (!renderer || !beforeDocument) throw new Error('Open a document before loading a LUT.');
    const canonicalAdjustments = resolveCanonicalAdjustmentSnapshot(beforeDocument);
    if (!canonicalAdjustments) throw new Error('Select a Grade owner before loading a LUT.');
    const beforeAdjustments = cloneAdjustments(canonicalAdjustments);
    const beforeDocumentAdjustments = cloneAdjustments(documentAdjustmentsRef.current);
    const beforeDocumentAdjustmentsIdentity = documentAdjustmentsRef.current;
    const targetLayerId = resolveAdjustmentTargetLayerId(beforeDocument);
    const targetIdentity = resolveAdjustmentTargetIdentity(beforeDocument);
    const rendererGeneration = rendererLifecycle.getSnapshot().generation;
    const bindingIsCurrent = () => imageDocumentRef.current === beforeDocument
      && engineRef.current === renderer
      && rendererLifecycle.getSnapshot().generation === rendererGeneration
      && resolveAdjustmentTargetIdentity(beforeDocument) === targetIdentity
      && (targetLayerId !== null
        || documentAdjustmentsRef.current === beforeDocumentAdjustmentsIdentity);
    const historyType = purpose === 'grade-look'
      ? 'adjustment.grade-look'
      : 'adjustment.color-lookup';
    const historyLabel = purpose === 'grade-look'
      ? 'Load Grade Look'
      : 'Load Color Lookup';
    const transaction = documentMutationController.begin(
      historyType,
      { label: historyLabel, type: historyType },
      undefined,
      'cancel'
    );
    if (!transaction) throw new Error('Another document operation is still completing.');

    const assetId = `lut-${crypto.randomUUID()}` as DocumentAssetId;
    try {
      const parsed = parseCubeLut(await file.text());
      if (!transaction.active
        || !bindingIsCurrent()) {
        throw new Error('The LUT target changed while the file was loading.');
      }
      const nextAdjustments = purpose === 'grade-look' ? {
        ...beforeAdjustments,
        gradeLook: {
          ...beforeAdjustments.gradeLook,
          assetId
        }
      } : {
        ...beforeAdjustments,
        photoshopAdjustment: {
          ...beforeAdjustments.photoshopAdjustment,
          kind: 'color-lookup' as const,
          colorLookupPreset: 'none' as const,
          colorLookupAssetId: assetId
        }
      };
      const withAsset: ImageDocument = {
        ...beforeDocument,
        assets: {
          ...beforeDocument.assets,
          colorLookups: [
            ...beforeDocument.assets.colorLookups,
            {
              id: assetId,
              name: parsed.title || file.name,
              size: parsed.size,
              domainMin: parsed.domainMin,
              domainMax: parsed.domainMax,
              byteLength: file.size,
              revision: 0
            }
          ]
        },
        revision: beforeDocument.revision + 1,
        modifiedAt: Date.now()
      };
      if (!transaction.stage(() => withAsset)) {
        throw new Error('The LUT operation lost its document ownership.');
      }
      await commitColorLookupAssetTransaction({
        transaction,
        runtime: renderer,
        source: file,
        assetId,
        beforeDocument,
        beforeDocumentAdjustments,
        nextEditorAdjustments: nextAdjustments,
        targetLayerId,
        history: { type: historyType, label: historyLabel },
        bindingIsCurrent,
        documentIsActive: (documentId) => imageDocumentRef.current?.id === documentId,
        applyCanonicalProjection: (projection) =>
          applyCanonicalAdjustmentProjection(projection, 'grade'),
        pushHistoryEntry
      });
      setGradeStatus(`Loaded ${parsed.title || file.name} · ${parsed.size}³ LUT`);
    } catch (error) {
      transaction.cancel();
      throw error;
    }
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

  const adjustmentCommands = useMemo(() => createAdjustmentCommands({
    endAdjustment: endAdjustmentTransaction,
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
    addPointColorSample,
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
    toggleGroupVisibility,
    resetGroup
  } = adjustmentCommands;
  const captureCurrentGrade = async (): Promise<LightTableGradeClipboardCapture> => {
    const document = imageDocumentRef.current;
    const renderer = engineRef.current;
    const canonical = document ? resolveCanonicalAdjustmentSnapshot(document) : null;
    const settings = cloneAdjustments(canonical ?? documentAdjustmentsRef.current);
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
  const applyGradeCapture = async (
    capture: LightTableGradeClipboardCapture
  ) => {
    let settings = cloneAdjustments(capture.settings);
    const document = imageDocumentRef.current;
    const renderer = engineRef.current;
    const copiedAssetId = settings.gradeLook.assetId;
    if (copiedAssetId && document) {
      if (document.assets.colorLookups.some((asset) => asset.id === copiedAssetId)) {
        // A same-document paste can reuse the already loaded immutable LUT.
        // Importing a fresh UUID here would create an orphan asset on every
        // paste and turn an otherwise identical Grade into a false change.
      } else if (capture.gradeLookAsset?.assetId === copiedAssetId) {
        if (!renderer) throw new Error('The document renderer is not ready to import this LUT.');
        endAdjustmentTransaction();
        const beforeDocument = document;
        const canonicalAdjustments = resolveCanonicalAdjustmentSnapshot(beforeDocument);
        if (!canonicalAdjustments) {
          throw new Error('Select a Grade owner before pasting a LUT-backed Grade.');
        }
        const beforeAdjustments = cloneAdjustments(canonicalAdjustments);
        const beforeDocumentAdjustments = cloneAdjustments(documentAdjustmentsRef.current);
        const beforeDocumentAdjustmentsIdentity = documentAdjustmentsRef.current;
        const targetLayerId = resolveAdjustmentTargetLayerId(beforeDocument);
        const targetIdentity = resolveAdjustmentTargetIdentity(beforeDocument);
        const rendererGeneration = rendererLifecycle.getSnapshot().generation;
        const bindingIsCurrent = () => imageDocumentRef.current === beforeDocument
          && engineRef.current === renderer
          && rendererLifecycle.getSnapshot().generation === rendererGeneration
          && resolveAdjustmentTargetIdentity(beforeDocument) === targetIdentity
          && (targetLayerId !== null
            || documentAdjustmentsRef.current === beforeDocumentAdjustmentsIdentity);
        const transaction = documentMutationController.begin(
          'adjustment.grade.paste',
          { label: `Load ${capture.name}`, type: 'adjustment.grade.paste' },
          undefined,
          'cancel'
        );
        if (!transaction) throw new Error('Another document operation is still completing.');
        const source = capture.gradeLookAsset.source;
        const assetId = `lut-${crypto.randomUUID()}` as DocumentAssetId;
        try {
          const parsed = parseCubeLut(await source.text());
          if (!transaction.active
            || !bindingIsCurrent()) {
            throw new Error('The Grade target changed while its LUT was loading.');
          }
          settings = { ...settings, gradeLook: { ...settings.gradeLook, assetId } };
          const nextAdjustments = pasteGradeSettings(beforeAdjustments, settings);
          const withAsset: ImageDocument = {
            ...beforeDocument,
            assets: {
              ...beforeDocument.assets,
              colorLookups: [...beforeDocument.assets.colorLookups, {
                id: assetId,
                name: parsed.title || capture.gradeLookAsset.name,
                size: parsed.size,
                domainMin: parsed.domainMin,
                domainMax: parsed.domainMax,
                byteLength: source.size,
                revision: 0
              }]
            },
            revision: beforeDocument.revision + 1,
            modifiedAt: Date.now()
          };
          if (!transaction.stage(() => withAsset)) {
            throw new Error('The Grade paste lost its document ownership.');
          }
          await commitColorLookupAssetTransaction({
            transaction,
            runtime: renderer,
            source,
            assetId,
            beforeDocument,
            beforeDocumentAdjustments,
            nextEditorAdjustments: nextAdjustments,
            targetLayerId,
            history: { type: 'adjustment.grade.paste', label: `Load ${capture.name}` },
            bindingIsCurrent,
            documentIsActive: (documentId) => imageDocumentRef.current?.id === documentId,
            applyCanonicalProjection: (projection) =>
              applyCanonicalAdjustmentProjection(projection, 'grade'),
            pushHistoryEntry
          });
          setGradeStatus(`Loaded ${capture.name}`);
          return {
            name: capture.name,
            changed: true,
            hasLookAsset: true,
            importedLookAsset: true
          };
        } catch (error) {
          transaction.cancel();
          throw error;
        }
      } else if (!document.assets.colorLookups.some((asset) => asset.id === copiedAssetId)) {
        // A persisted text-only clipboard cannot safely refer to another
        // document's missing binary LUT. Paste the remaining Grade honestly.
        settings = { ...settings, gradeLook: { ...settings.gradeLook, assetId: null } };
      }
    }
    const changed = adjustmentCommands.pasteGrade(capture.name, settings);
    return {
      name: capture.name,
      changed,
      hasLookAsset: Boolean(capture.gradeLookAsset),
      importedLookAsset: false
    };
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
      // PSD sources are converted into native LightTable assets. The source
      // file itself is not duplicated in the native document.
      preservedSourceAssetsRef.current = [];
      fontAssetsRef.current = [];
      setFontHydrationPending(nextDocument.assets.fonts.length > 0);
      setImageDocument(nextDocument);
      setThumbnailDocumentReadyId(nextDocument.id);
    },
    publishMetadata: (nextMetadata: LightTableImageMetadata) => {
      setMetadata(nextMetadata);
      documentSession?.updateLoadedSource((current) => ({
        ...current,
        metadata: nextMetadata
      }));
    },
    publishBinaryAssets: (fontAssets: readonly FontAssetBlob[], preservedSources: readonly PreservedSourceAssetBlob[]) => {
      fontAssetsRef.current = [...fontAssets];
      preservedSourceAssetsRef.current = [...preservedSources];
      documentSession?.updateLoadedSource((current) => ({
        ...current,
        fontAssets: [...fontAssets],
        preservedSources: [...preservedSources]
      }));
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
      documentSession?.updateLoadedSource((current) => ({
        ...current,
        name: nextName,
        blob: nextBlob,
        identity
      }));
    },
    resetDocumentInteraction: () => {
      resetLensBlurDepth();
      setFocusPickerActive(false);
      setPointColorPickerActive(false);
      selectionGestureRef.current.reset();
      resetPaintSessionRef.current();
      setSelectionDraft(null);
      resetTransformRef.current();
      setEditorSession((current) => ({ ...current, selection: [] }));
      setSelectionClipboardAvailable(false);
      editorDialogs.closeFeather();
      editorDialogs.closeSelectionMorphology();
      setLensBlurViewportModeState('result');
      clearEditorHistory();
      resetHistogram();
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
    },
    publishAdjustments: (nextAdjustments: BasicAdjustments) => {
      publishDocumentAdjustmentsState(nextAdjustments);
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
    resetHistogram,
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
    const startingGlobalGradeStrength = initialRecipe?.globalGradeStrength ?? 100;
    globalGradeStrengthRef.current = startingGlobalGradeStrength;
    setGlobalGradeStrengthState(startingGlobalGradeStrength);
    globalGradeStrengthGestureRef.current = null;
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
          startupTelemetryRef.current.begin(startupTimeline);
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
          resetPaintSessionRef.current();
          setSelectionDraft(null);
          setSelectionClipboardAvailable(false);
          editorDialogs.closeFeather();
          editorDialogs.closeSelectionMorphology();
          resetTransformRef.current();
        },
        resetLensBlur: () => {
          resetLensBlurDepth();
          setFocusPickerActive(false);
          setPointColorPickerActive(false);
          setLensBlurViewportModeState('result');
        },
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
          publishGroupVisibilityState(visibility);
        }
      }
    });
  }, [
    clearEditorHistory,
    documentSession,
    fileNameBase,
    initialRecipe,
    resetHistogram,
    resetLensBlurDepth,
    setEditorSession,
    setImageDocument,
    setView,
    startupTimeline
  ]);

  const beforeExistingDocumentRebind = useCallback(() => {
    const snapshot = documentSession?.getSnapshot();
    const existingDocument = snapshot?.document;
    if (!snapshot || !existingDocument) return;

    finishTextEditingRef.current();
    selectionGestureRef.current.reset();
    resetPaintSessionRef.current();
    resetTransformRef.current();
    setSelectionDraft(null);
    setSelectionClipboardAvailable(false);
    setError(null);
    setScopeError(null);
    setGradeStatus(null);

    const loaded = snapshot.loadedSource;
    setMetadata(loaded.metadata ?? {
      name: existingDocument.name,
      width: existingDocument.width,
      height: existingDocument.height,
      contentType: snapshot.source.mediaType
    });
    setSourceName(loaded.name);
    setSourceBlob(loaded.blob);
    setSourceIdentity(loaded.identity);
    fontAssetsRef.current = [...loaded.fontAssets];
    preservedSourceAssetsRef.current = [...loaded.preservedSources];

    const processing = snapshot.processing;
    // Restoring the active presentation is read-only with respect to the
    // document session. Do not route these values through publication helpers:
    // those helpers are reserved for authored edits and write canonical state.
    const restoredDocumentAdjustments = cloneAdjustments(processing.adjustments);
    documentAdjustmentsRef.current = restoredDocumentAdjustments;
    const restoredPresentation = resolveAdjustmentPresentation(
      existingDocument,
      restoredDocumentAdjustments,
      propertiesTargetRef.current
    );
    if (restoredPresentation) {
      adjustmentsRef.current = cloneAdjustments(restoredPresentation.adjustments);
      publishAdjustmentPresentation(
        restoredPresentation.adjustments,
        restoredPresentation.domain
      );
    }
    const restoredGroupVisibility = { ...processing.groupVisibility };
    groupVisibilityRef.current = restoredGroupVisibility;
    setGroupVisibility(restoredGroupVisibility);
    globalGradeStrengthRef.current = processing.globalGradeStrength;
    setGlobalGradeStrengthState(processing.globalGradeStrength);
    imageDocumentRef.current = existingDocument;
    setImageDocument(existingDocument);
    setThumbnailDocumentReadyId(existingDocument.id);
  }, [
    documentSession,
    publishAdjustmentPresentation,
    setImageDocument
  ]);

  const getDocumentOpenScopeOptions = useCallback(() => ({
    histogramVisible: scopeVisibilityRef.current.histogram,
    options: createScopeRendererOptions(
      scopeVisibilityRef.current,
      scopeSettingsRef.current
    )
  }), []);

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

  const existingDocumentForRebind = documentSession?.getSnapshot().document ?? null;
  const existingMetadataForRebind = documentSession?.getSnapshot().loadedSource.metadata ?? null;

  const afterDocumentClose = useCallback(() => {
    cancelAutoAlignRef.current();
    engineRef.current = null;
  }, []);

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
    getGroupVisibility: () => groupVisibilityRef.current,
    getPublicationPorts: getDocumentPublicationPorts,
    getScopeOptions: getDocumentOpenScopeOptions,
    publishHistogram,
    publishGpuMemory: setGpuMemoryBytes,
    publishTextRenderPresentation,
    publishCompositeRendered,
    publishInitialThumbnail: publishDocumentThumbnail,
    restoreSelectionState: restoreDocumentSelectionState,
    publishError: setError,
    publishOpenFailure: onDocumentOpenFailed,
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
    canReuseRenderer: () => {
      const replace = replaceRendererOnNextOpenRef.current;
      replaceRendererOnNextOpenRef.current = false;
      return !replace;
    }
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
    runAfterMountedDocumentAdmission(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'all'
      });
    });
  };
  const clearCurrentSelection = () => {
    runAfterMountedDocumentAdmission(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'clear'
      });
    });
  };
  const invertCurrentSelection = () => {
    runAfterMountedDocumentAdmission(() => {
      void executeRegisteredCommand('selection.modify', {
        kind: 'modify', operation: 'invert'
      });
    });
  };
  const selectSimilarColors = () => {
    runAfterMountedDocumentAdmission(() => {
      const document = imageDocumentRef.current;
      if (!document?.activeLayerId || !editorSessionRef.current.selection.length) return;
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
    runAfterMountedDocumentAdmission(() => {
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
    runAfterMountedDocumentAdmission(() => {
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
      preferredTools: preferredToolByShortcutRef.current,
      hasActiveLayer: Boolean(imageDocumentRef.current?.activeLayerId),
      hasSelection: editorSession.selection.length > 0,
      hasSelectionClipboard: selectionClipboardAvailable,
      transforming: transformActiveRef.current() || transformSession.ownsTemporaryMove(),
      editingBlocked: historySnapshot.busy
    }),
    commands: {
      openFile: () => { finishTextEditingRef.current(); void chooseLocalFile('automatic'); },
      saveFile: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleSave(); },
      quickExportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void quickExportPngRef.current(); },
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
        cancelParagraphCreation: () => cancelParagraphTextRef.current(),
        cancelPointCreation: () => cancelPointTextRef.current(),
        transform: { isActive: () => transformActiveRef.current(), cancel: () => cancelTransformRef.current() },
        autoAlign: { isActive: () => Boolean(autoAlignPreview), cancel: () => cancelAutoAlignRef.current() },
        warp: { isActive: () => warpSessionController.active, cancel: () => warpSessionController.reset() },
        selectionDraft: {
          isActive: () => Boolean(selectionSessionController.draft), cancel: () => selectionSessionController.reset()
        },
        cancelPenPath: () => cancelPenPathRef.current(),
        selection: { isActive: () => editorSession.selection.length > 0, cancel: clearCurrentSelection }
      })
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
    runAfterMountedDocumentAdmission(() => {
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
  const publishGlobalGradeStrength = React.useCallback((strength: number) => {
    const next = Math.min(100, Math.max(0, strength));
    globalGradeStrengthRef.current = next;
    setGlobalGradeStrengthState(next);
    documentSession?.updateProcessing((current) => ({
      ...current,
      globalGradeStrength: next
    }));
    engineRef.current?.setGlobalGradeStrength(next);
  }, [documentSession]);
  const beginGlobalGradeStrength = React.useCallback(() => {
    globalGradeStrengthGestureRef.current = globalGradeStrengthRef.current;
  }, []);
  const endGlobalGradeStrength = React.useCallback(() => {
    const before = globalGradeStrengthGestureRef.current;
    globalGradeStrengthGestureRef.current = null;
    const after = globalGradeStrengthRef.current;
    if (before === null || before === after) return;
    runEditorOperationTransaction({ operation: 'Global Grade Strength' }, (transaction) => {
      // The slider preview is already live. History acceptance transfers
      // ownership; before that, failure must restore the gesture origin.
      transaction.adopt(
        'published global grade strength',
        () => publishGlobalGradeStrength(before)
      );
      pushHistoryEntry({
        type: 'adjustment.global-grade-strength',
        label: 'Global Grade Strength',
        undo: () => publishGlobalGradeStrength(before),
        redo: () => publishGlobalGradeStrength(after)
      });
    });
  }, [publishGlobalGradeStrength, pushHistoryEntry]);
  const resetGlobalGrade = React.useCallback(() => {
    endAdjustmentTransaction();
    const documentId = imageDocumentRef.current?.id ?? null;
    if (!documentId) return;
    const beforeAdjustments = cloneAdjustments(documentAdjustmentsRef.current);
    const beforeStrength = globalGradeStrengthRef.current;
    const afterAdjustments = pasteGradeSettings(beforeAdjustments, createDefaultAdjustments());
    const apply = (adjustments: BasicAdjustments, strength: number) => {
      if (imageDocumentRef.current?.id !== documentId) return;
      applyAdjustmentSnapshot(cloneAdjustments(adjustments), null, 'grade');
      publishGlobalGradeStrength(strength);
    };
    if (JSON.stringify(beforeAdjustments) === JSON.stringify(afterAdjustments)
      && beforeStrength === 100) return;
    runEditorOperationTransaction({ operation: 'Reset Global Grade' }, (transaction) => {
      transaction.step(
        'publish global grade reset',
        () => apply(afterAdjustments, 100),
        () => apply(beforeAdjustments, beforeStrength)
      );
      pushHistoryEntry({
        type: 'adjustment.global-grade-reset',
        label: 'Reset Global Grade',
        undo: () => apply(beforeAdjustments, beforeStrength),
        redo: () => apply(afterAdjustments, 100)
      });
    });
  }, [
    applyAdjustmentSnapshot,
    endAdjustmentTransaction,
    publishGlobalGradeStrength,
    pushHistoryEntry
  ]);
  const resetGlobalLensFx = React.useCallback(() => {
    endAdjustmentTransaction();
    const documentId = imageDocumentRef.current?.id ?? null;
    if (!documentId) return;
    const beforeAdjustments = cloneAdjustments(documentAdjustmentsRef.current);
    const defaults = createDefaultAdjustments();
    const afterAdjustments: BasicAdjustments = {
      ...cloneAdjustments(beforeAdjustments),
      effects: cloneAdjustments(defaults).effects
    };
    if (JSON.stringify(beforeAdjustments) === JSON.stringify(afterAdjustments)) return;
    const apply = (adjustments: BasicAdjustments) => {
      if (imageDocumentRef.current?.id !== documentId) return;
      applyAdjustmentSnapshot(cloneAdjustments(adjustments), null, 'lens-fx');
      setFocusPickerActive(false);
      setLensBlurViewportModeState('result');
    };
    runEditorOperationTransaction({ operation: 'Reset Global Lens FX' }, (transaction) => {
      transaction.step(
        'publish global Lens FX reset',
        () => apply(afterAdjustments),
        () => apply(beforeAdjustments)
      );
      pushHistoryEntry({
        type: 'adjustment.global-lens-fx-reset',
        label: 'Reset Global Lens FX',
        undo: () => apply(beforeAdjustments),
        redo: () => apply(afterAdjustments)
      });
    });
  }, [applyAdjustmentSnapshot, endAdjustmentTransaction, pushHistoryEntry]);

  const globalGradeModified = useAdjustmentPresentationSelector(
    adjustmentPresentationStore,
    () => adjustmentStackOwnerHasAuthoredSettings(documentAdjustmentsRef.current, 'grade')
  ) || globalGradeStrength !== 100;
  const globalLensFxModified = useAdjustmentPresentationSelector(
    adjustmentPresentationStore,
    () => adjustmentStackOwnerHasAuthoredSettings(documentAdjustmentsRef.current, 'lens-fx')
  );

  useEffect(() => {
    if (rendererSnapshot.status === 'ready' || rendererSnapshot.status === 'suspended') {
      // A document switch reuses the presentation engine. Re-apply the active
      // document's processing state after its resource repository is bound;
      // otherwise the engine can briefly (or permanently, without another UI
      // edit) retain the adjustments from the previously active document.
      engineRef.current?.setAdjustments(documentAdjustmentsRef.current);
      engineRef.current?.setGlobalGradeStrength(globalGradeStrengthRef.current);
    }
  }, [rendererSnapshot.generation, rendererSnapshot.status]);
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

  const replaceLayerSelection = useCallback((layerId: LayerId) => {
    transformPickRevisionRef.current += 1;
    selectedLayerIdsRef.current = [layerId];
    setSelectedLayerIds([layerId]);
  }, []);

  const vectorToolSessionController = useVectorToolSessionController({
    document: imageDocument,
    rendererGeneration: rendererSnapshot.generation,
    selection: editorSession.vectorSelection,
    activeTool: editorSession.activeTool,
    foregroundColor: editorSession.brush.color,
    gradient: gradientToolSettings,
    shape: editorSession.shape,
    style: editorSession.vectorStyle,
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
    onLiveShapeCommitted: ({ layerId, element, existingLayerId, layerName }) => {
      replaceLayerSelection(layerId);
      const parameters = observedLiveShapeCreateCommand(element, existingLayerId, layerName);
      if (!parameters) return;
      commandService.recordObservedCommand(
        'vector.create',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId, elementId: element.id }
      );
    },
    onPenPathCommitted: ({ operation, layerId, layerName, path, existingLayerId }) => {
      if (operation === 'create') replaceLayerSelection(layerId);
      const parameters = operation === 'create'
        ? observedVectorPathCreateCommand(path, existingLayerId, layerName)
        : observedVectorPathUpdateCommand(path, layerId);
      commandService.recordObservedCommand(
        operation === 'create' ? 'vector.create' : 'vector.update',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId, elementId: path.id }
      );
    },
    onPathMutationCommitted: ({ layerId, pathId, path }) => {
      commandService.recordObservedCommand(
        path ? 'vector.update' : 'vector.remove',
        workspaceDocumentId as DocumentSessionId,
        path ? observedVectorPathUpdateCommand(path, layerId) : { layerId, elementId: pathId },
        { layerId, elementId: pathId }
      );
    },
    onGradientCommitted: ({ operation, layerId, layerName, layerRole, layerOpacity,
      layerBlendMode, element }) => {
      if (operation === 'create') replaceLayerSelection(layerId);
      const parameters = operation === 'create'
        ? observedLiveShapeCreateCommand(element, undefined, layerName, {
            role: layerRole,
            opacity: layerOpacity,
            blendMode: layerBlendMode
          })
        : observedLiveShapeUpdateCommand(element, layerId);
      if (!parameters) return;
      commandService.recordObservedCommand(
        operation === 'create' ? 'vector.create' : 'vector.update',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId, elementId: element.id }
      );
    }
  });
  finishPenPathRef.current = () => {
    vectorToolSessionController.finishPenPath();
    engineRef.current?.setPenEditingOverlay(vectorToolSessionController.penEditingOverlay());
  };
  cancelPenPathRef.current = () => {
    const changed = vectorToolSessionController.cancelPenPath();
    engineRef.current?.setPenEditingOverlay(vectorToolSessionController.penEditingOverlay());
    return changed;
  };
  undoPenAnchorRef.current = () => {
    const changed = vectorToolSessionController.undoPenAnchor();
    engineRef.current?.setPenEditingOverlay(vectorToolSessionController.penEditingOverlay());
    return changed;
  };
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
  const updateGradientSettings = (change: Partial<EditorSession['gradient']>) => {
    const paintChange = change.paint;
    setEditorSession((current) => ({
      ...current,
      gradient: { ...current.gradient, ...change }
    }));
    if (!paintChange
      || editorSession.activeTool !== 'gradient'
      || gradientToolSettings.application !== 'fill-layer') return;
    const reference = editorSession.vectorSelection.elements[0];
    const activeGradientLayer = reference && imageDocument?.activeLayerId === reference.layerId
      ? findDocumentLayer(imageDocument, reference.layerId)
      : null;
    if (activeGradientLayer?.type !== 'vector'
      || activeGradientLayer.role !== 'gradient-fill') return;
    vectorToolSessionController.editSelectedElementStyles((style) => {
      const fill = style.fill;
      if (!fill || !('kind' in fill)) return style;
      return {
        ...style,
        fill: {
          ...cloneGradientPaint(paintChange),
          coordinateSpace: fill.coordinateSpace,
          transform: { ...fill.transform }
        }
      };
    });
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
      const diagnostic = fontDiagnostics.find((entry) => (
        entry.layerId === layerId
        && entry.issue === 'font-missing'
        && entry.sourceIdentity
      )) ?? fontDiagnostics.find((entry) => (
        entry.layerId === layerId && entry.sourceIdentity
      ));
      if (!diagnostic?.sourceIdentity) return false;
      editorDialogs.requestMissingFontRecovery({
        layerId,
        sourceIdentity: diagnostic.sourceIdentity,
        requestedFont: diagnostic.requestedFont,
        layerName: diagnostic.layerName,
        metricsChanged: diagnostic.metricsChanged,
        offset,
        affinity
      });
      return false;
    }
    return textEditingController.begin(layerId, offset, affinity);
  };

  const missingFontReplacementActions = useMissingFontReplacementActions({
    documentId: workspaceDocumentId,
    getDocument: () => imageDocumentRef.current,
    registry: textFontRegistry,
    substitutionFamilies: DEFAULT_TEXT_SUBSTITUTION_FAMILIES,
    documentMutations: documentMutationController,
    closeRecovery: editorDialogs.closeMissingFontRecovery,
    requestRecovery: editorDialogs.requestMissingFontRecovery,
    beginEditing: (layerId, offset, affinity) => {
      void layerPanelController.select(layerId).then(() => {
        activatePersistentTool('text-point');
        textEditingController.begin(layerId, offset, affinity ?? 'downstream');
        showProperties({ kind: 'layer', layerId });
      });
    },
    setStatus: setGradeStatus,
    setError
  });
  const beginExistingFlowTextEditing = (
    point: { x: number; y: number },
    mode: 'point' | 'paragraph' | 'any' = 'any',
    pointerId?: number,
    clickCount = 1,
    extend = false
  ) => {
    const document = imageDocumentRef.current;
    if (!document) return false;
    const candidates = visibleTextLayersTopmostFirst(document.layers)
      .filter((node): node is TextLayer => node.type === 'text'
        && node.text.source.kind === 'flow'
        && (mode === 'any' || node.text.source.layout.mode === mode));
    const active = candidates.find(({ id }) => id === document.activeLayerId);
    const ordered = [
      ...(active ? [active] : []),
      ...candidates.filter(({ id }) => id !== active?.id)
    ];
    const radius = 8 / Math.max(activeScale, 1e-6);
    const activeTextTool = editorSession.activeTool;
    const activationRevision = ++existingTextActivationRevisionRef.current;
    const resolution = existingTextHitController.resolve(ordered, point, radius, ({
      layer, presentation: layout, hit
    }, pointerFinished) => {
      if (layer.text.source.kind !== 'flow') return;
      pointTextController.cancel();
      paragraphTextController.cancel();
      const beginEditing = (
        currentLayer: TextLayer,
        currentLayout: typeof layout,
        currentHit: typeof hit,
        allowPointerGesture: boolean
      ) => {
        if (currentLayer.text.source.kind !== 'flow') return;
        const previous = textEditingController.getSnapshot();
        const continuing = previous.status === 'editing' && previous.layerId === layer.id;
        const editingStarted = continuing
          ? true
          : requestExistingFlowTextEditing(layer.id, currentHit.offset, currentHit.affinity);
        if (!editingStarted || pointerId === undefined || !allowPointerGesture) return;
        const granularity: TextSelectionGranularity = clickCount >= 5 ? 'story'
          : clickCount === 4 ? 'paragraph'
            : clickCount === 3 ? 'line'
              : clickCount === 2 ? 'word'
                : 'character';
        const source = currentLayer.text.source;
        const clicked = textSelectionForGranularity(
          source.text,
          currentLayout.layout,
          currentHit.offset,
          granularity
        );
        const initial = extend && continuing
          ? { anchor: previous.selection.anchor, focus: currentHit.offset }
          : clicked;
        textEditingController.setSelection(initial, {
          transient: true,
          caretAffinity: currentHit.affinity
        });
        textSelectionGestureController.begin(
          pointerId,
          layer.id,
          extend && continuing
            ? { anchor: previous.selection.anchor, focus: previous.selection.anchor }
            : clicked,
          extend && continuing ? 'character' : granularity
        );
      };
      if (document.activeLayerId === layer.id) {
        beginEditing(layer, layout, hit, !pointerFinished);
        return;
      }
      // Layer selection owns an ordered document transition and may finish a
      // previous text session. Bind the continuation to the admitted tool,
      // document, renderer and source, then re-hit current exact geometry.
      const admittedRenderer = engineRef.current;
      const admittedRendererGeneration = rendererLifecycle.getSnapshot().generation;
      const admittedSourceKey = textLayerSourceKey(layer);
      void Promise.resolve(selectLayerRef.current(layer.id)).then(() => {
        const currentDocument = imageDocumentRef.current;
        const currentLayer = currentDocument ? findDocumentLayer(currentDocument, layer.id) : null;
        if (existingTextActivationRevisionRef.current !== activationRevision
          || currentDocument?.id !== document.id
          || currentDocument.activeLayerId !== layer.id
          || editorSessionRef.current.activeTool !== activeTextTool
          || engineRef.current !== admittedRenderer
          || rendererLifecycle.getSnapshot().generation !== admittedRendererGeneration
          || currentLayer?.type !== 'text'
          || currentLayer.text.source.kind !== 'flow'
          || textLayerSourceKey(currentLayer) !== admittedSourceKey) return;
        const currentLayout = admittedRenderer?.currentTextEditingLayout(layer.id) ?? null;
        const currentHit = currentLayout
          ? hitTestTextEditingLayout(currentLayout, point, radius) : null;
        if (currentLayout && currentHit) beginEditing(currentLayer, currentLayout, currentHit, false);
      }).catch(() => undefined);
    }, (intent) => {
      if (activeTextTool === 'text-path') {
        const current = imageDocumentRef.current;
        const creationPoint = intent?.current ?? point;
        const target = current ? resolvePathTextCreationTargetAtPoint(
          current, editorSessionRef.current.vectorSelection, creationPoint, radius
        ) : { kind: 'none' as const };
        if (target.kind === 'resolved') void beginPointTextCreation(creationPoint, target.target);
        else setError(target.kind === 'live-shape'
          ? 'Path text requires a native path. Convert the selected shape to a path first.'
          : target.kind === 'ambiguous-subpath'
            ? 'Select exactly one contour for Path Text.'
            : 'Click one native path before creating Path Text.');
        return;
      }
      if (!intent) {
        void beginPointTextCreation(point);
        return;
      }
      if (!beginParagraphTextCreation(
        intent.pointerId, intent.start, clickCount, extend, true
      )) return;
      if (intent.current.x !== intent.start.x || intent.current.y !== intent.start.y) {
        paragraphTextController.move(intent.pointerId, intent.current);
      }
      if (intent.finished) finishParagraphTextCreation(intent.pointerId, intent.current);
    }, pointerId);
    return resolution !== 'miss';
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
      commitPointTextRef.current(true);
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

  const commitPointTextCreation = (beginEditing = false) => {
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
    const command = pathTarget
      ? pathTextCreateCommand(
          request, pathTarget, editorSession.text, font, editorSession.brush.color
        )
      : pointTextCreateCommand(request, editorSession.text, font,
          editorSession.brush.color, editorSession.activeTool === 'text-vertical');
    const execution = executeRegisteredCommand('text.create', textCreateCommandParameters(command));
    void execution?.then((result) => {
      if (beginEditing && result.status === 'completed') {
        const layerId = (result.value as { layerId?: LayerId }).layerId;
        if (layerId) {
          textEditingController.begin(layerId); textEditingController.selectAll();
        }
      }
    });
    return Boolean(execution);
  };

  const cancelPointTextCreation = () => {
    pathTextCreationTargetRef.current = null;
    return pointTextController.cancel();
  };
  commitPointTextRef.current = commitPointTextCreation;
  cancelPointTextRef.current = cancelPointTextCreation;

  const beginParagraphTextCreation = (
    pointerId: number,
    origin: { x: number; y: number },
    clickCount = 1,
    extend = false,
    skipExistingText = false
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
    if (!skipExistingText
      && beginExistingFlowTextEditing(origin, 'any', pointerId, clickCount, extend)) return true;
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
    const execution = executeRegisteredCommand('text.create', textCreateCommandParameters(
      paragraphTextCreateCommand(request, editorSession.text, font, editorSession.brush.color,
        editorSession.activeTool === 'text-vertical')));
    void execution?.then((result) => {
      if (beginEditing && result.status === 'completed') {
        const layerId = (result.value as { layerId?: LayerId }).layerId;
        if (layerId) {
          textEditingController.begin(layerId); textEditingController.selectAll();
        }
      }
    });
    return Boolean(execution);
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

  const pickTransformAtPoint = (point: { x: number; y: number }, extend = false) => {
    if (historySnapshot.busy || !editorSession.transformAutoSelectLayer || !imageDocument) return;
    const renderer = engineRef.current;
    if (!renderer) return;
    const revision = ++transformPickRevisionRef.current;
    void pickCurrentTransformLayer({
      initialDocument: imageDocument,
      point,
      picker: renderer,
      isCurrent: () => revision === transformPickRevisionRef.current,
      getCurrentDocument: () => imageDocumentRef.current
    }).then(async (pick) => {
      if (!pick) return;
      // The hit was resolved against the current transform preview. Retire
      // that preview before deriving the next layer selection so both the
      // document and the picker agree about which revision is active.
      await commitTransformPendingRef.current();
      const currentDocument = imageDocumentRef.current;
      if (!currentDocument) return;
      const next = resolveTransformCanvasLayerSelection(
        selectedLayerIdsRef.current,
        currentDocument.activeLayerId,
        pick.layerId,
        extend
      );
      selectedLayerIdsRef.current = [...next.selectedLayerIds];
      setSelectedLayerIds([...next.selectedLayerIds]);
      await selectLayerRef.current(next.activeLayerId);
      setTransformActivationRevision((current) => current + 1);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The layer could not be selected.');
    });
  };

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
      void engineRef.current?.sampleDisplayColor(point).then((color) => {
        if (pointColorPickerActive) {
          const lab = linearRgbToOklab(srgbToLinear([
            color[0] / 255,
            color[1] / 255,
            color[2] / 255
          ]));
          addPointColorSample(
            `point-color-${globalThis.crypto.randomUUID()}`,
            lab[0],
            Math.hypot(lab[1], lab[2]),
            Math.atan2(lab[2], lab[1])
          );
          setPointColorPickerActive(false);
          return;
        }
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
    onPointTextCreate: (point, clickCount, extend) => {
      if (beginExistingFlowTextEditing(point, 'any', undefined, clickCount, extend)) return;
      textEditingController.finish();
      if (editorSession.activeTool === 'text-path') {
        const resolution = imageDocumentRef.current
          ? resolvePathTextCreationTargetAtPoint(
              imageDocumentRef.current,
              editorSession.vectorSelection,
              point,
              8 / Math.max(activeScale, 1e-6)
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
      beginPoint: (pointerId, point, temporaryMove, clickCount, extend) => (temporaryMove
        && textLayerMoveGestureController.begin(pointerId, point)) || pathTextHandleController.begin(
          pointerId, point, 8 / Math.max(activeScale, 1e-6)
        ) || beginExistingFlowTextEditing(point, 'any', pointerId, clickCount, extend),
      beginParagraph: (pointerId, point, temporaryMove, clickCount, extend) => (temporaryMove
        && textLayerMoveGestureController.begin(pointerId, point)) || pathTextHandleController.begin(
          pointerId, point, 8 / Math.max(activeScale, 1e-6)
        ) || beginParagraphTextCreation(pointerId, point, clickCount, extend),
      owns: (pointerId) => existingTextHitController.owns(pointerId)
        || textLayerMoveGestureController.owns(pointerId)
        || textSelectionGestureController.owns(pointerId)
        || pathTextHandleController.owns(pointerId)
        || paragraphFrameResizeController.owns(pointerId)
        || paragraphTextController.owns(pointerId),
      move: (pointerId, point) => existingTextHitController.owns(pointerId)
        ? existingTextHitController.move(pointerId, point)
        : textLayerMoveGestureController.owns(pointerId)
        ? textLayerMoveGestureController.move(pointerId, point)
        : textSelectionGestureController.owns(pointerId)
          ? textSelectionGestureController.move(pointerId, point)
        : pathTextHandleController.owns(pointerId)
          ? pathTextHandleController.move(pointerId, point)
          : paragraphFrameResizeController.owns(pointerId)
            ? paragraphFrameResizeController.move(pointerId, point)
            : paragraphTextController.move(pointerId, point),
      finish: (pointerId, point) => existingTextHitController.owns(pointerId)
        ? existingTextHitController.finish(pointerId, point)
        : textLayerMoveGestureController.owns(pointerId)
        ? textLayerMoveGestureController.finish(pointerId, point)
        : textSelectionGestureController.owns(pointerId)
          ? textSelectionGestureController.finish(pointerId, point)
        : pathTextHandleController.owns(pointerId)
          ? pathTextHandleController.finish(pointerId, point)
          : paragraphFrameResizeController.owns(pointerId)
            ? paragraphFrameResizeController.finish(pointerId, point)
            : finishParagraphTextCreation(pointerId, point),
      cancel: (pointerId) => existingTextHitController.cancelPointer(pointerId)
        || textLayerMoveGestureController.cancel(pointerId)
        || textSelectionGestureController.cancel(pointerId)
        || pathTextHandleController.cancel(pointerId)
        || paragraphFrameResizeController.cancel(pointerId)
        || (paragraphTextController.owns(pointerId) ? paragraphTextController.cancel() : false)
    },
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
    onPenRubberBandChange: (band) => {
      engineRef.current?.setPenRubberBandOverlay(band);
    },
    onPenEditingOverlayChange: (overlay) => {
      engineRef.current?.setPenEditingOverlay(overlay);
    }
  });
  const desktopHorizontalWheelRef = useRef(viewportInteraction.onHorizontalWheel);
  desktopHorizontalWheelRef.current = viewportInteraction.onHorizontalWheel;
  const wheelInputProbeCountRef = useRef(0);

  useEffect(() => {
    const onDesktopHorizontalWheel = (event: Event) => {
      if (!active) return;
      const detail = (event as CustomEvent<{
        readonly clientX?: number;
        readonly clientY?: number;
        readonly deltaX?: number;
      }>).detail;
      const viewport = viewportRef.current;
      if (!viewport || !detail
        || !Number.isFinite(detail.clientX) || !Number.isFinite(detail.clientY)
        || !Number.isFinite(detail.deltaX)) return;
      const bounds = viewport.getBoundingClientRect();
      if (detail.clientX! < bounds.left || detail.clientX! > bounds.right
        || detail.clientY! < bounds.top || detail.clientY! > bounds.bottom) return;
      if (wheelInputProbeCountRef.current < 20) {
        wheelInputProbeCountRef.current += 1;
        appendDebugMessage(
          'info',
          'Viewport input',
          'Electron horizontal wheel bridge received.',
          `sample=${wheelInputProbeCountRef.current} deltaX=${detail.deltaX} `
            + `client=(${detail.clientX},${detail.clientY})`
        );
      }
      desktopHorizontalWheelRef.current({ deltaX: detail.deltaX! });
    };
    window.addEventListener('lighttable:desktop-horizontal-wheel', onDesktopHorizontalWheel);
    return () => window.removeEventListener(
      'lighttable:desktop-horizontal-wheel',
      onDesktopHorizontalWheel
    );
  }, [active, appendDebugMessage]);

  useEffect(() => {
    if (!active || (toolPreferences?.zoomWithScrollWheel ?? true)) return undefined;
    const onRendererWheelCapture = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const wheelDelta = resolveWheelPanDeltas({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        legacyWheelDeltaX: (event as globalThis.WheelEvent & {
          readonly wheelDeltaX?: number;
        }).wheelDeltaX,
        shiftKey: event.shiftKey
      });
      if (wheelDelta.deltaX === 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const insideViewport = event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      if (insideViewport && wheelInputProbeCountRef.current < 20) {
        wheelInputProbeCountRef.current += 1;
        const legacyWheel = event as globalThis.WheelEvent & {
          readonly wheelDeltaX?: number;
          readonly wheelDeltaY?: number;
        };
        appendDebugMessage(
          'info',
          'Viewport input',
          'Renderer wheel event captured.',
          `sample=${wheelInputProbeCountRef.current} delta=(${event.deltaX},${event.deltaY}) `
            + `legacy=(${legacyWheel.wheelDeltaX ?? 0},${legacyWheel.wheelDeltaY ?? 0}) `
            + `resolved=(${wheelDelta.deltaX},${wheelDelta.deltaY}) mode=${event.deltaMode} `
            + `shift=${event.shiftKey} ctrl=${event.ctrlKey} meta=${event.metaKey} `
            + `trusted=${event.isTrusted} target=${event.target instanceof Element
              ? event.target.className : 'unknown'}`
        );
      }
      if (!insideViewport) return;
      event.preventDefault();
      desktopHorizontalWheelRef.current(wheelDelta);
    };
    window.addEventListener('wheel', onRendererWheelCapture, {
      capture: true,
      passive: false
    });
    return () => window.removeEventListener('wheel', onRendererWheelCapture, true);
  }, [active, appendDebugMessage, toolPreferences?.zoomWithScrollWheel]);

  const applyDocumentChange = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    textEditingController.finish();
    changeLayerDocument(change, recordHistory);
  };

  const layerDocumentCommands = useLayerDocumentCommands({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    getRendererGeneration: () => rendererLifecycle.getSnapshot().generation,
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
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    getPanelAdjustments: () => adjustmentsRef.current,
    publishDocumentAdjustments: (next) => {
      publishDocumentAdjustmentsState(next);
    },
    publishPanelAdjustments: (next) => {
      publishAdjustmentPresentation(cloneAdjustments(next));
    },
    getGlobalGradeStrength: () => globalGradeStrengthRef.current,
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
  const mergeLayersCommand = useCallback((layerIds: LayerId[]) => {
    return Boolean(executeRegisteredCommand('layer.merge', { layerIds }));
  }, [executeRegisteredCommand]);
  const mergeSelectionOrActiveDown = useCallback(async () => {
    await settleMountedDocumentInteraction();
    const selectedLayerIds = selectedLayerIdsRef.current;
    if (selectedLayerIds.length > 1) {
      if (import.meta.env.DEV) {
        setGradeStatus(`Merge requested for ${selectedLayerIds.length} selected layers`);
      }
      return mergeLayersCommand(selectedLayerIds);
    }
    const document = imageDocumentRef.current;
    // The Layers panel publishes its interaction selection synchronously,
    // while canonical active-layer preparation may cross an async renderer
    // boundary. Ctrl/Cmd+E must target the row the user just clicked, not the
    // previously active document layer during that short hand-off.
    const activeLayerId = selectedLayerIds[0] ?? document?.activeLayerId;
    if (!document || !activeLayerId) {
      setError('Select a layer with a lower sibling to merge.');
      return false;
    }
    const siblings = siblingLayers(document, activeLayerId);
    const index = siblings.findIndex(({ id }) => id === activeLayerId);
    if (index <= 0) {
      setError('The active layer has no layer below it to merge with.');
      return false;
    }
    return mergeLayersCommand([siblings[index - 1]!.id, activeLayerId]);
  }, [mergeLayersCommand]);
  const flattenGroupCommand = useCallback((groupId: LayerId) => {
    return Boolean(executeRegisteredCommand('layer.flattenGroup', { groupId }));
  }, [executeRegisteredCommand]);
  const flattenImageCommand = useCallback(() => {
    return Boolean(executeRegisteredCommand('document.flattenImage', {}));
  }, [executeRegisteredCommand]);
  const handleLayerSelectionChange = useCallback((layerIds: LayerId[]) => {
    // A layer-panel selection made after an asynchronous canvas hit supersedes
    // that hit and must never be overwritten when its GPU readback resolves.
    transformPickRevisionRef.current += 1;
    selectedLayerIdsRef.current = layerIds;
    setSelectedLayerIds(layerIds);
  }, []);

  const copyPixels = async (source: 'active-layer' | 'merged') => {
    await settleMountedDocumentInteraction();
    const execution = executeRegisteredCommand('selection.copyPixels', { source });
    if (execution) await execution;
  };
  const copySelectedContent = () => { void copyPixels('active-layer'); };
  copySelectedContentRef.current = copySelectedContent;

  const cutPixels = async () => {
    await settleMountedDocumentInteraction();
    const document = imageDocumentRef.current;
    const layerId = document?.activeLayerId;
    if (!document || !layerId || editorSessionRef.current.selection.length === 0) return null;
    const capture = await layerDocumentCommands.copySelectedContent(
      editorSessionRef.current.selection
    );
    if (!capture) return null;
    const cleared = fillCommandController.apply({
      layerId,
      channel: 'pixels',
      color: '#000000',
      preserveTransparency: false,
      opacity: 0
    }, { label: 'Cut', type: 'raster.cut' });
    if (!cleared) return null;
    setGradeStatus('Selected pixels cut to the system clipboard');
    return capture;
  };
  const cutSelectedContent = () => {
    void executeRegisteredCommand('selection.cutPixels', {});
  };
  cutSelectedContentRef.current = cutSelectedContent;

  const copyMergedContent = () => { void copyPixels('merged'); };
  copyMergedContentRef.current = copyMergedContent;

  const pasteSelectedContent = () => {
    const targetDocumentId = workspaceDocumentId;
    void (async () => {
      await settleMountedDocumentInteraction();
      if (workspaceDocumentIdRef.current !== targetDocumentId) return;
      // Always inspect the host clipboard. A prior LightTable copy must never
      // shadow a newer image copied from another application.
      const clipboardImage = await imageClipboard.readImage();
      if (workspaceDocumentIdRef.current !== targetDocumentId) return;
      if (!clipboardImage) {
        setError('The system clipboard does not contain an image.');
        return;
      }
      if (clipboardImage.blob.type === 'image/svg+xml'
        && editorSessionRef.current.activeChannel !== 'mask') {
        const svg = await clipboardImage.blob.text();
        if (workspaceDocumentIdRef.current !== targetDocumentId) return;
        await executeRegisteredCommand('vector.importSvg', {
          svg, placement: 'document', layerName: 'Pasted SVG'
        });
        return;
      }
      let file = new File(
        [clipboardImage.blob], 'Clipboard image.png',
        { type: clipboardImage.blob.type || 'image/png' }
      );
      const bitmap = await createImageBitmap(file);
      try {
        if (workspaceDocumentIdRef.current !== targetDocumentId) return;
        if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 32_768
          || bitmap.height > 32_768 || bitmap.width * bitmap.height > 268_435_456) {
          throw new Error('Clipboard image dimensions exceed the supported resource bounds.');
        }
        if (file.type === 'image/svg+xml') {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('The SVG clipboard image could not be rasterized for the mask.');
          context.drawImage(bitmap, 0, 0);
          let png: Blob;
          try {
            png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
              (value) => value ? resolve(value) : reject(new Error('The SVG clipboard image could not be encoded.')),
              'image/png'
            ));
          } finally {
            canvas.width = 1;
            canvas.height = 1;
          }
          if (workspaceDocumentIdRef.current !== targetDocumentId) return;
          file = new File([png], 'Clipboard image.png', { type: 'image/png' });
        }
        const artifact = clipboardImage.placement
          ? commandService.matchingPixelClipboardCopyArtifact(
              clipboardImage.placement.sourceDocumentId, clipboardImage.placement
            ) ?? commandService.registerPixelClipboardArtifact(file)
          : commandService.registerPixelClipboardArtifact(file);
        const copied = { artifactId: artifact.id, bounds: {
          x: clipboardImage.placement?.x ?? 0,
          y: clipboardImage.placement?.y ?? 0,
          width: bitmap.width,
          height: bitmap.height
        } };
        const currentDocument = imageDocumentRef.current;
        if (!currentDocument || workspaceDocumentIdRef.current !== targetDocumentId) return;
        const selection = editorSessionRef.current.selection;
        const targetBounds = selection.length
          ? selectionOperationsBounds([...selection], {
              x: 0, y: 0, width: currentDocument.width, height: currentDocument.height
            })
          : visibleDocumentBounds(currentDocument, viewportSize, imageRect);
        const bounds = centerClipboardBounds({
          width: copied.bounds.width,
          height: copied.bounds.height
        }, targetBounds);
        const target = editorSessionRef.current.activeChannel === 'mask'
          ? { channel: 'mask' as const, layerId: currentDocument.activeLayerId ?? undefined }
          : { channel: 'pixels' as const };
        if (workspaceDocumentIdRef.current !== targetDocumentId) return;
        await executeRegisteredCommand('selection.pastePixels', {
          artifactId: copied.artifactId,
          name: 'Pasted Selection',
          bounds,
          target
        });
      } finally {
        bitmap.close();
      }
    })().catch((reason) => {
      if (workspaceDocumentIdRef.current === targetDocumentId) {
        setError(reason instanceof Error ? reason.message : 'The clipboard image could not be pasted.');
      }
    });
  };
  pasteSelectedContentRef.current = pasteSelectedContent;

  const layerViaCopy = () => {
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (layerId) void executeRegisteredCommand('layer.copyToNewLayer', { layerId });
  };
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
  const openLayerStyleEditor = useCallback((layerId: LayerId, effectId?: LayerStyleId) => {
    layerStyleEditor.open(layerId, effectId);
    setPropertiesTarget(effectId
      ? { kind: 'style', layerId, effectId }
      : { kind: 'style-stack', layerId });
    // Activating after React publishes the contextual request prevents the
    // persistent Dockview renderer from restoring the previously active tab
    // during the same event batch.
    requestAnimationFrame(() => {
      workspaceRef.current?.showPanel(LIGHTTABLE_WORKSPACE_PANEL_IDS.properties);
    });
  }, [layerStyleEditor.open]);
  const addLayerEffectFromMenu = useCallback((effectKind: LayerStyleKind) => {
    const document = imageDocumentRef.current;
    const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
    if (!document || !layer || layer.type === 'adjustment' || layer.locks.all) return;

    const execution = executeRegisteredCommand('layer.effect.add', {
      layerId: layer.id,
      effectKind
    });
    if (!execution) {
      setError('Layer effect commands are unavailable in this document.');
      return;
    }
    void execution.then((response) => {
      if (response.status !== 'completed') return;
      const result = response.value as { layerId?: string; effectId?: string };
      if (result.layerId && result.effectId) {
        openLayerStyleEditor(result.layerId as LayerId, result.effectId as LayerStyleId);
      }
    });
  }, [documentMutationController, executeRegisteredCommand, openLayerStyleEditor]);
  const layerMaskCommandBridge = useMemo(() => createLayerMaskCommandBridge(() => ({
    getDocument: () => imageDocumentRef.current,
    hasSelection: () => editorSessionRef.current.selection.length > 0,
    execute: (parameters) => executeRegisteredCommand('layer.setMask', parameters),
    setPaintTarget: (activeChannel, brushColor) => setEditorSession((current) => ({
      ...current,
      activeChannel,
      brush: brushColor ? { ...current.brush, color: brushColor } : current.brush
    })),
    setError
  })), [executeRegisteredCommand]);
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
      await settleMountedDocumentInteraction();
      await selectionSessionController.selectLayerTransparency(layerId);
    },
    mergeActiveLayerDown: mergeSelectionOrActiveDown,
    mergeSelectedLayers: mergeLayersCommand,
    flattenGroup: flattenGroupCommand,
    flattenImage: flattenImageCommand,
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
    prepareActiveLayerChange: async (layerId) => {
      // Finish the active document transaction before changing its target.
      // The transform tool owns only a disposable preview; committing after
      // setActiveLayer() would make that preview race a newer document revision.
      if (transformActiveRef.current()) await commitTransformPendingRef.current();
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
    void executeRegisteredCommand('adjustment.create', command).then((result) => {
      if (result.status !== 'completed') return;
      const layerId = imageDocumentRef.current?.activeLayerId;
      if (command.placement === 'local') {
        showProperties({ kind: 'processing', layerId: command.layerId, owner: 'curves' });
      } else if (layerId) {
        showProperties({ kind: 'layer', layerId });
      }
    });
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
    requestAnimationFrame(() => showProperties({ kind: 'layer', layerId }));
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
    const session = editorSessionRef.current;
    const vectorSelection = session.vectorSelection;
    const target = resolveDeleteTarget({
      activeTool: session.activeTool,
      hasVectorSelection: vectorSelection.elements.length > 0
        || vectorSelection.paths.length > 0
        || vectorSelection.anchors.length > 0,
      hasPixelSelection: session.selection.length > 0,
      hasActiveLayer: Boolean(document?.activeLayerId)
    });
    if (!target) return;

    if (target === 'vector-selection') {
      vectorToolSessionController.deleteSelection();
      return;
    }
    if (target === 'pixel-selection') {
      runAfterMountedDocumentAdmission(() => {
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
    const waitForStableLayerCommandFrame = async () => {
      const admittedDocument = imageDocumentRef.current;
      const admittedRenderer = engineRef.current;
      if (!admittedDocument || !admittedRenderer) {
        throw new Error('The active document renderer is unavailable.');
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const currentDocument = imageDocumentRef.current;
      if (!currentDocument
        || currentDocument.id !== admittedDocument.id
        || currentDocument.revision !== admittedDocument.revision
        || engineRef.current !== admittedRenderer) {
        throw new Error('The document changed before layer finalization could begin.');
      }
    };
    return commandPorts.register(workspaceDocumentId as DocumentSessionId, {
      settleInteractionBeforeCommand: async (command) => {
        // Zoom does not change canonical content and may remain available
        // during a transform. All semantic document commands first publish
        // presentation-owned selection/transform state through its owner.
        if (command === 'view.setZoom') return;
        const admission = await interactionTransitions.request('commit-before-mutation');
        if (admission.status === 'rejected') throw new Error(admission.reason);
      },
      supportsCommand: isMountedDocumentCommand,
      resizeImage: (request) => commitImageSize(request, false),
      applyDocumentGeometry: (request) => commitDocumentGeometry(request, false),
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
      cutPixels,
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
      executeSvgImport: (command) => executeSvgImport(command, {
        getDocument: () => imageDocumentRef.current,
        applyDocument: applyDocumentSnapshot,
        recordHistory: pushDocumentHistory
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
      executeLayerCommand: async (command) => {
        if (command.kind === 'duplicate') {
          const layerId = layerDocumentCommands.duplicateLayer(command.layerId);
          return layerId ? { sourceLayerId: command.layerId, layerId } : null;
        }
        if (command.kind === 'copy-to-new-layer') {
          await settleMountedDocumentInteraction();
          const result = layerDocumentCommands.layerViaCopy(command.layerId);
          return result ? { sourceLayerId: command.layerId, ...result } : null;
        }
        if (command.kind === 'delete') {
          layerPanelController.deleteSelection([...command.layerIds]);
          return { layerIds: command.layerIds };
        }
        if (command.kind === 'move') {
          layerPanelController.move(command.layerId, command.direction);
          return { layerId: command.layerId, direction: command.direction };
        }
        if (command.kind === 'set-opacity') {
          layerPanelController.setOpacity(command.layerId, command.opacity);
          return { layerId: command.layerId, opacity: command.opacity };
        }
        if (command.kind === 'set-vector-anti-alias') {
          layerPanelController.setVectorAntiAlias(command.layerId, command.antiAlias);
          return { layerId: command.layerId, antiAlias: command.antiAlias };
        }
        if (command.kind === 'set-blend-mode') {
          layerPanelController.setBlendMode(command.layerId, command.blendMode);
          return { layerId: command.layerId, blendMode: command.blendMode };
        }
        if (command.kind === 'set-clipping') {
          layerPanelController.setClipping(command.layerId, command.clipping);
          return { layerId: command.layerId, clipping: command.clipping };
        }
        if (command.kind === 'set-transform') {
          const changed = documentMutationController.change(
            (document) => setLayerTransform(document, command.layerId, command.transform),
            true,
            { label: 'Free Transform', type: 'layer.transform', layerIds: [command.layerId] }
          );
          if (!changed) return null;
          return { layerId: command.layerId, transform: command.transform };
        }
        if (command.kind === 'set-mask') {
          return executeSemanticMaskCommand(command, {
            commands: layerDocumentCommands,
            settlePixelInteraction: settleMountedDocumentInteraction,
            waitForPresentation: waitForStableLayerCommandFrame,
            loadMaskAsSelection: selectionSessionController.selectLayerMask,
            changeDocument: documentMutationController.change
          });
        }
        if (command.kind === 'reorder') {
          layerPanelController.reorder(
            [...command.layerIds], command.targetLayerId, command.placement
          );
          return command;
        }
        if (command.kind === 'create-gradient-fill') {
          const previousLayerId = imageDocumentRef.current?.activeLayerId;
          layerPanelController.createGradientFillLayer();
          const layerId = imageDocumentRef.current?.activeLayerId;
          return layerId && layerId !== previousLayerId ? { layerId } : null;
        }
        if (command.kind === 'create-group') {
          const previousLayerId = imageDocumentRef.current?.activeLayerId;
          layerPanelController.createGroup();
          const layerId = imageDocumentRef.current?.activeLayerId;
          return layerId && layerId !== previousLayerId ? { layerId } : null;
        }
        if (command.kind === 'group') {
          const beforeLayerId = imageDocumentRef.current?.activeLayerId;
          layerPanelController.groupSelection([...command.layerIds]);
          const groupId = imageDocumentRef.current?.activeLayerId;
          return groupId && groupId !== beforeLayerId
            ? { layerIds: command.layerIds, groupId }
            : null;
        }
        if (command.kind === 'ungroup') {
          layerPanelController.ungroupSelection([...command.layerIds]);
          return { layerIds: command.layerIds };
        }
        layerPanelController.setLock([...command.layerIds], command.lock, command.locked);
        return { layerIds: command.layerIds, lock: command.lock, locked: command.locked };
      },
      executeSelectionCommand: async (command) => {
        await settleMountedDocumentInteraction();
        if (command.kind === 'modify') {
          if (command.operation === 'load-transparency') {
            const applied = await selectionSessionController.selectLayerTransparency(command.layerId);
            return applied ? { operation: command.operation, layerId: command.layerId } : null;
          }
          if (command.operation === 'similar') {
            const applied = await selectionSessionController.selectSimilar(command.layerId, {
              tolerance: command.tolerance,
              antiAlias: command.antiAlias,
              sampleAllLayers: command.sampleAllLayers
            });
            return applied ? {
              operation: command.operation,
              layerId: command.layerId,
              tolerance: command.tolerance,
              antiAlias: command.antiAlias,
              sampleAllLayers: command.sampleAllLayers
            } : null;
          }
          const applied = command.operation === 'feather'
            ? await selectionSessionController.feather(
                command.radius!,
                command.applyAtCanvasBounds === true
              )
            : command.operation === 'border'
              ? await selectionSessionController.border(command.width!)
              : command.operation === 'smooth'
                ? await selectionSessionController.smooth(
                    command.radius!,
                    command.applyAtCanvasBounds === true
                  )
            : command.operation === 'expand' || command.operation === 'contract'
              ? await selectionSessionController.morphology(
                  command.operation,
                  command.radius!,
                  command.applyAtCanvasBounds === true
                )
              : await selectionSessionController.applyState(command.operation);
          return applied ? { operation: command.operation,
            ...(command.operation === 'feather' || command.operation === 'smooth'
              || command.operation === 'expand' || command.operation === 'contract'
              ? { radius: command.radius } : {}),
            ...(command.operation === 'border' ? { width: command.width } : {}),
            ...(command.operation === 'feather' || command.operation === 'smooth'
              || command.operation === 'expand' || command.operation === 'contract'
              ? { applyAtCanvasBounds: command.applyAtCanvasBounds === true } : {}) } : null;
        }
        if (command.kind === 'magic-wand') {
          const applied = await selectionSessionController.applyMagicWand(
            command.layerId,
            command.point,
            command.mode,
            command.options
          );
          return applied ? {
            layerId: command.layerId,
            point: command.point,
            mode: command.mode,
            options: command.options
          } : null;
        }
        const applied = await selectionSessionController.applyShape(
          command.shape,
          command.mode,
          command.featherRadius,
          command.antiAlias
        );
        return applied ? {
          mode: command.mode,
          shape: command.shape,
          featherRadius: command.featherRadius,
          antiAlias: command.antiAlias
        } : null;
      },
      executeSubjectSelection: (command, signal, report) => (
        smartSelectionController.executeSubjectSelection(command, signal, report)
      ),
      executeBasicAdjustmentCommand: (command) => {
        adjustmentInteractions.finish();
        const document = imageDocumentRef.current;
        if (!document) return null;
        const currentPropertiesTarget = propertiesTargetRef.current;
        const presented = command.target.kind === 'document'
          ? currentPropertiesTarget.kind === 'document-processing'
            && currentPropertiesTarget.owner === 'grade'
          : 'layerId' in currentPropertiesTarget
            && currentPropertiesTarget.layerId === command.target.layerId
            && propertiesInspectorView(document, currentPropertiesTarget) === 'grade';
        return executeSemanticGradePatch({
          document, documentAdjustments: documentAdjustmentsRef.current,
          target: command.target, values: command.values,
          historyType: 'adjustment.basic', historyLabel: 'Set Basic Grade',
          mutate: (snapshot, values) => Object.assign(snapshot, values),
          changeDocument: documentMutationController.change,
          publishDocumentProcessing: (snapshot) => documentProjectionController
            .applyAdjustmentSnapshot(snapshot, null, 'grade', presented),
          pushProcessingHistoryEntry: pushHistoryEntry
        });
      },
      executeDetailAdjustmentCommand: (command) => {
        adjustmentInteractions.finish();
        const document = imageDocumentRef.current;
        if (!document) return null;
        const currentPropertiesTarget = propertiesTargetRef.current;
        const presented = command.target.kind === 'document'
          ? currentPropertiesTarget.kind === 'document-processing'
            && currentPropertiesTarget.owner === 'grade'
          : 'layerId' in currentPropertiesTarget
            && currentPropertiesTarget.layerId === command.target.layerId
            && propertiesInspectorView(document, currentPropertiesTarget) === 'grade';
        return executeSemanticGradePatch({
          document, documentAdjustments: documentAdjustmentsRef.current,
          target: command.target, values: command.values,
          historyType: 'adjustment.detail', historyLabel: 'Set Detail',
          mutate: (snapshot, values) => Object.assign(snapshot.detail, values),
          changeDocument: documentMutationController.change,
          publishDocumentProcessing: (snapshot) => documentProjectionController
            .applyAdjustmentSnapshot(snapshot, null, 'grade', presented),
          pushProcessingHistoryEntry: pushHistoryEntry
        });
      },
      executeFixedTransform: (command) => applyFixedTransformRef.current(command.operation),
      executeAdjustmentCreation: (command) => executeAdjustmentCreationRef.current(command),
      executeAdjustmentSnapshot: (command) => {
        adjustmentInteractions.finish();
        const document = imageDocumentRef.current;
        if (!document) return null;
        const currentTarget = propertiesTargetRef.current;
        const presented = adjustmentTargetIsPresented(command.target, currentTarget);
        return executeSemanticAdjustmentSnapshot({
          document,
          documentAdjustments: documentAdjustmentsRef.current,
          target: command.target,
          snapshot: command.snapshot,
          changeDocument: documentMutationController.change,
          publishDocumentProcessing: (snapshot, domain) => documentProjectionController
            .applyAdjustmentSnapshot(snapshot, null, domain, presented),
          pushProcessingHistoryEntry: pushHistoryEntry
        });
      },
      executeProcessingStructure: (command) => {
        adjustmentInteractions.finish();
        commitLayerDocumentTransaction();
        return executeSemanticProcessingStructure(command, {
          changeDocument: documentMutationController.change
        });
      },
      executeRasterInvert: async (command) => {
        await settleMountedDocumentInteraction();
        return layerDocumentCommands.invertLayerColors(
          command.layerId, command.channel
        ) ? command : null;
      },
      executeLayerRasterize: async (command) => {
        await waitForStableLayerCommandFrame();
        if (!await layerDocumentCommands.rasterizeLayerWhenReady(command.layerId)) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId
          ? { sourceLayerId: command.layerId, outputLayerId, outputType: 'raster' as const }
          : null;
      },
      executeTextToShape: async (command) => (
        await textToShapeController.convert(command.layerId)
          ? { layerId: command.layerId, outputType: 'vector' as const }
          : null
      ),
      executeTextRasterize: async (command) => {
        // Document publication updates the command snapshot synchronously, but
        // the text coordinator observes a newly created layer on the next
        // editor frame. Rasterization must wait for that host boundary before
        // asking the coordinator for its final outline source.
        await waitForStableLayerCommandFrame();
        return await layerDocumentCommands.rasterizeTextLayerWhenReady(command.layerId)
          ? { layerId: imageDocumentRef.current?.activeLayerId, outputType: 'raster' as const }
          : null;
      },
      executeLayerMerge: async (command) => {
        await settleMountedDocumentInteraction();
        await waitForStableLayerCommandFrame();
        if (!await layerDocumentCommands.mergeLayersWhenReady([...command.layerIds])) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId ? { layerIds: command.layerIds, outputLayerId } : null;
      },
      executeFlattenGroup: async (command) => {
        await settleMountedDocumentInteraction();
        await waitForStableLayerCommandFrame();
        if (!await layerDocumentCommands.flattenWhenReady({
          kind: 'group', groupId: command.groupId
        })) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId ? { groupId: command.groupId, outputLayerId } : null;
      },
      executeFlattenImage: async () => {
        await settleMountedDocumentInteraction();
        await waitForStableLayerCommandFrame();
        if (!await layerDocumentCommands.flattenWhenReady({ kind: 'image' })) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId ? { outputLayerId } : null;
      },
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
      queryBasicAdjustments: (target) => {
        const document = imageDocumentRef.current;
        if (!document) return null;
        const resolved = resolveBasicAdjustmentTarget(
          document,
          documentAdjustmentsRef.current,
          target,
          { allowLocked: true }
        );
        if ('message' in resolved) throw new Error(resolved.message);
        const layer = resolved.targetLayerId
          ? findDocumentLayer(document, resolved.targetLayerId)
          : null;
        return {
          target,
          documentRevision: document.revision,
          targetRevision: layer?.revision ?? document.revision,
          values: projectBasicAdjustmentValues(resolved.adjustments)
        };
      },
      queryAdjustments: (target) => {
        const document = imageDocumentRef.current;
        if (!document) return null;
        return projectAdjustmentQuery(workspaceDocumentId, document,
          documentAdjustmentsRef.current, document.revision, target);
      },
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
      beginGesture: (kind, pointerId, parameters, sample) => beginAutomationGestureRef.current(kind, pointerId, parameters, sample),
      updateGesture: (kind, pointerId, sample) => updateAutomationGestureRef.current(kind, pointerId, sample),
      finishGesture: (kind, pointerId, commit) => finishAutomationGestureRef.current(kind, pointerId, commit),
      undo: applyUndoEditor,
      redo: applyRedoEditor,
      queryRenderTelemetry: () => {
        const snapshot = engineRef.current?.renderTelemetrySnapshot();
        return snapshot ? {
          ...snapshot,
          presentedDocumentRevision: imageDocumentRef.current?.revision ?? null
        } : null;
      },
      resetRenderTelemetry: () => engineRef.current?.resetRenderTelemetry(),
      forceDeviceLossForAutomation: () => engineRef.current?.forceDeviceLossForAutomation() ?? false
    });
  }, [applyActualZoom, applyExactZoom, applyFitZoom, applyRedoEditor, applyUndoEditor,
    commandPorts, documentSession, imageDocument?.id, layerDocumentCommands,
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

  const reconciledPropertiesTarget = reconcilePropertiesTarget(imageDocument, propertiesTarget);
  const gradeContextLayer = imageDocument && 'layerId' in reconciledPropertiesTarget
    ? findDocumentLayer(imageDocument, reconciledPropertiesTarget.layerId)
    : null;
  const gradeOwnerStack = reconciledPropertiesTarget.kind === 'attached-processing'
    && gradeContextLayer?.type === 'raster'
    ? (gradeContextLayer.attachedAdjustments ?? []).find(
        ({ id }) => id === reconciledPropertiesTarget.adjustmentId
      )?.adjustmentStack ?? null
    : gradeContextLayer?.type === 'adjustment' || gradeContextLayer?.type === 'raster'
      ? gradeContextLayer.adjustmentStack
      : null;
  const gradeOwnerId = reconciledPropertiesTarget.kind === 'attached-processing'
    ? attachedAdjustmentOwnerId(
        reconciledPropertiesTarget.layerId,
        reconciledPropertiesTarget.adjustmentId
      )
    : 'layerId' in reconciledPropertiesTarget
      ? reconciledPropertiesTarget.layerId
      : null;
  const gradeUsesDocumentVisibility = reconciledPropertiesTarget.kind === 'document-processing'
    && reconciledPropertiesTarget.owner === 'grade';
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
  const gradeSectionVisibility = gradeUsesDocumentVisibility
    ? groupVisibility
    : {
        ...groupVisibility,
        light: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'light'),
        color: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'color'),
        colorMixer: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'colorMixer'),
        colorGrading: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'colorGrading'),
        blackWhiteMix: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'blackWhiteMix'),
        look: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'look'),
        curves: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'curves'),
        effects: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'effects'),
        detail: adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, 'detail')
      };
  const gradeMasterEnabled = reconciledPropertiesTarget.kind === 'document-processing'
    && reconciledPropertiesTarget.owner === 'grade'
    ? groupVisibility.globalGrade
    : gradeContextLayer?.type === 'adjustment'
      ? gradeContextLayer.visible
      : gradeContextLayer?.type === 'raster'
        && gradeContextLayer.adjustmentStack
        && adjustmentStackHasLocalProcessing(gradeContextLayer.adjustmentStack, 'grade')
        ? adjustmentStackLocalProcessingIsEnabled(gradeContextLayer.adjustmentStack, 'grade')
        : true;
  const toggleGradeMasterEnabled = () => {
    if (reconciledPropertiesTarget.kind === 'document-processing'
      && reconciledPropertiesTarget.owner === 'grade') {
      documentProjectionController.applyGroupVisibilitySnapshot({
        ...groupVisibilityRef.current,
        globalGrade: !groupVisibilityRef.current.globalGrade
      });
      return;
    }
    if (!gradeContextLayer) return;
    if (gradeContextLayer.type === 'adjustment') {
      commandLayerPanelController.setVisibility([gradeContextLayer.id], !gradeContextLayer.visible);
      return;
    }
    if (gradeContextLayer.type === 'raster') {
      commandLayerPanelController.setLocalGradeEnabled(gradeContextLayer.id, !gradeMasterEnabled);
    }
  };
  const toggleGradeSectionVisibility = (group: keyof GroupVisibility) => {
    if (group === 'globalGrade' || group === 'globalLensFx' || gradeUsesDocumentVisibility) {
      toggleGroupVisibility(group);
      return;
    }
    if (!gradeOwnerId) return;
    const gradeGroup = group as GradeModuleGroup;
    commandLayerPanelController.setGradeGroupEnabled(
      gradeOwnerId,
      gradeGroup,
      !adjustmentStackGradeGroupIsEnabled(gradeOwnerStack, gradeGroup)
    );
  };

  const effectiveDocumentGuides = guideDraft ?? imageDocument?.guides ?? [];
  useEffect(() => {
    setGuideDraft(null);
  }, [imageDocument?.id]);
  const commitDocumentGuides = useCallback((guides: readonly DocumentGuide[]) => {
    documentMutationController.change(
      (document) => replaceDocumentGuides(document, guides),
      true,
      { label: 'Edit Guides', type: 'document.guides' }
    );
  }, [documentMutationController]);
  const clearGuides = useCallback(() => {
    documentMutationController.change(
      clearDocumentGuides,
      true,
      { label: 'Clear Guides', type: 'document.guides' }
    );
  }, [documentMutationController]);

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
    applyDocumentAndSelection: async (document, selection, selectionMaskSnapshot, binding) => {
      const rendererDocumentBindingIsCurrent = () => engineRef.current === binding.renderer
        && rendererLifecycle.getSnapshot().generation === binding.rendererGeneration
        && imageDocumentRef.current === binding.expectedDocument;
      const bindingIsCurrent = () => {
        if (!rendererDocumentBindingIsCurrent() || !documentSession) return false;
        const lease = new DocumentSelectionStateStore(documentSession).acquire(
          documentSession.getSnapshot().documentRevision
        );
        return lease.document.sessionId === binding.expectedSelectionLease.document.sessionId
          && lease.document.revision === binding.expectedSelectionLease.document.revision
          && lease.selection.revision === binding.expectedSelectionLease.selection.revision
          && lease.selection.coverage === binding.expectedSelectionLease.selection.coverage;
      };
      await publishBoundSelection({
        renderer: binding.renderer,
        bindingIsCurrent,
        publish: () => {
          publishTransformDocumentSelection(
          document,
          selection,
          selectionMaskSnapshot,
          binding.expectedSelectionLease,
          rendererDocumentBindingIsCurrent,
          () => engineRef.current === binding.renderer
            && rendererLifecycle.getSnapshot().generation === binding.rendererGeneration,
          binding.publishPixels
          );
        }
      });
    },
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
    },
    onRasterTransformCommitted: () => {
      if (!fixedTransformCommandRunningRef.current) documentSession?.markChanged();
    },
    onAuxiliaryTransformCommitted: () => {
      if (!fixedTransformCommandRunningRef.current) documentSession?.markChanged();
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
  const activeTransformFrame = useMemo(() => transformState && !temporarySelectionMoveActive
    ? transformSession.frameOverride ?? transformSessionFrame(
        transformState,
        toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document'
      )
    : null, [
      temporarySelectionMoveActive,
      toolPreferences?.preserveTransformLocalAxes,
      transformSession.frameOverride,
      transformState
    ]);
  const transformFrame = useMemo(() => transformState && !temporarySelectionMoveActive
    ? buildTransformEditingFrame(transformState, activeScale, activeTransformFrame ?? undefined)
    : null, [activeScale, activeTransformFrame, temporarySelectionMoveActive, transformState]);
  const getTransformSnapTargets = useCallback(() => {
    const document = imageDocumentRef.current;
    const snap = editorSessionRef.current.snap;
    return document && transformState
      ? buildLayerSnapTargets(document, {
        excludedLayerIds: new Set([
          transformState.layerId,
          ...selectedLayerIdsRef.current
        ]),
        includeCanvas: snap.targets.documentBounds,
        includeLayers: snap.targets.layers,
        includeGuides: snap.targets.guides,
        movingBounds: transformFrame?.bounds
      })
      : [];
  }, [transformFrame?.bounds, transformState]);
  useEffect(() => {
    engineRef.current?.setTransformEditingFrame(transformFrame);
  }, [transformFrame]);
  useEffect(() => {
    engineRef.current?.setSmartGuideEditingFrame(
      editorSession.snap.extrasVisible !== false
        && editorSession.snap.smartGuidesVisible
        && (transformFrame || selectionSnapFeedback.bounds)
        ? buildSmartGuideEditingFrame(
            transformFrame ? transformSnapMatchesRef.current : selectionSnapFeedback.matches,
            transformFrame?.bounds ?? selectionSnapFeedback.bounds!,
            activeScale
          )
        : null
    );
  }, [activeScale, editorSession.snap.extrasVisible, editorSession.snap.smartGuidesVisible, selectionSnapFeedback, transformFrame]);
  useEffect(() => {
    const engine = engineRef.current;
    engine?.setDocumentGuideEditingFrame(
      imageDocument && editorSession.snap.extrasVisible !== false && editorSession.snap.guidesVisible
        ? buildDocumentGuideFrame(effectiveDocumentGuides, imageDocument.width, imageDocument.height)
        : null
    );
    engine?.setDocumentGridEditingFrame(
      imageDocument && editorSession.snap.extrasVisible !== false && editorSession.snap.gridVisible
        ? buildDocumentGridFrame(
            imageDocument.width,
            imageDocument.height,
            editorSession.snap.gridSpacing / Math.max(1, editorSession.snap.gridSubdivisions),
            editorSession.snap.gridOriginX,
            editorSession.snap.gridOriginY,
            activeScale
          )
        : null
    );
  }, [activeScale, editorSession.snap, effectiveDocumentGuides, imageDocument]);
  useEffect(() => {
    if (!transformState) {
      transformSnapMatchesRef.current = [];
      engineRef.current?.setSmartGuideEditingFrame(null);
    }
  }, [transformState]);
  const publishTransientTransformFrame = useCallback((next: TransformSessionState | null) => {
    if (!next) return;
    const frame = transformSession.frameOverride ?? transformSessionFrame(
      next,
      toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document'
    );
    const editingFrame = buildTransformEditingFrame(next, activeScale, frame);
    const engine = engineRef.current;
    engine?.setTransformEditingFrame(editingFrame);
    engine?.setSmartGuideEditingFrame(
      editorSession.snap.extrasVisible !== false
        && editorSession.snap.smartGuidesVisible
        ? buildSmartGuideEditingFrame(
            transformSnapMatchesRef.current,
            editingFrame.bounds,
            activeScale
          )
        : null
    );
  }, [activeScale, editorSession.snap.extrasVisible, editorSession.snap.smartGuidesVisible,
    toolPreferences?.preserveTransformLocalAxes, transformSession.frameOverride]);
  const updateTransformMatrix = useCallback((matrix: AffineMatrix, matches: readonly SnapMatch[]) => {
    const next = transformSession.update(matrix);
    transformSnapMatchesRef.current = next ? matches : [];
    publishTransientTransformFrame(next);
    if (!next) engineRef.current?.setSmartGuideEditingFrame(null);
    return next !== null;
  }, [publishTransientTransformFrame, transformSession.update]);
  const updateTransformProjective = useCallback((quad: TransformQuad, matches: readonly SnapMatch[]) => {
    const next = transformSession.updateProjective(quad);
    transformSnapMatchesRef.current = next ? matches : [];
    publishTransientTransformFrame(next);
    if (!next) engineRef.current?.setSmartGuideEditingFrame(null);
    return next !== null;
  }, [publishTransientTransformFrame, transformSession.updateProjective]);
  const publishTransformSnapMatches = useCallback((matches: readonly SnapMatch[]) => {
    transformSnapMatchesRef.current = matches;
    if (matches.length === 0) engineRef.current?.setSmartGuideEditingFrame(null);
  }, []);
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
  settlePixelInteractionRef.current = async () => {
    await selectionSessionController.settle();
    await transformSession.commitPending();
  };
  cancelPixelInteractionRef.current = () => {
    selectionSessionController.reset();
    transformSession.reset();
  };
  cancelTransformRef.current = transformSession.cancel;
  resetTransformRef.current = transformSession.reset;
  transformActiveRef.current = transformSession.isActive;
  repeatTransformRef.current = transformSession.repeat;
  nudgeTransformRef.current = transformSession.nudge;
  hostPresentationDeactivateRef.current = () => {
    void interactionTransitions.request('preserve');
    viewportInteraction.cancelActiveGesture();
    adjustmentInteractions.reset();
    rasterGradientController.cancel();
    cancelAutoAlignRef.current();
  };
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
    if (kind === 'selection-paint') {
      return selectionSessionController.beginPaint(
        pointerId,
        { ...sample, pressure: sample.pressure ?? 1 },
        parameters.mode === 'subtract' ? 'subtract' : 'add',
        {
          size: Number(parameters.size),
          hardness: Number(parameters.hardness),
          opacity: Number(parameters.opacity),
          smooth: Number(parameters.smooth)
        }
      );
    }
    if (kind === 'brush-stroke') {
      const document = imageDocumentRef.current;
      const layerId = typeof parameters.layerId === 'string'
        ? parameters.layerId as LayerId
        : document?.activeLayerId ?? null;
      if (!document) return false;
      const layer = document && layerId ? findRasterLayer(document, layerId) : null;
      if (!layer) return false;
      const channel = parameters.channel === 'mask' ? 'mask' : 'pixels';
      const brush = parseAutomationBrushSettings(parameters.brush)
        ?? editorSessionRef.current.brush;
      const operator = parameters.operator === undefined
        ? undefined
        : parseAutomationPaintOperator(parameters.operator) ?? undefined;
      if (parameters.operator !== undefined && !operator) return false;
      let paintOperator: PaintBrushStrokePlan | undefined;
      if (operator?.operator === 'clone' || operator?.operator === 'healing') {
        paintOperator = {
          ...operator,
          source: { ...operator.source, documentId: document.id }
        };
      } else if (operator?.operator === 'tone') {
        paintOperator = operator;
      }
      if (paintOperator && paintOperator.operator !== 'tone'
        && paintOperator.sampleMode !== 'all'
        && !findDocumentLayer(document, paintOperator.source.anchorLayerId)) return false;
      return paintSessionController.begin({
        pointerId,
        layer,
        target: {
          layerId: layer.id,
          channel,
          erase: parameters.erase === true,
          sourceToDocument: paintTargetSourceToDocument(document, layer, channel)
        },
        brush,
        operator: paintOperator,
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
    const transaction = documentMutationController.begin(
      'automation.translate',
      { label: 'Move Layer', type: 'layer.transform', layerIds: [layerId] },
      undefined,
      'cancel'
    );
    if (!transaction) return false;
    automationTranslateRef.current = { transaction, layerId, start: sample };
    return true;
  };
  updateAutomationGestureRef.current = (kind, pointerId, sample) => {
    if (kind === 'selection-rectangle') {
      return selectionSessionController.move(pointerId, sample);
    }
    if (kind === 'selection-paint') {
      return selectionSessionController.movePaint(pointerId, [{
        ...sample,
        pressure: sample.pressure ?? 1
      }]);
    }
    if (kind === 'brush-stroke') {
      return paintSessionController.move(pointerId, {
        ...sample,
        pressure: sample.pressure ?? 1
      });
    }
    const transaction = automationTranslateRef.current;
    const layer = transaction
      ? findDocumentLayer(transaction.transaction.before, transaction.layerId)
      : null;
    if (!transaction || !transaction.transaction.active || !layer) return false;
    transaction.transaction.change(() => setLayerTransform(
      transaction.transaction.before,
      transaction.layerId,
      {
        ...layer.transform,
        tx: layer.transform.tx + sample.x - transaction.start.x,
        ty: layer.transform.ty + sample.y - transaction.start.y
      }
    ));
    return transaction.transaction.active;
  };
  finishAutomationGestureRef.current = (kind, pointerId, commit) => {
    if (kind === 'selection-rectangle') {
      return commit
        ? selectionSessionController.finish(pointerId)
        : selectionSessionController.cancel(pointerId);
    }
    if (kind === 'selection-paint') {
      return commit
        ? selectionSessionController.finishPaint(pointerId)
        : selectionSessionController.cancelPaint(pointerId);
    }
    if (kind === 'brush-stroke') {
      return commit
        ? paintSessionController.finish(pointerId)
        : paintSessionController.cancel(pointerId);
    }
    const transaction = automationTranslateRef.current;
    automationTranslateRef.current = null;
    if (!transaction) return false;
    return commit ? transaction.transaction.commit() : transaction.transaction.cancel();
  };

  const activatePersistentTool = (requestedTool: ToolId) => {
    if (cropBounds) setCropBounds(null);
    const shortcutGroup = toolShortcutGroupFor(requestedTool);
    if (shortcutGroup) {
      preferredToolByShortcutRef.current[shortcutGroup.key] = requestedTool;
    }
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
    if (editorSession.activeTool === 'face-warp' && requestedTool !== 'face-warp') {
      faceWarpSessionController.reset();
      faceWarpDetectionController.reset();
    }
    const plan = planPersistentToolActivation(
      editorSession.activeTool,
      requestedTool,
      transformSession.isActive()
    );
    if (plan.finishTransform) transformSession.commit();
    if (plan.restartTransform) transformSession.begin();
    if (plan.nextTool) {
      if (
        (selectionSessionController.draft || editorSession.activeTool === 'select-magic-wand')
        && editorSession.activeTool !== plan.nextTool
      ) {
        selectionSessionController.reset();
      }
      setEditorSession((current) => {
        const nextTool = plan.nextTool as ToolId;
        const sampledBrushRequiresPaintTip = (
          nextTool === 'clone-stamp' || nextTool === 'healing-brush'
        ) && resolveBrushPreset(current.brush.presetId).engine !== 'paint';
        if (current.activeTool === nextTool && !sampledBrushRequiresPaintTip) return current;
        return {
          ...current,
          activeTool: nextTool,
          brush: sampledBrushRequiresPaintTip
            ? { ...current.brush, ...brushPresetChange('round') }
            : current.brush
        };
      });
    }
  };
  activateToolRef.current = activatePersistentTool;

  const invertActiveLayerColors = () => {
    runAfterMountedDocumentAdmission(() => {
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
    pointTextController.cancel();
    paragraphTextController.cancel();
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
    exportPng: handleExportPng,
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
    getFlatAdjustments: () => adjustmentsRef.current,
    getDocumentAdjustments: () => documentAdjustmentsRef.current,
    getEffectiveLayeredAdjustments: () => documentAdjustmentsRef.current,
    getGlobalGradeStrength: () => globalGradeStrengthRef.current,
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

  const exportPngThroughCommand = useCallback(async () => {
    const execution = executeRegisteredCommand('file.exportPng', {});
    if (!execution || !commandService) {
      await handleExportPng();
      return;
    }
    try {
      const result = await execution;
      if (result.status !== 'accepted') return;
      const file = await waitForCommandArtifact(
        commandService, workspaceDocumentId as DocumentSessionId, result.taskId
      );
      await deliverExportFile(file);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [commandService, deliverExportFile, executeRegisteredCommand, handleExportPng, workspaceDocumentId]);
  quickExportPngRef.current = exportPngThroughCommand;

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
      hasSelection: editorSession.selection.length > 0,
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
      save: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleSave(); },
      exportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void exportPngThroughCommand(); },
      exportJpeg: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportJpeg(); },
      exportWebp: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportWebp(); },
      exportTiff: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportTiff(); },
      exportPsd: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPsd(); },
      exportPsdMaximumAppearance: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPsdMaximumAppearance(); },
      exportSvg: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportSvg(); },
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
            await deliverExportFile(new File(
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
            await deliverExportFile(new File(
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
              await deliverExportFile(new File(
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
            await deliverExportFile(new File(
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
        if (layerId) requestTextToShape(layerId);
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
      clearGuides,
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
      globalGradeStrength={globalGradeStrength}
      globalGradeModified={globalGradeModified}
      globalLensFxModified={globalLensFxModified}
      copiedGradeName={copiedGrade?.name ?? null}
      onGlobalGradeStrength={publishGlobalGradeStrength}
      onGlobalGradeStrengthInteractionStart={beginGlobalGradeStrength}
      onGlobalGradeStrengthInteractionEnd={endGlobalGradeStrength}
      onResetGlobalGrade={resetGlobalGrade}
      onResetGlobalLensFx={resetGlobalLensFx}
      onCopyGlobalGrade={copyCurrentGrade}
      onPasteGlobalGrade={pasteCurrentGrade}
      editingTextLayerId={textEditing.layerId}
      onEditText={(layerId) => {
        pointTextController.cancel();
        activatePersistentTool('text-point');
        requestExistingFlowTextEditing(layerId);
      }}
      onOpenFontReport={() => editorDialogs.openPsdReport()}
      onConvertTextToShape={requestTextToShape}
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
      documentProcessingVisibility={{
        grade: groupVisibility.globalGrade,
        lensFx: groupVisibility.globalLensFx
      }}
      onDocumentProcessingVisibility={(owner, visible) => {
        documentProjectionController.applyGroupVisibilitySnapshot({
          ...groupVisibilityRef.current,
          [owner === 'grade' ? 'globalGrade' : 'globalLensFx']: visible
        });
      }}
      onInspectDocumentProcessing={(owner) => {
        publishAdjustmentPresentation(
          cloneAdjustments(documentAdjustmentsRef.current),
          owner === 'grade' ? 'grade' : 'lens-fx'
        );
        showProperties({ kind: 'document-processing', owner });
      }}
      onInspectAttachedAdjustment={(layerId, adjustmentId) => {
        const currentDocument = imageDocumentRef.current;
        const layer = currentDocument
          ? findDocumentLayer(currentDocument, layerId)
          : null;
        const adjustment = layer?.type === 'raster'
          ? (layer.attachedAdjustments ?? []).find(({ id }) => id === adjustmentId)
          : null;
        if (adjustment) {
          publishAdjustmentPresentation(
            materializeBasicAdjustments(
              adjustment.adjustmentStack,
              undefined,
              undefined,
              true
            )
          );
        }
        showProperties({ kind: 'attached-processing', layerId, adjustmentId });
      }}
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
        runAfterMountedDocumentAdmission(() => {
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
    void executeRegisteredCommand('text.convertToShape', { layerId }).then((result) => {
      setGradeStatus(result.status === 'completed' ? 'Text converted to editable shapes.' : null);
      if (result.status === 'rejected') setError(result.message);
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
    const changed = documentMutationController.change(
      (document) => mode === 'paragraph'
        ? convertPointTextToParagraph(document, layerId, {
            width: 240,
            height: 120,
            firstBaselineOffset
          })
        : convertParagraphTextToPoint(document, layerId, { firstBaselineOffset }),
      true,
      { label: mode === 'paragraph' ? 'Convert to Paragraph Text' : 'Convert to Point Text',
        type: 'text.set-layout', layerIds: [layerId] }
    );
    if (!changed) return;
    activatePersistentTool('text-point');
    if (restoreEditing) textEditingController.begin(layerId, restoreOffset);
  };
  const beginTextPropertyGesture = () =>
    textPropertyGestureController.begin(activeFlowTextPropertyLayer?.id);
  const applyTextPropertyPatch = (
    patch: TextStylePatch,
    paragraphPatch: ParagraphStylePatch = {}
  ) => textPropertyGestureController.apply(patch, paragraphPatch);
  const queueTextPaintPreview = (patch: TextStylePatch) =>
    textPropertyGestureController.queuePaint(patch);
  const commitTextPropertyGesture = () => textPropertyGestureController.commit();
  const cancelTextPropertyGesture = () => textPropertyGestureController.cancel();
  const dispatchDiscreteTextFormat = (stylePatch: TextStylePatch, paragraphPatch: ParagraphStylePatch) => {
    const document = imageDocumentRef.current; const layerId = document?.activeLayerId;
    const style = semanticStylePatchFromCanonical(stylePatch);
    const paragraph = semanticParagraphPatchFromCanonical(paragraphPatch);
    if (!layerId || !style || !paragraph) return false;
    const editing = textEditingController.getSnapshot();
    const selection = editing.status === 'editing' && editing.layerId === layerId ? editing.selection : null;
    if (selection) {
      if (!beginTextPropertyGesture()) return false;
      applyTextPropertyPatch(stylePatch, paragraphPatch);
      commitTextPropertyGesture();
      return true;
    }
    void executeRegisteredCommand('text.format', { layerId,
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(paragraph).length ? { paragraph } : {}) });
    return true;
  };
  const applyDiscreteTextProperty = (patch: TextStylePatch) => {
    dispatchDiscreteTextFormat(patch, {});
  };
  const applyDiscreteTextParagraph = (patch: ParagraphStylePatch) => {
    dispatchDiscreteTextFormat({}, patch);
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
    const execution = executeRegisteredCommand('text.setLayout', { layerId, writingMode });
    void execution?.then((result) => {
      if (result.status === 'completed') {
        activatePersistentTool(writingMode === 'horizontal-tb' ? 'text-point' : 'text-vertical');
      }
    });
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
    onInteractionStart: beginFaceWarpDocumentTransaction,
    onInteractionEnd: commitFaceWarpDocumentTransaction,
    onInteractionCancel: cancelFaceWarpDocumentTransaction,
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
        onTransformChange: updateTransformMatrix,
        onTransformProjectiveChange: updateTransformProjective,
        onTransformCommitGesture: transformSession.checkpoint,
        onTransformDuplicateChange: transformSession.setDuplicate,
        onTransformPick: pickTransformAtPoint,
        getTransformSnapTargets,
        transformSnapEnabled: editorSession.snap.enabled,
        transformSnapGrid: editorSession.snap.targets.grid && editorSession.snap.gridVisible ? {
          spacing: editorSession.snap.gridSpacing / Math.max(1, editorSession.snap.gridSubdivisions),
          originX: editorSession.snap.gridOriginX,
          originY: editorSession.snap.gridOriginY
        } : null,
        transformFrameMode: toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document',
        transformFrameOverride: transformSession.frameOverride,
        onTransformSnapMatches: publishTransformSnapMatches,
        onTransformViewportPan: panTransformViewport,
        documentGuides: effectiveDocumentGuides,
        rulersVisible: editorSession.snap.rulersVisible,
        guidesVisible: editorSession.snap.extrasVisible !== false && editorSession.snap.guidesVisible,
        guidesLocked: editorSession.snap.guidesLocked,
        onGuideDraft: setGuideDraft,
        onGuideCommit: commitDocumentGuides
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
              const layer = imageDocumentRef.current
                ? findDocumentLayer(imageDocumentRef.current, layerId)
                : null;
              if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return;
              void layerPanelController.select(layerId).then(() => {
                editorDialogs.closePsdReport();
                pointTextController.cancel();
                activatePersistentTool('text-point');
                requestExistingFlowTextEditing(layerId);
                showProperties({ kind: 'layer', layerId });
              });
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
            onConvertTextToShape: commitTextToShape,
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
            onCreateGuide: (guide) => {
              documentMutationController.change(
                (document) => addDocumentGuide(document, guide),
                true,
                { label: 'New Guide', type: 'document.guides' }
              );
            }
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
            onGradientChange: (change) => setEditorSession((current) => ({
              ...current,
              gradient: { ...current.gradient, ...change }
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
                  disabled: workspaceDocument.kind === 'video' || !genAiService || Boolean(pendingTabReference)
                    || !genAiSetup.workflow?.fields.some(field => field.kind === 'asset')
                    || !workspacePanels.some(panel => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi && panel.visible),
                  disabledReason: 'Open GenAI with a model that accepts image references.',
                  onClick: () => {
                    setPendingTabReference({ id: workspaceDocument.id, origin: workspaceDocumentId });
                    if (workspaceDocument.id !== workspaceDocumentId) activateWorkspaceDocument(workspaceDocument.id);
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
                    toggleFocusPicker: () => setFocusPickerActive((current) => !current)
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
                  toggleMasterEnabled: toggleGradeMasterEnabled,
                  toggleVisibility: toggleGradeSectionVisibility,
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
                  addPointColorSample,
                  updatePointColorSample,
                  resetPointColorSample,
                  removePointColorSample,
                  togglePointColorPicker: () => setPointColorPickerActive((current) => !current),
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
                onModeChange: (mode) => {
                  setGenAiBaseImageSelected(mode === 'image2image');
                  genAiSetup.setMode(mode);
                },
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
                baseImageSelected: genAiBaseImageSelected,
                baseImageAssetId: genAiBaseImageAssetId,
                onBaseImageSelectedChange: (selected) => {
                  setGenAiBaseImageSelected(selected);
                  if (!selected && genAiBaseImageAssetId) {
                    genAiSetup.removeAssetReference(genAiBaseImageAssetId);
                    setGenAiBaseImageAssetId(undefined);
                  }
                },
                onImportReferenceFile: (file) => importGenAiReferenceFile(file),
                onImportDocumentReference: (documentId) => importGenAiDocumentReference(documentId),
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
