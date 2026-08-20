import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cloneGradientPaint } from '@lighttable/paint-core';
import { TEXT_CONTRACT_FIXTURE_COUNT, type TextPaint, type TextWarp } from '@lighttable/text-core';
import { buildParagraphFrameOverlay } from '@lighttable/text-rendering';
import { DocumentCommandHistory } from './application/commands/documentCommandHistory';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandId, type LightTableCommandPortRegistry, type LightTableCommandService, type LightTableGestureKind, type LightTableGestureSample } from './application/commands/lightTableCommandService';
import type { LightTablePreviewEncoding } from './application/commands/lightTableCommandContract';
import { resolveAcceptedCommandArtifact } from './application/commands/resolveAcceptedCommandArtifact';
import type { DocumentPixelRegion } from './editor/geometry/documentRegionPreview';
import {
  automationPaintOperatorFromPlan,
  parseAutomationBrushSettings,
  parseAutomationPaintOperator
} from './application/commands/lightTableCommandValidation';
import { useDocumentHistoryController, type EditorHistoryEntry } from './application/commands/useDocumentHistoryController';
import type { DocumentSession, DocumentSessionId } from './application/documents/documentSession';
import { DocumentTaskRegistry } from './application/tasks/documentTaskRegistry';
import { DocumentRendererLifecycle } from './application/rendering/documentRendererLifecycle';
import { resolveViewportImageRect } from './application/rendering/viewportRenderState';
import { useDocumentRuntimeServices } from './application/documents/useDocumentRuntimeServices';
import { resetDocumentOpenPresentation } from './application/documents/resetDocumentOpenPresentation';
import { useDocumentMutationController } from './application/documents/useDocumentMutationController';
import { useEditorRecoveryJournal } from './application/documents/useEditorRecoveryJournal';
import { exportEditorPngArtifact, exportEditorPreviewArtifact, exportEditorPsdArtifact } from './application/documents/editorArtifactExports';
import type { ExportedPsdDocument } from './application/documents/PsdExportClient';
import { hydrateDocumentFonts } from './application/documents/hydrateDocumentFonts';
import { useAdjustmentTransactionController } from './application/adjustments/useAdjustmentTransactionController';
import { projectAdjustmentSnapshot } from './application/adjustments/projectAdjustmentSnapshot';
import { createAdjustmentCommands } from './application/adjustments/createAdjustmentCommands';
import { resolveBasicAdjustmentTarget } from './application/adjustments/basicAdjustmentTarget';
import { projectBasicAdjustmentValues } from './application/adjustments/basicAdjustmentQuery';
import { projectAdjustmentQuery } from './application/adjustments/adjustmentQuery';
import { changedBasicAdjustmentValues } from './application/commands/semanticBasicAdjustmentCommandContract';
import {
  resolveContextualAdjustmentCreation,
  type SemanticAdjustmentCreationCommand
} from './application/commands/semanticAdjustmentCreationCommandContract';
import type { ActionRecordingSnapshot } from './application/actions/semanticActionRecorder';
import type { ActionPlaybackSnapshot } from './application/actions/semanticActionPlayback';
import type { SemanticActionLibrarySnapshot } from './application/actions/semanticActionLibrary';
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
import { useEditorResizeController } from './editor/hooks/useEditorResizeController';
import { useLayerThumbnailController } from './editor/hooks/useLayerThumbnailController';
import { useEditorDiagnosticsController } from './editor/hooks/useEditorDiagnosticsController';
import { createScopeRendererOptions, useRendererPresentationSync } from './editor/hooks/useRendererPresentationSync';
import { planPersistentToolActivation } from './application/tools/persistentToolActivation';
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
import type { LayerStyleId } from './editor/styles/layerStyleTypes';
import { useLayerDocumentCommands } from './application/layers/useLayerDocumentCommands';
import { useBackgroundRemovalController, type BackgroundRemovalMaskMode } from './application/backgroundRemoval/useBackgroundRemovalController';
import { useLayerPanelController } from './application/layers/useLayerPanelController';
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
  type DocumentGeometryRequest
} from './application/documentGeometry/documentGeometryModel';
import { LightTableEditorShell } from './editor/ui/LightTableEditorShell';
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
import { executeSemanticTextCommand, paragraphTextCreateCommand, pathTextCreateCommand,
  pointTextCreateCommand,
  textCreateCommandParameters,
  semanticParagraphPatchFromCanonical, semanticStylePatchFromCanonical } from './application/text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from './application/vectors/semanticVectorCommandExecutor';
import { executeSemanticWarpStrokeCommand } from './application/commands/semanticWarpCommandExecutor';
import { semanticWarpStrokeFromCommitted } from './application/commands/semanticWarpCommandContract';
import { observedLiveShapeCreateCommand, observedLiveShapeUpdateCommand, observedVectorPathCreateCommand,
  observedVectorPathUpdateCommand } from './application/vectors/semanticVectorObservation';
import { executeSemanticLayerStyleCommand } from './application/styles/semanticLayerStyleCommandExecutor';
import { executeAtomicCommandBatch } from './application/commands/atomicCommandBatchExecutor';
import { applySemanticFaceWarpCommandToDocument, executeSemanticFaceWarpCommand } from './application/effects/faceWarp/semanticFaceWarpCommandExecutor';
import { useAgentActivity } from './application/commands/useAgentActivity';
import { waitForExactCommandRender } from './application/rendering/waitForExactCommandRender';
import { FlowTextEditingRuntime } from './application/text/FlowTextEditingRuntime';
import { ParagraphFrameResizeController } from './application/text/ParagraphFrameResizeController';
import { PathTextHandleController } from './application/text/PathTextHandleController';
import { useMissingFontReplacementActions } from './application/text/useMissingFontReplacementActions';
import { hitTestTextEditingLayout } from './application/text/textEditingHitTest';
import { TextLayerMoveGestureController } from './application/text/TextLayerMoveGestureController';
import { formatFlowTextSource, type ParagraphStylePatch, type TextStylePatch } from './application/text/flowTextFormatting';
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
  setFlowTextLayout,
  setTextWarp
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
import { LightTableDockWorkspace, type LightTableDockWorkspaceHandle } from './editor/workspace/LightTableDockWorkspace';
import { nextEditorScreenMode, type EditorScreenMode } from './editor/workspace/editorScreenMode';
import { LIGHTTABLE_WORKSPACE_PANEL_IDS } from './editor/workspace/workspacePanelRegistry';
import { useGenAiSetupController } from '../genai/application/useGenAiSetupController';
import { useGenAiJobsController } from '../genai/application/useGenAiJobsController';
import { executeRemoveObject } from '../genai/application/removeObjectCommand';
import type { GenAiGenerationJob } from '@lighttable/genai-core';

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
import { FaceWarpDetector } from './effects/faceWarp/FaceWarpDetector';
import { mapDetectedFaceToLayerSource } from './effects/faceWarp/faceWarpDetectionMapping';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_CANONICAL_UVS,
  MEDIAPIPE_FACE_TOPOLOGY_ID,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from './effects/faceWarp/canonicalFaceTopology';
import { semanticLandmarksFromMesh } from './effects/faceWarp/faceWarpLandmarks';
import { buildFaceWarpMeshOverlay } from './effects/faceWarp/faceWarpMeshOverlay';
import {
  applyFaceWarpParameterChange,
  applyFaceWarpBrush,
  findDeformedFaceHit,
  refineFaceWarpBrush,
  relaxFaceWarpBrush,
  restoreFaceWarpBrush
} from './effects/faceWarp/faceWarpDeformer';
import {
  assessFaceWarpDetection,
  matchFaceWarpObservations
} from './effects/faceWarp/faceWarpDetectionQuality';
import {
  addFaceWarpNodeToStack,
  createDefaultFaceWarpParameters,
  createFaceWarpModuleInstance,
  findFaceWarpModuleInstance,
  readFaceWarpNodeSettings,
  setFaceWarpNodeSettings,
  type FaceWarpFace,
  type FaceWarpNodeSettings,
  type FaceWarpProtectedFeature,
  type FaceWarpParameters
} from './effects/faceWarp/faceWarpTypes';
import type { FaceWarpSemanticTarget } from './application/tools/faceWarp/FaceWarpToolOptions';
import {
  faceWarpDetectionReviewMatches,
  type FaceWarpDetectionReviewSource
} from './application/tools/faceWarp/faceWarpDetectionReview';
import { useSelectionSessionController } from './application/tools/selection/useSelectionSessionController';
import { useTransformSessionController, type FixedTransformOperation } from './application/tools/transform/useTransformSessionController';
import { pickTransformLayer } from './application/tools/transform/transformLayerPicker';
import { buildTransformEditingFrame } from './editor/tools/transform/transformEditingFrame';
import { transformSessionFrame } from './editor/tools/transform/transformSessionFrame';
import { buildSmartGuideEditingFrame } from './editor/tools/transform/smartGuideEditingFrame';
import { buildDocumentGridFrame, buildDocumentGuideFrame } from './editor/tools/transform/layoutGuideEditingFrame';
import { buildLayerSnapTargets } from './application/tools/snapping/layerSnapGeometry';
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
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import type { PsdImportCompatibilityEntry } from './editor/psd/psdDocumentAdapter';
import { PaintGestureController } from './editor/tools/paint/paintGestureController';
import { paintTargetSourceToDocument } from './editor/tools/paint/paintCoordinates';
import {
  removeLayerMask,
  setLayerMaskEnabled,
  setLayerMaskLinked,
  mergeLayers as mergeDocumentLayers,
  setRasterLayerAdjustmentStack,
  setLayerTransform
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
const EMPTY_ACTION_RECORDING: ActionRecordingSnapshot = {
  status: 'idle', id: null, name: 'Untitled Action', startedAt: null, stoppedAt: null,
  steps: [], byteLength: 0, limitReached: false
};
const subscribeToNothing = () => () => undefined;
const emptyActionRecording = () => EMPTY_ACTION_RECORDING;
const EMPTY_ACTION_PLAYBACK: ActionPlaybackSnapshot = {
  status: 'idle', currentSequence: null, results: [], taskProgress: null
};
const emptyActionPlayback = () => EMPTY_ACTION_PLAYBACK;
const EMPTY_ACTION_LIBRARY: SemanticActionLibrarySnapshot = {
  actions: [], selectedId: null, error: null
};
const emptyActionLibrary = () => EMPTY_ACTION_LIBRARY;
const encodeAgentPreview = async (source: File | Blob, name: string,
  encoding: LightTablePreviewEncoding): Promise<File> => {
  if (encoding.format === 'png') {
    return source instanceof File ? source : new File([source], `${name}.png`, { type: 'image/png' });
  }
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('WebP preview encoding is unavailable.');
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: encoding.quality ?? 0.85 });
    if (blob.type !== 'image/webp') throw new Error('The browser did not produce a WebP preview.');
    return new File([blob], `${name}.webp`, { type: 'image/webp' });
  } finally { bitmap.close(); }
};
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
  documentCreationSettings?: DocumentCreationSettings;
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
    replaceSource?: { readonly path: string; readonly format: 'png' | 'jpeg' }
  ) => Promise<LightTableSaveResult> | LightTableSaveResult;
  onExportFile?: (file: File) => Promise<unknown> | unknown;
  workspaceDocumentId?: string;
  workspaceDocuments?: ReadonlyArray<{
    id: string;
    title: string;
    dirty?: boolean;
    thumbnailUrl?: string;
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
  onDocumentThumbnailChange?: (thumbnail: Blob) => void;
  onDocumentError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  history?: DocumentCommandHistory;
  tasks?: DocumentTaskRegistry;
  rendererLifecycle?: DocumentRendererLifecycle;
  documentSession?: DocumentSession;
  commandService?: LightTableCommandService;
  commandPorts?: LightTableCommandPortRegistry;
  imageClipboard?: LightTableImageClipboard;
  recoveryStore?: LightTableRecoveryStore;
  recoveryPreferences?: { readonly enabled: boolean; readonly intervalMs: number };
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
  genAiService?: import('../platform/LightTableHost').LightTableGenAiService;
  onGenAiGenerationSucceeded?: (job: GenAiGenerationJob) => void;
  onGenAiOpenResult?: (job: GenAiGenerationJob) => void;
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
  sourceDecodeMode = 'automatic',
  documentCreationSettings,
  loadSource,
  initialRecipe = null,
  fileNameBase,
  onClose,
  onSave,
  onExportFile,
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
  onDocumentThumbnailChange,
  onDocumentError,
  onDirtyChange,
  history,
  tasks,
  rendererLifecycle: providedRendererLifecycle,
  documentSession,
  commandService,
  commandPorts,
  imageClipboard: providedImageClipboard,
  recoveryStore,
  recoveryPreferences,
  toolPreferences,
  genAiPreferences,
  releaseService, genAiService, onGenAiGenerationSucceeded, onGenAiOpenResult, onGenAiOpenAsset, hostKind = 'web',
  recoveryNotice = null,
  onRecoveryResolved
}) => {
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
  const [globalGradeStrength, setGlobalGradeStrengthState] = React.useState(
    () => initialRecipe?.globalGradeStrength ?? 100
  );
  const globalGradeStrengthRef = useRef(globalGradeStrength);
  const globalGradeStrengthGestureRef = useRef<number | null>(null);
  const thumbnailTimerRef = useRef<number | null>(null);
  const thumbnailGenerationRef = useRef(0);
  const publishDocumentThumbnail = useCallback(async (renderer: DocumentRendererPort) => {
    if (!onDocumentThumbnailChange) return;
    const generation = ++thumbnailGenerationRef.current;
    try {
      const thumbnail = await renderer.exportThumbnailPng(256);
      if (generation === thumbnailGenerationRef.current) {
        onDocumentThumbnailChange(thumbnail);
      }
    } catch {
      // Thumbnail publication is best-effort and must never fail document open.
    }
  }, [onDocumentThumbnailChange]);
  const publishCompositeRendered = useCallback(() => {
    if (!onDocumentThumbnailChange) return;
    if (thumbnailTimerRef.current !== null) window.clearTimeout(thumbnailTimerRef.current);
    thumbnailTimerRef.current = window.setTimeout(() => {
      thumbnailTimerRef.current = null;
      const renderer = engineRef.current;
      if (!renderer) return;
      void publishDocumentThumbnail(renderer);
    }, 180);
  }, [onDocumentThumbnailChange, publishDocumentThumbnail]);
  useEffect(() => () => {
    thumbnailGenerationRef.current += 1;
    if (thumbnailTimerRef.current !== null) window.clearTimeout(thumbnailTimerRef.current);
  }, []);
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
  const copySelectedContentRef = useRef<() => void>(() => undefined);
  const copyMergedContentRef = useRef<() => void>(() => undefined);
  const pasteSelectedContentRef = useRef<() => void>(() => undefined);
  const layerViaCopyRef = useRef<() => void>(() => undefined);
  const mergeActiveLayerDownRef = useRef<() => void>(() => undefined);
  const applyCurvesRef = useRef<() => void>(() => undefined);
  const applyAdjustmentRef = useRef<(kind: AdjustmentLayerKind) => void>(() => undefined);
  const executeAdjustmentCreationRef = useRef<(
    command: SemanticAdjustmentCreationCommand
  ) => unknown>(() => null);
  const rasterizeShapeRef = useRef<(
    transaction: VectorElementCreationTransaction
  ) => boolean>(() => false);
  const selectedLayerIdsRef = useRef<LayerId[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<LayerId[]>([]);
  const invertActiveLayerColorsRef = useRef<() => void>(() => undefined);
  const fillActiveTargetRef = useRef<(
    color: string,
    preserveTransparency?: boolean
  ) => void>(() => undefined);
  const deleteActiveTargetRef = useRef<() => void>(() => undefined);
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
    setView,
    setViewport
  } = useDocumentViewportState(documentSession);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [documentSurfaceRevision, setDocumentSurfaceRevision] = useState(0);
  const handleDocumentSurfaceReady = useCallback(() => {
    setDocumentSurfaceRevision((current) => current + 1);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentEvents = useAgentActivity(commandService, workspaceDocumentId);
  const actionRecording = useSyncExternalStore(
    commandService?.subscribeActionRecording ?? subscribeToNothing,
    commandService?.actionRecordingSnapshot ?? emptyActionRecording,
    commandService?.actionRecordingSnapshot ?? emptyActionRecording
  );
  const actionPlayback = useSyncExternalStore(
    commandService?.subscribeActionPlayback ?? subscribeToNothing,
    commandService?.actionPlaybackSnapshot ?? emptyActionPlayback,
    commandService?.actionPlaybackSnapshot ?? emptyActionPlayback
  );
  const actionLibrary = useSyncExternalStore(
    commandService?.subscribeActionLibrary ?? subscribeToNothing,
    commandService?.actionLibrarySnapshot ?? emptyActionLibrary,
    commandService?.actionLibrarySnapshot ?? emptyActionLibrary
  );
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
  const [pointColorPickerActive, setPointColorPickerActive] = useState(false);
  const [pointColorRangeVisualization, setPointColorRangeVisualization] = useState<{
    readonly ownerId: string | null;
    readonly sample: PointColorSample;
  } | null>(null);
  const [lensBlurViewportMode, setLensBlurViewportModeState] = useState<LensBlurViewportMode>('result');
  const [imageDocument, setImageDocument, imageDocumentRef] =
    useDocumentImageState(documentSession);
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
    width: imageDocument.width,
    height: imageDocument.height
  }) : undefined, [imageDocument?.height, imageDocument?.width, workspaceDocumentId]);
  const genAiSetup = useGenAiSetupController(
    genAiService,
    genAiProvider,
    activeGenAiProjectId,
    genAiDocumentContext
  );
  const [genAiBaseImageSelected, setGenAiBaseImageSelected] = useState(false);
  const [genAiBaseImageAssetId, setGenAiBaseImageAssetId] =
    useState<import('@lighttable/genai-core').GenAiAssetId>();
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
  const genAiBaseImageScope = `${activeGenAiProjectId ?? 'session'}:${String(workspaceDocumentId)}`;
  React.useEffect(() => {
    const previousScope = genAiBaseImageScopeRef.current;
    genAiBaseImageScopeRef.current = genAiBaseImageScope;
    if (!previousScope || previousScope === genAiBaseImageScope || !genAiBaseImageAssetId) return;
    genAiSetup.removeAssetReference(genAiBaseImageAssetId);
    setGenAiBaseImageAssetId(undefined);
  }, [genAiBaseImageAssetId, genAiBaseImageScope, genAiSetup.removeAssetReference]);
  React.useEffect(() => {
    if (!active || !genAiBaseImageSelected
      || genAiBaseImageAssetId || genAiBaseImageImportPendingRef.current) return;
    let current = true;
    genAiBaseImageImportPendingRef.current = true;
    void importGenAiDocumentReference(String(workspaceDocumentId)).then((asset) => {
      if (current && asset) setGenAiBaseImageAssetId(asset.id);
    }).finally(() => { genAiBaseImageImportPendingRef.current = false; });
    return () => { current = false; };
  }, [active, genAiBaseImageSelected,
    genAiBaseImageAssetId, importGenAiDocumentReference, workspaceDocumentId]);
  const genAiJobs = useGenAiJobsController(
    genAiService,
    activeGenAiProjectId,
    onGenAiGenerationSucceeded,
    genAiProvider.status
  );
  const faceWarpDetectorRef = useRef<FaceWarpDetector | null>(null);
  const faceWarpDetectionGenerationRef = useRef(0);
  const [faceWarpBusy, setFaceWarpBusy] = useState(false);
  const [pendingFaceWarpDetection, setPendingFaceWarpDetection] = useState<{
    readonly source: FaceWarpDetectionReviewSource;
    readonly settings: FaceWarpNodeSettings;
  } | null>(null);
  const [faceWarpMeshVisible, setFaceWarpMeshVisible] = useState(false);
  const [faceWarpSelectedFaceId, setFaceWarpSelectedFaceId] = useState<string | null>(null);
  const [faceWarpSemanticTarget, setFaceWarpSemanticTarget] =
    useState<FaceWarpSemanticTarget>('both');
  const [faceWarpProtectedFeature, setFaceWarpProtectedFeature] =
    useState<FaceWarpProtectedFeature>('eyes');
  const faceWarpGestureRef = useRef<{
    pointerId: number;
    faceId: string;
    seedSource: { x: number; y: number };
    startPointerSource: { x: number; y: number };
    originalDisplacements: FaceWarpFace['displacements'];
    latestRadius: number;
    mode: 'sculpt' | 'relax' | 'restore';
  } | null>(null);
  const faceWarpRefinementRef = useRef<{
    frame: number;
    documentId: ImageDocument['id'];
    layerId: LayerId;
    finish(): void;
  } | null>(null);
  const [thumbnailDocumentReadyId, setThumbnailDocumentReadyId] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useDocumentEditorSession(documentSession);
  const editorSessionRef = useRef(editorSession);
  editorSessionRef.current = editorSession;
  const fallbackGradientSettingsRef = useRef(createGradientToolSettings());
  const gradientToolSettings = editorSession.gradient ?? fallbackGradientSettingsRef.current;
  const [gradientEditorRequest, setGradientEditorRequest] = useState<{
    revision: number;
    endpoint: 'start' | 'end';
  } | null>(null);
  useEffect(() => {
    if (editorSession.gradient) return;
    setEditorSession((current) => ({
      ...current,
      gradient: current.gradient ?? fallbackGradientSettingsRef.current
    }));
  }, [editorSession.gradient, setEditorSession]);
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
  const [transformSnapMatches, setTransformSnapMatches] = useState<readonly SnapMatch[]>([]);
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
  const exportNativeArtifactRef = useRef<() => Promise<File>>(async () => {
    throw new Error('The native export controller is not ready.');
  });
  const exportPngArtifactRef = useRef<() => Promise<File>>(async () => {
    throw new Error('The PNG export controller is not ready.');
  });
  const exportPreviewArtifactRef = useRef<(maxEdge: number,
    region?: DocumentPixelRegion) => Promise<File>>(async () => {
    throw new Error('The preview export controller is not ready.');
  });
  const exportPsdArtifactRef = useRef<() => Promise<ExportedPsdDocument>>(async () => {
    throw new Error('The PSD export controller is not ready.');
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
    | { readonly kind: 'text'; readonly layerId: LayerId;
        readonly range: { readonly start: number; readonly end: number } | null;
        style: TextStylePatch; paragraph: ParagraphStylePatch; recordable: boolean }
    | { readonly kind: 'document'; readonly documentId: ImageDocument['id']; readonly layerId: LayerId;
        readonly before: ImageDocument; style: TextStylePatch;
        paragraph: ParagraphStylePatch; recordable: boolean }
    | null
  >(null);
  const textWarpGestureRef = useRef<{
    readonly documentId: ImageDocument['id'];
    readonly layerId: LayerId;
    readonly before: ImageDocument;
  } | null>(null);
  const pendingTextPaintPatchRef = useRef<TextStylePatch | null>(null);
  const textPaintPreviewFrameRef = useRef<number | null>(null);
  const selectLayerRef = useRef<(layerId: LayerId) => void>(() => undefined);
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
        documentAdjustmentsRef.current = nextAdjustments;
      },
      publishEditorAdjustments: (nextAdjustments, domain) => {
        publishAdjustmentPresentation(nextAdjustments, domain);
      },
      stageEditorAdjustments: (nextAdjustments) => {
        adjustmentsRef.current = nextAdjustments;
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
    // Undo/redo must first retire the renderer's active transform preview.
    // Otherwise GPU history restores the backing pixels while the stale preview
    // remains composited on top, making committed transforms appear not to undo.
    commitTransformRef.current();
    commitPointTextRef.current();
    commitParagraphTextRef.current();
    finishTextEditingRef.current();
    resetAdjustmentTransactionRef.current();
    const pendingFaceWarpRefinement = faceWarpRefinementRef.current;
    if (pendingFaceWarpRefinement) {
      window.cancelAnimationFrame(pendingFaceWarpRefinement.frame);
      faceWarpRefinementRef.current = null;
      pendingFaceWarpRefinement.finish();
    }
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
  const currentFaceWarpReviewSource: FaceWarpDetectionReviewSource | null = imageDocument
    && activeFaceWarpLayer
    ? {
      documentId: imageDocument.id,
      layerId: activeFaceWarpLayer.id,
      pixelRevision: activeFaceWarpLayer.pixelRevision,
      transform: activeFaceWarpLayer.transform
    }
    : null;
  const pendingFaceWarpDetectionForActiveLayer = pendingFaceWarpDetection
    && faceWarpDetectionReviewMatches(pendingFaceWarpDetection.source, currentFaceWarpReviewSource)
    ? pendingFaceWarpDetection
    : null;
  const visibleFaceWarpFaces = pendingFaceWarpDetectionForActiveLayer?.settings.faces
    ?? activeFaceWarpFaces;
  const effectiveFaceWarpFaceId = visibleFaceWarpFaces.some(({ id }) => id === faceWarpSelectedFaceId)
    ? faceWarpSelectedFaceId
    : visibleFaceWarpFaces[0]?.id ?? null;
  const updateFaceWarpParameters = useCallback((change: Partial<FaceWarpParameters>) => {
    const faceId = faceWarpSelectedFaceId
      ?? (() => {
        const document = imageDocumentRef.current;
        const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
        const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
        return instance ? readFaceWarpNodeSettings(instance).faces[0]?.id ?? null : null;
      })();
    if (!faceId) return;
    documentMutationController.change((document) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      if (!layer?.adjustmentStack || !instance) return document;
      return applySemanticFaceWarpCommandToDocument(document, {
        layerId: layer.id,
        operation: { kind: 'set-semantic', faceId, target: faceWarpSemanticTarget, change }
      });
    });
  }, [documentMutationController, faceWarpSelectedFaceId, faceWarpSemanticTarget, imageDocumentRef]);

  const updateFaceWarpProtection = useCallback((
    feature: FaceWarpProtectedFeature,
    locked: boolean
  ) => {
    const faceId = faceWarpSelectedFaceId ?? effectiveFaceWarpFaceId;
    if (!faceId) return;
    documentMutationController.change((document) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      if (!layer?.adjustmentStack || !instance) return document;
      return applySemanticFaceWarpCommandToDocument(document, {
        layerId: layer.id,
        operation: { kind: 'set-protection', faceId, feature, locked }
      });
    });
  }, [documentMutationController, effectiveFaceWarpFaceId, faceWarpSelectedFaceId]);

  const detectFacesForActiveLayer = useCallback(async () => {
    const document = imageDocumentRef.current;
    const renderer = engineRef.current;
    const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
    if (!document || !renderer || !layer) {
      setError('Face Warp requires an active pixel layer.');
      return;
    }
    if (layerIsLocked(layer)) {
      setError('Unlock the pixel layer before using Face Warp.');
      return;
    }
    setFaceWarpBusy(true);
    setPendingFaceWarpDetection(null);
    setError(null);
    const generation = ++faceWarpDetectionGenerationRef.current;
    const sourceDocumentId = document.id;
    const sourcePixelRevision = layer.pixelRevision;
    const sourceTransform = JSON.stringify(layer.transform);
    try {
      const preview = await renderer.exportLayerThumbnail(layer.id, false, 1024, 1024);
      if (generation !== faceWarpDetectionGenerationRef.current) return;
      if (!preview) throw new Error('The active layer has no image pixels to analyze.');
      const detector = faceWarpDetectorRef.current ??= new FaceWarpDetector();
      const detection = await detector.detect({
        blob: preview.blob,
        sourceWidth: preview.width,
        sourceHeight: preview.height
      });
      if (generation !== faceWarpDetectionGenerationRef.current) return;
      const currentDocument = imageDocumentRef.current;
      const currentLayer = currentDocument ? findRasterLayer(currentDocument, layer.id) : null;
      if (currentDocument?.id !== sourceDocumentId
        || !currentLayer
        || currentLayer.pixelRevision !== sourcePixelRevision
        || JSON.stringify(currentLayer.transform) !== sourceTransform) {
        throw new Error('The layer changed while faces were being detected. Detect faces again.');
      }
      if (detection.meshes.length === 0) throw new Error('No face was detected in the active layer.');
      const rejectedReasons: string[] = [];
      const matchedObservations = matchFaceWarpObservations(detection.meshes, detection.observations);
      const faces: FaceWarpFace[] = detection.meshes.flatMap((mesh, index) => {
        const observation = matchedObservations[index];
        if (!observation) {
          rejectedReasons.push(
            'The face could not be confirmed by the independent detector. Try a clearer or larger face.'
          );
          return [];
        }
        const quality = assessFaceWarpDetection(
          mesh, detection.poseMatrices[index], preview.width, preview.height, observation
        );
        console.info('[Face Warp] Detection quality', JSON.stringify({
          face: index + 1,
          accepted: quality.accepted,
          confidence: quality.confidence,
          detectorScore: observation?.score ?? null,
          ...quality.diagnostics
        }));
        if (!quality.accepted) {
          rejectedReasons.push(quality.reason ?? 'A detected face could not be edited safely.');
          return [];
        }
        const sourceMesh = mapDetectedFaceToLayerSource(
          mesh.slice(0, 468), preview.sourceToOutput
        );
        return [{
          id: `face-${index + 1}`,
          confidence: quality.confidence,
          landmarks: semanticLandmarksFromMesh(sourceMesh),
          parameters: createDefaultFaceWarpParameters(),
          poseMatrix: detection.poseMatrices[index]
        }];
      });
      console.info('[Face Warp] Detector memory', JSON.stringify(detection.detectorMemory));
      if (faces.length === 0) {
        throw new Error(rejectedReasons[0] ?? 'No editable face was detected in the active layer.');
      }
      const settings: FaceWarpNodeSettings = {
        version: 2 as const,
        opacity: 1,
        sourceRevision: layer.pixelRevision,
        detector: { id: 'mediapipe-face-landmarker', version: '1.0.1' },
        topology: {
          id: MEDIAPIPE_FACE_TOPOLOGY_ID,
          vertexCount: MEDIAPIPE_FACE_VERTEX_COUNT,
          triangleIndices: MEDIAPIPE_FACE_TRIANGLE_INDICES,
          canonicalPositions: MEDIAPIPE_FACE_CANONICAL_POSITIONS,
          canonicalUvs: MEDIAPIPE_FACE_CANONICAL_UVS
        },
        faces
      };
      setPendingFaceWarpDetection({
        source: {
          documentId: sourceDocumentId,
          layerId: layer.id,
          pixelRevision: sourcePixelRevision,
          transform: { ...layer.transform }
        },
        settings
      });
      setFaceWarpSelectedFaceId(faces[0]!.id);
      setFaceWarpMeshVisible(true);
      setGradeStatus(`${faces.length} face${faces.length === 1 ? '' : 's'} detected. Check the mesh before accepting.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (generation === faceWarpDetectionGenerationRef.current) setFaceWarpBusy(false);
    }
  }, [imageDocumentRef]);

  const acceptPendingFaceWarpDetection = useCallback(() => {
    const pending = pendingFaceWarpDetection;
    if (!pending) return;
    const currentDocument = imageDocumentRef.current;
    const currentLayer = currentDocument ? findRasterLayer(currentDocument, pending.source.layerId) : null;
    const currentSource: FaceWarpDetectionReviewSource | null = currentDocument && currentLayer
      ? {
        documentId: currentDocument.id,
        layerId: currentLayer.id,
        pixelRevision: currentLayer.pixelRevision,
        transform: currentLayer.transform
      }
      : null;
    if (!faceWarpDetectionReviewMatches(pending.source, currentSource)
      || !currentLayer
      || layerIsLocked(currentLayer)) {
      setPendingFaceWarpDetection(null);
      setError('The layer changed while the face mesh was being reviewed. Detect faces again.');
      return;
    }
    documentMutationController.change((document) => {
      const layer = findRasterLayer(document, pending.source.layerId);
      if (!layer || layerIsLocked(layer)) return document;
      let stack = layer.adjustmentStack
        ? structuredClone(layer.adjustmentStack)
        : { id: `stack-${crypto.randomUUID()}`, revision: 0, modules: [] };
      const existing = findFaceWarpModuleInstance(stack);
      stack = existing
        ? setFaceWarpNodeSettings(stack, pending.settings)
        : addFaceWarpNodeToStack(stack, createFaceWarpModuleInstance(
          `module-${crypto.randomUUID()}`,
          pending.settings
        ));
      return setRasterLayerAdjustmentStack(document, layer.id, stack);
    });
    setPendingFaceWarpDetection(null);
    setGradeStatus(`${pending.settings.faces.length} face${pending.settings.faces.length === 1 ? '' : 's'} accepted.`);
  }, [documentMutationController, imageDocumentRef, pendingFaceWarpDetection]);

  useEffect(() => {
    if (pendingFaceWarpDetection
      && !faceWarpDetectionReviewMatches(
        pendingFaceWarpDetection.source,
        currentFaceWarpReviewSource
      )) {
      setPendingFaceWarpDetection(null);
    }
  }, [currentFaceWarpReviewSource, pendingFaceWarpDetection]);

  const cancelPendingFaceWarpDetection = useCallback(() => {
    faceWarpDetectionGenerationRef.current += 1;
    setPendingFaceWarpDetection(null);
    setFaceWarpSelectedFaceId(activeFaceWarpFaces[0]?.id ?? null);
    setFaceWarpMeshVisible(activeFaceWarpFaces.length > 0);
    setGradeStatus('Face detection cancelled.');
  }, [activeFaceWarpFaces]);

  const resetSelectedFaceWarp = useCallback(() => {
    const faceId = effectiveFaceWarpFaceId;
    if (!faceId) return;
    documentMutationController.change((document) => {
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
  }, [documentMutationController, effectiveFaceWarpFaceId]);

  const changeFaceWarpMeshVisible = useCallback((visible: boolean) => {
    setFaceWarpMeshVisible(visible);
  }, []);

  useEffect(() => () => {
    faceWarpDetectionGenerationRef.current += 1;
    faceWarpDetectorRef.current?.dispose();
  }, []);

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
    const pendingRefinement = faceWarpRefinementRef.current;
    if (pendingRefinement) {
      window.cancelAnimationFrame(pendingRefinement.frame);
      faceWarpRefinementRef.current = null;
      // A new gesture supersedes refinement, but the already visible preview
      // remains one complete, undoable authored gesture.
      endDocumentTransaction();
    }
    const document = imageDocumentRef.current;
    const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
    const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
    const inverse = layer ? invertMatrix(layer.transform) : null;
    if (!layer || !instance || !inverse || layerIsLocked(layer)) return false;
    const settings = readFaceWarpNodeSettings(instance);
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
    if (!hit?.hit || !beginDocumentTransaction()) return false;
    faceWarpGestureRef.current = {
      pointerId,
      faceId: hit.face.id,
      seedSource: hit.hit.sourcePoint,
      startPointerSource: sourcePoint,
      originalDisplacements: hit.face.displacements,
      latestRadius: 0,
      mode: 'sculpt'
    };
    engineRef.current?.setFaceWarpInteractionMode('sculpt');
    setFaceWarpSelectedFaceId(hit.face.id);
    return true;
  };

  const moveFaceWarpGesture = (
    pointerId: number,
    documentPoint: { x: number; y: number },
    mode: 'sculpt' | 'relax' | 'restore'
  ) => {
    const gesture = faceWarpGestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return false;
    engineRef.current?.setFaceWarpInteractionMode(mode);
    return documentMutationController.change((document) => {
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
    const gesture = faceWarpGestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return false;
    engineRef.current?.setFaceWarpInteractionMode(null);
    const document = imageDocumentRef.current;
    const layerId = document?.activeLayerId ?? null;
    if (gesture.mode === 'sculpt' && gesture.latestRadius > 0) {
      if (!document || !layerId) {
        faceWarpGestureRef.current = null;
        endDocumentTransaction();
        return true;
      }
      const refinement = {
        documentId: document.id,
        layerId,
        faceId: gesture.faceId,
        seedSource: gesture.seedSource,
        radius: gesture.latestRadius
      };
      faceWarpGestureRef.current = null;
      const finishRefinement = () => {
        if (!documentMutationController.active) return;
        if (imageDocumentRef.current?.id !== refinement.documentId) {
          documentMutationController.reset();
          return;
        }
        documentMutationController.change((currentDocument) => {
          const layer = findRasterLayer(currentDocument, refinement.layerId);
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
        }, false);
        endDocumentTransaction();
      };
      const frame = window.requestAnimationFrame(() => {
        const pending = faceWarpRefinementRef.current;
        if (!pending || pending.frame !== frame) return;
        faceWarpRefinementRef.current = null;
        finishRefinement();
      });
      faceWarpRefinementRef.current = {
        frame,
        documentId: refinement.documentId,
        layerId: refinement.layerId,
        finish: finishRefinement
      };
      return true;
    }
    faceWarpGestureRef.current = null;
    endDocumentTransaction();
    return true;
  };

  const cancelFaceWarpGesture = (pointerId: number) => {
    const gesture = faceWarpGestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId) return false;
    engineRef.current?.setFaceWarpInteractionMode(null);
    documentMutationController.change((document) => {
      const layer = findRasterLayer(document, document.activeLayerId);
      const instance = layer ? findFaceWarpModuleInstance(layer.adjustmentStack) : null;
      if (!layer?.adjustmentStack || !instance) return document;
      const settings = readFaceWarpNodeSettings(instance);
      const faces = settings.faces.map((face) => face.id === gesture.faceId
        ? { ...face, displacements: gesture.originalDisplacements }
        : face);
      return setRasterLayerAdjustmentStack(document, layer.id,
        setFaceWarpNodeSettings(layer.adjustmentStack, { ...settings, faces }));
    }, false);
    faceWarpGestureRef.current = null;
    documentMutationController.reset();
    return true;
  };

  const applyImageSizeSnapshot = (snapshot: ImageDocument) => {
    engineRef.current?.resizeDocumentSurface(snapshot);
    applyDocumentSnapshot(snapshot);
  };
  const commitImageSize = (request: ImageSizeRequest, reportError = true) => {
    finishOpenHistoryTransactions();
    const before = imageDocumentRef.current;
    if (!before) return;
    let gpuResize: ReturnType<DocumentRendererPort['resizeImagePixels']> | null = null;
    try {
      const plan = createResizePlan(before, request);
      const after = resizeImageDocumentSemantics(before, request);
      if (after === before) {
        editorDialogs.closeImageSize();
        return;
      }
      gpuResize = engineRef.current?.resizeImagePixels(
        before,
        plan,
        request.preserveDetailsNoiseReduction
      ) ?? null;
      applyImageSizeSnapshot(after);
      pushHistoryEntry({
        type: 'document.image-size',
        label: 'Image Size',
        documentMutation: true,
        undo: () => { gpuResize?.apply('before'); applyImageSizeSnapshot(before); },
        redo: () => { gpuResize?.apply('after'); applyImageSizeSnapshot(after); },
        dispose: () => gpuResize?.dispose()
      });
      editorDialogs.closeImageSize();
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
    } catch (reason) {
      if (gpuResize) {
        gpuResize.apply('before');
        applyImageSizeSnapshot(before);
      }
      if (!reportError) throw reason;
      setError(reason instanceof Error ? reason.message : 'The image could not be resized.');
    }
  };
  const commitDocumentGeometry = (request: DocumentGeometryRequest, reportError = true) => {
    finishOpenHistoryTransactions();
    const before = imageDocumentRef.current;
    if (!before) return;
    let gpuGeometry: ReturnType<DocumentRendererPort['applyDocumentGeometryPixels']> | null = null;
    try {
      const plan = createDocumentGeometryPlan(before, request);
      const matrix = plan.oldDocumentToNewDocument;
      if (plan.targetWidth === before.width && plan.targetHeight === before.height
        && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1
        && matrix.tx === 0 && matrix.ty === 0) {
        editorDialogs.closeCanvasSize();
        return;
      }
      const beforeSelection = editorSessionRef.current.selection;
      const after = projectDocumentGeometry(before, plan);
      const afterSelection = projectSelectionGeometry(beforeSelection, plan);
      gpuGeometry = engineRef.current?.applyDocumentGeometryPixels(before, plan) ?? null;
      const apply = (document: ImageDocument, selection: typeof beforeSelection) => {
        engineRef.current?.resizeDocumentSurface(document);
        applyDocumentSnapshot(document);
        setEditorSession((current) => ({ ...current, selection }));
      };
      apply(after, afterSelection);
      pushHistoryEntry({
        type: `document.${request.operation}`,
        label: request.operation === 'canvas-size' ? 'Canvas Size'
          : request.operation === 'crop' ? 'Crop'
            : request.operation === 'flip' ? 'Flip Canvas' : 'Image Rotation',
        documentMutation: true,
        undo: () => { gpuGeometry?.apply('before'); apply(before, beforeSelection); },
        redo: () => { gpuGeometry?.apply('after'); apply(after, afterSelection); },
        dispose: () => gpuGeometry?.dispose()
      });
      editorDialogs.closeCanvasSize();
      setZoomMode('fit');
      setView({ scale: 1, panX: 0, panY: 0 });
    } catch (reason) {
      if (gpuGeometry) {
        gpuGeometry.apply('before');
        engineRef.current?.resizeDocumentSurface(before);
        applyDocumentSnapshot(before);
      }
      if (!reportError) throw reason;
      setError(reason instanceof Error ? reason.message : 'Document geometry could not be changed.');
    }
  };
  const runImageSizeCommand = (request: ImageSizeRequest) => {
    if (!executeRegisteredCommand('document.resizeImage', request)) commitImageSize(request);
  };
  const runDocumentGeometryCommand = (request: DocumentGeometryRequest) => {
    if (!executeRegisteredCommand('document.applyGeometry', request)) commitDocumentGeometry(request);
  };
  const beginCrop = () => {
    const document = imageDocumentRef.current;
    if (!document) return;
    finishOpenHistoryTransactions();
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
      pendingTextDocumentRef.current = null;
      if (!pending) return;
      // React can render the previous external-store snapshot between the
      // edit and this frame, which temporarily rewinds imageDocumentRef. The
      // dedicated pending slot is the authoritative newest text document.
      imageDocumentRef.current = pending;
      engineRef.current?.setDocument(pending);
      setImageDocument(pending);
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
      if (entry.semanticReplacement) {
        commandService?.recordObservedCommand(
          'text.replaceRange',
          workspaceDocumentId as DocumentSessionId,
          entry.semanticReplacement,
          { layerId: entry.semanticReplacement.layerId }
        );
      }
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
    setError,
    getSnapContext: (movingBounds) => {
      const document = imageDocumentRef.current;
      const snap = editorSessionRef.current.snap;
      return {
        targets: document ? buildLayerSnapTargets(document, {
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
      commandService?.recordObservedCommand(
        'selection.applyShape',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { mode: parameters.mode, shape: parameters.shape,
          featherRadius: parameters.featherRadius, antiAlias: parameters.antiAlias }
      );
    },
    onMagicWandCommitted: (parameters) => {
      commandService?.recordObservedCommand(
        'selection.applyMagicWand',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId: parameters.layerId, mode: parameters.mode, point: parameters.point,
          options: parameters.options }
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
    onPreparationChange: setSmartSelectionPreparation
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

  const adjustmentTransactionController = useAdjustmentTransactionController({
    getDocumentId: () => imageDocumentRef.current?.id ?? null,
    getAdjustments: () => adjustmentsRef.current,
    getActiveTargetLayerId: () => {
      const document = imageDocumentRef.current;
      if (!document) return null;
      if (propertiesTarget.kind === 'document-processing') return null;
      if (propertiesTarget.kind === 'attached-processing') {
        return attachedAdjustmentOwnerId(
          propertiesTarget.layerId,
          propertiesTarget.adjustmentId
        );
      }
      const active = findDocumentLayer(document, document.activeLayerId);
      return active?.type === 'adjustment' || active?.type === 'raster'
        ? active.id
        : null;
    },
    getRenderer: () => engineRef.current,
    previewSnapshot: previewAdjustmentSnapshot,
    commitSnapshot: applyAdjustmentSnapshot,
    pushHistoryEntry,
    onCommitted: ({ before, after, targetLayerId, domain }) => {
      if (domain !== 'grade' || (targetLayerId && parseAttachedAdjustmentOwnerId(targetLayerId))) {
        return;
      }
      const values = changedBasicAdjustmentValues(before, after);
      if (!Object.keys(values).length) return;
      const target = targetLayerId
        ? { kind: 'layer' as const, layerId: targetLayerId }
        : { kind: 'document' as const };
      commandService?.recordObservedCommand(
        'grade.setBasic',
        workspaceDocumentId as DocumentSessionId,
        { target, values },
        { target, values, changed: true }
      );
    }
  });
  resetAdjustmentTransactionRef.current = () => {
    adjustmentTransactionController.reset();
    documentProjectionController.discardAdjustmentPreview();
  };

  const beginAdjustmentTransaction = adjustmentTransactionController.begin;
  const endAdjustmentTransaction = adjustmentTransactionController.end;
  const changeAdjustments = adjustmentTransactionController.change;
  const loadCubeAsset = async (file: File, purpose: 'photoshop-color-lookup' | 'grade-look') => {
    if (!/\.cube$/i.test(file.name)) throw new Error('Choose a 3D .cube LUT file.');
    if (file.size <= 0 || file.size > 32 * 1024 * 1024) {
      throw new Error('A .cube LUT must be between 1 byte and 32 MiB.');
    }
    const parsed = parseCubeLut(await file.text());
    const renderer = engineRef.current;
    const beforeDocument = imageDocumentRef.current;
    if (!renderer || !beforeDocument) throw new Error('Open a document before loading a LUT.');
    const beforeAdjustments = cloneAdjustments(adjustmentsRef.current);
    const assetId = `lut-${crypto.randomUUID()}` as DocumentAssetId;
    await renderer.loadLayerAssets([{ lutId: assetId, source: file }]);

    const targetLayerId = propertiesTarget.kind === 'document-processing'
      ? null
      : propertiesTarget.kind === 'attached-processing'
      ? attachedAdjustmentOwnerId(propertiesTarget.layerId, propertiesTarget.adjustmentId)
      : (() => {
          const active = findDocumentLayer(beforeDocument, beforeDocument.activeLayerId);
          return active?.type === 'adjustment' || active?.type === 'raster'
            ? active.id
            : null;
        })();
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
    const projection = projectAdjustmentSnapshot({
      snapshot: nextAdjustments,
      targetLayerId,
      document: withAsset,
      documentAdjustments: documentAdjustmentsRef.current
    });
    if (!projection.document) throw new Error(
      `The selected layer cannot own this ${purpose === 'grade-look' ? 'Grade Look' : 'Color Lookup'}.`
    );
    const afterDocument = projection.document;
    applyDocumentSnapshot(afterDocument);
    publishAdjustmentPresentation(nextAdjustments, 'grade');
    pushHistoryEntry({
      type: purpose === 'grade-look' ? 'adjustment.grade-look' : 'adjustment.color-lookup',
      label: purpose === 'grade-look' ? 'Load Grade Look' : 'Load Color Lookup',
      documentMutation: true,
      undo: () => {
        applyDocumentSnapshot(beforeDocument);
        publishAdjustmentPresentation(cloneAdjustments(beforeAdjustments), 'grade');
      },
      redo: () => {
        applyDocumentSnapshot(afterDocument);
        publishAdjustmentPresentation(cloneAdjustments(nextAdjustments), 'grade');
      }
    });
    setGradeStatus(`Loaded ${parsed.title || file.name} · ${parsed.size}³ LUT`);
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
  const copyCurrentGrade = async () => {
    try {
      const document = imageDocumentRef.current;
      const renderer = engineRef.current;
      const settings = cloneAdjustments(adjustmentsRef.current);
      const assetId = settings.gradeLook.assetId;
      let gradeLookAsset: NonNullable<typeof copiedGrade>['gradeLookAsset'];
      if (assetId && document && renderer) {
        const assets = await renderer.exportLayerAssets(document);
        const source = assets.find((asset) => 'lutId' in asset && asset.lutId === assetId);
        const metadata = document.assets.colorLookups.find((asset) => asset.id === assetId);
        if (source && 'lutId' in source && metadata) {
          gradeLookAsset = { assetId, name: metadata.name, source: source.source };
        }
      }
      copyLightTableGrade(settings, document?.name ?? 'Copied grade', gradeLookAsset);
      setGradeStatus('Grade copied');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not copy the Grade.');
    }
  };
  const pasteCurrentGrade = async () => {
    if (!copiedGrade) return;
    try {
      let settings = cloneAdjustments(copiedGrade.settings);
      const document = imageDocumentRef.current;
      const renderer = engineRef.current;
      const copiedAssetId = settings.gradeLook.assetId;
      if (copiedAssetId && document && renderer) {
        if (copiedGrade.gradeLookAsset?.assetId === copiedAssetId) {
          const source = copiedGrade.gradeLookAsset.source;
          const parsed = parseCubeLut(await source.text());
          const assetId = `lut-${crypto.randomUUID()}` as DocumentAssetId;
          await renderer.loadLayerAssets([{ lutId: assetId, source }]);
          applyDocumentSnapshot({
            ...document,
            assets: {
              ...document.assets,
              colorLookups: [...document.assets.colorLookups, {
                id: assetId,
                name: parsed.title || copiedGrade.gradeLookAsset.name,
                size: parsed.size,
                domainMin: parsed.domainMin,
                domainMax: parsed.domainMax,
                byteLength: source.size,
                revision: 0
              }]
            },
            revision: document.revision + 1,
            modifiedAt: Date.now()
          });
          settings = {
            ...settings,
            gradeLook: { ...settings.gradeLook, assetId }
          };
        } else if (!document.assets.colorLookups.some((asset) => asset.id === copiedAssetId)) {
          // A persisted text-only clipboard cannot safely refer to another
          // document's missing binary LUT. Paste the remaining Grade honestly.
          settings = {
            ...settings,
            gradeLook: { ...settings.gradeLook, assetId: null }
          };
        }
      }
      adjustmentCommands.pasteGrade(copiedGrade.name, settings);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not paste the Grade.');
    }
  };

  const applyUndoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    // Gesture checkpoints are durable history entries while the transform tool
    // immediately opens the next preview session. Close that preview before
    // navigating history so the renderer cannot keep a stale transform source.
    if (transformActiveRef.current()) commitTransformRef.current();
    return documentHistoryController.undo();
  }, [documentHistoryController, endAdjustmentTransaction, endDocumentTransaction]);

  const applyRedoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    if (transformActiveRef.current()) commitTransformRef.current();
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
      setPointColorPickerActive(false);
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
    sourceDecodeMode,
    documentCreationSettings
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
      initialAdjustments: initialRecipe?.settings ?? createDefaultAdjustments(), creationSettings: documentCreationSettings
    },
    getGroupVisibility: () => groupVisibilityRef.current,
    getPublicationPorts: getDocumentPublicationPorts,
    getScopeOptions: getDocumentOpenScopeOptions,
    publishHistogram: setHistogram,
    publishGpuMemory: setGpuMemoryBytes,
    publishTextRenderPresentation,
    publishCompositeRendered,
    publishInitialThumbnail: publishDocumentThumbnail,
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
    selectionOverlayVisible: editorSession.activeTool !== 'view',
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
    engineRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    if (!gradeStatus) return;
    const timeout = window.setTimeout(() => setGradeStatus(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [gradeStatus]);

  useEffect(() => {
    if (!error) return;
    // Status-bar errors are transient interaction feedback. Diagnostics keeps
    // the full record, so the workspace can recover visually without hiding
    // information needed for debugging a real engine or document failure.
    const timeout = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const selectAllContentOwner = selectionSessionController.selectAll;
  const clearCurrentSelectionOwner = selectionSessionController.clear;
  const invertCurrentSelectionOwner = selectionSessionController.invert;
  const selectAllContent = () => {
    if (!executeRegisteredCommand('selection.modify', {
      kind: 'modify', operation: 'all'
    })) selectAllContentOwner();
  };
  const clearCurrentSelection = () => {
    if (!executeRegisteredCommand('selection.modify', {
      kind: 'modify', operation: 'clear'
    })) clearCurrentSelectionOwner();
  };
  const invertCurrentSelection = () => {
    if (!executeRegisteredCommand('selection.modify', {
      kind: 'modify', operation: 'invert'
    })) invertCurrentSelectionOwner();
  };
  const featherCurrentSelection = (radius: number) => {
    if (!executeRegisteredCommand('selection.modify', {
      kind: 'modify', operation: 'feather', radius
    })) void selectionSessionController.feather(radius);
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
      preferredTools: preferredToolByShortcutRef.current,
      hasActiveLayer: Boolean(imageDocumentRef.current?.activeLayerId),
      hasSelection: editorSession.selection.length > 0,
      hasSelectionClipboard: selectionClipboardAvailable,
      transforming: transformActiveRef.current(),
      editingBlocked: historySnapshot.busy
    }),
    commands: {
      openFile: () => { finishTextEditingRef.current(); void chooseLocalFile('automatic'); },
      saveFile: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleSave(); },
      quickExportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPng(); },
      openImageSize: editorDialogs.openImageSize,
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
      nudge: (x, y) => {
        if (transformActiveRef.current()) nudgeTransformRef.current(x, y);
        else selectionSessionController.translate(x, y);
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
      cancelActiveOperation: () => {
        if (pendingFaceWarpDetectionForActiveLayer) {
          cancelPendingFaceWarpDetection();
          return;
        }
        if (toolOptionsMenu) {
          setToolOptionsMenu(null);
          return;
        }
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
    setError,
    onFillCommitted: (parameters, result) => commandService?.recordObservedCommand(
      'raster.fill',
      workspaceDocumentId as DocumentSessionId,
      parameters,
      result
    )
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
    setError,
    onGradientCommitted: (parameters, result) => commandService?.recordObservedCommand(
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
    engineRef.current?.setGlobalGradeStrength(next);
  }, []);
  const beginGlobalGradeStrength = React.useCallback(() => {
    globalGradeStrengthGestureRef.current = globalGradeStrengthRef.current;
  }, []);
  const endGlobalGradeStrength = React.useCallback(() => {
    const before = globalGradeStrengthGestureRef.current;
    globalGradeStrengthGestureRef.current = null;
    const after = globalGradeStrengthRef.current;
    if (before === null || before === after) return;
    pushHistoryEntry({
      type: 'adjustment.global-grade-strength',
      label: 'Global Grade Strength',
      undo: () => publishGlobalGradeStrength(before),
      redo: () => publishGlobalGradeStrength(after)
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
    apply(afterAdjustments, 100);
    if (JSON.stringify(beforeAdjustments) === JSON.stringify(afterAdjustments)
      && beforeStrength === 100) return;
    pushHistoryEntry({
      type: 'adjustment.global-grade-reset',
      label: 'Reset Global Grade',
      undo: () => apply(beforeAdjustments, beforeStrength),
      redo: () => apply(afterAdjustments, 100)
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
    apply(afterAdjustments);
    pushHistoryEntry({
      type: 'adjustment.global-lens-fx-reset',
      label: 'Reset Global Lens FX',
      undo: () => apply(beforeAdjustments),
      redo: () => apply(afterAdjustments)
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
    applyDocumentSnapshot,
    pushHistoryEntry,
    setError,
    onStrokeCommitted: ({ target, brush, operator, samples }) => {
      commandService?.recordObservedCommand(
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
  const sampledBrushSourceController = useMemo(
    () => new SampledBrushSourceController(),
    [workspaceDocumentId]
  );

  const warpSessionController = useWarpSessionController({
    getDocument: () => imageDocumentRef.current,
    applyDocumentSnapshot,
    pushHistoryEntry,
    setError,
    createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`,
    setInteractionActive: (active) => engineRef.current?.setWarpInteractionActive(active),
    onStrokeCommitted: (layerId, stroke) => commandService?.recordObservedCommand(
      'warp.applyStroke',
      workspaceDocumentId as DocumentSessionId,
      semanticWarpStrokeFromCommitted(layerId, stroke),
      { layerId, strokeId: stroke.id, sampleCount: stroke.samples.length }
    )
  });

  const vectorToolSessionController = useVectorToolSessionController({
    document: imageDocument,
    selection: editorSession.vectorSelection,
    activeTool: editorSession.activeTool,
    foregroundColor: editorSession.brush.color,
    gradient: gradientToolSettings,
    shape: editorSession.shape,
    style: editorSession.vectorStyle,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection: (vectorSelection) => {
      setEditorSession((current) => ({ ...current, vectorSelection }));
    },
    requestGradientColorEditor: (endpoint) => {
      setGradientEditorRequest((current) => ({
        revision: (current?.revision ?? 0) + 1,
        endpoint
      }));
    },
    rasterizeShape: (transaction) => rasterizeShapeRef.current(transaction),
    onLiveShapeCommitted: ({ layerId, element, existingLayerId, layerName }) => {
      const parameters = observedLiveShapeCreateCommand(element, existingLayerId, layerName);
      if (!parameters) return;
      commandService?.recordObservedCommand(
        'vector.create',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId, elementId: element.id }
      );
    },
    onPenPathCommitted: ({ operation, layerId, layerName, path, existingLayerId }) => {
      const parameters = operation === 'create'
        ? observedVectorPathCreateCommand(path, existingLayerId, layerName)
        : observedVectorPathUpdateCommand(path, layerId);
      commandService?.recordObservedCommand(
        operation === 'create' ? 'vector.create' : 'vector.update',
        workspaceDocumentId as DocumentSessionId,
        parameters,
        { layerId, elementId: path.id }
      );
    },
    onPathMutationCommitted: ({ layerId, pathId, path }) => {
      commandService?.recordObservedCommand(
        path ? 'vector.update' : 'vector.remove',
        workspaceDocumentId as DocumentSessionId,
        path ? observedVectorPathUpdateCommand(path, layerId) : { layerId, elementId: pathId },
        { layerId, elementId: pathId }
      );
    },
    onGradientCommitted: ({ operation, layerId, layerName, layerRole, layerOpacity,
      layerBlendMode, element }) => {
      const parameters = operation === 'create'
        ? observedLiveShapeCreateCommand(element, undefined, layerName, {
            role: layerRole,
            opacity: layerOpacity,
            blendMode: layerBlendMode
          })
        : observedLiveShapeUpdateCommand(element, layerId);
      if (!parameters) return;
      commandService?.recordObservedCommand(
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
      gradient: { ...(current.gradient ?? fallbackGradientSettingsRef.current), ...change }
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
    documentRef: imageDocumentRef,
    registry: textFontRegistry,
    substitutionFamilies: DEFAULT_TEXT_SUBSTITUTION_FAMILIES,
    applyDocument: applyDocumentSnapshot,
    recordHistory: pushDocumentHistory,
    closeRecovery: editorDialogs.closeMissingFontRecovery,
    requestRecovery: editorDialogs.requestMissingFontRecovery,
    beginEditing: (layerId, offset, affinity) => {
      layerPanelController.select(layerId);
      activatePersistentTool('text-point');
      textEditingController.begin(layerId, offset, affinity ?? 'downstream');
      showProperties({ kind: 'layer', layerId });
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
    const candidates = walkLayerTree(document.layers)
      .map(({ node }) => node)
      .filter((node) => node.type === 'text'
        && node.visible
        && node.opacity > 0
        && node.text.source.kind === 'flow'
        && (mode === 'any' || node.text.source.layout.mode === mode));
    const active = candidates.find(({ id }) => id === document.activeLayerId);
    const ordered = [
      ...(active ? [active] : []),
      ...candidates.filter(({ id }) => id !== active?.id).reverse()
    ];
    for (const layer of ordered) {
      const layout = engineRef.current?.textEditingLayout(layer.id);
      if (!layout || layer.type !== 'text' || layer.text.source.kind !== 'flow') continue;
      const hit = hitTestTextEditingLayout(layout, point, 8 / Math.max(activeScale, 1e-6));
      if (!hit) continue;
      pointTextController.cancel();
      paragraphTextController.cancel();
      selectLayerRef.current(layer.id);
      const previous = textEditingController.getSnapshot();
      const continuing = previous.status === 'editing' && previous.layerId === layer.id;
      const editingStarted = continuing
        ? true
        : requestExistingFlowTextEditing(layer.id, hit.offset, hit.affinity);
      if (editingStarted && pointerId !== undefined) {
        const granularity: TextSelectionGranularity = clickCount >= 5 ? 'story'
          : clickCount === 4 ? 'paragraph'
            : clickCount === 3 ? 'line'
              : clickCount === 2 ? 'word'
                : 'character';
        const currentLayout = layout.layout;
        const source = layer.text.source;
        const clicked = textSelectionForGranularity(
          source.text,
          currentLayout,
          hit.offset,
          granularity
        );
        const initial = extend && continuing
          ? { anchor: previous.selection.anchor, focus: hit.offset }
          : clicked;
        textEditingController.setSelection(initial, { transient: true });
        textSelectionGestureController.begin(
          pointerId,
          layer.id,
          extend && continuing
            ? { anchor: previous.selection.anchor, focus: previous.selection.anchor }
            : clicked,
          extend && continuing ? 'character' : granularity
        );
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
    if (commandService) {
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
    }
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
    if (beginEditing && after.activeLayerId) {
      textEditingController.begin(after.activeLayerId);
      textEditingController.selectAll();
    }
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
    origin: { x: number; y: number },
    clickCount = 1,
    extend = false
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
    if (beginExistingFlowTextEditing(origin, 'any', pointerId, clickCount, extend)) return true;
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
    if (commandService) {
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
    }
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

  const pickTransformAtPoint = (point: { x: number; y: number }) => {
    if (historySnapshot.busy || !editorSession.transformAutoSelectLayer || !imageDocument) return;
    const renderer = engineRef.current;
    const sourceDocument = imageDocument;
    if (!renderer) return;
    const revision = ++transformPickRevisionRef.current;
    void pickTransformLayer(sourceDocument, point, renderer).then((pick) => {
      if (revision !== transformPickRevisionRef.current
        || !pick || imageDocumentRef.current !== sourceDocument) return;
      if (sourceDocument.activeLayerId !== pick.layerId) commitTransformRef.current();
      selectLayerRef.current(pick.layerId);
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
      beginPoint: (pointerId, point, temporaryMove, clickCount, extend) => (temporaryMove
        && textLayerMoveGestureController.begin(pointerId, point)) || pathTextHandleController.begin(
          pointerId, point, 8 / Math.max(activeScale, 1e-6)
        ) || beginExistingFlowTextEditing(point, 'any', pointerId, clickCount, extend),
      beginParagraph: (pointerId, point, temporaryMove, clickCount, extend) => (temporaryMove
        && textLayerMoveGestureController.begin(pointerId, point)) || pathTextHandleController.begin(
          pointerId, point, 8 / Math.max(activeScale, 1e-6)
        ) || beginParagraphTextCreation(pointerId, point, clickCount, extend),
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
      owns: (pointerId) => faceWarpGestureRef.current?.pointerId === pointerId,
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
    },
    getGlobalGradeStrength: () => globalGradeStrengthRef.current,
    publishGlobalGradeStrength
  });
  const backgroundRemovalTaskIdRef = useRef<string | null>(null);
  const startBackgroundRemovalTask = useCallback((layerId: LayerId, mode: BackgroundRemovalMaskMode) => {
    void executeRegisteredCommand('layer.removeBackground', { layerId, mode })?.then((result) => {
      if (result.status === 'accepted') backgroundRemovalTaskIdRef.current = result.taskId;
    });
  }, [executeRegisteredCommand]);
  const cancelBackgroundRemovalTask = useCallback(() => {
    const taskId = backgroundRemovalTaskIdRef.current;
    if (!taskId) return false;
    backgroundRemovalTaskIdRef.current = null;
    void executeRegisteredCommand('task.cancel', { taskId });
    return true;
  }, [executeRegisteredCommand]);
  const backgroundRemovalController = useBackgroundRemovalController({
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    applyMask: layerDocumentCommands.applyBackgroundRemovalMask,
    setStatus: setGradeStatus,
    setError,
    startTask: startBackgroundRemovalTask,
    cancelTask: cancelBackgroundRemovalTask
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
  const mergeSelectedLayers = layerDocumentCommands.mergeSelectedLayers;
  const mergeActiveLayerDown = layerDocumentCommands.mergeActiveLayerDown;
  const mergeLayersCommand = useCallback((layerIds: LayerId[]) => {
    if (!executeRegisteredCommand('layer.merge', { layerIds })) {
      return mergeSelectedLayers(layerIds);
    }
    return true;
  }, [executeRegisteredCommand, mergeSelectedLayers]);
  const mergeSelectionOrActiveDown = useCallback(() => {
    const selectedLayerIds = selectedLayerIdsRef.current;
    if (selectedLayerIds.length > 1) return mergeLayersCommand(selectedLayerIds);
    const document = imageDocumentRef.current;
    const activeLayerId = document?.activeLayerId;
    if (!document || !activeLayerId) return mergeActiveLayerDown();
    const siblings = siblingLayers(document, activeLayerId);
    const index = siblings.findIndex(({ id }) => id === activeLayerId);
    return index > 0
      ? mergeLayersCommand([siblings[index - 1]!.id, activeLayerId])
      : mergeActiveLayerDown();
  }, [mergeActiveLayerDown, mergeLayersCommand]);
  const flattenGroupCommand = useCallback((groupId: LayerId) => {
    if (!executeRegisteredCommand('layer.flattenGroup', { groupId })) {
      return layerDocumentCommands.flatten({ kind: 'group', groupId });
    }
    return true;
  }, [executeRegisteredCommand, layerDocumentCommands]);
  const flattenImageCommand = useCallback(() => {
    if (!executeRegisteredCommand('document.flattenImage', {})) {
      return layerDocumentCommands.flatten({ kind: 'image' });
    }
    return true;
  }, [executeRegisteredCommand, layerDocumentCommands]);
  const handleLayerSelectionChange = useCallback((layerIds: LayerId[]) => {
    selectedLayerIdsRef.current = layerIds;
    setSelectedLayerIds(layerIds);
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
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (layerId) void executeRegisteredCommand('layer.copyToNewLayer', { layerId });
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
    applyDocumentSnapshot,
    pushDocumentHistory
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
    createCurvesAdjustmentLayer: layerDocumentCommands.createCurvesAdjustmentLayer,
    createLensFxLayer: layerDocumentCommands.createLensFxLayer,
    createAdjustmentLayerOfKind: layerDocumentCommands.createAdjustmentLayerOfKind,
    createAttachedAdjustment: layerDocumentCommands.createAttachedAdjustment,
    addActiveLayerMask: () => layerDocumentCommands.addActiveLayerMask(
      editorSession.selection.length > 0
    ),
    duplicateActiveLayer,
    rasterizeActiveTextLayer,
    loadLayerMaskSelection: selectionSessionController.selectLayerMask,
    loadLayerTransparencySelection: selectionSessionController.selectLayerTransparency,
    mergeActiveLayerDown: mergeSelectionOrActiveDown,
    mergeSelectedLayers: mergeLayersCommand,
    flattenGroup: flattenGroupCommand,
    flattenImage: flattenImageCommand,
    editStyles: openLayerStyleEditor,
    finishStyleEditing: layerStyleEditor.commit,
    finishProcessingEditing: () => {
      endAdjustmentTransaction();
      endDocumentTransaction();
    },
    prepareActiveLayerChange: (layerId) => {
      if (textEditingController.getSnapshot().layerId !== layerId) {
        textEditingController.finish();
      }
      vectorToolSessionController.prepareActiveLayerChange(layerId);
    },
    finishTextEditing: () => { textEditingController.finish(); }
  });
  applyCurvesRef.current = () => {
    const document = imageDocumentRef.current;
    const active = document ? findDocumentLayer(document, document.activeLayerId) : null;
    if (active?.type === 'raster' && !active.locks.all) {
      layerPanelController.createLocalProcessing(active.id, 'curves');
      showProperties({ kind: 'processing', layerId: active.id, owner: 'curves' });
      return;
    }
    if (layerPanelController.createCurvesAdjustmentLayer()) {
      requestAnimationFrame(() => {
        const layerId = imageDocumentRef.current?.activeLayerId;
        if (layerId) showProperties({ kind: 'layer', layerId });
      });
    }
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
      const adjustmentId = layerPanelController.createAttachedAdjustment(command.layerId, command.kind);
      if (!adjustmentId) return null;
      showProperties({ kind: 'attached-processing', layerId: command.layerId, adjustmentId });
      return { kind: command.kind, placement: command.placement,
        layerId: command.layerId, adjustmentId };
    }
    if (!layerPanelController.createAdjustmentLayerOfKind(command.kind, command.aboveLayerId)) {
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
    if (!executeRegisteredCommand('adjustment.create', command)) {
      executeAdjustmentCreationRef.current(command);
    }
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
    if (transformActiveRef.current()) cancelTransformRef.current();
    if (target === 'pixel-selection') {
      fillCommandController.clearSelection();
      return;
    }

    const layerIds = selectedLayerIdsRef.current.length > 0
      ? selectedLayerIdsRef.current
      : document?.activeLayerId
        ? [document.activeLayerId]
        : [];
    if (layerIds.length > 0
      && !executeRegisteredCommand('layer.delete', { layerIds })) {
      layerPanelController.deleteSelection(layerIds);
    }
  };
  useEffect(() => {
    if (!commandPorts) return;
    return commandPorts.register(workspaceDocumentId as DocumentSessionId, {
      resizeImage: (request) => commitImageSize(request, false),
      applyDocumentGeometry: (request) => commitDocumentGeometry(request, false),
      setZoom: (viewport) => {
        if (viewport.zoomMode === 'fit') applyFitZoom();
        else if (viewport.zoomMode === '100') applyActualZoom();
        else applyExactZoom(viewport.scale * 100);
      },
      createRasterLayer: layerPanelController.createRasterLayer,
      placeArtifact: layerDocumentCommands.placeImageArtifact,
      renameLayer: layerPanelController.rename,
      setLayerVisibility: layerPanelController.setVisibility,
      setLayerFillOpacity: layerPanelController.setFillOpacity,
      setLayerStyleEnabled: layerPanelController.setStyleStackEnabled,
      setLayerEffectEnabled: (layerId, effectId, enabled) => executeSemanticLayerStyleCommand(
        { kind: 'toggle', layerId, effectId, enabled }, { getDocument: () => imageDocumentRef.current,
          applyDocument: applyDocumentSnapshot, recordHistory: pushDocumentHistory }),
      executeTextCommand: async (command) => {
        const result = await executeSemanticTextCommand(command, {
          fontRegistry: textFontRegistry, getDocument: () => imageDocumentRef.current,
          getTextSettings: () => editorSessionRef.current.text, getForegroundColor: () => editorSessionRef.current.brush.color,
          applyDocument: applyDocumentSnapshot, recordHistory: pushDocumentHistory
        });
        if (!result) return null;
        await waitForExactCommandRender(engineRef.current);
        return result;
      },
      executeVectorCommand: (command) => executeSemanticVectorCommand(command, { getDocument: () => imageDocumentRef.current, applyDocument: applyDocumentSnapshot, recordHistory: pushDocumentHistory }),
      executeWarpStrokeCommand: (command) => executeSemanticWarpStrokeCommand(command, {
        getDocument: () => imageDocumentRef.current,
        applyDocument: applyDocumentSnapshot,
        recordHistory: pushDocumentHistory,
        createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`
      }),
      executeFillCommand: (command) => fillCommandController.apply(command),
      executeRasterGradientCommand: (command) => rasterGradientController.apply(command),
      executeLayerStyleCommand: (command) => executeSemanticLayerStyleCommand(command, { getDocument: () => imageDocumentRef.current, applyDocument: applyDocumentSnapshot, recordHistory: pushDocumentHistory }),
      executeFaceWarpCommand: (command) => executeSemanticFaceWarpCommand(command, {
        getDocument: () => imageDocumentRef.current,
        applyDocument: applyDocumentSnapshot,
        recordHistory: pushDocumentHistory
      }),
      executeLayerCommand: (command) => {
        if (command.kind === 'duplicate') {
          const layerId = layerDocumentCommands.duplicateLayer(command.layerId);
          return layerId ? { sourceLayerId: command.layerId, layerId } : null;
        }
        if (command.kind === 'copy-to-new-layer') {
          const layerId = layerDocumentCommands.layerViaCopy(
            command.layerId,
            editorSessionRef.current.selection
          );
          return layerId ? { sourceLayerId: command.layerId, layerId,
            scope: editorSessionRef.current.selection.length ? 'selection' : 'layer' } : null;
        }
        if (command.kind === 'delete') {
          layerPanelController.deleteSelection([...command.layerIds]);
          return { layerIds: command.layerIds };
        }
        if (command.kind === 'move') {
          layerPanelController.move(command.layerId, command.direction);
          return { layerId: command.layerId, direction: command.direction };
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
          const before = imageDocumentRef.current;
          if (!before) return null;
          const after = setLayerTransform(before, command.layerId, command.transform);
          if (after === before) return null;
          applyDocumentSnapshot(after);
          pushDocumentHistory(before, after);
          return { layerId: command.layerId, transform: command.transform };
        }
        if (command.kind === 'set-mask') {
          if (command.operation === 'add') {
            return layerDocumentCommands.addLayerMask(
              command.layerId,
              command.source === 'selection'
            ) ? { layerId: command.layerId, operation: command.operation,
              source: command.source ?? 'reveal-all' } : null;
          }
          const before = imageDocumentRef.current;
          if (!before) return null;
          const after = command.operation === 'remove'
            ? removeLayerMask(before, command.layerId)
            : command.operation === 'set-enabled'
              ? setLayerMaskEnabled(before, command.layerId, command.enabled!)
              : setLayerMaskLinked(before, command.layerId, command.linked!);
          if (after === before) return null;
          applyDocumentSnapshot(after);
          pushDocumentHistory(before, after);
          return { layerId: command.layerId, operation: command.operation,
            ...(command.operation === 'set-enabled' ? { enabled: command.enabled } : {}),
            ...(command.operation === 'set-linked' ? { linked: command.linked } : {}) };
        }
        layerPanelController.setLock([...command.layerIds], command.lock, command.locked);
        return { layerIds: command.layerIds, lock: command.lock, locked: command.locked };
      },
      executeSelectionCommand: async (command) => {
        if (command.kind === 'modify') {
          const applied = command.operation === 'feather'
            ? await selectionSessionController.feather(command.radius!)
            : await selectionSessionController.applyState(command.operation);
          return applied ? { operation: command.operation,
            ...(command.operation === 'feather' ? { radius: command.radius } : {}) } : null;
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
      executeBasicAdjustmentCommand: (command) => {
        adjustmentTransactionController.end();
        const document = imageDocumentRef.current;
        if (!document) return null;
        const resolved = resolveBasicAdjustmentTarget(
          document,
          documentAdjustmentsRef.current,
          command.target
        );
        if ('message' in resolved) throw new Error(resolved.message);
        const before = cloneAdjustments(resolved.adjustments);
        const after = cloneAdjustments(before);
        Object.entries(command.values).forEach(([key, value]) => {
          (after as unknown as Record<string, unknown>)[key] = value;
        });
        const changed = Object.keys(command.values).some((key) => (
          (before as unknown as Record<string, unknown>)[key]
            !== (after as unknown as Record<string, unknown>)[key]
        ));
        if (!changed) return { target: command.target, values: command.values, changed: false };
        const currentPropertiesTarget = propertiesTargetRef.current;
        const presented = command.target.kind === 'document'
          ? currentPropertiesTarget.kind === 'document-processing'
            && currentPropertiesTarget.owner === 'grade'
          : 'layerId' in currentPropertiesTarget
            && currentPropertiesTarget.layerId === command.target.layerId
            && propertiesInspectorView(document, currentPropertiesTarget) === 'grade';
        const publish = (snapshot: BasicAdjustments) => {
          documentProjectionController.applyAdjustmentSnapshot(
            snapshot,
            resolved.targetLayerId,
            'grade',
            presented
          );
        };
        publish(after);
        pushHistoryEntry({
          type: 'adjustment.basic',
          label: 'Set Basic Grade',
          documentMutation: true,
          undo: () => publish(before),
          redo: () => publish(after)
        });
        return { target: command.target, values: command.values, changed: true };
      },
      executeFixedTransform: (command) => applyFixedTransformRef.current(command.operation),
      executeAdjustmentCreation: (command) => executeAdjustmentCreationRef.current(command),
      executeRasterInvert: (command) => layerDocumentCommands.invertLayerColors(
        command.layerId, command.channel
      ) ? command : null,
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
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        return await layerDocumentCommands.rasterizeTextLayerWhenReady(command.layerId)
          ? { layerId: command.layerId, outputType: 'raster' as const }
          : null;
      },
      executeLayerMerge: async (command) => {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (!await layerDocumentCommands.mergeLayersWhenReady([...command.layerIds])) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId ? { layerIds: command.layerIds, outputLayerId } : null;
      },
      executeFlattenGroup: async (command) => {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (!await layerDocumentCommands.flattenWhenReady({
          kind: 'group', groupId: command.groupId
        })) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId ? { groupId: command.groupId, outputLayerId } : null;
      },
      executeFlattenImage: async () => {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (!await layerDocumentCommands.flattenWhenReady({ kind: 'image' })) return null;
        const outputLayerId = imageDocumentRef.current?.activeLayerId;
        return outputLayerId ? { outputLayerId } : null;
      },
      executeBackgroundRemoval: async (command, signal, report) => {
        try {
          return await backgroundRemovalController.removeBackgroundFromLayer(
            command.layerId,
            command.mode,
            { signal, onProgress: (progress) => report(
              Math.max(0, Math.min(1, (progress.percent ?? 0) / 100)), progress.message
            ) }
          );
        } finally {
          backgroundRemovalTaskIdRef.current = null;
        }
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
          fontRegistry: textFontRegistry, getDocument: () => imageDocumentRef.current,
          getTextSettings: () => editorSessionRef.current.text, getForegroundColor: () => editorSessionRef.current.brush.color,
          publish: applyDocumentSnapshot, record: (before, after, label) => pushHistoryEntry({
            type: 'automation.batch', label, undo: () => applyDocumentSnapshot(before), redo: () => applyDocumentSnapshot(after) })
        }, signal, report);
        await waitForExactCommandRender(engineRef.current, signal); return result;
      },
      exportNativeArtifact: () => exportNativeArtifactRef.current(),
      exportPngArtifact: () => exportPngArtifactRef.current(),
      exportPreviewArtifact: async (maxEdge, encoding, region) => {
        const source = await exportPreviewArtifactRef.current(maxEdge, region);
        return encodeAgentPreview(
          source, region ? 'document-region-preview' : 'document-preview', encoding
        );
      },
      exportLayerPreviewArtifact: async (layerId, channel, maxEdge, encoding) => {
        const preview = await engineRef.current?.exportLayerThumbnail(
          layerId, channel === 'mask', maxEdge, maxEdge
        );
        if (!preview) throw new Error(`Layer ${layerId} has no renderable ${channel} content.`);
        return { file: await encodeAgentPreview(preview.blob, `layer-${channel}`, encoding),
          width: preview.width, height: preview.height, sourceToOutput: preview.sourceToOutput };
      },
      exportPsdArtifact: () => exportPsdArtifactRef.current(),
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
      resetRenderTelemetry: () => engineRef.current?.resetRenderTelemetry()
    });
  }, [applyActualZoom, applyExactZoom, applyFitZoom, applyRedoEditor, applyUndoEditor,
    commandPorts, layerDocumentCommands, layerPanelController, workspaceDocumentId]);
  const commandLayerPanelController = useMemo(() => ({
    ...layerPanelController,
    createRasterLayer: () => { if (!executeRegisteredCommand('layer.createRaster', {})) layerPanelController.createRasterLayer(); },
    rename: (layerId: LayerId, name: string) => { if (!executeRegisteredCommand('layer.rename', { layerId, name })) layerPanelController.rename(layerId, name); },
    setVisibility: (layerIds: LayerId[], visible: boolean) => { if (!executeRegisteredCommand('layer.setVisibility', { layerIds, visible })) layerPanelController.setVisibility(layerIds, visible); },
    duplicateActive: () => {
      const layerId = imageDocumentRef.current?.activeLayerId;
      if (!layerId || !executeRegisteredCommand('layer.duplicate', { layerId })) {
        layerPanelController.duplicateActive();
      }
    },
    deleteSelection: (layerIds: LayerId[]) => {
      if (!executeRegisteredCommand('layer.delete', { layerIds })) layerPanelController.deleteSelection(layerIds);
    },
    move: (layerId: LayerId, direction: 'up' | 'down') => {
      if (!executeRegisteredCommand('layer.move', { layerId, direction })) layerPanelController.move(layerId, direction);
    },
    moveActive: (direction: 'up' | 'down') => {
      const layerId = imageDocumentRef.current?.activeLayerId;
      if (!layerId || !executeRegisteredCommand('layer.move', { layerId, direction })) {
        layerPanelController.moveActive(direction);
      }
    },
    setBlendMode: (layerId: LayerId, blendMode: Parameters<typeof layerPanelController.setBlendMode>[1]) => {
      if (!executeRegisteredCommand('layer.setBlendMode', { layerId, blendMode })) layerPanelController.setBlendMode(layerId, blendMode);
    },
    setClipping: (layerId: LayerId, clipping: boolean) => {
      if (!executeRegisteredCommand('layer.setClipping', { layerId, clipping })) layerPanelController.setClipping(layerId, clipping);
    },
    addMask: () => {
      const layerId = imageDocumentRef.current?.activeLayerId;
      const source = editorSessionRef.current.selection.length > 0 ? 'selection' : 'reveal-all';
      const execution = layerId
        ? executeRegisteredCommand('layer.setMask', { layerId, operation: 'add', source })
        : null;
      if (!execution) {
        layerPanelController.addMask();
      } else {
        void execution.then((result) => {
          if (result.status === 'completed') layerPanelController.changeChannel('mask');
        });
      }
    },
    toggleMask: () => {
      const document = imageDocumentRef.current;
      const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
      if (!layer?.mask || !executeRegisteredCommand('layer.setMask', {
        layerId: layer.id, operation: 'set-enabled', enabled: !layer.mask.enabled
      })) layerPanelController.toggleMask();
    },
    setMaskLinked: (layerId: LayerId, linked: boolean) => {
      if (!executeRegisteredCommand('layer.setMask', { layerId, operation: 'set-linked', linked })) {
        layerPanelController.setMaskLinked(layerId, linked);
      }
    },
    removeMask: (requestedLayerId?: LayerId) => {
      const layerId = requestedLayerId ?? imageDocumentRef.current?.activeLayerId;
      const execution = layerId
        ? executeRegisteredCommand('layer.setMask', { layerId, operation: 'remove' })
        : null;
      if (!execution) {
        layerPanelController.removeMask(requestedLayerId);
      } else {
        void execution.then((result) => {
          if (result.status === 'completed') layerPanelController.changeChannel('pixels');
        });
      }
    },
    setLock: (layerIds: LayerId[], lock: Parameters<typeof layerPanelController.setLock>[1], locked: boolean) => {
      if (!executeRegisteredCommand('layer.setLock', { layerIds, lock, locked })) layerPanelController.setLock(layerIds, lock, locked);
    },
    setStyleEnabled: (layerId: LayerId, effectId: LayerStyleId, enabled: boolean) => {
      if (!executeRegisteredCommand('layer.effect.setEnabled', { layerId, effectId, enabled })) layerPanelController.setStyleEnabled(layerId, effectId, enabled);
    },
    setStyleStackEnabled: (layerId: LayerId, enabled: boolean) => {
      if (!executeRegisteredCommand('layer.style.setEnabled', { layerId, enabled })) layerPanelController.setStyleStackEnabled(layerId, enabled);
    }
  }), [executeRegisteredCommand, layerPanelController]);
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
    const before = imageDocumentRef.current;
    if (!before) return;
    const after = replaceDocumentGuides(before, guides);
    if (after === before) return;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
  }, [applyDocumentSnapshot, pushDocumentHistory]);
  const clearGuides = useCallback(() => {
    const before = imageDocumentRef.current;
    if (!before) return;
    const after = clearDocumentGuides(before);
    if (after === before) return;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
  }, [applyDocumentSnapshot, pushDocumentHistory]);

  const transformSession = useTransformSessionController({
    activeTool: editorSession.activeTool,
    activeDocument: imageDocument,
    activeLayerId: imageDocument?.activeLayerId ?? null,
    activeChannel: editorSession.activeChannel,
    selectedLayerIds,
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
    setError,
    setStatus: setGradeStatus,
    transformFrameMode: toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document',
    onLayerTransformCommitted: (layerId, transform) => {
      if (!fixedTransformCommandRunningRef.current) commandService?.recordObservedCommand(
        'layer.setTransform',
        workspaceDocumentId as DocumentSessionId,
        { layerId, transform },
        { layerId, transform }
      );
    }
  });
  const transformState = transformSession.state;
  const activeTransformFrame = useMemo(() => transformState
    ? transformSession.frameOverride ?? transformSessionFrame(
        transformState,
        toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document'
      )
    : null, [toolPreferences?.preserveTransformLocalAxes, transformSession.frameOverride, transformState]);
  const transformFrame = useMemo(() => transformState
    ? buildTransformEditingFrame(transformState, activeScale, activeTransformFrame ?? undefined)
    : null, [activeScale, activeTransformFrame, transformState]);
  const transformSnapTargets = useMemo(() => imageDocument && transformState
    ? buildLayerSnapTargets(imageDocument, {
        excludedLayerIds: new Set([
          transformState.layerId,
          ...selectedLayerIdsRef.current
        ]),
        includeCanvas: editorSession.snap.targets.documentBounds,
        includeLayers: editorSession.snap.targets.layers,
        includeGuides: editorSession.snap.targets.guides,
        includeGrid: editorSession.snap.targets.grid && editorSession.snap.gridVisible,
        gridSpacing: editorSession.snap.gridSpacing / Math.max(1, editorSession.snap.gridSubdivisions),
        gridOriginX: editorSession.snap.gridOriginX,
        gridOriginY: editorSession.snap.gridOriginY,
        movingBounds: transformFrame?.bounds
      })
    : [], [editorSession.snap, imageDocument, transformFrame, transformState]);
  useEffect(() => {
    engineRef.current?.setTransformEditingFrame(transformFrame);
  }, [transformFrame]);
  useEffect(() => {
    engineRef.current?.setSmartGuideEditingFrame(
      editorSession.snap.extrasVisible !== false
        && editorSession.snap.smartGuidesVisible
        && (transformFrame || selectionSnapFeedback.bounds)
        ? buildSmartGuideEditingFrame(
            transformFrame ? transformSnapMatches : selectionSnapFeedback.matches,
            transformFrame?.bounds ?? selectionSnapFeedback.bounds!,
            activeScale
          )
        : null
    );
  }, [activeScale, editorSession.snap.extrasVisible, editorSession.snap.smartGuidesVisible, selectionSnapFeedback, transformFrame, transformSnapMatches]);
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
    if (!transformState) setTransformSnapMatches([]);
  }, [transformState]);
  const updateTransformMatrix = transformSession.update;
  const updateTransformProjective = transformSession.updateProjective;
  commitTransformRef.current = transformSession.commit;
  cancelTransformRef.current = transformSession.cancel;
  resetTransformRef.current = transformSession.reset;
  transformActiveRef.current = transformSession.isActive;
  repeatTransformRef.current = transformSession.repeat;
  nudgeTransformRef.current = transformSession.nudge;
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
          sourceToDocument: paintTargetSourceToDocument(layer, channel)
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
    const plan = planPersistentToolActivation(
      editorSession.activeTool,
      requestedTool,
      transformSession.isActive()
    );
    if (plan.finishTransform) transformSession.commit();
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
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (!layerId || !executeRegisteredCommand('raster.invert', {
      layerId, channel: editorSession.activeChannel
    })) {
      if (layerId) layerDocumentCommands.invertLayerColors(layerId, editorSession.activeChannel);
    }
  };
  invertActiveLayerColorsRef.current = invertActiveLayerColors;

  const rasterizeActiveTextLayerCommand = () => {
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (!layerId) {
      layerDocumentCommands.rasterizeActiveTextLayer();
      return;
    }
    textEditingController.finish();
    pointTextController.cancel();
    paragraphTextController.cancel();
    if (!executeRegisteredCommand('text.rasterize', { layerId })) {
      layerDocumentCommands.rasterizeTextLayer(layerId);
    }
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

  const requestPngArtifact = useCallback(async () => {
    if (!commandService) throw new Error('The LightTable command service is unavailable.');
    const execution = executeRegisteredCommand('file.exportPng', {});
    if (!execution) throw new Error('PNG export is unavailable.');
    const result = await execution;
    const resolved = await resolveAcceptedCommandArtifact(
      commandService,
      workspaceDocumentId as DocumentSessionId,
      result
    );
    return resolved.file;
  }, [commandService, executeRegisteredCommand, workspaceDocumentId]);

  const {
    saving,
    exportOutput,
    save: handleSave,
    exportPng: handleExportPng,
    exportJpeg: handleExportJpeg,
    exportPsd: handleExportPsd,
    exportPsdMaximumAppearance: handleExportPsdMaximumAppearance,
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
    sourceFile: initialSourceBlob instanceof File ? initialSourceBlob : null,
    hasMetadata: Boolean(metadata),
    getDocument: () => imageDocumentRef.current,
    getRenderer: () => engineRef.current,
    requestPngArtifact: commandService ? requestPngArtifact : undefined,
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
      ? async () => {
          await recoveryStore.remove(workspaceDocumentId);
          await onRecoveryResolved?.();
        }
      : undefined,
    onRequestOpenWorkspaceDocument,
    onOpenWorkspaceDocument,
    setLoading,
    setError,
    setStatus: setGradeStatus
  });
  useEditorRecoveryJournal({ store: recoveryStore,
    enabled: recoveryPreferences?.enabled ?? true,
    intervalMs: recoveryPreferences?.intervalMs,
    documentId: workspaceDocumentId,
    sourceKey: effectiveSourceFileKey, sourceName: initialSourceName, sourceBlob: initialSourceBlob, active, commandHistory, exportOutput,
    workspaceOrder: Math.max(0, workspaceDocuments?.findIndex(({ id }) => id === workspaceDocumentId) ?? 0),
    getCanonicalRevision: () => documentSession?.getSnapshot().documentRevision ?? commandHistory.getSnapshot().currentStateId,
    setStatus: setGradeStatus });
  exportNativeArtifactRef.current = async () => (await exportOutput({ forceLayered: true })).file;
  exportPngArtifactRef.current = () => exportEditorPngArtifact(engineRef.current, imageDocumentRef.current, fileNameBase);
  exportPreviewArtifactRef.current = (maxEdge, region) => exportEditorPreviewArtifact(
    engineRef.current, imageDocumentRef.current, fileNameBase, maxEdge, region
  );
  exportPsdArtifactRef.current = () => exportEditorPsdArtifact(engineRef.current, imageDocumentRef.current, fileNameBase);

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
      place: () => { finishTextEditingRef.current(); void onRequestPlaceWorkspaceArtifact?.(workspaceDocumentId); },
      recentFiles,
      openRecent: (id) => {
        finishTextEditingRef.current();
        void onOpenRecentWorkspaceDocument?.(id);
      },
      clearRecent: () => { void onClearRecentWorkspaceDocuments?.(); },
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
      exportPng: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPng(); },
      exportJpeg: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportJpeg(); },
      exportPsd: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPsd(); },
      exportPsdMaximumAppearance: () => { finishTextEditingRef.current(); commitPointTextRef.current(); commitParagraphTextRef.current(); void handleExportPsdMaximumAppearance(); },
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
      copyGrade: copyCurrentGrade,
      applyFixedTransform: (operation) => {
        if (!executeRegisteredCommand('transform.applyFixed', { operation })) {
          void transformSession.applyFixed(operation);
        }
      }
    },
    selection: {
      selectAll: selectAllContent,
      clear: clearCurrentSelection,
      invert: invertCurrentSelection,
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
      assignSrgbProfile: () => {
        documentMutationController.change((document) => document.colorSettings.profileState === 'assigned'
          ? document
          : {
              ...document,
              colorSettings: { ...document.colorSettings, profileState: 'assigned' },
              revision: document.revision + 1,
              modifiedAt: Date.now()
            });
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
      toggleScreenMode,
      resetLayout: () => workspaceRef.current?.resetLayout(),
      applyPhotoEditWorkspace: () => workspaceRef.current?.applyPreset('photo-edit'),
      applyGradingWorkspace: () => workspaceRef.current?.applyPreset('grading'),
      applyAiGenerationWorkspace: () => workspaceRef.current?.applyPreset('ai-generation'),
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
            materializeBasicAdjustments(adjustment.adjustmentStack)
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
      onSelectCompositeChannel={selectionSessionController.selectCompositeChannel}
      onSelectLayerMask={selectionSessionController.selectLayerMask}
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
    const execution = executeRegisteredCommand('text.convertToShape', { layerId });
    const conversion = execution ?? textToShapeController.convert(layerId).then((converted) => (
      converted
        ? { status: 'completed' as const }
        : { status: 'rejected' as const, message: 'Text could not be converted to shapes.' }
    ));
    void conversion.then((result) => {
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
      const start = Math.min(editing.selection.anchor, editing.selection.focus);
      const end = Math.max(editing.selection.anchor, editing.selection.focus);
      textPropertyGestureRef.current = {
        kind: 'text', layerId, range: start === end ? null : { start, end },
        style: {}, paragraph: {}, recordable: true
      };
      return true;
    }
    if (!beginDocumentTransaction()) return false;
    textPropertyGestureRef.current = {
      kind: 'document', documentId: document.id, layerId, before: document,
      style: {}, paragraph: {}, recordable: true
    };
    return true;
  };
  const applyTextPropertyPatch = (
    patch: TextStylePatch,
    paragraphPatch: ParagraphStylePatch = {}
  ) => {
    const gesture = textPropertyGestureRef.current;
    if (!gesture) return;
    gesture.style = { ...gesture.style, ...patch };
    gesture.paragraph = { ...gesture.paragraph, ...paragraphPatch };
    if (!semanticStylePatchFromCanonical(gesture.style)
      || !semanticParagraphPatchFromCanonical(gesture.paragraph)) {
      gesture.recordable = false;
    }
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
    const changed = gesture.kind === 'text'
      ? textEditingController.endFormatting()
      : endDocumentTransaction();
    textPropertyGestureRef.current = null;
    if (!changed || !gesture.recordable) return;
    const style = semanticStylePatchFromCanonical(gesture.style);
    const paragraph = semanticParagraphPatchFromCanonical(gesture.paragraph);
    if (!style || !paragraph || (!Object.keys(style).length && !Object.keys(paragraph).length)) return;
    const parameters = {
      layerId: gesture.layerId,
      ...(gesture.kind === 'text' && gesture.range ? gesture.range : {}),
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(paragraph).length ? { paragraph } : {})
    };
    commandService?.recordObservedCommand(
      'text.format',
      workspaceDocumentId as DocumentSessionId,
      parameters,
      { layerId: gesture.layerId }
    );
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
  const dispatchDiscreteTextFormat = (stylePatch: TextStylePatch, paragraphPatch: ParagraphStylePatch) => {
    const document = imageDocumentRef.current; const layerId = document?.activeLayerId;
    const style = semanticStylePatchFromCanonical(stylePatch);
    const paragraph = semanticParagraphPatchFromCanonical(paragraphPatch);
    if (!commandService || !layerId || !style || !paragraph) return false;
    const editing = textEditingController.getSnapshot();
    const selection = editing.status === 'editing' && editing.layerId === layerId ? editing.selection : null;
    if (selection) textEditingController.finish();
    const execution = executeRegisteredCommand('text.format', { layerId,
      ...(selection ? { start: selection.anchor, end: selection.focus } : {}), style,
      paragraph });
    void execution?.then(() => {
      if (selection) { textEditingController.begin(layerId, selection.focus); textEditingController.setSelection(selection); }
    });
    return Boolean(execution);
  };
  const applyDiscreteTextProperty = (patch: TextStylePatch) => {
    if (dispatchDiscreteTextFormat(patch, {})) return;
    if (!beginTextPropertyGesture()) return;
    applyTextPropertyPatch(patch);
    commitTextPropertyGesture();
  };
  const applyDiscreteTextParagraph = (patch: ParagraphStylePatch) => {
    if (dispatchDiscreteTextFormat({}, patch)) return;
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
    if (commandService) {
      const execution = executeRegisteredCommand('text.setLayout', { layerId, writingMode });
      void execution?.then((result) => {
        if (result.status === 'completed') {
          activatePersistentTool(writingMode === 'horizontal-tb' ? 'text-point' : 'text-vertical');
        }
      });
      return;
    }
    const after = setFlowTextLayout(before, layerId, {
      ...layer.text.source.layout,
      writingMode
    });
    if (after === before) return;
    applyDocumentSnapshot(after);
    pushDocumentHistory(before, after);
    activatePersistentTool(writingMode === 'horizontal-tb' ? 'text-point' : 'text-vertical');
  };
  const applyTextWarp = (warp: TextWarp | null) => {
    const before = imageDocumentRef.current;
    const layerId = before?.activeLayerId;
    if (!before || !layerId) return;
    const layer = findDocumentLayer(before, layerId);
    if (layer?.type !== 'text') return;
    const after = setTextWarp(before, layerId, warp);
    if (after === before) return;
    applyDocumentSnapshot(after);
    const gesture = textWarpGestureRef.current;
    if (!gesture || gesture.documentId !== before.id || gesture.layerId !== layerId) {
      pushDocumentHistory(before, after);
    }
  };
  const beginTextWarpGesture = () => {
    if (textWarpGestureRef.current) return;
    const before = imageDocumentRef.current;
    const layerId = before?.activeLayerId;
    const layer = before && layerId ? findDocumentLayer(before, layerId) : null;
    if (!before || !layerId || layer?.type !== 'text') return;
    textWarpGestureRef.current = { documentId: before.id, layerId, before };
  };
  const commitTextWarpGesture = () => {
    const gesture = textWarpGestureRef.current;
    textWarpGestureRef.current = null;
    const after = imageDocumentRef.current;
    if (!gesture || !after || after.id !== gesture.documentId || after === gesture.before) return;
    pushDocumentHistory(gesture.before, after);
  };
  const cancelTextWarpGesture = () => {
    const gesture = textWarpGestureRef.current;
    textWarpGestureRef.current = null;
    if (gesture && imageDocumentRef.current?.id === gesture.documentId) {
      applyDocumentSnapshot(gesture.before);
    }
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
    onSelectFace: setFaceWarpSelectedFaceId,
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
    onInteractionStart: beginDocumentTransaction,
    onInteractionEnd: endDocumentTransaction,
    onReset: resetSelectedFaceWarp
  };
  useEffect(() => {
    if (activeTextPropertyLayer?.type === 'text') {
      showProperties({ kind: 'layer', layerId: activeTextPropertyLayer.id });
    }
  }, [activeTextPropertyLayer?.id, activeTextPropertyLayer?.type, showProperties]);
  return (
    <LightTableEditorShell
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
      smartSelectionBackendIdentity={import.meta.env.DEV ? smartSelectionBackendIdentity : null}
      smartSelectionPreparation={smartSelectionPreparation}
      zoomPercent={activeScale * 100}
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
      onSmartSelectionSelectSubject={() => {
        void smartSelectionController.selectSubject(editorSessionRef.current.selectionCombineMode);
      }}
      onZoomPreset={setExactZoom}
      onZoomFit={fitZoom}
      onZoomActual={actualZoom}
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
          dialogs={{
            controller: editorDialogs,
            photoshopReport: imageDocument?.photoshopImportReport ?? null,
            differenceMetrics: psdDifferenceMetrics,
            textFontDiagnostics: fontDiagnostics,
            replacementFonts: selectableTextFonts,
            onSelectCompatibilityLayer: (layerId) => { layerPanelController.select(layerId); editorDialogs.closePsdReport(); },
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
              showProperties({ kind: 'layer', layerId });
            },
            onPreviewTextFont: missingFontReplacementActions.preview,
            onCancelTextFontPreview: missingFontReplacementActions.cancelPreview,
            onReplaceTextFont: missingFontReplacementActions.replace,
            onReplaceTextFonts: missingFontReplacementActions.replaceDocument,
            onFeather: featherCurrentSelection,
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
              const before = imageDocumentRef.current;
              if (!before) return;
              const after = addDocumentGuide(before, guide);
              applyDocumentSnapshot(after);
              pushDocumentHistory(before, after);
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
            smartSelectionBackendIdentity: import.meta.env.DEV
              ? smartSelectionBackendIdentity
              : null,
            smartSelectionPreparation,
            zoomPercent: activeScale * 100,
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
            onSmartSelectionSelectSubject: () => {
              void smartSelectionController.selectSubject(
                editorSessionRef.current.selectionCombineMode
              );
            },
            onZoomPreset: setExactZoom,
            onZoomFit: fitZoom,
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
            status={{
              status: error ?? gradeStatus ?? fontDiagnosticStatus,
              error: Boolean(error),
              meta: statusBar.meta,
              metaTitle: statusBar.title,
              reportAvailable: statusBar.reportAvailable || fontDiagnostics.length > 0,
              onOpenReport: editorDialogs.openPsdReport
            }}
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
                    transformState,
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
                    onWheel: viewportInteraction.onWheel,
                    onPointerDown: viewportInteraction.onPointerDown,
                    onPointerMove: viewportInteraction.onPointerMove,
                    onPointerUp: viewportInteraction.onPointerUp,
                    onPointerCancel: viewportInteraction.onPointerCancel,
                    onPointerLeave: () => {
                      if (editorSessionRef.current.activeTool === 'select-object') {
                        smartSelectionController.clearHoverPreview();
                      }
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
                    onTransformProjectiveChange: updateTransformProjective,
                    onTransformCommitGesture: transformSession.checkpoint,
                    onTransformDuplicateChange: transformSession.setDuplicate,
                    onTransformPick: pickTransformAtPoint,
                    transformSnapTargets,
                    transformSnapEnabled: editorSession.snap.enabled,
                    transformFrameMode: toolPreferences?.preserveTransformLocalAxes ? 'local' : 'document',
                    transformFrameOverride: transformSession.frameOverride,
                    onTransformSnapMatches: setTransformSnapMatches,
                    documentGuides: effectiveDocumentGuides,
                    rulersVisible: editorSession.snap.rulersVisible,
                    guidesVisible: editorSession.snap.extrasVisible !== false && editorSession.snap.guidesVisible,
                    guidesLocked: editorSession.snap.guidesLocked,
                    onGuideDraft: setGuideDraft,
                    onGuideCommit: commitDocumentGuides
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
              agent: { events: agentEvents,
                onCancel: (taskId) => { void executeRegisteredCommand('task.cancel', { taskId }); } },
              actions: {
                capabilities: commandService?.queryCapabilities(workspaceDocumentId as DocumentSessionId) ?? null,
                onExecute: executeRegisteredCommand,
                recording: actionRecording,
                playback: actionPlayback,
                library: actionLibrary,
                onStartRecording: () => { commandService?.startActionRecording(); },
                onStopRecording: () => { commandService?.stopActionRecording(); },
                onClearRecording: () => { commandService?.clearActionRecording(); },
                onPlay: () => { void commandService?.playActionRecording(); },
                onPlayStep: (sequence) => { void commandService?.playActionStep(sequence); },
                onStopPlayback: () => { commandService?.stopActionPlayback(); },
                onSaveAction: (name) => { void commandService?.saveActionRecording(name); },
                onLoadAction: (id) => { void commandService?.loadSavedAction(id); },
                onDeleteAction: (id) => { void commandService?.deleteSavedAction(id); }
              },
              genAi: {
                interactionActive: active,
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
                  setSelectedGenAiProviderId(mode === 'image2image'
                    ? editGenAiProviderId : createGenAiProviderId);
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
  );
};
