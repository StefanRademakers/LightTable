import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '../ui/ActionButton';
import { ContextMenu, type ContextMenuOption } from '../ui/ContextMenu';
import { SegmentedControl, type SegmentedControlOption } from '../ui/SegmentedControl';
import { SquareIconButton } from '../ui/SquareIconButton';
import { TextInputDialog } from '../ui/TextInputDialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { lightTableIcon } from '../assets/icons';
import { AdjustmentSlider, type AdjustmentSliderTrack } from './AdjustmentSlider';
import { ColorGradingWheel } from './ColorGradingWheel';
import {
  cloneColorGrading,
  COLOR_GRADING_ZONE_LABELS,
  colorGradingZoneIndex,
  createDefaultColorGrading,
  type ColorGradingMode,
  type ColorGradingValues,
  type ColorGradingZone
} from './colorGrading';
import {
  cloneColorMixer,
  COLOR_MIXER_CHANNELS,
  COLOR_MIXER_DISPLAY_CENTERS,
  COLOR_MIXER_RANGES,
  colorMixerTrack,
  createDefaultColorMixer,
  type ColorMixerChannel,
  type ColorMixerValues
} from './colorMixer';
import {
  WebGpuEngine,
  type LightTableImageDecodeMode,
  type ReferenceDifferenceMetrics
} from './gpu/WebGpuEngine';
import { CurvesEditor } from './CurvesEditor';
import { cloneCurves, createDefaultCurves, createIdentityCurve, type CurveChannel, type ToneCurve } from './curves';
import { copyLightTableGrade, useLightTableGradeClipboard } from './lightTableGradeClipboard';
import {
  createLightTableRecipe,
  resolveLightTableEditorSourceKey,
  resolveLightTableSaveSourceKey,
  type LightTableRecipe
} from './lightTableRecipe';
import {
  createDefaultGrainSettings,
  DEFAULT_GRAIN_SETTINGS,
  type GrainSettings
} from './effects/grain/settings';
import {
  createDefaultHalationSettings,
  DEFAULT_HALATION_SETTINGS,
  type HalationSettings
} from './effects/halation/settings';
import {
  createDefaultChromaticAberrationSettings,
  DEFAULT_CHROMATIC_ABERRATION_SETTINGS,
  type ChromaticAberrationSettings
} from './effects/chromaticAberration/settings';
import {
  createDefaultLensDistortionSettings,
  DEFAULT_LENS_DISTORTION_SETTINGS,
  type LensDistortionSettings
} from './effects/lensDistortion/settings';
import { EffectPanel } from './effects/EffectPanel';
import {
  createDefaultLensBlurSettings,
  DEFAULT_LENS_BLUR_SETTINGS,
  focusInterval,
  type BokehShape,
  type LensBlurQuality,
  type LensBlurSettings
} from './effects/lensBlur/settings';
import { mapLensDistortionUv } from './effects/lensDistortion/settings';
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
import {
  type LightTableDebugMessage,
  type LightTableDebugSeverity
} from './editor/debug/debugLog';
import {
  LightTableDockWorkspace,
  type LightTableDockWorkspaceHandle
} from './editor/workspace/LightTableDockWorkspace';
import { createEditorSession, type EditorSession, type ToolId } from './editor/session/editorSession';
import {
  createImageDocument,
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
  applyTranslationAlignment,
  createGroupLayer,
  createAdjustmentLayer,
  createRasterLayer,
  deleteLayer,
  deleteLayers,
  duplicateLayer,
  flattenGroup,
  flattenImage,
  getFlattenGroupPlan,
  getFlattenImagePlan,
  getMergeRasterLayersPlan,
  groupLayers,
  markLayerPixelsChanged,
  markLayerMaskPixelsChanged,
  mergeRasterLayers,
  moveLayerSelection,
  moveLayer,
  renameLayer,
  removeLayerMask,
  setActiveLayer,
  setAdjustmentLayerStack,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerLocked,
  setLayerMaskEnabled,
  setLayerOpacity,
  setLayerTransform,
  setLayerVisibility,
  setLayersLock,
  setLayersVisibility,
  ungroupLayers
} from './editor/document/documentCommands';
import type { TranslationAlignmentResult } from './editor/autoAlign/alignmentTypes';
import { BLEND_MODES } from './editor/document/blendModes';
import {
  clearLayerStyles,
  setLayerStyleEnabled,
  setLayerStyleStack,
  setLayerStyleStackEnabled
} from './editor/styles/layerStyleCommands';
import type { LayerStyleId, LayerStyleStack } from './editor/styles/layerStyleTypes';
import {
  buildLayeredDocumentFile,
  parseLayeredDocumentFile,
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
  isPhotoshopDocument,
  isSupportedImageFile,
  pickSupportedImageFile
} from './image-io/supportedImageFormats';
import type { PsdDecodeSuccess } from './image-io/psdProtocol';
import {
  importPsdDocument,
  type PsdImportCompatibilityEntry
} from './editor/psd/psdDocumentAdapter';
import { PsdImportReportDialog } from './editor/psd/PsdImportReportDialog';
import { boundsForDabs, StrokeBuilder } from './editor/tools/brush/strokeBuilder';
import { paintTargetSourceToDocument } from './editor/tools/paint/paintCoordinates';
import { TransformOverlay } from './editor/tools/transform/TransformOverlay';
import {
  identityMatrix,
  matrixApproximatelyEqual,
  multiplyMatrices,
  transformedBounds
} from './editor/tools/transform/affine';
import {
  selectionOperationsBounds,
  transformSelectionOperations
} from './editor/tools/transform/selectionTransform';
import type { AffineMatrix, TransformSessionState } from './editor/tools/transform/transformTypes';
import {
  createFullCanvasSelection,
  createFeatherSelectionOperation,
  createInvertSelectionOperation,
  selectionModeFromModifiers,
  selectionShapeIsValid,
  type SelectionOperation,
  type SelectionShape,
  type SelectionToolId
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
const BRUSH_SIZE_STEPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70,
  80, 90, 100, 125, 150, 175, 200, 250, 300, 400,
  500, 600, 700, 800, 900, 1000
] as const;
const steppedBrushSize = (current: number, direction: -1 | 1) => {
  if (direction > 0) {
    return BRUSH_SIZE_STEPS.find((size) => size > current) ?? BRUSH_SIZE_STEPS[BRUSH_SIZE_STEPS.length - 1];
  }
  return [...BRUSH_SIZE_STEPS].reverse().find((size) => size < current) ?? BRUSH_SIZE_STEPS[0];
};
const isTextEditingTarget = (target: EventTarget | null) => (
  target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || (target instanceof HTMLInputElement && target.type !== 'range')
  || (target instanceof HTMLElement && target.isContentEditable)
);
interface EditorHistoryEntry {
  byteSize?: number;
  layerIds?: readonly LayerId[];
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  dispose?: () => void;
}

export interface LightTableEditorOverlayProps {
  open: boolean;
  projectId: string;
  sourceFileKey?: string | null;
  sourceBlob?: Blob | null;
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
}

interface LightTableStartupTimings {
  webGpuMs?: number;
  downloadMs?: number;
  layeredProbeMs?: number;
  decodeAndUploadMs?: number;
  documentInitMs?: number;
  firstFrameMs?: number;
  scopesMs?: number;
}

interface LayerThumbnailCacheEntry extends LayerThumbnailPreview {
  revisionKey: string;
}

const formatStartupTimings = (timings: LightTableStartupTimings | null) => {
  if (!timings) return '';
  const labels: Array<[keyof LightTableStartupTimings, string]> = [
    ['webGpuMs', 'WebGPU'],
    ['downloadMs', 'download'],
    ['layeredProbeMs', 'document probe'],
    ['decodeAndUploadMs', 'decode/upload'],
    ['documentInitMs', 'layers'],
    ['firstFrameMs', 'first frame'],
    ['scopesMs', 'deferred scopes']
  ];
  return labels
    .filter(([key]) => timings[key] !== undefined)
    .map(([key, label]) => `${label}: ${Math.round(timings[key] ?? 0)} ms`)
    .join(' · ');
};
const formatGpuMemory = (bytes: number) => (
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    : `${Math.round(bytes / (1024 * 1024))} MB`
);

type ZoomMode = 'fit' | '100' | 'custom';
type LightTableAppMenuId = 'file' | 'edit' | 'select' | 'view' | 'layer';
type NumericAdjustmentKey = Exclude<keyof BasicAdjustments, 'colorMixer' | 'colorGrading' | 'curves' | 'effects'>;

interface SliderDefinition {
  key: NumericAdjustmentKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  track?: AdjustmentSliderTrack;
}

const SLIDERS: SliderDefinition[] = [
  { key: 'temperature', label: 'Temperature', min: -150, max: 100, track: 'temperature' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, track: 'tint' },
  { key: 'exposureEV', label: 'Exposure', min: -5, max: 5, step: 0.01, format: (value) => `${value.toFixed(2)} EV`, track: 'luminance' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, track: 'luminance' },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, track: 'luminance' },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, track: 'luminance' },
  { key: 'whites', label: 'Whites', min: -100, max: 100, track: 'luminance' },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, track: 'luminance' },
  { key: 'lift', label: 'Lift', min: -100, max: 100, track: 'luminance' },
  { key: 'texture', label: 'Texture', min: -100, max: 100, track: 'luminance' },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, track: 'luminance' },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100, track: 'luminance' },
  { key: 'vignette', label: 'Vignette', min: -100, max: 100, track: 'luminance' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, track: 'vibrance' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, track: 'saturation' }
];

type GrainNumericKey = Exclude<keyof GrainSettings, 'enabled'>;
interface GrainSliderDefinition extends Omit<SliderDefinition, 'key'> {
  key: GrainNumericKey;
}

const GRAIN_SLIDERS: GrainSliderDefinition[] = [
  { key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'size', label: 'Size', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'softness', label: 'Softness', min: 0, max: 2, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'color', label: 'Color', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'shadowResponse', label: 'Shadow Response', min: 0.25, max: 4, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'blend', label: 'Blend', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'seed', label: 'Seed', min: 1, max: 200 }
];

const GRAIN_ADVANCED_SLIDERS: GrainSliderDefinition[] = [
  { key: 'redScale', label: 'Red scale', min: 0.25, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'greenScale', label: 'Green scale', min: 0.25, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'blueScale', label: 'Blue scale', min: 0.25, max: 3, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'redContrast', label: 'Red noise contrast', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'greenContrast', label: 'Green noise contrast', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) },
  { key: 'blueContrast', label: 'Blue noise contrast', min: 0.25, max: 2.5, step: 0.01, format: (value) => value.toFixed(2) }
];

type HalationNumericKey = Exclude<keyof HalationSettings, 'enabled'>;
interface HalationSliderDefinition extends Omit<SliderDefinition, 'key'> {
  key: HalationNumericKey;
}

const HALATION_SLIDERS: HalationSliderDefinition[] = [
  { key: 'amount', label: 'Amount', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'radius', label: 'Radius', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'threshold', label: 'Threshold', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'warmth', label: 'Warmth', min: 0, max: 100, format: (value) => `${Math.round(value)}%`, track: 'temperature' }
];

type ChromaticAberrationNumericKey = Exclude<keyof ChromaticAberrationSettings, 'enabled'>;
interface ChromaticAberrationSliderDefinition extends Omit<SliderDefinition, 'key'> {
  key: ChromaticAberrationNumericKey;
}

const CHROMATIC_ABERRATION_SLIDERS: ChromaticAberrationSliderDefinition[] = [
  { key: 'amount', label: 'Amount', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'falloff', label: 'Edge falloff', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'balance', label: 'Red / Blue balance', min: -100, max: 100, track: 'tint' }
];

type LensDistortionNumericKey = Exclude<keyof LensDistortionSettings, 'enabled'>;
interface LensDistortionSliderDefinition extends Omit<SliderDefinition, 'key'> {
  key: LensDistortionNumericKey;
}

const LENS_DISTORTION_SLIDERS: LensDistortionSliderDefinition[] = [
  { key: 'amount', label: 'Distortion', min: -100, max: 100 },
  { key: 'midpoint', label: 'Midpoint', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'zoom', label: 'Zoom', min: 0, max: 100, format: (value) => `${Math.round(value)}%` }
];

type LensBlurNumericKey = Exclude<keyof LensBlurSettings, 'enabled' | 'bokehShape' | 'quality'>;
type LensBlurViewportMode = 'result' | 'depth';
interface LensBlurSliderDefinition extends Omit<SliderDefinition, 'key'> {
  key: LensBlurNumericKey;
}

const LENS_BLUR_SLIDERS: LensBlurSliderDefinition[] = [
  { key: 'apertureSize', label: 'Aperture Size', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'focusDistance', label: 'Focus Distance', min: 0, max: 1, step: 0.005, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'depthOfField', label: 'Depth of Field', min: 0.01, max: 0.8, step: 0.005, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'catEye', label: 'Cat Eye', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'bokehBoost', label: 'Bokeh Boost', min: 0, max: 100, format: (value) => `${Math.round(value)}%` },
  { key: 'transitionFeather', label: 'Transition Feather', min: 0.01, max: 0.4, step: 0.005, format: (value) => `${Math.round(value * 100)}%` }
];

const BOKEH_SHAPE_OPTIONS: Array<SegmentedControlOption<BokehShape>> = [
  { value: 'circle', label: 'Round' },
  { value: 'hexagon', label: 'Hex' },
  { value: 'anamorphic', label: 'Oval' },
  { value: 'donut', label: 'Donut' }
];

const LENS_BLUR_QUALITY_OPTIONS: Array<SegmentedControlOption<LensBlurQuality>> = [
  { value: 'balanced', label: '48' },
  { value: 'high', label: '64' },
  { value: 'ultra', label: '128' }
];

const LENS_BLUR_VIEWPORT_MODE_OPTIONS: Array<SegmentedControlOption<LensBlurViewportMode>> = [
  { value: 'result', label: 'Result' },
  { value: 'depth', label: 'Depth' }
];

const LIGHT_SLIDER_KEYS = new Set<NumericAdjustmentKey>([
  'exposureEV', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'lift'
]);
const LIGHT_SLIDERS = SLIDERS.filter((slider) => LIGHT_SLIDER_KEYS.has(slider.key));
const COLOR_SLIDER_KEYS = new Set<NumericAdjustmentKey>(['temperature', 'tint', 'vibrance', 'saturation']);
const EFFECTS_SLIDER_KEYS = new Set<NumericAdjustmentKey>(['texture', 'clarity', 'dehaze', 'vignette']);
const COLOR_SLIDERS = SLIDERS.filter((slider) => COLOR_SLIDER_KEYS.has(slider.key));
const EFFECTS_SLIDERS = SLIDERS.filter((slider) => EFFECTS_SLIDER_KEYS.has(slider.key));

interface GroupVisibility {
  light: boolean;
  color: boolean;
  colorMixer: boolean;
  colorGrading: boolean;
  curves: boolean;
  effects: boolean;
}

const MIXER_CHANNEL_LABELS: Record<ColorMixerChannel, string> = {
  hue: 'Hue',
  saturation: 'Saturation',
  luminance: 'Luminance'
};

const wrapUnit = (value: number) => ((value % 1) + 1) % 1;

const colorMixerRangeBounds = (index: number) => {
  const count = COLOR_MIXER_DISPLAY_CENTERS.length;
  const center = COLOR_MIXER_DISPLAY_CENTERS[index];
  const previous = COLOR_MIXER_DISPLAY_CENTERS[(index + count - 1) % count];
  const next = COLOR_MIXER_DISPLAY_CENTERS[(index + 1) % count];
  const previousDistance = wrapUnit(center - previous);
  const nextDistance = wrapUnit(next - center);
  return {
    start: wrapUnit(center - previousDistance / 2),
    end: wrapUnit(center + nextDistance / 2)
  };
};

const nearestColorMixerRange = (position: number) => {
  let selected = 0;
  let selectedDistance = Number.POSITIVE_INFINITY;
  COLOR_MIXER_DISPLAY_CENTERS.forEach((center, index) => {
    const direct = Math.abs(position - center);
    const distance = Math.min(direct, 1 - direct);
    if (distance < selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  });
  return selected;
};

const GRADING_MODE_OPTIONS: Array<SegmentedControlOption<ColorGradingMode>> = [
  { value: 'all', label: '3-Way', title: 'Three-way grading' },
  { value: 'global', label: 'Global' },
  { value: 'shadows', label: 'Shadows' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'highlights', label: 'Highlights' }
];

const applyGroupVisibility = (adjustments: BasicAdjustments, visibility: GroupVisibility): BasicAdjustments => {
  const next = cloneAllAdjustments(adjustments);
  const zero = (keys: Set<NumericAdjustmentKey>) => keys.forEach((key) => { next[key] = 0; });
  if (!visibility.light) zero(LIGHT_SLIDER_KEYS);
  if (!visibility.color) zero(COLOR_SLIDER_KEYS);
  if (!visibility.colorMixer) next.colorMixer = createDefaultColorMixer();
  if (!visibility.colorGrading) next.colorGrading = createDefaultColorGrading();
  if (!visibility.curves) next.curves = createDefaultCurves();
  if (!visibility.effects) zero(EFFECTS_SLIDER_KEYS);
  return next;
};

const cloneAdjustments = cloneAllAdjustments;

const adjustmentsEqual = (left: BasicAdjustments, right: BasicAdjustments) =>
  JSON.stringify(left) === JSON.stringify(right);

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
const isSelectionTool = (tool: ToolId): tool is SelectionToolId => tool.startsWith('select-');
const isPaintTool = (tool: ToolId) => tool === 'brush' || tool === 'erase';
const selectionKindForTool = (tool: SelectionToolId): SelectionShape['kind'] => (
  tool === 'select-rectangle' ? 'rectangle' : tool === 'select-ellipse' ? 'ellipse' : 'free'
);

const buildOutputName = (base: string) => `${base.replace(/\.[^.]+$/, '') || 'image'}-lighttable.png`;
interface SelectionOverlayProps {
  operations: SelectionOperation[];
  draft: SelectionShape | null;
  imageRect: { x: number; y: number };
  scale: number;
  width: number;
  height: number;
}

const SelectionOverlay: React.FC<SelectionOverlayProps> = ({ operations, draft, imageRect, scale, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext('2d', { willReadFrequently: true });
    const shape = document.createElement('canvas');
    shape.width = canvas.width;
    shape.height = canvas.height;
    const shapeContext = shape.getContext('2d');
    if (!maskContext || !shapeContext) return;

    const traceShape = (selectionShape: SelectionShape) => {
      const points = selectionShape.points.map((point) => ({
        x: imageRect.x + point.x * scale,
        y: imageRect.y + point.y * scale
      }));
      if (!points.length) return false;
      shapeContext.beginPath();
      if (selectionShape.kind === 'free') {
        if (points.length < 3) return false;
        shapeContext.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => shapeContext.lineTo(point.x, point.y));
        shapeContext.closePath();
        return true;
      }
      if (points.length < 2) return false;
      const left = Math.min(points[0].x, points[1].x);
      const top = Math.min(points[0].y, points[1].y);
      const shapeWidth = Math.abs(points[1].x - points[0].x);
      const shapeHeight = Math.abs(points[1].y - points[0].y);
      if (selectionShape.kind === 'ellipse') {
        shapeContext.ellipse(
          left + shapeWidth / 2,
          top + shapeHeight / 2,
          shapeWidth / 2,
          shapeHeight / 2,
          0,
          0,
          Math.PI * 2
        );
      } else {
        shapeContext.rect(left, top, shapeWidth, shapeHeight);
      }
      return true;
    };

    operations.forEach((operation) => {
      if (operation.mode === 'feather') {
        const radius = Math.max(0, operation.amount ?? 0) * scale;
        if (radius <= 0) return;
        shapeContext.clearRect(0, 0, shape.width, shape.height);
        shapeContext.filter = `blur(${radius}px)`;
        shapeContext.drawImage(mask, 0, 0);
        shapeContext.filter = 'none';
        maskContext.clearRect(0, 0, mask.width, mask.height);
        maskContext.drawImage(shape, 0, 0);
        return;
      }
      if (operation.mode === 'invert') {
        const pixels = maskContext.getImageData(0, 0, mask.width, mask.height);
        for (let index = 3; index < pixels.data.length; index += 4) {
          pixels.data[index] = 255 - pixels.data[index];
        }
        maskContext.putImageData(pixels, 0, 0);
        return;
      }

      shapeContext.clearRect(0, 0, shape.width, shape.height);
      shapeContext.fillStyle = '#fff';
      if (!traceShape(operation.shape)) return;
      shapeContext.fill();
      if (operation.mode === 'replace') maskContext.clearRect(0, 0, mask.width, mask.height);
      maskContext.globalCompositeOperation = operation.mode === 'subtract'
        ? 'destination-out'
        : operation.mode === 'intersect'
          ? 'destination-in'
          : 'source-over';
      maskContext.drawImage(shape, 0, 0);
      maskContext.globalCompositeOperation = 'source-over';
    });

    const maskPixels = maskContext.getImageData(0, 0, mask.width, mask.height);
    const output = context.createImageData(mask.width, mask.height);
    const isSelected = (x: number, y: number) => (
      x >= 0
      && y >= 0
      && x < mask.width
      && y < mask.height
      && maskPixels.data[(y * mask.width + x) * 4 + 3] >= 128
    );
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (!isSelected(x, y)) continue;
        if (
          isSelected(x - 1, y)
          && isSelected(x + 1, y)
          && isSelected(x, y - 1)
          && isSelected(x, y + 1)
        ) continue;
        const outputIndex = (y * mask.width + x) * 4;
        const whiteDash = Math.floor((x + y) / 4) % 2 === 0;
        output.data[outputIndex] = whiteDash ? 255 : 18;
        output.data[outputIndex + 1] = whiteDash ? 255 : 18;
        output.data[outputIndex + 2] = whiteDash ? 255 : 18;
        output.data[outputIndex + 3] = 245;
      }
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(output, 0, 0);
  }, [imageRect.x, imageRect.y, operations, scale, width, height]);

  const renderDraft = (shape: SelectionShape) => {
    const points = shape.points.map((point) => ({
      x: imageRect.x + point.x * scale,
      y: imageRect.y + point.y * scale
    }));
    if (!points.length) return null;
    const className = 'lighttable-selection__shape lighttable-selection__shape--draft';
    if (shape.kind === 'free') {
      const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
      return <path className={className} d={`${path}${points.length > 2 ? ' Z' : ''}`} />;
    }
    if (points.length < 2) return null;
    const left = Math.min(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const shapeWidth = Math.abs(points[1].x - points[0].x);
    const shapeHeight = Math.abs(points[1].y - points[0].y);
    if (shape.kind === 'ellipse') {
      return <ellipse className={className} cx={left + shapeWidth / 2} cy={top + shapeHeight / 2} rx={shapeWidth / 2} ry={shapeHeight / 2} />;
    }
    return <rect className={className} x={left} y={top} width={shapeWidth} height={shapeHeight} />;
  };

  return (
    <>
      <canvas ref={canvasRef} className="lighttable-selection" aria-hidden="true" />
      {draft ? (
        <svg className="lighttable-selection" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {renderDraft(draft)}
        </svg>
      ) : null}
    </>
  );
};

export const LightTableEditorOverlay: React.FC<LightTableEditorOverlayProps> = ({
  open,
  projectId,
  sourceFileKey = null,
  sourceBlob: initialSourceBlob = null,
  loadSource,
  initialRecipe = null,
  fileNameBase,
  onClose,
  onSave
}) => {
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
  const localImageLoadAbortRef = useRef<AbortController | null>(null);
  const autoAlignAbortRef = useRef<AbortController | null>(null);
  const engineRef = useRef<WebGpuEngine | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const adjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const documentAdjustmentsRef = useRef<BasicAdjustments>(createDefaultAdjustments());
  const undoStackRef = useRef<EditorHistoryEntry[]>([]);
  const redoStackRef = useRef<EditorHistoryEntry[]>([]);
  const historyBusyRef = useRef(false);
  const historyEpochRef = useRef(0);
  const adjustmentTransactionRef = useRef<BasicAdjustments | null>(null);
  const adjustmentTransactionTargetRef = useRef<LayerId | null>(null);
  const documentTransactionRef = useRef<ImageDocument | null>(null);
  const imageDocumentRef = useRef<ImageDocument | null>(null);
  const preservedSourceAssetsRef = useRef<PreservedSourceAssetBlob[]>([]);
  const strokeBuilderRef = useRef<StrokeBuilder | null>(null);
  const strokeDirtyBoundsRef = useRef<Rect | null>(null);
  const brushPointerIdRef = useRef<number | null>(null);
  const brushStrokeChannelRef = useRef<'pixels' | 'mask'>('pixels');
  const brushStrokeEraseRef = useRef(false);
  const brushStrokeTransformRef = useRef<AffineMatrix>(identityMatrix());
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const brushCursorCenterRef = useRef<{ x: number; y: number } | null>(null);
  const selectionPointerIdRef = useRef<number | null>(null);
  const selectionDraftRef = useRef<SelectionShape | null>(null);
  const transformStateRef = useRef<TransformSessionState | null>(null);
  const transformLaunchRef = useRef(0);
  const commitTransformRef = useRef<() => void>(() => undefined);
  const cancelTransformRef = useRef<() => void>(() => undefined);
  const cancelAutoAlignRef = useRef<() => void>(() => undefined);
  const copySelectedContentRef = useRef<() => void>(() => undefined);
  const pasteSelectedContentRef = useRef<() => void>(() => undefined);
  const layerViaCopyRef = useRef<() => void>(() => undefined);
  const invertActiveLayerColorsRef = useRef<() => void>(() => undefined);
  const fillActiveTargetRef = useRef<(color: string) => void>(() => undefined);
  const temporaryPanRef = useRef(false);
  const groupVisibilityRef = useRef<GroupVisibility>({ light: true, color: true, colorMixer: true, colorGrading: true, curves: true, effects: true });
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
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  const [view, setView] = useState<LightTableViewState>({ scale: 1, panX: 0, panY: 0 });
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
  const [expandedGroups, setExpandedGroups] = useState({ light: true, color: true, colorMixer: true, colorGrading: true, curves: true, effects: true, grain: true, halation: true, chromaticAberration: true, lensDistortion: true, lensBlur: true });
  const [grainAdvancedExpanded, setGrainAdvancedExpanded] = useState(false);
  const [selectedColorMixerRange, setSelectedColorMixerRange] = useState(0);
  const [colorGradingMode, setColorGradingMode] = useState<ColorGradingMode>('all');
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('master');
  const [groupVisibility, setGroupVisibility] = useState<GroupVisibility>({ light: true, color: true, colorMixer: true, colorGrading: true, curves: true, effects: true });
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
  const [imageDocument, setImageDocument] = useState<ImageDocument | null>(null);
  const [thumbnailDocumentReadyId, setThumbnailDocumentReadyId] = useState<string | null>(null);
  const [layerThumbnails, setLayerThumbnails] = useState<ReadonlyMap<LayerId, LayerThumbnailSet>>(
    () => new Map()
  );
  const [editorSession, setEditorSession] = useState<EditorSession>(createEditorSession);
  const [selectionDraft, setSelectionDraft] = useState<SelectionShape | null>(null);
  const [transformState, setTransformState] = useState<TransformSessionState | null>(null);
  const [autoAlignPreview, setAutoAlignPreview] = useState<TranslationAlignmentResult | null>(null);
  const [featherDialogOpen, setFeatherDialogOpen] = useState(false);
  const [flattenRequest, setFlattenRequest] = useState<
    { kind: 'group'; groupId: LayerId } | { kind: 'image' } | null
  >(null);
  const [styleEditorRequest, setStyleEditorRequest] = useState<{
    layerId: LayerId;
    effectId?: LayerStyleId;
    before: ImageDocument;
  } | null>(null);
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
    if (error) appendDebugMessage('error', 'LightTable', error);
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
    const next = cloneAdjustments(snapshot);
    adjustmentsRef.current = next;
    setAdjustments(next);
    let document = imageDocumentRef.current;
    if (targetLayerId && document) {
      const target = findDocumentLayer(document, targetLayerId);
      if (target?.type === 'adjustment') {
        documentAdjustmentsRef.current = {
          ...documentAdjustmentsRef.current,
          effects: structuredClone(next.effects)
        };
        document = setAdjustmentLayerStack(
          document,
          targetLayerId,
          adjustmentStackForScope(
            createAdjustmentStackFromBasicAdjustments(next, target.adjustmentStack),
            'adjustment-layer'
          )
        );
        imageDocumentRef.current = document;
        setImageDocument(document);
        engineRef.current?.setDocument(document);
      }
    } else {
      documentAdjustmentsRef.current = next;
    }
    const effective = effectiveDocumentAdjustments(document);
    engineRef.current?.setAdjustments(applyGroupVisibility(effective, groupVisibilityRef.current));
  }, [effectiveDocumentAdjustments]);

  const pruneHistoryRuntimes = useCallback(() => {
    const keep = new Set<LayerId>(
      imageDocumentRef.current
        ? walkLayerTree(imageDocumentRef.current.layers).map(({ node }) => node.id)
        : []
    );
    [...undoStackRef.current, ...redoStackRef.current].forEach((entry) => {
      entry.layerIds?.forEach((layerId) => keep.add(layerId));
    });
    engineRef.current?.pruneLayerRuntimes(keep);
  }, []);

  const clearEditorHistory = useCallback(() => {
    historyEpochRef.current += 1;
    [...undoStackRef.current, ...redoStackRef.current].forEach((entry) => entry.dispose?.());
    undoStackRef.current = [];
    redoStackRef.current = [];
    adjustmentTransactionRef.current = null;
    adjustmentTransactionTargetRef.current = null;
    documentTransactionRef.current = null;
    historyBusyRef.current = false;
    pruneHistoryRuntimes();
  }, [pruneHistoryRuntimes]);

  const pushHistoryEntry = useCallback((entry: EditorHistoryEntry) => {
    redoStackRef.current.forEach((redoEntry) => redoEntry.dispose?.());
    redoStackRef.current = [];
    undoStackRef.current.push(entry);
    let byteSize = undoStackRef.current.reduce((total, candidate) => total + (candidate.byteSize ?? 0), 0);
    while (undoStackRef.current.length > HISTORY_LIMIT || (byteSize > GPU_HISTORY_BYTE_LIMIT && undoStackRef.current.length > 1)) {
      const evicted = undoStackRef.current.shift();
      byteSize -= evicted?.byteSize ?? 0;
      evicted?.dispose?.();
    }
    pruneHistoryRuntimes();
  }, [pruneHistoryRuntimes]);

  const applyDocumentSnapshot = useCallback((snapshot: ImageDocument) => {
    imageDocumentRef.current = snapshot;
    setImageDocument(snapshot);
    engineRef.current?.setDocument(snapshot);
    engineRef.current?.setAdjustments(applyGroupVisibility(
      effectiveDocumentAdjustments(snapshot),
      groupVisibilityRef.current
    ));
  }, [effectiveDocumentAdjustments]);

  const pushDocumentHistory = useCallback((before: ImageDocument, after: ImageDocument) => {
    pushHistoryEntry({
      layerIds: [...new Set([
        ...walkRasterLayers(before.layers),
        ...walkRasterLayers(after.layers)
      ].map(({ layer }) => layer.id))],
      undo: () => applyDocumentSnapshot(before),
      redo: () => applyDocumentSnapshot(after)
    });
  }, [applyDocumentSnapshot, pushHistoryEntry]);

  const endDocumentTransaction = useCallback(() => {
    const before = documentTransactionRef.current;
    documentTransactionRef.current = null;
    const after = imageDocumentRef.current;
    if (before && after && before !== after) pushDocumentHistory(before, after);
  }, [pushDocumentHistory]);

  const pushAdjustmentHistory = useCallback((
    before: BasicAdjustments,
    after: BasicAdjustments,
    targetLayerId: LayerId | null
  ) => {
    const previous = cloneAdjustments(before);
    const next = cloneAdjustments(after);
    pushHistoryEntry({
      undo: () => applyAdjustmentSnapshot(previous, targetLayerId),
      redo: () => applyAdjustmentSnapshot(next, targetLayerId)
    });
  }, [applyAdjustmentSnapshot, pushHistoryEntry]);

  const cloneSelection = useCallback((operations: SelectionOperation[]) => operations.map((operation) => ({
    mode: operation.mode,
    amount: operation.amount,
    shape: { ...operation.shape, points: operation.shape.points.map((point) => ({ ...point })) }
  })), []);

  const applySelectionSnapshot = useCallback(async (operations: SelectionOperation[]) => {
    const snapshot = cloneSelection(operations);
    if (!await engineRef.current?.replaceSelection(snapshot)) {
      throw new Error('The LightTable selection could not be restored.');
    }
    setEditorSession((current) => ({ ...current, pointerId: null, selection: snapshot }));
  }, [cloneSelection]);

  const pushSelectionHistory = useCallback((before: SelectionOperation[], after: SelectionOperation[]) => {
    const previous = cloneSelection(before);
    const next = cloneSelection(after);
    pushHistoryEntry({
      undo: () => applySelectionSnapshot(previous),
      redo: () => applySelectionSnapshot(next)
    });
  }, [applySelectionSnapshot, cloneSelection, pushHistoryEntry]);

  const beginAdjustmentTransaction = useCallback(() => {
    if (adjustmentTransactionRef.current) return;
    engineRef.current?.setScopeInteractionActive(true);
    // Any upstream adjustment invalidates enabled downstream effects. Keep
    // expensive lens blur at interactive quality for the complete drag, not
    // only while one of its own controls is moving.
    engineRef.current?.setLensBlurInteractionActive(true);
    adjustmentTransactionRef.current = cloneAdjustments(adjustmentsRef.current);
    const active = imageDocumentRef.current
      ? findDocumentLayer(imageDocumentRef.current, imageDocumentRef.current.activeLayerId)
      : null;
    adjustmentTransactionTargetRef.current = active?.type === 'adjustment' ? active.id : null;
  }, []);

  const endAdjustmentTransaction = useCallback(() => {
    if (!adjustmentTransactionRef.current) return;
    engineRef.current?.setScopeInteractionActive(false);
    const before = adjustmentTransactionRef.current;
    const targetLayerId = adjustmentTransactionTargetRef.current;
    adjustmentTransactionRef.current = null;
    adjustmentTransactionTargetRef.current = null;
    if (before && !adjustmentsEqual(before, adjustmentsRef.current)) {
      pushAdjustmentHistory(before, adjustmentsRef.current, targetLayerId);
    }
    // Re-render once at final quality after the exact last slider value has
    // been flushed by AdjustmentSlider.
    engineRef.current?.setLensBlurInteractionActive(false);
  }, [pushAdjustmentHistory]);

  const beginLensBlurInteraction = useCallback(() => {
    beginAdjustmentTransaction();
  }, [beginAdjustmentTransaction]);

  const endLensBlurInteraction = useCallback(() => {
    endAdjustmentTransaction();
  }, [endAdjustmentTransaction]);

  const changeAdjustments = useCallback((change: (current: BasicAdjustments) => BasicAdjustments) => {
    const before = cloneAdjustments(adjustmentsRef.current);
    const next = change(cloneAdjustments(before));
    if (adjustmentsEqual(before, next)) return;
    const active = imageDocumentRef.current
      ? findDocumentLayer(imageDocumentRef.current, imageDocumentRef.current.activeLayerId)
      : null;
    const targetLayerId = active?.type === 'adjustment' ? active.id : null;
    applyAdjustmentSnapshot(next, targetLayerId);
    if (!adjustmentTransactionRef.current) pushAdjustmentHistory(before, next, targetLayerId);
  }, [applyAdjustmentSnapshot, pushAdjustmentHistory]);

  const undoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    if (historyBusyRef.current) return;
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const epoch = historyEpochRef.current;
    historyBusyRef.current = true;
    try {
      await entry.undo();
      if (epoch === historyEpochRef.current) redoStackRef.current.push(entry);
      else entry.dispose?.();
    } catch (reason) {
      if (epoch === historyEpochRef.current) {
        undoStackRef.current.push(entry);
        setError(reason instanceof Error ? reason.message : 'LightTable undo failed.');
      } else entry.dispose?.();
    } finally {
      historyBusyRef.current = false;
    }
  }, [endAdjustmentTransaction, endDocumentTransaction]);

  const redoEditor = useCallback(async () => {
    endAdjustmentTransaction();
    endDocumentTransaction();
    if (historyBusyRef.current) return;
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    const epoch = historyEpochRef.current;
    historyBusyRef.current = true;
    try {
      await entry.redo();
      if (epoch === historyEpochRef.current) undoStackRef.current.push(entry);
      else entry.dispose?.();
    } catch (reason) {
      if (epoch === historyEpochRef.current) {
        redoStackRef.current.push(entry);
        setError(reason instanceof Error ? reason.message : 'LightTable redo failed.');
      } else entry.dispose?.();
    } finally {
      historyBusyRef.current = false;
    }
  }, [endAdjustmentTransaction, endDocumentTransaction]);

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
    const layeredProbeStartedAt = performance.now();
    const layered = await parseLayeredDocumentFile(blob);
    startupTimingsRef.current.layeredProbeMs = performance.now() - layeredProbeStartedAt;
    if (isCanceled()) return;
    let psdImport: PsdDecodeSuccess | null = null;
    const photoshopBlob = !layered && isPhotoshopDocument(blob, name) ? blob : null;
    if (photoshopBlob) {
      const { PsdDecoder } = await import('./image-io/PsdDecoder');
      const decoder = new PsdDecoder();
      try {
        psdImport = await decoder.decode(photoshopBlob, signal);
      } finally {
        decoder.destroy();
      }
    }
    if (isCanceled()) return;
    const imageBlob = psdImport?.preview ?? layered?.preview ?? blob;
    const semanticPsd = psdImport && !layered
      ? importPsdDocument(psdImport, name)
      : null;
    if (!isSupportedImageFile(imageBlob, name, decodeMode)) {
      throw new Error(decodeMode === 'preserve-precision'
        ? 'Precision-preserving import currently supports PNG, TIFF, JPEG, and WebP.'
        : 'LightTable supports JPEG, PNG, WebP, PSD, and layered LightTable images.');
    }
    const decodeStartedAt = performance.now();
    const loadedMetadata = await engine.loadImage(imageBlob, name, {
      decodeMode: psdImport ? 'fast' : decodeMode,
      signal
    });
    const nextMetadata: LightTableImageMetadata = psdImport
      ? {
          ...loadedMetadata,
          decoder: 'ag-psd',
          sourceBitDepth: psdImport.bitsPerChannel,
          sourceFormat: 'PSD',
          sourceInterpretation: psdImport.colorMode
        }
      : loadedMetadata;
    startupTimingsRef.current.decodeAndUploadMs = performance.now() - decodeStartedAt;
    if (isCanceled()) return;
    const documentStartedAt = performance.now();
    const nextDocument = layered?.document ?? semanticPsd?.document ?? createImageDocument(
      name,
      nextMetadata.width,
      nextMetadata.height,
      cacheKey,
      {
        decoder: nextMetadata.decoder ?? 'browser',
        sourceBitDepth: nextMetadata.sourceBitDepth ?? null,
        sourceFormat: nextMetadata.sourceFormat ?? null,
        sourceInterpretation: nextMetadata.sourceInterpretation ?? null,
        sourceProfile: nextMetadata.sourceProfile ?? null,
        normalizedColorSpace: 'linear-srgb'
      }
    );
    if (nextDocument.width !== nextMetadata.width || nextDocument.height !== nextMetadata.height) {
      throw new Error('The layered LightTable preview does not match its document dimensions.');
    }
    imageDocumentRef.current = nextDocument;
    // A PSD is converted into native LightTable layers/assets. Do not embed
    // the complete source document again in the native file.
    preservedSourceAssetsRef.current = [];
    setImageDocument(nextDocument);
    engine.setDocument(nextDocument);
    if (layered) await engine.loadLayerAssets([...layered.assets, ...layered.patternAssets]);
    if (semanticPsd) await engine.loadLayerAssets(semanticPsd.assets);
    setThumbnailDocumentReadyId(nextDocument.id);
    startupTimingsRef.current.documentInitMs = performance.now() - documentStartedAt;
    if (isCanceled()) return;
    const nextAdjustments = cloneAdjustments(
      layered ? materializeBasicAdjustments(layered.adjustmentStack) : initialAdjustments
    );
    setMetadata(nextMetadata);
    setPsdImportInfo(psdImport && semanticPsd
      ? { ...psdImport, warnings: semanticPsd.warnings }
      : psdImport);
    setPsdCompatibility(
      semanticPsd?.compatibility
      ?? nextDocument.photoshopImportReport?.compatibility
      ?? []
    );
    setPsdDifferenceMetrics(null);
    setSourceName(name);
    setSourceBlob(imageBlob);
    setSourceIdentity(cacheKey);
    setDepthResult(null);
    setDepthIdentity('');
    setDepthProgress({ status: 'idle' });
    setFocusPickerActive(false);
    selectionDraftRef.current = null;
    selectionPointerIdRef.current = null;
    setSelectionDraft(null);
    transformStateRef.current = null;
    setTransformState(null);
    setEditorSession((current) => ({ ...current, selection: [] }));
    setSelectionClipboardAvailable(false);
    setFeatherDialogOpen(false);
    setLensBlurViewportModeState('result');
    engineRef.current?.setLensBlurDepthVisualization(false);
    clearEditorHistory();
    documentAdjustmentsRef.current = nextAdjustments;
    adjustmentsRef.current = nextAdjustments;
    setAdjustments(nextAdjustments);
    if (layered) engine.setAdjustmentStack(layered.adjustmentStack);
    engine.setAdjustments(applyGroupVisibility(
      effectiveDocumentAdjustments(nextDocument),
      groupVisibilityRef.current
    ));
    setHistogram(null);
    setZoomMode('fit');
    setView({ scale: 1, panX: 0, panY: 0 });
    if (psdImport) {
      const { inventory } = psdImport;
      try {
        const metrics = await engine.measureReferenceDifference();
        if (!isCanceled()) {
          setPsdDifferenceMetrics(metrics);
          setGradeStatus(
            `PSD reconstruction loaded · ${inventory.layers} layers · `
            + `${metrics.differingPixelPercentage.toFixed(2)}% differs`
          );
        }
      } catch (reason) {
        if (!isCanceled()) {
          setGradeStatus(
            `PSD reconstruction loaded · ${inventory.layers} layers · `
            + `${inventory.layerStyles} styled · ${inventory.adjustments} adjustments`
          );
          console.warn('LightTable PSD difference measurement failed', reason);
        }
      }
      if (semanticPsd?.warnings.length) {
        console.warn('LightTable PSD semantic import warnings', semanticPsd.warnings);
      }
    }
  }, [clearEditorHistory, effectiveDocumentAdjustments]);

  useEffect(() => {
    if (!open || !canvasRef.current || !hueDistributionCanvasRef.current ||
      !colorMixerHueCanvasRef.current ||
      !paradeCanvasRef.current || !vectorscopeCanvasRef.current) return;
    let canceled = false;
    let engine: WebGpuEngine | null = null;
    const hueDistributionCanvas = hueDistributionCanvasRef.current;
    const colorMixerHueDistributionCanvas = colorMixerHueCanvasRef.current;
    const paradeCanvas = paradeCanvasRef.current;
    const vectorscopeCanvas = vectorscopeCanvasRef.current;
    const abortController = new AbortController();
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
    selectionDraftRef.current = null;
    selectionPointerIdRef.current = null;
    setSelectionDraft(null);
    setSelectionClipboardAvailable(false);
    setFeatherDialogOpen(false);
    transformStateRef.current = null;
    setTransformState(null);
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
    setExpandedGroups({ light: true, color: true, colorMixer: true, colorGrading: true, curves: true, effects: true, grain: true, halation: true, chromaticAberration: true, lensDistortion: true, lensBlur: true });
    setGrainAdvancedExpanded(false);
    setSelectedColorMixerRange(0);
    setColorGradingMode('all');
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
    const startingVisibility: GroupVisibility = { light: true, color: true, colorMixer: true, colorGrading: true, curves: true, effects: true };
    groupVisibilityRef.current = startingVisibility;
    setGroupVisibility(startingVisibility);

    void (async () => {
      if (!editorSourceFileKey && !initialSourceBlob) throw new Error('No source image was supplied to LightTable.');
      const webGpuStartedAt = performance.now();
      const enginePromise = WebGpuEngine.create(canvasRef.current!, {
        onHistogram: (next) => { if (!canceled) setHistogram(next); },
        onGpuMemoryEstimate: (bytes) => { if (!canceled) setGpuMemoryBytes(bytes); },
        onDeviceLost: (message) => { if (!canceled) setError(message); },
        onScopeError: (message) => { if (!canceled) setScopeError(message); },
        onFirstFrame: () => {
          if (canceled || !startupAwaitingFirstFrameRef.current) return;
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
            if (canceled) return;
            startupTimingsRef.current.scopesMs = performance.now() - scopeStartedAt;
            setStartupTimings({ ...startupTimingsRef.current });
          });
        }
      }).then((createdEngine) => {
        startupTimingsRef.current.webGpuMs = performance.now() - webGpuStartedAt;
        return createdEngine;
      });
      // The authenticated media request is independent of WebGPU setup. Start
      // it immediately so network latency overlaps adapter/pipeline creation.
      const downloadStartedAt = performance.now();
      const blobPromise = initialSourceBlob
        ? Promise.resolve(initialSourceBlob)
        : loadSource?.({
            projectId,
            sourceFileKey: editorSourceFileKey!,
            signal: abortController.signal
          }) ?? Promise.reject(new Error('The LightTable host cannot read this source image.'));
      const responsePromise = blobPromise.then((data) => {
        startupTimingsRef.current.downloadMs = performance.now() - downloadStartedAt;
        return { data };
      });
      const initialized = await Promise.all([enginePromise, responsePromise]);
      engine = initialized[0];
      const response = initialized[1];
      if (canceled) {
        engine.destroy();
        return;
      }
      engineRef.current = engine;
      engine.setLensBlurDepthVisualization(false);
      engine.setScopeOptions(
        false,
        scopeEngineOptions(scopeVisibilityRef.current, scopeSettingsRef.current)
      );
      if (!canceled) await loadBlobIntoEngine(
        response.data,
        initialSourceName,
        initialRecipe?.settings ?? createDefaultAdjustments(),
        `${editorSourceFileKey ?? initialSourceName}:${response.data.size}`,
        () => canceled,
        'fast',
        abortController.signal
      );
    })().catch((reason: unknown) => {
      if (!canceled) {
        abortController.abort();
        setError(reason instanceof Error ? reason.message : 'LightTable could not be initialized.');
      }
    }).finally(() => {
      if (!canceled) setLoading(false);
    });

    return () => {
      canceled = true;
      abortController.abort();
      localImageLoadAbortRef.current?.abort();
      localImageLoadAbortRef.current = null;
      autoAlignAbortRef.current?.abort();
      autoAlignAbortRef.current = null;
      clearEditorHistory();
      engineRef.current = null;
      engine?.destroy();
    };
  }, [clearEditorHistory, documentSurfaceRevision, editorSourceFileKey, initialRecipe, initialSourceBlob, initialSourceName, loadBlobIntoEngine, loadSource, open, projectId]);

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
  }, [documentSurfaceRevision, editorResizeObserversEnabled, open]);

  useEffect(() => {
    if (!open) return;
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
  }, [documentSurfaceRevision, editorResizeObserversEnabled, open]);

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

  const updateAdjustment = (key: NumericAdjustmentKey, value: number) => {
    // Native range controls can emit their first input before/without a useful
    // pointer event on some browser/OS combinations. Opening the transaction
    // here as well guarantees that an entire drag remains one undo command.
    beginAdjustmentTransaction();
    changeAdjustments((current) => ({ ...current, [key]: value }));
  };

  const resetAdjustment = (key: NumericAdjustmentKey) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({ ...current, [key]: DEFAULT_BASIC_ADJUSTMENTS[key] }));
  };

  const updateGrainAdjustment = (key: GrainNumericKey, value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        grain: { ...current.effects.grain, [key]: value }
      }
    }));
  };

  const resetGrainAdjustment = (key: GrainNumericKey) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        grain: { ...current.effects.grain, [key]: DEFAULT_GRAIN_SETTINGS[key] }
      }
    }));
  };

  const resetGrain = () => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        grain: { ...createDefaultGrainSettings(), enabled: current.effects.grain.enabled }
      }
    }));
  };

  const toggleGrain = () => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        grain: { ...current.effects.grain, enabled: !current.effects.grain.enabled }
      }
    }));
  };

  const updateHalationAdjustment = (key: HalationNumericKey, value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        halation: { ...current.effects.halation, [key]: value }
      }
    }));
  };

  const resetHalationAdjustment = (key: HalationNumericKey) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        halation: { ...current.effects.halation, [key]: DEFAULT_HALATION_SETTINGS[key] }
      }
    }));
  };

  const resetHalation = () => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        halation: { ...createDefaultHalationSettings(), enabled: current.effects.halation.enabled }
      }
    }));
  };

  const setHalationEnabled = (enabled: boolean) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        halation: { ...current.effects.halation, enabled }
      }
    }));
  };

  const updateChromaticAberrationAdjustment = (key: ChromaticAberrationNumericKey, value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        chromaticAberration: { ...current.effects.chromaticAberration, [key]: value }
      }
    }));
  };

  const resetChromaticAberrationAdjustment = (key: ChromaticAberrationNumericKey) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        chromaticAberration: {
          ...current.effects.chromaticAberration,
          [key]: DEFAULT_CHROMATIC_ABERRATION_SETTINGS[key]
        }
      }
    }));
  };

  const resetChromaticAberration = () => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        chromaticAberration: {
          ...createDefaultChromaticAberrationSettings(),
          enabled: current.effects.chromaticAberration.enabled
        }
      }
    }));
  };

  const setChromaticAberrationEnabled = (enabled: boolean) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        chromaticAberration: { ...current.effects.chromaticAberration, enabled }
      }
    }));
  };

  const updateLensDistortionAdjustment = (key: LensDistortionNumericKey, value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensDistortion: { ...current.effects.lensDistortion, [key]: value }
      }
    }));
  };

  const resetLensDistortionAdjustment = (key: LensDistortionNumericKey) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensDistortion: { ...current.effects.lensDistortion, [key]: DEFAULT_LENS_DISTORTION_SETTINGS[key] }
      }
    }));
  };

  const resetLensDistortion = () => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensDistortion: {
          ...createDefaultLensDistortionSettings(),
          enabled: current.effects.lensDistortion.enabled
        }
      }
    }));
  };

  const setLensDistortionEnabled = (enabled: boolean) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensDistortion: { ...current.effects.lensDistortion, enabled }
      }
    }));
  };

  const updateLensBlurAdjustment = (key: LensBlurNumericKey, value: number) => {
    beginLensBlurInteraction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensBlur: { ...current.effects.lensBlur, [key]: value }
      }
    }));
  };

  const resetLensBlurAdjustment = (key: LensBlurNumericKey) => {
    endLensBlurInteraction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensBlur: { ...current.effects.lensBlur, [key]: DEFAULT_LENS_BLUR_SETTINGS[key] }
      }
    }));
  };

  const resetLensBlur = () => {
    endLensBlurInteraction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensBlur: { ...createDefaultLensBlurSettings(), enabled: current.effects.lensBlur.enabled }
      }
    }));
    setFocusPickerActive(false);
  };

  const setLensBlurEnabled = (enabled: boolean) => {
    endLensBlurInteraction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensBlur: { ...current.effects.lensBlur, enabled }
      }
    }));
    if (!enabled) setFocusPickerActive(false);
  };

  const setLensBlurShape = (bokehShape: BokehShape) => {
    endLensBlurInteraction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensBlur: { ...current.effects.lensBlur, bokehShape }
      }
    }));
  };

  const setLensBlurQuality = (quality: LensBlurQuality) => {
    endLensBlurInteraction();
    changeAdjustments((current) => ({
      ...current,
      effects: {
        ...current.effects,
        lensBlur: { ...current.effects.lensBlur, quality }
      }
    }));
  };

  const setLensBlurViewportMode = (mode: LensBlurViewportMode) => {
    endLensBlurInteraction();
    setLensBlurViewportModeState(mode);
    engineRef.current?.setLensBlurDepthVisualization(mode === 'depth');
  };

  const updateColorMixerAdjustment = (channel: ColorMixerChannel, index: number, value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => {
      const values = [...current.colorMixer[channel]] as ColorMixerValues;
      values[index] = value;
      return {
        ...current,
        colorMixer: { ...cloneColorMixer(current.colorMixer), [channel]: values }
      };
    });
  };

  const resetColorMixerAdjustment = (channel: ColorMixerChannel, index: number) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => {
      const values = [...current.colorMixer[channel]] as ColorMixerValues;
      values[index] = 0;
      return {
        ...current,
        colorMixer: { ...cloneColorMixer(current.colorMixer), [channel]: values }
      };
    });
  };

  const updateColorGradingWheel = (zone: ColorGradingZone, hue: number, saturation: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const next = cloneColorGrading(current.colorGrading);
      next.hue[index] = hue;
      next.saturation[index] = saturation;
      return { ...current, colorGrading: next };
    });
  };

  const updateColorGradingLuminance = (zone: ColorGradingZone, value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const luminance = [...current.colorGrading.luminance] as ColorGradingValues;
      luminance[index] = value;
      return {
        ...current,
        colorGrading: { ...cloneColorGrading(current.colorGrading), luminance }
      };
    });
  };

  const updateColorGradingControl = (control: 'blending' | 'balance', value: number) => {
    beginAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      colorGrading: { ...cloneColorGrading(current.colorGrading), [control]: value }
    }));
  };

  const resetColorGradingControl = (control: 'blending' | 'balance') => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      colorGrading: {
        ...cloneColorGrading(current.colorGrading),
        [control]: DEFAULT_BASIC_ADJUSTMENTS.colorGrading[control]
      }
    }));
  };

  const resetColorGradingZone = (zone: ColorGradingZone) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const next = cloneColorGrading(current.colorGrading);
      next.hue[index] = 0;
      next.saturation[index] = 0;
      next.luminance[index] = 0;
      return { ...current, colorGrading: next };
    });
  };

  const resetColorGradingLuminance = (zone: ColorGradingZone) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => {
      const index = colorGradingZoneIndex(zone);
      const luminance = [...current.colorGrading.luminance] as ColorGradingValues;
      luminance[index] = 0;
      return {
        ...current,
        colorGrading: { ...cloneColorGrading(current.colorGrading), luminance }
      };
    });
  };

  const updateCurve = (channel: CurveChannel, points: ToneCurve) => {
    changeAdjustments((current) => ({
      ...current,
      curves: { ...cloneCurves(current.curves), [channel]: points.map((point) => ({ ...point })) }
    }));
  };

  const resetCurve = (channel: CurveChannel) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => ({
      ...current,
      curves: { ...cloneCurves(current.curves), [channel]: createIdentityCurve() }
    }));
  };

  const resetAll = () => {
    endAdjustmentTransaction();
    changeAdjustments(() => createDefaultAdjustments());
  };

  const toggleGroupVisibility = (group: keyof GroupVisibility) => {
    const nextVisibility = { ...groupVisibility, [group]: !groupVisibility[group] };
    groupVisibilityRef.current = nextVisibility;
    setGroupVisibility(nextVisibility);
    engineRef.current?.setAdjustments(applyGroupVisibility(adjustmentsRef.current, nextVisibility));
  };

  const resetGroup = (group: keyof GroupVisibility) => {
    endAdjustmentTransaction();
    changeAdjustments((current) => {
      if (group === 'colorMixer') {
        return { ...current, colorMixer: createDefaultColorMixer() };
      }
      if (group === 'colorGrading') {
        return { ...current, colorGrading: createDefaultColorGrading() };
      }
      if (group === 'curves') {
        return { ...current, curves: createDefaultCurves() };
      }
      const keys = group === 'light'
        ? LIGHT_SLIDER_KEYS
        : group === 'color'
          ? COLOR_SLIDER_KEYS
          : EFFECTS_SLIDER_KEYS;
      keys.forEach((key) => {
        current[key] = DEFAULT_BASIC_ADJUSTMENTS[key];
      });
      return current;
    });
  };

  const copyCurrentGrade = () => {
    copyLightTableGrade(adjustmentsRef.current, sourceName);
    setGradeStatus('Grade copied');
  };

  const pasteCurrentGrade = () => {
    if (!copiedGrade) return;
    endAdjustmentTransaction();
    changeAdjustments(() => copiedGrade.settings);
    setGradeStatus(`Loaded ${copiedGrade.name}`);
  };

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

  const commitSelectionChange = useCallback((
    after: SelectionOperation[],
    failureMessage: string
  ) => {
    const before = cloneSelection(editorSession.selection);
    selectionDraftRef.current = null;
    selectionPointerIdRef.current = null;
    setSelectionDraft(null);
    void applySelectionSnapshot(after)
      .then(() => pushSelectionHistory(before, after))
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : failureMessage);
      });
  }, [applySelectionSnapshot, cloneSelection, editorSession.selection, pushSelectionHistory]);

  const selectAllContent = useCallback(() => {
    const document = imageDocumentRef.current;
    if (!document) return;
    commitSelectionChange(
      createFullCanvasSelection(document.width, document.height),
      'The complete canvas could not be selected.'
    );
  }, [commitSelectionChange]);

  const clearCurrentSelection = useCallback(() => {
    if (!editorSession.selection.length && !selectionDraftRef.current) return;
    commitSelectionChange([], 'The selection could not be cleared.');
  }, [commitSelectionChange, editorSession.selection.length]);

  const invertCurrentSelection = useCallback(() => {
    const document = imageDocumentRef.current;
    if (!document) return;
    commitSelectionChange(
      [...cloneSelection(editorSession.selection), createInvertSelectionOperation(document.width, document.height)],
      'The selection could not be inverted.'
    );
  }, [cloneSelection, commitSelectionChange, editorSession.selection]);

  const featherCurrentSelection = useCallback((radius: number) => {
    const document = imageDocumentRef.current;
    if (!document || !editorSession.selection.length) return;
    commitSelectionChange(
      [...cloneSelection(editorSession.selection), createFeatherSelectionOperation(document.width, document.height, radius)],
      'The selection could not be feathered.'
    );
  }, [cloneSelection, commitSelectionChange, editorSession.selection]);

  useEffect(() => {
    if (!open) return;
    const handleModifierDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftPressed(true);
    };
    const handleModifierUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShiftPressed(false);
    };
    const clearModifier = () => setShiftPressed(false);
    window.addEventListener('keydown', handleModifierDown);
    window.addEventListener('keyup', handleModifierUp);
    window.addEventListener('blur', clearModifier);
    return () => {
      window.removeEventListener('keydown', handleModifierDown);
      window.removeEventListener('keyup', handleModifierUp);
      window.removeEventListener('blur', clearModifier);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const primaryModifier = event.ctrlKey || event.metaKey;
      const undo = primaryModifier && !event.altKey && !event.shiftKey && key === 'z';
      const redo = primaryModifier && !event.altKey && (
        (event.shiftKey && key === 'z') || (!event.shiftKey && key === 'y')
      );
      if (undo || redo) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void (redo ? redoEditor() : undoEditor());
        return;
      }
      // A focused range is still an editor control, but it is not text entry:
      // global tool/view shortcuts must continue working immediately after a
      // drag while arrow keys remain available to fine-tune the slider.
      const editable = isTextEditingTarget(event.target);
      if (event.code === 'Space' && !editable && !primaryModifier && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!temporaryPanRef.current) {
          temporaryPanRef.current = true;
          setTemporaryPanActive(true);
        }
        return;
      }
      const selectAll = primaryModifier && !event.altKey && !event.shiftKey && key === 'a';
      const deselect = primaryModifier && !event.altKey && !event.shiftKey && key === 'd';
      const invertSelection = primaryModifier && !event.altKey && event.shiftKey && key === 'i';
      const copySelection = primaryModifier && !event.altKey && !event.shiftKey && key === 'c';
      const pasteSelection = primaryModifier && !event.altKey && !event.shiftKey && key === 'v';
      const layerViaCopy = primaryModifier && !event.altKey && !event.shiftKey && key === 'j';
      const freeTransform = primaryModifier && event.altKey && !event.shiftKey && key === 't';
      const invertLayerColors = primaryModifier && !event.altKey && !event.shiftKey && key === 'i';
      const featherSelection = !primaryModifier && !event.altKey && event.shiftKey && event.key === 'F6';
      // macOS labels the key Delete but browsers commonly report the
      // delete-backward key as Backspace. Accept both representations.
      const fillKey = event.key === 'Backspace' || event.key === 'Delete';
      const fillForeground = fillKey && event.altKey && !primaryModifier && !event.shiftKey;
      const fillBackground = fillKey && primaryModifier && !event.altKey && !event.shiftKey;
      if ((fillForeground || fillBackground) && !editable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        fillActiveTargetRef.current(
          fillForeground
            ? editorSession.brush.color
            : editorSession.brush.backgroundColor
        );
        return;
      }
      if (selectAll && !editable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        selectAllContent();
        return;
      }
      if (deselect && !editable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearCurrentSelection();
        return;
      }
      if (invertSelection && !editable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        invertCurrentSelection();
        return;
      }
      if (copySelection && !editable && editorSession.selection.length) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        copySelectedContentRef.current();
        return;
      }
      if (pasteSelection && !editable && selectionClipboardAvailable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        pasteSelectedContentRef.current();
        return;
      }
      if (layerViaCopy && !editable && !saving) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        layerViaCopyRef.current();
        return;
      }
      if (freeTransform && !editable && !saving && imageDocumentRef.current?.activeLayerId) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // Repeating the shortcut while transforming must not implicitly commit;
        // Enter/Escape remain the explicit commit/cancel controls.
        setEditorSession((current) => (
          current.activeTool === 'transform' ? current : { ...current, activeTool: 'transform' }
        ));
        return;
      }
      if (invertLayerColors && !editable) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        invertActiveLayerColorsRef.current();
        return;
      }
      if (featherSelection && !editable && editorSession.selection.length) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setFeatherDialogOpen(true);
        return;
      }
      if (!primaryModifier && !event.altKey && !editable && key === 'x') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setEditorSession((current) => ({
          ...current,
          brush: {
            ...current.brush,
            color: current.brush.backgroundColor,
            backgroundColor: current.brush.color
          }
        }));
        return;
      }
      if (!primaryModifier && !event.altKey && !editable && key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setShowDifference(false);
        setShowOriginal((current) => !current);
        return;
      }
      const brushSizeDirection = event.code === 'BracketLeft' || key === '['
        ? -1
        : event.code === 'BracketRight' || key === ']'
          ? 1
          : 0;
      if (
        brushSizeDirection
        && !primaryModifier
        && !event.altKey
        && !editable
        && isPaintTool(editorSession.activeTool)
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setEditorSession((current) => ({
          ...current,
          brush: {
            ...current.brush,
            size: steppedBrushSize(current.brush.size, brushSizeDirection)
          }
        }));
        return;
      }
      const toolShortcut: Partial<Record<string, ToolId>> = {
        h: 'view',
        t: 'transform',
        g: 'fill',
        b: 'brush',
        e: 'erase',
        m: 'select-rectangle',
        l: 'select-free'
      };
      const requestedShortcutTool = key === 'm' && event.shiftKey
        ? 'select-ellipse'
        : toolShortcut[key];
      if (!primaryModifier && !event.altKey && !editable && requestedShortcutTool) {
        event.preventDefault();
        const requestedTool = requestedShortcutTool;
        if (requestedTool === 'transform' && editorSession.activeTool === 'transform') {
          commitTransformRef.current();
          return;
        }
        if (transformStateRef.current && requestedTool !== 'transform') {
          commitTransformRef.current();
        }
        setEditorSession((current) => ({ ...current, activeTool: requestedTool }));
        return;
      }
      if (event.key === 'Enter' && !editable && transformStateRef.current) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        commitTransformRef.current();
        return;
      }
      if (event.key !== 'Escape' || saving) return;
      // Inputs own Escape themselves (for example layer rename cancellation).
      if (editable) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (appMenu) {
        setAppMenu(null);
        return;
      }
      if (transformStateRef.current) {
        cancelTransformRef.current();
        return;
      }
      if (autoAlignPreview) {
        cancelAutoAlignRef.current();
        return;
      }
      if (selectionDraftRef.current || editorSession.selection.length) {
        const before = cloneSelection(editorSession.selection);
        selectionDraftRef.current = null;
        selectionPointerIdRef.current = null;
        setSelectionDraft(null);
        engineRef.current?.clearSelection();
        setEditorSession((current) => ({ ...current, pointerId: null, selection: [] }));
        if (before.length) pushSelectionHistory(before, []);
        return;
      }
      onClose();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !temporaryPanRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      temporaryPanRef.current = false;
      setTemporaryPanActive(false);
    };
    const releaseTemporaryPan = () => {
      if (!temporaryPanRef.current) return;
      temporaryPanRef.current = false;
      setTemporaryPanActive(false);
    };
    // Capture keeps LightTable's local history from also triggering a page-level undo.
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', releaseTemporaryPan);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', releaseTemporaryPan);
    };
  }, [appMenu, autoAlignPreview, clearCurrentSelection, cloneSelection, editorSession.activeTool, editorSession.brush.backgroundColor, editorSession.brush.color, editorSession.selection, invertCurrentSelection, onClose, open, pushSelectionHistory, redoEditor, saving, selectAllContent, selectionClipboardAvailable, undoEditor]);

  const renderAdjustmentGroup = (
    group: keyof GroupVisibility,
    label: string,
    sliders: SliderDefinition[]
  ) => {
    const expanded = expandedGroups[group];
    const visible = groupVisibility[group];
    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <div className="lighttable-group__header">
          <button
            type="button"
            className="lighttable-group__toggle"
            onPointerDown={(event) => {
              if (event.button === 0 && (event.shiftKey || shiftPressed)) {
                event.preventDefault();
                resetGroup(group);
              }
            }}
            onClick={(event) => {
              if (event.button === 0 && (event.shiftKey || shiftPressed)) {
                event.preventDefault();
                resetGroup(group);
                return;
              }
              setExpandedGroups((current) => ({ ...current, [group]: !current[group] }));
            }}
            aria-expanded={expanded}
            title={shiftPressed ? `Reset ${label}` : label}
          >
            <img src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
            <strong>{label}</strong>
          </button>
          <div className="lighttable-group__actions">
            <button
              type="button"
              className="lighttable-group__reset"
              onClick={() => resetGroup(group)}
              aria-label={`Reset ${label} adjustments`}
              title={`Reset ${label} adjustments`}
            >
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lighttable-group__visibility"
              onClick={() => toggleGroupVisibility(group)}
              aria-label={`${visible ? 'Disable' : 'Enable'} ${label} adjustments`}
              title={`${visible ? 'Disable' : 'Enable'} ${label} adjustments`}
            >
              <img src={lightTableIcon(visible ? 'visible.png' : 'visible_off.png')} alt="" aria-hidden="true" />
            </button>
          </div>
        </div>
        {expanded ? (
          <div className="lighttable-group__controls">
            {sliders.map((slider) => (
              <AdjustmentSlider
                key={slider.key}
                label={slider.label}
                value={adjustments[slider.key]}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                format={slider.format}
                track={slider.track}
                resetValue={DEFAULT_BASIC_ADJUSTMENTS[slider.key]}
                disabled={!metadata || !visible}
                resetModifierActive={shiftPressed}
                onChange={(value) => updateAdjustment(slider.key, value)}
                onReset={() => resetAdjustment(slider.key)}
                onInteractionStart={beginAdjustmentTransaction}
                onInteractionEnd={endAdjustmentTransaction}
              />
            ))}
          </div>
        ) : null}
      </section>
    );
  };

  const renderGrainGroup = () => {
    const expanded = expandedGroups.grain;
    const enabled = adjustments.effects.grain.enabled;
    const renderSlider = (slider: GrainSliderDefinition) => (
      <AdjustmentSlider
        key={slider.key}
        label={slider.label}
        value={adjustments.effects.grain[slider.key]}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        format={slider.format}
        track={slider.track}
        resetValue={DEFAULT_GRAIN_SETTINGS[slider.key]}
        disabled={!metadata || !enabled}
        resetModifierActive={shiftPressed}
        onChange={(value) => updateGrainAdjustment(slider.key, value)}
        onReset={() => resetGrainAdjustment(slider.key)}
        onInteractionStart={beginLensBlurInteraction}
        onInteractionEnd={endLensBlurInteraction}
      />
    );

    return (
      <EffectPanel
        label="Grain"
        expanded={expanded}
        enabled={enabled}
        resetModifierActive={shiftPressed}
        onExpandedChange={(next) => setExpandedGroups((current) => ({ ...current, grain: next }))}
        onEnabledChange={toggleGrain}
        onReset={resetGrain}
      >
        {GRAIN_SLIDERS.map(renderSlider)}
        <div className="lighttable-subgroup">
          <button
            type="button"
            className="lighttable-subgroup__toggle"
            onClick={() => setGrainAdvancedExpanded((current) => !current)}
            aria-expanded={grainAdvancedExpanded}
          >
            <img src={lightTableIcon(grainAdvancedExpanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
            <strong>Advanced</strong>
          </button>
          {grainAdvancedExpanded ? (
            <div className="lighttable-subgroup__controls">
              {GRAIN_ADVANCED_SLIDERS.map(renderSlider)}
            </div>
          ) : null}
        </div>
      </EffectPanel>
    );
  };

  const renderHalationGroup = () => {
    const enabled = adjustments.effects.halation.enabled;
    return (
      <EffectPanel
        label="Halation"
        expanded={expandedGroups.halation}
        enabled={enabled}
        resetModifierActive={shiftPressed}
        onExpandedChange={(next) => setExpandedGroups((current) => ({ ...current, halation: next }))}
        onEnabledChange={setHalationEnabled}
        onReset={resetHalation}
      >
        {HALATION_SLIDERS.map((slider) => (
          <AdjustmentSlider
            key={slider.key}
            label={slider.label}
            value={adjustments.effects.halation[slider.key]}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            format={slider.format}
            track={slider.track}
            resetValue={DEFAULT_HALATION_SETTINGS[slider.key]}
            disabled={!metadata || !enabled}
            resetModifierActive={shiftPressed}
            onChange={(value) => updateHalationAdjustment(slider.key, value)}
            onReset={() => resetHalationAdjustment(slider.key)}
            onInteractionStart={beginAdjustmentTransaction}
            onInteractionEnd={endAdjustmentTransaction}
          />
        ))}
      </EffectPanel>
    );
  };

  const renderChromaticAberrationGroup = () => {
    const enabled = adjustments.effects.chromaticAberration.enabled;
    return (
      <EffectPanel
        label="Chromatic Aberration"
        expanded={expandedGroups.chromaticAberration}
        enabled={enabled}
        resetModifierActive={shiftPressed}
        onExpandedChange={(next) => setExpandedGroups((current) => ({ ...current, chromaticAberration: next }))}
        onEnabledChange={setChromaticAberrationEnabled}
        onReset={resetChromaticAberration}
      >
        {CHROMATIC_ABERRATION_SLIDERS.map((slider) => (
          <AdjustmentSlider
            key={slider.key}
            label={slider.label}
            value={adjustments.effects.chromaticAberration[slider.key]}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            format={slider.format}
            track={slider.track}
            resetValue={DEFAULT_CHROMATIC_ABERRATION_SETTINGS[slider.key]}
            disabled={!metadata || !enabled}
            resetModifierActive={shiftPressed}
            onChange={(value) => updateChromaticAberrationAdjustment(slider.key, value)}
            onReset={() => resetChromaticAberrationAdjustment(slider.key)}
            onInteractionStart={beginAdjustmentTransaction}
            onInteractionEnd={endAdjustmentTransaction}
          />
        ))}
      </EffectPanel>
    );
  };

  const renderLensDistortionGroup = () => {
    const enabled = adjustments.effects.lensDistortion.enabled;
    return (
      <EffectPanel
        label="Lens Distortion"
        expanded={expandedGroups.lensDistortion}
        enabled={enabled}
        resetModifierActive={shiftPressed}
        onExpandedChange={(next) => setExpandedGroups((current) => ({ ...current, lensDistortion: next }))}
        onEnabledChange={setLensDistortionEnabled}
        onReset={resetLensDistortion}
      >
        {LENS_DISTORTION_SLIDERS.map((slider) => (
          <AdjustmentSlider
            key={slider.key}
            label={slider.label}
            value={adjustments.effects.lensDistortion[slider.key]}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            format={slider.format}
            track={slider.track}
            resetValue={DEFAULT_LENS_DISTORTION_SETTINGS[slider.key]}
            disabled={!metadata || !enabled}
            resetModifierActive={shiftPressed}
            onChange={(value) => updateLensDistortionAdjustment(slider.key, value)}
            onReset={() => resetLensDistortionAdjustment(slider.key)}
            onInteractionStart={beginAdjustmentTransaction}
            onInteractionEnd={endAdjustmentTransaction}
          />
        ))}
      </EffectPanel>
    );
  };

  const renderLensBlurGroup = () => {
    const settings = adjustments.effects.lensBlur;
    const enabled = settings.enabled;
    const analyzing = depthProgress.status === 'loading-model' || depthProgress.status === 'estimating';
    const focus = focusInterval(settings);
    const focusVisualizationStyle = {
      '--focus-start': `${focus.start * 100}%`,
      '--focus-end': `${focus.end * 100}%`,
      '--focus-distance': `${settings.focusDistance * 100}%`,
      '--transition-feather': `${Math.min(40, settings.transitionFeather * 100)}%`,
      '--aperture-size': `${Math.max(14, settings.apertureSize)}%`
    } as React.CSSProperties;
    const renderSlider = (slider: LensBlurSliderDefinition) => (
      <AdjustmentSlider
        key={slider.key}
        label={slider.label}
        value={settings[slider.key]}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        format={slider.format}
        track={slider.track}
        resetValue={DEFAULT_LENS_BLUR_SETTINGS[slider.key]}
        disabled={!metadata || !enabled || analyzing}
        resetModifierActive={shiftPressed}
        onChange={(value) => updateLensBlurAdjustment(slider.key, value)}
        onReset={() => resetLensBlurAdjustment(slider.key)}
        onInteractionStart={beginLensBlurInteraction}
        onInteractionEnd={endLensBlurInteraction}
      />
    );
    return (
      <EffectPanel
        label="Lens Blur"
        expanded={expandedGroups.lensBlur}
        enabled={enabled}
        resetModifierActive={shiftPressed}
        onExpandedChange={(next) => setExpandedGroups((current) => ({ ...current, lensBlur: next }))}
        onEnabledChange={setLensBlurEnabled}
        onReset={resetLensBlur}
      >
        {depthProgress.status !== 'idle' ? (
          <div className={`lighttable-lens-blur__status lighttable-lens-blur__status--${depthProgress.status}`}>
            <span>{depthProgress.message ?? (analyzing ? 'Analyzing depth…' : 'Depth ready')}</span>
            {typeof depthProgress.progress === 'number' ? <span>{Math.round(depthProgress.progress)}%</span> : null}
          </div>
        ) : null}
        <span className="lighttable-control-label">Render quality</span>
        <SegmentedControl
          options={LENS_BLUR_QUALITY_OPTIONS.map((option) => ({ ...option, disabled: !enabled || analyzing }))}
          value={settings.quality}
          onChange={setLensBlurQuality}
          ariaLabel="Lens Blur render quality"
          className="lighttable-lens-blur__shapes"
        />
        <span className="lighttable-control-label">Bokeh shape</span>
        <SegmentedControl
          options={BOKEH_SHAPE_OPTIONS.map((option) => ({ ...option, disabled: !enabled || analyzing }))}
          value={settings.bokehShape}
          onChange={setLensBlurShape}
          ariaLabel="Lens Blur bokeh shape"
          className="lighttable-lens-blur__shapes"
        />
        <div className="lighttable-lens-blur__visualization" style={focusVisualizationStyle} aria-hidden="true">
          <span className="lighttable-lens-blur__visualization-taper lighttable-lens-blur__visualization-taper--low" />
          <span className="lighttable-lens-blur__visualization-taper lighttable-lens-blur__visualization-taper--high" />
          <span className="lighttable-lens-blur__visualization-focus-zone" />
          <span className="lighttable-lens-blur__visualization-focus-marker" />
          <span className="lighttable-lens-blur__visualization-point lighttable-lens-blur__visualization-point--low" />
          <span className="lighttable-lens-blur__visualization-point lighttable-lens-blur__visualization-point--focus" />
          <span className="lighttable-lens-blur__visualization-point lighttable-lens-blur__visualization-point--high" />
        </div>
        <SegmentedControl
          options={LENS_BLUR_VIEWPORT_MODE_OPTIONS.map((option) => ({
            ...option,
            disabled: !enabled || (option.value === 'depth' && (!depthResult || analyzing))
          }))}
          value={lensBlurViewportMode}
          onChange={setLensBlurViewportMode}
          ariaLabel="Lens Blur viewport mode"
          className="lighttable-lens-blur__viewport-modes"
        />
        <div className="lighttable-lens-blur__actions">
          <ActionButton
            className={focusPickerActive ? 'action-button--active' : ''}
            onClick={() => setFocusPickerActive((current) => !current)}
            disabled={!enabled || !depthResult || analyzing}
          >Pick focus</ActionButton>
        </div>
        {renderSlider(LENS_BLUR_SLIDERS[0])}
        {renderSlider(LENS_BLUR_SLIDERS[1])}
        {renderSlider(LENS_BLUR_SLIDERS[2])}
        {renderSlider(LENS_BLUR_SLIDERS[3])}
        {renderSlider(LENS_BLUR_SLIDERS[4])}
        {renderSlider(LENS_BLUR_SLIDERS[5])}
      </EffectPanel>
    );
  };

  const renderColorMixerGroup = () => {
    const expanded = expandedGroups.colorMixer;
    const visible = groupVisibility.colorMixer;
    const selectedRange = COLOR_MIXER_RANGES[selectedColorMixerRange];
    const rangeBounds = colorMixerRangeBounds(selectedColorMixerRange);
    const rangeSpans = rangeBounds.start <= rangeBounds.end
      ? [{ left: rangeBounds.start, width: rangeBounds.end - rangeBounds.start }]
      : [
          { left: rangeBounds.start, width: 1 - rangeBounds.start },
          { left: 0, width: rangeBounds.end }
        ];
    const selectRangeAtPointer = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!metadata || !visible) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width < 1) return;
      const position = Math.max(0, Math.min(0.999999, (event.clientX - bounds.left) / bounds.width));
      setSelectedColorMixerRange(nearestColorMixerRange(position));
    };
    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <div className="lighttable-group__header">
          <button
            type="button"
            className="lighttable-group__toggle"
            onPointerDown={(event) => {
              if (event.button === 0 && (event.shiftKey || shiftPressed)) {
                event.preventDefault();
                resetGroup('colorMixer');
              }
            }}
            onClick={(event) => {
              if (event.shiftKey || shiftPressed) {
                event.preventDefault();
                resetGroup('colorMixer');
                return;
              }
              setExpandedGroups((current) => ({ ...current, colorMixer: !current.colorMixer }));
            }}
            aria-expanded={expanded}
            title={shiftPressed ? 'Reset Color Mixer' : 'Color Mixer'}
          >
            <img src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
            <strong>Color Mixer</strong>
          </button>
          <div className="lighttable-group__actions">
            <button
              type="button"
              className="lighttable-group__reset"
              onClick={() => resetGroup('colorMixer')}
              aria-label="Reset Color Mixer adjustments"
              title="Reset Color Mixer adjustments"
            >
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lighttable-group__visibility"
              onClick={() => toggleGroupVisibility('colorMixer')}
              aria-label={`${visible ? 'Disable' : 'Enable'} Color Mixer adjustments`}
              title={`${visible ? 'Disable' : 'Enable'} Color Mixer adjustments`}
            >
              <img src={lightTableIcon(visible ? 'visible.png' : 'visible_off.png')} alt="" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          className="lighttable-group__controls lighttable-color-mixer"
          hidden={!expanded}
        >
          <div
            ref={colorMixerScopeContainerRef}
            className="lighttable-color-mixer__picker"
          role="slider"
          aria-label="Color Mixer hue range"
          aria-valuemin={0}
          aria-valuemax={COLOR_MIXER_RANGES.length - 1}
          aria-valuenow={selectedColorMixerRange}
          aria-valuetext={selectedRange.label}
            aria-disabled={!metadata || !visible}
            tabIndex={metadata && visible ? 0 : -1}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              selectRangeAtPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) selectRangeAtPointer(event);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' &&
                event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              if (event.key === 'Home') setSelectedColorMixerRange(0);
              else if (event.key === 'End') setSelectedColorMixerRange(COLOR_MIXER_RANGES.length - 1);
              else {
                const direction = event.key === 'ArrowLeft' ? -1 : 1;
                setSelectedColorMixerRange((current) => (
                  current + direction + COLOR_MIXER_RANGES.length
                ) % COLOR_MIXER_RANGES.length);
              }
            }}
          >
            <canvas
              ref={colorMixerHueCanvasRef}
              className="lighttable-color-mixer__scope"
              aria-hidden="true"
            />
            <div className="lighttable-color-mixer__hue-strip" aria-hidden="true" />
            <div className="lighttable-color-mixer__range-overlay" aria-hidden="true">
              {rangeSpans.map((span, index) => (
                <span
                  className="lighttable-color-mixer__range-fill"
                  key={`${span.left}-${index}`}
                  style={{
                    left: `${span.left * 100}%`,
                    width: `${span.width * 100}%`
                  }}
                />
              ))}
              <span
                className="lighttable-color-mixer__range-marker"
                style={{ left: `${rangeBounds.start * 100}%` }}
              />
              <span
                className="lighttable-color-mixer__range-marker"
                style={{ left: `${rangeBounds.end * 100}%` }}
              />
            </div>
          </div>
          <div className="lighttable-color-mixer__selection">
            <span
              className="lighttable-color-mixer__selection-swatch"
              style={{ background: selectedRange.color }}
            />
            <strong>{selectedRange.label}</strong>
          </div>
          {COLOR_MIXER_CHANNELS.map((channel) => (
            <AdjustmentSlider
              key={`${channel}-${selectedRange.label}`}
              label={MIXER_CHANNEL_LABELS[channel]}
              value={adjustments.colorMixer[channel][selectedColorMixerRange]}
              min={-100}
              max={100}
              resetValue={0}
              trackBackground={colorMixerTrack(channel, selectedColorMixerRange)}
              disabled={!metadata || !visible}
              resetModifierActive={shiftPressed}
              onChange={(value) => updateColorMixerAdjustment(channel, selectedColorMixerRange, value)}
              onReset={() => resetColorMixerAdjustment(channel, selectedColorMixerRange)}
              onInteractionStart={beginAdjustmentTransaction}
              onInteractionEnd={endAdjustmentTransaction}
            />
          ))}
        </div>
      </section>
    );
  };

  const renderColorGradingWheel = (zone: ColorGradingZone, compact = false) => {
    const index = colorGradingZoneIndex(zone);
    const label = COLOR_GRADING_ZONE_LABELS[zone];
    const visible = groupVisibility.colorGrading;
    return (
      <div className="lighttable-color-grading__wheel-block" key={zone}>
        <ColorGradingWheel
          label={label}
          hue={adjustments.colorGrading.hue[index]}
          saturation={adjustments.colorGrading.saturation[index]}
          luminance={adjustments.colorGrading.luminance[index]}
          compact={compact}
          disabled={!metadata || !visible}
          resetModifierActive={shiftPressed}
          onChange={(hue, saturation) => updateColorGradingWheel(zone, hue, saturation)}
          onReset={() => resetColorGradingZone(zone)}
          onInteractionStart={beginAdjustmentTransaction}
          onInteractionEnd={endAdjustmentTransaction}
        />
        <AdjustmentSlider
          label="Luminance"
          value={adjustments.colorGrading.luminance[index]}
          min={-100}
          max={100}
          track="luminance"
          resetValue={0}
          disabled={!metadata || !visible}
          resetModifierActive={shiftPressed}
          onChange={(value) => updateColorGradingLuminance(zone, value)}
          onReset={() => resetColorGradingLuminance(zone)}
          onInteractionStart={beginAdjustmentTransaction}
          onInteractionEnd={endAdjustmentTransaction}
        />
      </div>
    );
  };

  const renderColorGradingGroup = () => {
    const expanded = expandedGroups.colorGrading;
    const visible = groupVisibility.colorGrading;
    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <div className="lighttable-group__header">
          <button
            type="button"
            className="lighttable-group__toggle"
            onPointerDown={(event) => {
              if (event.button === 0 && (event.shiftKey || shiftPressed)) {
                event.preventDefault();
                resetGroup('colorGrading');
              }
            }}
            onClick={(event) => {
              if (event.shiftKey || shiftPressed) {
                event.preventDefault();
                resetGroup('colorGrading');
                return;
              }
              setExpandedGroups((current) => ({ ...current, colorGrading: !current.colorGrading }));
            }}
            aria-expanded={expanded}
            title={shiftPressed ? 'Reset Color Grading' : 'Color Grading'}
          >
            <img src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
            <strong>Color Grading</strong>
          </button>
          <div className="lighttable-group__actions">
            <button
              type="button"
              className="lighttable-group__reset"
              onClick={() => resetGroup('colorGrading')}
              aria-label="Reset Color Grading adjustments"
              title="Reset Color Grading adjustments"
            >
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lighttable-group__visibility"
              onClick={() => toggleGroupVisibility('colorGrading')}
              aria-label={`${visible ? 'Disable' : 'Enable'} Color Grading adjustments`}
              title={`${visible ? 'Disable' : 'Enable'} Color Grading adjustments`}
            >
              <img src={lightTableIcon(visible ? 'visible.png' : 'visible_off.png')} alt="" aria-hidden="true" />
            </button>
          </div>
        </div>
        {expanded ? (
          <div className="lighttable-group__controls lighttable-color-grading">
            <SegmentedControl
              options={GRADING_MODE_OPTIONS}
              value={colorGradingMode}
              onChange={setColorGradingMode}
              ariaLabel="Color Grading tonal range"
              className="lighttable-color-grading__modes"
            />
            {colorGradingMode === 'all' ? (
              <div className="lighttable-color-grading__three-way">
                {renderColorGradingWheel('midtones')}
                <div className="lighttable-color-grading__split">
                  {renderColorGradingWheel('shadows', true)}
                  {renderColorGradingWheel('highlights', true)}
                </div>
              </div>
            ) : renderColorGradingWheel(colorGradingMode)}
            <div className="lighttable-color-grading__range-controls">
              <AdjustmentSlider
                label="Blending"
                value={adjustments.colorGrading.blending}
                min={0}
                max={100}
                format={(value) => `${Math.round(value)}%`}
                resetValue={50}
                disabled={!metadata || !visible}
                resetModifierActive={shiftPressed}
                onChange={(value) => updateColorGradingControl('blending', value)}
                onReset={() => resetColorGradingControl('blending')}
                onInteractionStart={beginAdjustmentTransaction}
                onInteractionEnd={endAdjustmentTransaction}
              />
              <AdjustmentSlider
                label="Balance"
                value={adjustments.colorGrading.balance}
                min={-100}
                max={100}
                resetValue={0}
                disabled={!metadata || !visible}
                resetModifierActive={shiftPressed}
                onChange={(value) => updateColorGradingControl('balance', value)}
                onReset={() => resetColorGradingControl('balance')}
                onInteractionStart={beginAdjustmentTransaction}
                onInteractionEnd={endAdjustmentTransaction}
              />
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  const renderCurvesGroup = () => {
    const expanded = expandedGroups.curves;
    const visible = groupVisibility.curves;
    return (
      <section className={`lighttable-group${visible ? '' : ' lighttable-group--disabled'}`}>
        <div className="lighttable-group__header">
          <button
            type="button"
            className="lighttable-group__toggle"
            onClick={(event) => {
              if (event.shiftKey || shiftPressed) {
                event.preventDefault();
                resetGroup('curves');
                return;
              }
              setExpandedGroups((current) => ({ ...current, curves: !current.curves }));
            }}
            aria-expanded={expanded}
            title={shiftPressed ? 'Reset Custom Curves' : 'Custom Curves'}
          >
            <img src={lightTableIcon(expanded ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
            <strong>Custom Curves</strong>
          </button>
          <div className="lighttable-group__actions">
            <button type="button" className="lighttable-group__reset" onClick={() => resetGroup('curves')} title="Reset Custom Curves" aria-label="Reset Custom Curves">
              <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lighttable-group__visibility"
              onClick={() => toggleGroupVisibility('curves')}
              title={`${visible ? 'Disable' : 'Enable'} Custom Curves`}
              aria-label={`${visible ? 'Disable' : 'Enable'} Custom Curves`}
            >
              <img src={lightTableIcon(visible ? 'visible.png' : 'visible_off.png')} alt="" aria-hidden="true" />
            </button>
          </div>
        </div>
        {expanded ? (
          <div className="lighttable-group__controls">
            <CurvesEditor
              curves={adjustments.curves}
              channel={curveChannel}
              histogram={histogram}
              disabled={!metadata || !visible}
              onChannelChange={setCurveChannel}
              onChange={updateCurve}
              onReset={resetCurve}
              onInteractionStart={beginAdjustmentTransaction}
              onInteractionEnd={endAdjustmentTransaction}
            />
          </div>
        ) : null}
      </section>
    );
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!metadata) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const currentScale = activeScale;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale * Math.exp(-event.deltaY * 0.0015)));
    const centerX = viewportSize.width / 2;
    const centerY = viewportSize.height / 2;
    const imageX = (cursorX - centerX - view.panX) / currentScale;
    const imageY = (cursorY - centerY - view.panY) / currentScale;
    setZoomMode('custom');
    setView({
      scale: nextScale,
      panX: cursorX - centerX - imageX * nextScale,
      panY: cursorY - centerY - imageY * nextScale
    });
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
    setView((current) => ({
      ...current,
      panX: drag.panX + event.clientX - drag.x,
      panY: drag.panY + event.clientY - drag.y
    }));
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const mergeBounds = (first: Rect | null, second: Rect | null): Rect | null => {
    if (!first) return second;
    if (!second) return first;
    const left = Math.min(first.x, second.x);
    const top = Math.min(first.y, second.y);
    const right = Math.max(first.x + first.width, second.x + second.width);
    const bottom = Math.max(first.y + first.height, second.y + second.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  const documentPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!metadata) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left - imageRect.x) / Math.max(activeScale, 0.0001);
    const y = (event.clientY - bounds.top - imageRect.y) / Math.max(activeScale, 0.0001);
    if (x < 0 || y < 0 || x > metadata.width || y > metadata.height) return null;
    return { x, y, pressure: event.pressure > 0 ? event.pressure : 1 };
  };

  const updateBrushCursor = (event: React.PointerEvent<HTMLDivElement>) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    if (!isPaintTool(editorSession.activeTool) || temporaryPanRef.current || focusPickerActive || !metadata) {
      brushCursorCenterRef.current = null;
      cursor.style.opacity = '0';
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const insideDocument = x >= imageRect.x
      && y >= imageRect.y
      && x <= imageRect.x + imageRect.width
      && y <= imageRect.y + imageRect.height;
    if (!insideDocument) {
      brushCursorCenterRef.current = null;
      cursor.style.opacity = '0';
      return;
    }
    const diameter = Math.max(2, editorSession.brush.size * activeScale);
    brushCursorCenterRef.current = { x, y };
    cursor.style.opacity = '1';
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate3d(${x - diameter / 2}px, ${y - diameter / 2}px, 0)`;
  };

  const linearBrushColor = (hex: string): [number, number, number] => {
    const channel = (offset: number) => {
      const encoded = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
    };
    return [channel(1), channel(3), channel(5)];
  };

  const fillActiveTarget = (color: string) => {
    const current = imageDocumentRef.current;
    const engine = engineRef.current;
    if (!current || !engine || !current.activeLayerId) return;
    const channel = editorSession.activeChannel;
    const layer = channel === 'mask'
      ? findDocumentLayer(current, current.activeLayerId)
      : findRasterLayer(current, current.activeLayerId);
    if (!layer) {
      setError(channel === 'mask'
        ? 'Select a layer with an editable mask before filling.'
        : 'Select a raster layer before filling.');
      return;
    }
    try {
      engine.beginBrushStroke(layer, channel);
      const preserveTransparency = channel === 'pixels'
        && layer.type === 'raster'
        && layer.locks.transparency;
      if (!engine.fillLayerColor(
        layer.id,
        channel,
        linearBrushColor(color),
        preserveTransparency
      )) {
        engine.cancelPixelEdit();
        throw new Error('The active fill target is not available on the GPU.');
      }
      const pixelEdit = engine.finishPixelEdit();
      if (!pixelEdit) throw new Error('The fill operation could not create an undo snapshot.');
      const dirtyBounds = { x: 0, y: 0, width: current.width, height: current.height };
      const next = channel === 'mask'
        ? markLayerMaskPixelsChanged(current, layer.id, dirtyBounds)
        : markLayerPixelsChanged(current, layer.id, dirtyBounds);
      applyDocumentSnapshot(next);
      pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: [layer.id],
        undo: () => {
          if (!engineRef.current?.applyPixelHistory(pixelEdit, 'undo')) {
            throw new Error('Fill undo is no longer available.');
          }
          applyDocumentSnapshot(current);
        },
        redo: () => {
          if (!engineRef.current?.applyPixelHistory(pixelEdit, 'redo')) {
            throw new Error('Fill redo is no longer available.');
          }
          applyDocumentSnapshot(next);
        },
        dispose: pixelEdit.destroy
      });
      setError(null);
      setGradeStatus(`${channel === 'mask' ? 'Mask' : layer.name} filled with ${color.toUpperCase()}`);
    } catch (reason) {
      engine.cancelPixelEdit();
      setError(reason instanceof Error ? reason.message : 'The active target could not be filled.');
    }
  };
  fillActiveTargetRef.current = fillActiveTarget;

  const paintDabs = (layerId: LayerId, dabs: ReturnType<StrokeBuilder['add']>) => {
    if (!dabs.length) return;
    const brush = editorSession.brush;
    engineRef.current?.paintBrushDabs(
      layerId,
      brushStrokeChannelRef.current,
      dabs,
      linearBrushColor(brush.color),
      brush.hardness,
      brush.opacity,
      brush.flow,
      brushStrokeEraseRef.current,
      brushStrokeTransformRef.current
    );
    strokeDirtyBoundsRef.current = mergeBounds(strokeDirtyBoundsRef.current, boundsForDabs(dabs));
  };

  const beginViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    updateBrushCursor(event);
    if (temporaryPanRef.current) {
      beginPan(event, true);
      event.preventDefault();
      return;
    }
    if (isSelectionTool(editorSession.activeTool) && !focusPickerActive) {
      if (event.button !== 0 || !metadata) return;
      const point = documentPoint(event);
      if (!point) return;
      const start = { x: point.x, y: point.y };
      const shape: SelectionShape = {
        kind: selectionKindForTool(editorSession.activeTool),
        points: editorSession.activeTool === 'select-free' ? [start] : [start, start]
      };
      selectionDraftRef.current = shape;
      selectionPointerIdRef.current = event.pointerId;
      setSelectionDraft(shape);
      setEditorSession((current) => ({ ...current, pointerId: event.pointerId }));
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (editorSession.activeTool === 'fill' && !focusPickerActive) {
      if (event.button !== 0 || !documentPoint(event)) return;
      fillActiveTarget(editorSession.brush.color);
      event.preventDefault();
      return;
    }
    if (!isPaintTool(editorSession.activeTool) || focusPickerActive) {
      beginPan(event);
      return;
    }
    if (event.button !== 0 || !imageDocument) return;
    const point = documentPoint(event);
    const layer = editorSession.activeChannel === 'mask'
      ? findDocumentLayer(imageDocument, imageDocument.activeLayerId)
      : findRasterLayer(imageDocument, imageDocument.activeLayerId);
    if (!point || !layer) return;
    try {
      brushStrokeChannelRef.current = editorSession.activeChannel;
      brushStrokeEraseRef.current = editorSession.activeTool === 'erase';
      // Keep the mask's local-to-document matrix stable for the complete
      // pointer gesture. Dabs must never switch coordinate spaces mid-stroke.
      brushStrokeTransformRef.current = paintTargetSourceToDocument(
        layer,
        brushStrokeChannelRef.current
      );
      engineRef.current?.beginBrushStroke(layer, brushStrokeChannelRef.current);
      const builder = new StrokeBuilder(editorSession.brush.size, editorSession.brush.spacing);
      strokeBuilderRef.current = builder;
      strokeDirtyBoundsRef.current = null;
      brushPointerIdRef.current = event.pointerId;
      paintDabs(layer.id, builder.begin(point));
      setEditorSession((current) => ({ ...current, pointerId: event.pointerId }));
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The brush stroke could not be started.');
    }
  };

  const moveViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    updateBrushCursor(event);
    if (temporaryPanRef.current || dragRef.current?.pointerId === event.pointerId) {
      movePan(event);
      return;
    }
    if (selectionPointerIdRef.current === event.pointerId && selectionDraftRef.current) {
      const point = documentPoint(event);
      if (!point) return;
      const current = selectionDraftRef.current;
      let next: SelectionShape;
      if (current.kind === 'free') {
        const last = current.points[current.points.length - 1];
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (dx * dx + dy * dy < 4) return;
        next = { ...current, points: [...current.points, { x: point.x, y: point.y }] };
      } else {
        next = { ...current, points: [current.points[0], { x: point.x, y: point.y }] };
      }
      selectionDraftRef.current = next;
      setSelectionDraft(next);
      event.preventDefault();
      return;
    }
    if (!isPaintTool(editorSession.activeTool) || brushPointerIdRef.current !== event.pointerId) {
      movePan(event);
      return;
    }
    const point = documentPoint(event);
    const layerId = imageDocumentRef.current?.activeLayerId;
    if (!point || !layerId || !strokeBuilderRef.current) return;
    paintDabs(layerId, strokeBuilderRef.current.add(point));
    event.preventDefault();
  };

  const endViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionPointerIdRef.current === event.pointerId) {
      const shape = selectionDraftRef.current;
      selectionDraftRef.current = null;
      selectionPointerIdRef.current = null;
      setSelectionDraft(null);
      setEditorSession((current) => ({ ...current, pointerId: null }));
      if (shape && selectionShapeIsValid(shape)) {
        const mode = selectionModeFromModifiers(event.shiftKey, event.altKey);
        const before = cloneSelection(editorSession.selection);
        const engine = engineRef.current;
        void engine?.setSelection(shape, mode).then((applied) => {
          if (!applied || engineRef.current !== engine) return;
          const operation: SelectionOperation = { mode, shape };
          const after = mode === 'replace' ? [operation] : [...before, operation];
          setEditorSession((current) => ({ ...current, selection: after }));
          pushSelectionHistory(before, after);
        });
      } else if (!event.shiftKey && !event.altKey) {
        const before = cloneSelection(editorSession.selection);
        engineRef.current?.clearSelection();
        setEditorSession((current) => ({ ...current, selection: [] }));
        if (before.length) pushSelectionHistory(before, []);
      }
      event.preventDefault();
      return;
    }
    if (brushPointerIdRef.current === event.pointerId) {
      const document = imageDocumentRef.current;
      const dirtyBounds = strokeDirtyBoundsRef.current;
      if (document?.activeLayerId && dirtyBounds) {
        const next = brushStrokeChannelRef.current === 'mask'
          ? markLayerMaskPixelsChanged(document, document.activeLayerId, dirtyBounds)
          : markLayerPixelsChanged(document, document.activeLayerId, dirtyBounds);
        imageDocumentRef.current = next;
        setImageDocument(next);
        engineRef.current?.setDocument(next);
        const pixelEdit = engineRef.current?.finishPixelEdit();
        if (pixelEdit) {
          pushHistoryEntry({
            byteSize: pixelEdit.byteSize,
            layerIds: [document.activeLayerId],
            undo: () => {
              if (!engineRef.current?.applyPixelHistory(pixelEdit, 'undo')) throw new Error('Brush undo is no longer available.');
              imageDocumentRef.current = document;
              setImageDocument(document);
              engineRef.current?.setDocument(document);
            },
            redo: () => {
              if (!engineRef.current?.applyPixelHistory(pixelEdit, 'redo')) throw new Error('Brush redo is no longer available.');
              imageDocumentRef.current = next;
              setImageDocument(next);
              engineRef.current?.setDocument(next);
            },
            dispose: pixelEdit.destroy
          });
        }
      } else {
        engineRef.current?.cancelPixelEdit();
      }
      strokeBuilderRef.current = null;
      strokeDirtyBoundsRef.current = null;
      brushPointerIdRef.current = null;
      brushStrokeTransformRef.current = identityMatrix();
      setEditorSession((current) => ({ ...current, pointerId: null }));
    }
    endPan(event);
  };

  const cancelViewportPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionPointerIdRef.current === event.pointerId) {
      selectionDraftRef.current = null;
      selectionPointerIdRef.current = null;
      setSelectionDraft(null);
    }
    if (brushPointerIdRef.current === event.pointerId) {
      const pixelEdit = engineRef.current?.finishPixelEdit();
      if (pixelEdit) {
        engineRef.current?.applyPixelHistory(pixelEdit, 'undo');
        pixelEdit.destroy();
      } else {
        engineRef.current?.cancelPixelEdit();
      }
      strokeBuilderRef.current = null;
      strokeDirtyBoundsRef.current = null;
      brushPointerIdRef.current = null;
      brushStrokeTransformRef.current = identityMatrix();
    }
    setEditorSession((current) => ({ ...current, pointerId: null }));
    endPan(event);
  };

  const applyDocumentChange = (
    change: (current: ImageDocument) => ImageDocument,
    recordHistory = true
  ) => {
    const current = imageDocumentRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    applyDocumentSnapshot(next);
    if (recordHistory && !documentTransactionRef.current) pushDocumentHistory(current, next);
  };

  const copySelectedContent = () => {
    const document = imageDocumentRef.current;
    const engine = engineRef.current;
    const activeLayer = document ? findRasterLayer(document, document.activeLayerId) : null;
    if (!document || !engine || !activeLayer || !editorSession.selection.length) return;
    if (!engine.copySelectedLayerContent(document, activeLayer.id)) {
      setError('The selected pixels could not be copied from the active layer.');
      return;
    }
    setSelectionClipboardAvailable(true);
    setGradeStatus('Selected pixels copied');
  };
  copySelectedContentRef.current = copySelectedContent;

  const pasteSelectedContent = () => {
    const before = imageDocumentRef.current;
    const engine = engineRef.current;
    if (!before || !engine || !engine.hasSelectionClipboard()) return;
    const insertionTarget = before.activeLayerId ?? undefined;
    let after = createRasterLayer(before, 'Pasted Selection', insertionTarget);
    const pastedLayerId = after.activeLayerId;
    if (!pastedLayerId) return;
    const dirtyBounds = editorSession.selection.length
      ? selectionOperationsBounds(
          editorSession.selection,
          { x: 0, y: 0, width: before.width, height: before.height }
        )
      : { x: 0, y: 0, width: before.width, height: before.height };
    after = markLayerPixelsChanged(after, pastedLayerId, dirtyBounds);
    applyDocumentSnapshot(after);
    if (!engine.pasteSelectionClipboard(pastedLayerId)) {
      applyDocumentSnapshot(before);
      setError('The copied pixels could not be pasted into a new layer.');
      return;
    }
    pushDocumentHistory(before, after);
    setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
    setGradeStatus('Pasted selection into a new layer');
  };
  pasteSelectedContentRef.current = pasteSelectedContent;

  const layerViaCopy = () => {
    const before = imageDocumentRef.current;
    const engine = engineRef.current;
    const sourceId = before?.activeLayerId;
    if (!before || !engine || !sourceId) return;

    // With no active selection this is a normal lossless layer duplicate,
    // including its mask, transform and layer properties.
    if (!editorSession.selection.length) {
      duplicateActiveLayer();
      setGradeStatus('Layer copied');
      return;
    }

    const sourceLayer = findRasterLayer(before, sourceId);
    if (!sourceLayer || !engine.copySelectedLayerContent(before, sourceId)) {
      setError('The selected pixels could not be copied from the active layer.');
      return;
    }

    let after = createRasterLayer(before, `${sourceLayer.name} copy`, sourceId);
    const copiedLayerId = after.activeLayerId;
    if (!copiedLayerId) return;
    const dirtyBounds = selectionOperationsBounds(
      editorSession.selection,
      { x: 0, y: 0, width: before.width, height: before.height }
    );
    after = markLayerPixelsChanged(after, copiedLayerId, dirtyBounds);
    applyDocumentSnapshot(after);
    if (!engine.pasteSelectionClipboard(copiedLayerId)) {
      applyDocumentSnapshot(before);
      setError('The selected pixels could not be placed on a new layer.');
      return;
    }
    pushDocumentHistory(before, after);
    setSelectionClipboardAvailable(true);
    setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
    setGradeStatus('Selection copied to a new layer');
  };
  layerViaCopyRef.current = layerViaCopy;

  const cancelAutoAlignPreview = () => {
    autoAlignAbortRef.current?.abort();
    autoAlignAbortRef.current = null;
    if (autoAlignPreview) {
      engineRef.current?.clearTranslationAlignmentPreview(autoAlignPreview.targetLayerId);
    }
    setAutoAlignPreview(null);
    setGradeStatus(null);
  };
  cancelAutoAlignRef.current = cancelAutoAlignPreview;

  const applyAutoAlignPreview = () => {
    const before = imageDocumentRef.current;
    if (!before || !autoAlignPreview) return;
    const result = autoAlignPreview;
    const after = applyTranslationAlignment(before, autoAlignPreview);
    setAutoAlignPreview(null);
    if (after === before) {
      engineRef.current?.clearTranslationAlignmentPreview(result.targetLayerId);
      setGradeStatus('Auto Align found no geometry change to apply.');
      return;
    }

    // Commit the document transform before removing the compositor-only
    // preview. This keeps preview -> committed rendering atomic: there is no
    // frame in which the layer briefly falls back to its old geometry.
    applyDocumentSnapshot(after);
    engineRef.current?.clearTranslationAlignmentPreview(result.targetLayerId);
    // A completed alignment is one non-destructive geometry undo step.
    pushDocumentHistory(before, after);
    const inliers = result.diagnostics.inlierCount;
    const matches = result.diagnostics.mutualMatches;
    setGradeStatus(
      inliers != null && matches != null
        ? `Auto Align applied to layer · ${inliers}/${matches} geometric inliers`
        : `Auto Align applied to layer · ${Math.round(result.confidence * 100)}% confidence`
    );
  };

  const beginAutoAlign = async () => {
    const document = imageDocumentRef.current;
    const engine = engineRef.current;
    const target = document ? findRasterLayer(document, document.activeLayerId) : null;
    const references = document
      ? walkRasterLayers(document.layers)
        .map(({ layer }) => layer)
        .filter((layer) => layer.id !== target?.id && layer.visible && layer.locks.all)
      : [];
    if (!document || !engine || !target || references.length !== 1) {
      setError('Auto Align needs one active target layer and exactly one other visible locked reference layer.');
      return;
    }

    autoAlignAbortRef.current?.abort();
    if (autoAlignPreview) engine.clearTranslationAlignmentPreview(autoAlignPreview.targetLayerId);
    setAutoAlignPreview(null);
    const controller = new AbortController();
    autoAlignAbortRef.current = controller;
    setGradeStatus('Analyzing layer alignment...');
    setError(null);
    try {
      const result = await engine.alignLayersTranslation(
        references[0].id,
        target.id,
        {},
        controller.signal
      );
      if (controller.signal.aborted || autoAlignAbortRef.current !== controller) return;
      if (!engine.previewTranslationAlignment(result)) {
        throw new Error('The Auto Align preview could not be displayed.');
      }
      setAutoAlignPreview(result);
      const model = result.model === 'similarity' ? 'scale / rotate / move' : 'move';
      const estimate = result.diagnostics;
      const scale = estimate.estimatedScale != null
        ? ` · ${(100 / estimate.estimatedScale).toFixed(1)}% correction`
        : '';
      const rotation = estimate.estimatedRotationDegrees != null
        && Math.abs(estimate.estimatedRotationDegrees) >= 0.05
        ? ` · ${(-estimate.estimatedRotationDegrees).toFixed(2)}° correction`
        : '';
      const evidence = estimate.inlierCount != null && estimate.mutualMatches != null
        ? ` · ${estimate.inlierCount}/${estimate.mutualMatches} inliers`
        : ` · ${Math.round(result.confidence * 100)}% confidence`;
      const coverage = estimate.coverageCells != null
        ? ` · ${estimate.coverageCells}/16 regions`
        : '';
      const residual = estimate.medianResidual != null
        ? ` · ${estimate.medianResidual.toFixed(2)} px residual`
        : '';
      setGradeStatus(
        `Auto Align ${model} preview${evidence}${coverage}${residual}${scale}${rotation}`
      );
    } catch (reason) {
      if (!controller.signal.aborted) {
        setGradeStatus(null);
        setError(reason instanceof Error ? reason.message : 'Auto Align failed.');
      }
    } finally {
      if (autoAlignAbortRef.current === controller) autoAlignAbortRef.current = null;
    }
  };

  const beginDocumentTransaction = () => {
    if (!documentTransactionRef.current && imageDocumentRef.current) {
      documentTransactionRef.current = imageDocumentRef.current;
    }
  };

  const openLayerStyleEditor = (layerId: LayerId, effectId?: LayerStyleId) => {
    const current = imageDocumentRef.current;
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || layer?.type !== 'raster') return;
    engineRef.current?.setLayerStyleInteractionActive(true);
    setStyleEditorRequest({ layerId, effectId, before: current });
  };

  const previewLayerStyleStack = (stack: LayerStyleStack) => {
    const current = imageDocumentRef.current;
    if (!current || !styleEditorRequest) return;
    const next = setLayerStyleStack(current, styleEditorRequest.layerId, stack);
    if (next !== current) applyDocumentSnapshot(next);
  };

  const cancelLayerStyleEditor = () => {
    if (!styleEditorRequest) return;
    applyDocumentSnapshot(styleEditorRequest.before);
    engineRef.current?.setLayerStyleInteractionActive(false);
    setStyleEditorRequest(null);
  };

  const commitLayerStyleEditor = () => {
    if (!styleEditorRequest) return;
    const after = imageDocumentRef.current;
    if (after && after !== styleEditorRequest.before) {
      pushDocumentHistory(styleEditorRequest.before, after);
    }
    engineRef.current?.setLayerStyleInteractionActive(false);
    setStyleEditorRequest(null);
  };

  useEffect(() => {
    if (!styleEditorRequest) return;
    const layer = imageDocument
      ? findDocumentLayer(imageDocument, styleEditorRequest.layerId)
      : null;
    if (layer?.type === 'raster') return;
    // Undo/document replacement can remove the edited layer while the modal
    // editor is open. Do not leave the renderer stuck in preview quality.
    engineRef.current?.setLayerStyleInteractionActive(false);
    setStyleEditorRequest(null);
  }, [imageDocument, styleEditorRequest]);

  const beginTransform = async () => {
    if (transformStateRef.current) return;
    const launchId = ++transformLaunchRef.current;
    const document = imageDocumentRef.current;
    const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
    if (!document || !layer) {
      setError('Select a raster layer before transforming.');
      setEditorSession((current) => ({ ...current, activeTool: 'view' }));
      return;
    }
    const selectionRequested = editorSession.selection.length > 0;
    // Pixel-selection transforms are currently baked in document space. A
    // raster layer with a non-identity transform still owns layer-local pixels,
    // so applying that path would mix coordinate spaces. Repeatedly
    // transforming the layer itself is exact, however, and must not make the
    // Transform tool appear to bounce back to Pan because of a stale selection.
    let usesSelection = selectionRequested
      && matrixApproximatelyEqual(layer.transform, identityMatrix());
    let sourceMatrix = usesSelection ? identityMatrix() : layer.transform;
    try {
      let measuredContent = usesSelection
        ? await engineRef.current?.measureSelectedLayerContent(layer)
        : await engineRef.current?.measureLayerContent(layer);
      if (launchId !== transformLaunchRef.current || transformStateRef.current) return;
      // A selection can legitimately miss every visible pixel on the active
      // layer. Keep the user's selection intact, but allow Free Transform to
      // operate on the visible layer rather than silently returning to Pan.
      if (!measuredContent && usesSelection) {
        usesSelection = false;
        sourceMatrix = layer.transform;
        measuredContent = await engineRef.current?.measureLayerContent(layer);
        if (launchId !== transformLaunchRef.current || transformStateRef.current) return;
      }
      if (!measuredContent) {
        setError('The active layer does not contain visible pixels.');
        setEditorSession((current) => ({ ...current, activeTool: 'view' }));
        return;
      }
      const sourceBounds = usesSelection
        ? measuredContent.coreBounds
        : transformedBounds(sourceMatrix, measuredContent.coreBounds);
      const supportBounds = usesSelection
        ? measuredContent.supportBounds
        : transformedBounds(sourceMatrix, measuredContent.supportBounds);
      const state: TransformSessionState = {
        layerId: layer.id,
        sourceBounds,
        supportBounds,
        sourceMatrix,
        matrix: identityMatrix(),
        sourceKind: usesSelection ? 'selection' : 'layer'
      };
      engineRef.current?.beginLayerTransform(layer, usesSelection);
      engineRef.current?.updateLayerTransform(multiplyMatrices(state.matrix, state.sourceMatrix));
      transformStateRef.current = state;
      setTransformState(state);
      setError(null);
      if (selectionRequested && !usesSelection) {
        setGradeStatus(
          matrixApproximatelyEqual(layer.transform, identityMatrix())
            ? 'The selection contains no visible pixels; transforming the active layer'
            : 'Transforming the active layer; rasterize it first to transform selected pixels'
        );
      }
    } catch (reason) {
      engineRef.current?.cancelLayerTransform();
      setError(reason instanceof Error ? reason.message : 'The transform could not be started.');
      setEditorSession((current) => ({ ...current, activeTool: 'view' }));
    }
  };

  const updateTransformMatrix = (matrix: AffineMatrix) => {
    const current = transformStateRef.current;
    if (
      !current
      || !engineRef.current?.updateLayerTransform(multiplyMatrices(matrix, current.sourceMatrix))
    ) return;
    const next = { ...current, matrix };
    transformStateRef.current = next;
    setTransformState(next);
  };

  const finishTransform = (commit: boolean) => {
    const state = transformStateRef.current;
    if (!state) return;
    transformLaunchRef.current += 1;
    const beforeDocument = imageDocumentRef.current;
    const beforeSelection = cloneSelection(editorSession.selection);
    transformStateRef.current = null;
    setTransformState(null);
    setEditorSession((current) => ({ ...current, pointerId: null, activeTool: 'view' }));

    if (!commit || matrixApproximatelyEqual(state.matrix, identityMatrix()) || !beforeDocument) {
      engineRef.current?.cancelLayerTransform();
      return;
    }
    if (state.sourceKind === 'layer') {
      engineRef.current?.cancelLayerTransform();
      const afterDocument = setLayerTransform(
        beforeDocument,
        state.layerId,
        multiplyMatrices(state.matrix, state.sourceMatrix)
      );
      if (afterDocument !== beforeDocument) {
        applyDocumentSnapshot(afterDocument);
        pushDocumentHistory(beforeDocument, afterDocument);
      }
      return;
    }
    const edit = engineRef.current?.commitLayerTransform();
    if (!edit) {
      setError('The transform could not be committed.');
      engineRef.current?.cancelLayerTransform();
      return;
    }
    const dirtyBounds = mergeBounds(state.supportBounds, transformedBounds(state.matrix, state.supportBounds))
      ?? { x: 0, y: 0, width: beforeDocument.width, height: beforeDocument.height };
    const afterDocument = markLayerPixelsChanged(beforeDocument, state.layerId, dirtyBounds);
    const afterSelection = state.sourceKind === 'selection'
      ? transformSelectionOperations(beforeSelection, state.matrix)
      : beforeSelection;
    imageDocumentRef.current = afterDocument;
    setImageDocument(afterDocument);
    engineRef.current?.setDocument(afterDocument);
    setEditorSession((current) => ({ ...current, selection: afterSelection }));
    pushHistoryEntry({
      byteSize: edit.byteSize,
      layerIds: [state.layerId],
      undo: () => {
        if (!engineRef.current?.applyPixelHistory(edit, 'undo')) {
          throw new Error('Transform undo is no longer available.');
        }
        imageDocumentRef.current = beforeDocument;
        setImageDocument(beforeDocument);
        engineRef.current?.setDocument(beforeDocument);
        setEditorSession((current) => ({ ...current, selection: beforeSelection }));
      },
      redo: () => {
        if (!engineRef.current?.applyPixelHistory(edit, 'redo')) {
          throw new Error('Transform redo is no longer available.');
        }
        imageDocumentRef.current = afterDocument;
        setImageDocument(afterDocument);
        engineRef.current?.setDocument(afterDocument);
        setEditorSession((current) => ({ ...current, selection: afterSelection }));
      },
      dispose: edit.destroy
    });
  };

  commitTransformRef.current = () => finishTransform(true);
  cancelTransformRef.current = () => finishTransform(false);

  useEffect(() => {
    if (editorSession.activeTool !== 'transform') {
      transformLaunchRef.current += 1;
      if (transformStateRef.current) finishTransform(true);
      return;
    }
    if (
      transformStateRef.current
      && transformStateRef.current.layerId !== imageDocument?.activeLayerId
    ) {
      finishTransform(true);
      return;
    }
    void beginTransform();
  // Transform session ownership is intentionally keyed to the selected tool
  // and layer. Matrix updates must not recreate the GPU session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSession.activeTool, imageDocument?.activeLayerId]);

  const selectTool = (activeTool: ToolId) => {
    if (activeTool === 'transform' && editorSession.activeTool === 'transform') {
      finishTransform(true);
      return;
    }
    if (transformStateRef.current && activeTool !== 'transform') finishTransform(true);
    setEditorSession((current) => ({ ...current, activeTool }));
  };

  const duplicateActiveLayer = () => {
    const current = imageDocumentRef.current;
    if (!current?.activeLayerId) return;
    const sourceId = current.activeLayerId;
    const next = duplicateLayer(current, sourceId);
    if (next === current || !next.activeLayerId) return;
    imageDocumentRef.current = next;
    setImageDocument(next);
    engineRef.current?.setDocument(next);
    engineRef.current?.duplicateLayerPixels(sourceId, next.activeLayerId);
    pushDocumentHistory(current, next);
    setEditorSession((session) => ({ ...session, activeChannel: 'pixels' }));
  };

  const mergeSelectedRasterLayers = (selectedLayerIds: LayerId[]) => {
    const current = imageDocumentRef.current;
    if (!current) return;
    const plan = getMergeRasterLayersPlan(current, selectedLayerIds);
    if (!plan) {
      setError('Merge Selected requires two or more contiguous raster layers in the same group.');
      return;
    }
    engineRef.current?.beginLayerPixelEdit(plan.destinationId);
    if (!engineRef.current?.mergeLayers(current, plan.layerIds, plan.destinationId)) {
      engineRef.current?.cancelPixelEdit();
      setError('The selected layers could not be merged on the GPU.');
      return;
    }
    const pixelEdit = engineRef.current.finishPixelEdit();
    const next = mergeRasterLayers(current, plan.layerIds);
    applyDocumentSnapshot(next);
    if (pixelEdit) {
      pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: plan.layerIds,
        undo: () => {
          applyDocumentSnapshot(current);
          if (!engineRef.current?.applyPixelHistory(pixelEdit, 'undo')) throw new Error('Merge undo is no longer available.');
        },
        redo: () => {
          if (!engineRef.current?.applyPixelHistory(pixelEdit, 'redo')) throw new Error('Merge redo is no longer available.');
          applyDocumentSnapshot(next);
        },
        dispose: pixelEdit.destroy
      });
    }
    setEditorSession((session) => ({ ...session, activeChannel: 'pixels' }));
  };

  const mergeActiveLayerDown = () => {
    const current = imageDocumentRef.current;
    if (!current?.activeLayerId) return;
    const siblings = siblingLayers(current, current.activeLayerId);
    const index = siblings.findIndex((layer) => layer.id === current.activeLayerId);
    if (index <= 0) return;
    const top = siblings[index];
    const bottom = siblings[index - 1];
    if (top?.type !== 'raster' || bottom?.type !== 'raster') return;
    mergeSelectedRasterLayers([bottom.id, top.id]);
  };

  const commitFlattenRequest = () => {
    const request = flattenRequest;
    const current = imageDocumentRef.current;
    const engine = engineRef.current;
    setFlattenRequest(null);
    if (!request || !current || !engine) return;
    const plan = request.kind === 'group'
      ? getFlattenGroupPlan(current, request.groupId)
      : getFlattenImagePlan(current);
    if (!plan) {
      setError(
        request.kind === 'group'
          ? 'This group cannot be flattened until its adjustment layers are rasterized.'
          : 'This image cannot be flattened until its adjustment layers are rasterized.'
      );
      return;
    }
    engine.beginLayerPixelEdit(plan.destinationId);
    const rendered = request.kind === 'group'
      ? engine.flattenGroup(current, request.groupId, plan.destinationId)
      : engine.flattenImage(current, plan.destinationId);
    if (!rendered) {
      engine.cancelPixelEdit();
      setError('The layer stack could not be flattened on the GPU.');
      return;
    }
    const pixelEdit = engine.finishPixelEdit();
    const next = request.kind === 'group'
      ? flattenGroup(current, request.groupId)
      : flattenImage(current);
    if (!pixelEdit || next === current) {
      pixelEdit?.destroy();
      setError('The flattened result could not create a recoverable undo step.');
      return;
    }
    applyDocumentSnapshot(next);
    pushHistoryEntry({
      byteSize: pixelEdit.byteSize,
      layerIds: plan.layerIds,
      undo: () => {
        applyDocumentSnapshot(current);
        if (!engineRef.current?.applyPixelHistory(pixelEdit, 'undo')) {
          throw new Error('Flatten undo is no longer available.');
        }
      },
      redo: () => {
        if (!engineRef.current?.applyPixelHistory(pixelEdit, 'redo')) {
          throw new Error('Flatten redo is no longer available.');
        }
        applyDocumentSnapshot(next);
      },
      dispose: pixelEdit.destroy
    });
    setEditorSession((session) => ({ ...session, activeChannel: 'pixels' }));
    setGradeStatus(request.kind === 'group' ? 'Group flattened' : 'Image flattened');
  };

  const invertActiveLayerColors = () => {
    const current = imageDocumentRef.current;
    const layerId = current?.activeLayerId;
    const channel = editorSession.activeChannel;
    const activeLayer = current
      ? (channel === 'mask'
          ? findDocumentLayer(current, layerId ?? null)
          : findRasterLayer(current, layerId ?? null))
      : null;
    const engine = engineRef.current;
    if (!current || !layerId || !activeLayer || !engine) return;
    if (layerIsLocked(activeLayer, 'pixels')) {
      setError(`Unlock the active layer before inverting its ${channel === 'mask' ? 'mask' : 'colors'}.`);
      return;
    }
    if (channel === 'mask' && !activeLayer.mask) {
      setError('Add or select a layer mask before inverting it.');
      return;
    }
    try {
      engine.beginLayerPixelEdit(layerId, channel);
      if (!engine.invertLayerColors(layerId, channel)) {
        engine.cancelPixelEdit();
        throw new Error(`The active ${channel === 'mask' ? 'mask' : 'layer pixels'} are not available on the GPU.`);
      }
      const pixelEdit = engine.finishPixelEdit();
      if (!pixelEdit) throw new Error('The invert operation could not create an undo snapshot.');
      const dirtyBounds = { x: 0, y: 0, width: current.width, height: current.height };
      const next = channel === 'mask'
        ? markLayerMaskPixelsChanged(current, layerId, dirtyBounds)
        : markLayerPixelsChanged(current, layerId, dirtyBounds);
      applyDocumentSnapshot(next);
      pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: [layerId],
        undo: () => {
          if (!engineRef.current?.applyPixelHistory(pixelEdit, 'undo')) {
            throw new Error('Invert colors undo is no longer available.');
          }
          applyDocumentSnapshot(current);
        },
        redo: () => {
          if (!engineRef.current?.applyPixelHistory(pixelEdit, 'redo')) {
            throw new Error('Invert colors redo is no longer available.');
          }
          applyDocumentSnapshot(next);
        },
        dispose: pixelEdit.destroy
      });
      setError(null);
      setGradeStatus(`Inverted ${channel === 'mask' ? 'mask' : 'colors'} on ${activeLayer.name}`);
    } catch (reason) {
      engine.cancelPixelEdit();
      setError(reason instanceof Error ? reason.message : `The active ${channel === 'mask' ? 'mask' : 'layer colors'} could not be inverted.`);
    }
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
    const preview = await engine.exportPng();
    const document = imageDocumentRef.current;
    const recipeSourceKey = effectiveSourceFileKey;
    if (!document || !recipeSourceKey) throw new Error('The LightTable document is not ready yet.');
    if (
      rasterLayerCount(document) === 1
      && walkLayerTree(document.layers).length === 1
      && document.assets.preservedSources.length === 0
    ) {
      return {
        file: new File([preview], buildOutputName(fileNameBase), { type: 'image/png' }),
        recipe: createLightTableRecipe(recipeSourceKey, adjustmentsRef.current)
      };
    }
    const assets = [
      ...await engine.exportLayerAssets(document),
      ...preservedSourceAssetsRef.current
    ];
    const adjustmentStack = createAdjustmentStackFromBasicAdjustments(
      documentAdjustmentsRef.current,
      engine.getAdjustmentStack()
    );
    return {
      file: buildLayeredDocumentFile(preview, document, adjustmentStack, assets, buildOutputName(fileNameBase)),
      recipe: createLightTableRecipe(
        recipeSourceKey,
        effectiveDocumentAdjustments(document),
        'embedded-layered-png'
      )
    };
  };

  const handleSave = async () => {
    if (!metadata || !effectiveSourceFileKey || saving) return;
    setSaving(true);
    setError(null);
    try {
      const output = await exportOutput();
      const saved = await onSave(output.file, output.recipe);
      if (saved !== false) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'LightTable image could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      setError(null);
      const output = await exportOutput();
      const url = URL.createObjectURL(output.file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = output.file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'LightTable export failed.');
    }
  };

  const openLocalFile = async (file: File | null, decodeMode: LightTableImageDecodeMode) => {
    if (!file) return;
    cancelAutoAlignPreview();
    localImageLoadAbortRef.current?.abort();
    const controller = new AbortController();
    localImageLoadAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      await loadBlobIntoEngine(
        file,
        file.name,
        createDefaultAdjustments(),
        `${file.name}:${file.size}:${file.type}:${file.lastModified}${decodeMode === 'preserve-precision' ? ':preserve-precision' : ''}`,
        () => controller.signal.aborted,
        decodeMode,
        controller.signal
      );
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error
          ? reason.message
          : decodeMode === 'preserve-precision'
            ? 'The precision-preserving image import failed.'
            : 'The image could not be opened.');
      }
    } finally {
      if (localImageLoadAbortRef.current === controller) {
        localImageLoadAbortRef.current = null;
        setLoading(false);
      }
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
      const fallback = decodeMode === 'preserve-precision'
        ? advancedFileInputRef.current
        : fileInputRef.current;
      const file = await pickSupportedImageFile(decodeMode, fallback);
      if (file) await openLocalFile(file, decodeMode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The image file dialog could not be opened.');
    }
  };

  const appMenuOptions: Array<ContextMenuOption<string>> = (() => {
    if (appMenu?.id === 'file') {
      return [
        {
          value: 'open-image',
          label: `Open image (${imagePickerFormatNames('fast')})...`,
          onClick: () => void chooseLocalFile('fast'),
          disabled: saving
        },
        {
          value: 'open-image-preserve-precision',
          label: `Open image - preserve precision (${imagePickerFormatNames('preserve-precision')})...`,
          onClick: async () => {
            const { getAdvancedImageIoCapabilities } = await import('./image-io/advancedImageIoCapabilities');
            const capabilities = getAdvancedImageIoCapabilities();
            if (!capabilities.available) {
              setError(`Precision-preserving import is unavailable: ${capabilities.reasons.join(' ')}`);
              return;
            }
            await chooseLocalFile('preserve-precision');
          },
          disabled: saving
        },
        {
          value: 'save-corrected',
          label: saving
            ? 'Saving...'
            : imageDocument && walkLayerTree(imageDocument.layers).length > 1 ? 'Save layered LightTable document' : 'Save corrected PNG',
          onClick: () => void handleSave(),
          disabled: !metadata || !effectiveSourceFileKey || saving
        },
        {
          value: 'download',
          label: imageDocument && walkLayerTree(imageDocument.layers).length > 1 ? 'Download layered document' : 'Download PNG',
          onClick: () => void handleDownload(),
          disabled: !metadata || saving
        },
        {
          value: 'reset',
          label: 'Reset',
          separatorBefore: true,
          onClick: resetAll,
          disabled: !metadata || saving
        }
      ];
    }
    if (appMenu?.id === 'edit') {
      return [
        {
          value: 'copy-selected-content',
          label: `Copy selected content (${primaryShortcutLabel('C')})`,
          onClick: copySelectedContent,
          disabled: !metadata || !editorSession.selection.length || saving
        },
        {
          value: 'paste-selected-content',
          label: `Paste as new layer (${primaryShortcutLabel('V')})`,
          onClick: pasteSelectedContent,
          disabled: !metadata || !selectionClipboardAvailable || saving
        },
        {
          value: 'paste-grade',
          label: copiedGrade ? `Paste grade: ${copiedGrade.name}` : 'Paste grade',
          separatorBefore: true,
          onClick: pasteCurrentGrade,
          disabled: !metadata || !copiedGrade || saving
        },
        {
          value: 'copy-grade',
          label: 'Copy grade',
          onClick: copyCurrentGrade,
          disabled: !metadata || saving
        }
      ];
    }
    if (appMenu?.id === 'select') {
      return [
        {
          value: 'select-all',
          label: `Select all (${primaryShortcutLabel('A')})`,
          onClick: selectAllContent,
          disabled: !metadata || saving
        },
        {
          value: 'select-none',
          label: `Select none (${primaryShortcutLabel('D')})`,
          onClick: clearCurrentSelection,
          disabled: !editorSession.selection.length || saving
        },
        {
          value: 'invert-selection',
          label: `Invert selection (${primaryShortcutLabel('I', true)})`,
          onClick: invertCurrentSelection,
          disabled: !metadata || saving
        },
        {
          value: 'clear-selection',
          label: `Clear selection (${primaryShortcutLabel('D')})`,
          onClick: clearCurrentSelection,
          disabled: !editorSession.selection.length || saving
        },
        {
          value: 'feather-selection',
          label: 'Feather... (Shift+F6)',
          separatorBefore: true,
          onClick: () => setFeatherDialogOpen(true),
          disabled: !editorSession.selection.length || saving
        }
      ];
    }
    if (appMenu?.id === 'layer') {
      const document = imageDocumentRef.current;
      const activeLayer = document ? findDocumentLayer(document, document.activeLayerId) : null;
      const activeSiblings = activeLayer && document ? siblingLayers(document, activeLayer.id) : [];
      const activeIndex = activeLayer
        ? activeSiblings.findIndex((layer) => layer.id === activeLayer.id)
        : -1;
      return [
        {
          value: 'new-layer',
          label: 'New Raster Layer',
          onClick: () => {
            applyDocumentChange((current) => createRasterLayer(current));
            setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
          },
          disabled: !document
        },
        {
          value: 'duplicate-layer',
          label: 'Duplicate Layer',
          onClick: duplicateActiveLayer,
          disabled: !activeLayer || activeLayer.type !== 'raster'
        },
        {
          value: 'layer-via-copy',
          label: `Layer via Copy (${primaryShortcutLabel('J')})`,
          onClick: layerViaCopy,
          disabled: !activeLayer || activeLayer.type !== 'raster' || saving
        },
        {
          value: 'rename-layer',
          label: 'Rename Layer',
          onClick: focusActiveLayerName,
          disabled: !activeLayer
        },
        {
          value: 'invert-layer-colors',
          label: `Invert Colors (${primaryShortcutLabel('I')})`,
          separatorBefore: true,
          onClick: invertActiveLayerColors,
          disabled: !activeLayer
            || activeLayer.type !== 'raster'
            || layerIsLocked(activeLayer, 'pixels')
        },
        ...(autoAlignPreview ? [
          {
            value: 'apply-auto-align',
            label: 'Apply Auto Align',
            separatorBefore: true,
            onClick: applyAutoAlignPreview
          },
          {
            value: 'cancel-auto-align',
            label: 'Cancel Auto Align',
            onClick: cancelAutoAlignPreview
          }
        ] : [{
          value: 'auto-align',
          label: 'Auto Align to Locked Layer',
          separatorBefore: true,
          onClick: () => void beginAutoAlign(),
          disabled: !activeLayer
            || activeLayer.type !== 'raster'
            || layerIsLocked(activeLayer, 'position')
            || !activeLayer.visible
            || !document
            || walkRasterLayers(document.layers)
              .map(({ layer }) => layer)
              .filter((layer) =>
                layer.id !== activeLayer.id && layer.visible && layer.locks.all
              ).length !== 1
        }]),
        {
          value: 'clipping-mask',
          label: activeLayer?.clipping
            ? 'Release Clipping Mask'
            : 'Create Clipping Mask',
          separatorBefore: true,
          onClick: () => {
            if (activeLayer) {
              applyDocumentChange((current) =>
                setLayerClipping(current, activeLayer.id, !activeLayer.clipping));
            }
          },
          disabled: !activeLayer || (!activeLayer.clipping && activeIndex <= 0)
        },
        {
          value: 'blend-mode',
          label: 'Blend Mode',
          disabled: !activeLayer,
          children: BLEND_MODES.map((mode) => ({
            value: `blend-${mode.id}`,
            label: activeLayer?.blendMode === mode.id ? `${mode.label} ✓` : mode.label,
            separatorBefore: ['darken', 'lighten', 'overlay', 'difference', 'hue'].includes(mode.id),
            onClick: () => activeLayer && applyDocumentChange((current) => setLayerBlendMode(current, activeLayer.id, mode.id))
          }))
        },
        {
          value: 'edit-layer-pixels',
          label: editorSession.activeChannel === 'pixels' ? 'Edit Layer Pixels ✓' : 'Edit Layer Pixels',
          onClick: () => setEditorSession((current) => ({ ...current, activeChannel: 'pixels' })),
          disabled: !activeLayer || activeLayer.type !== 'raster'
        },
        {
          value: 'edit-layer-mask',
          label: editorSession.activeChannel === 'mask' ? 'Edit Layer Mask ✓' : 'Edit Layer Mask',
          onClick: () => setEditorSession((current) => ({ ...current, activeChannel: 'mask' })),
          disabled: !activeLayer?.mask
        },
        {
          value: 'add-mask',
          label: 'Add Layer Mask',
          separatorBefore: true,
          onClick: () => {
            if (!activeLayer) return;
            applyDocumentChange((current) => addLayerMask(current, activeLayer.id));
            setEditorSession((current) => ({ ...current, activeChannel: 'mask', brush: { ...current.brush, color: '#000000' } }));
          },
          disabled: !activeLayer || activeLayer.type === 'group' || Boolean(activeLayer.mask)
        },
        {
          value: 'toggle-mask',
          label: activeLayer?.mask?.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask',
          onClick: () => activeLayer?.mask && applyDocumentChange((current) => setLayerMaskEnabled(current, activeLayer.id, !activeLayer.mask!.enabled)),
          disabled: !activeLayer?.mask
        },
        {
          value: 'remove-mask',
          label: 'Remove Layer Mask',
          onClick: () => {
            if (!activeLayer) return;
            applyDocumentChange((current) => removeLayerMask(current, activeLayer.id));
            setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
          },
          disabled: !activeLayer?.mask
        },
        {
          value: 'move-up',
          label: 'Move Layer Up',
          separatorBefore: true,
          onClick: () => activeLayer && document && applyDocumentChange((current) => moveLayer(current, activeLayer.id, activeIndex + 1)),
          disabled: !activeLayer || activeIndex >= activeSiblings.length - 1
        },
        {
          value: 'move-down',
          label: 'Move Layer Down',
          onClick: () => activeLayer && applyDocumentChange((current) => moveLayer(current, activeLayer.id, activeIndex - 1)),
          disabled: !activeLayer || activeIndex <= 0
        },
        {
          value: 'merge-down',
          label: 'Merge Down',
          onClick: mergeActiveLayerDown,
          disabled: !activeLayer
            || activeLayer.type !== 'raster'
            || activeIndex <= 0
            || activeSiblings[activeIndex - 1]?.type !== 'raster'
        },
        {
          value: 'flatten-group',
          label: 'Flatten Group...',
          onClick: () => {
            if (activeLayer?.type === 'group') {
              setFlattenRequest({ kind: 'group', groupId: activeLayer.id });
            }
          },
          disabled: activeLayer?.type !== 'group'
            || !document
            || !getFlattenGroupPlan(document, activeLayer.id)
        },
        {
          value: 'flatten-image',
          label: 'Flatten Image...',
          onClick: () => setFlattenRequest({ kind: 'image' }),
          disabled: !document || !getFlattenImagePlan(document)
        },
        {
          value: 'toggle-visibility',
          label: activeLayer?.visible ? 'Hide Layer' : 'Show Layer',
          separatorBefore: true,
          onClick: () => activeLayer && applyDocumentChange((current) => setLayerVisibility(current, activeLayer.id, !activeLayer.visible)),
          disabled: !activeLayer
        },
        {
          value: 'toggle-lock',
          label: activeLayer?.locks.all ? 'Unlock Layer' : 'Lock Layer',
          onClick: () => activeLayer && applyDocumentChange((current) => setLayerLocked(current, activeLayer.id, !activeLayer.locks.all)),
          disabled: !activeLayer
        },
        {
          value: 'delete-layer',
          label: 'Delete Layer',
          separatorBefore: true,
          onClick: () => {
            if (!activeLayer) return;
            applyDocumentChange((current) => deleteLayer(current, activeLayer.id));
            setEditorSession((current) => ({ ...current, activeChannel: 'pixels' }));
          },
          disabled: !activeLayer || !document || (
            activeLayer.type === 'raster'
            && rasterLayerCount(document) <= 1
          )
        }
      ];
    }
    return [
      {
        value: 'fit',
        label: zoomMode === 'fit' ? 'Fit (current)' : 'Fit',
        onClick: () => {
          setZoomMode('fit');
          setView({ scale: 1, panX: 0, panY: 0 });
        },
        disabled: !metadata
      },
      {
        value: 'actual-size',
        label: zoomMode === '100' ? '100% (current)' : '100%',
        onClick: () => {
          setZoomMode('100');
          setView({ scale: 1, panX: 0, panY: 0 });
        },
        disabled: !metadata
      },
      {
        value: 'show-original',
        label: showOriginal ? 'Show corrected (P)' : 'Show original (P)',
        separatorBefore: true,
        onClick: () => {
          setShowDifference(false);
          setShowOriginal((current) => !current);
        },
        disabled: !metadata
      },
      {
        value: 'show-difference',
        label: showDifference ? 'Show corrected' : 'Show reference difference',
        onClick: () => {
          setShowOriginal(false);
          setShowDifference((current) => !current);
        },
        disabled: !metadata
      },
      {
        value: 'show-debug-panel',
        label: 'Debug panel',
        separatorBefore: true,
        onClick: () => workspaceRef.current?.showDebugPanel()
      },
      {
        value: 'reset-workspace-layout',
        label: 'Reset workspace layout',
        onClick: () => workspaceRef.current?.resetLayout()
      }
    ];
  })();

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

  if (!open) return null;

  return (
    <div
      className="modal-backdrop lighttable-backdrop"
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
            onToolChange={selectTool}
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
            documents={[{
              id: 'active-document',
              title: sourceName,
              onClose: saving ? undefined : onClose,
              content: (
                <section className="lighttable__main">
            <div
              ref={viewportRef}
              className={`lighttable-viewport lighttable-viewport--${temporaryPanActive ? 'view' : editorSession.activeTool}${dragRef.current ? ' lighttable-viewport--dragging' : ''}${focusPickerActive ? ' lighttable-viewport--focus-picker' : ''}`}
              onWheel={handleWheel}
              onPointerDown={beginViewportPointer}
              onPointerMove={moveViewportPointer}
              onPointerUp={endViewportPointer}
              onPointerCancel={cancelViewportPointer}
              onPointerLeave={() => {
                if (brushPointerIdRef.current === null && brushCursorRef.current) {
                  brushCursorCenterRef.current = null;
                  brushCursorRef.current.style.opacity = '0';
                }
              }}
            >
              <canvas ref={canvasRef} className="lighttable-viewport__canvas" />
              {isPaintTool(editorSession.activeTool) && !temporaryPanActive ? (
                <div ref={brushCursorRef} className="lighttable-brush-cursor" aria-hidden="true" />
              ) : null}
              {editorSession.activeTool !== 'view' && (editorSession.selection.length || selectionDraft) ? (
                <SelectionOverlay
                  operations={editorSession.selection}
                  draft={selectionDraft}
                  imageRect={imageRect}
                  scale={activeScale}
                  width={viewportSize.width}
                  height={viewportSize.height}
                />
              ) : null}
              {transformState ? (
                <TransformOverlay
                  state={transformState}
                  imageRect={imageRect}
                  scale={activeScale}
                  width={viewportSize.width}
                  height={viewportSize.height}
                  onChange={updateTransformMatrix}
                />
              ) : null}
              {loading ? <div className="lighttable-viewport__message">Loading image and WebGPU pipeline...</div> : null}
              {!loading && error && !metadata ? <div className="lighttable-viewport__message">LightTable is unavailable for this image.</div> : null}
            </div>

            <footer className="lighttable-toolbar">
              <div
                className={`lighttable-toolbar__status${error ? ' lighttable-toolbar__status--error' : ''}`}
                title={error ?? gradeStatus ?? undefined}
              >
                {error ?? gradeStatus ?? ''}
              </div>
              <div
                className={`lighttable-toolbar__meta${
                  imageDocument?.photoshopImportReport ? ' lighttable-toolbar__meta--report' : ''
                }`}
                role={imageDocument?.photoshopImportReport ? 'button' : undefined}
                tabIndex={imageDocument?.photoshopImportReport ? 0 : undefined}
                onClick={() => {
                  if (imageDocument?.photoshopImportReport) setPsdReportOpen(true);
                }}
                onKeyDown={(event) => {
                  if (
                    imageDocument?.photoshopImportReport
                    && (event.key === 'Enter' || event.key === ' ')
                  ) {
                    event.preventDefault();
                    setPsdReportOpen(true);
                  }
                }}
                title={[
                  formatStartupTimings(startupTimings),
                  psdImportInfo
                    ? [
                        'PSD layers are reconstructed by LightTable; the embedded Photoshop composite is retained only as the in-session Original/reference view and is not duplicated in native saves.',
                        `${psdImportInfo.inventory.layers} layers; ${psdImportInfo.inventory.groups} groups; `
                          + `${psdImportInfo.inventory.masks} masks; ${psdImportInfo.inventory.layerStyles} styled layers; `
                          + `${psdImportInfo.inventory.adjustments} adjustment layers; ${psdImportInfo.inventory.smartObjects} smart objects.`,
                        psdCompatibilitySummary
                          ? `Semantic import support: ${psdCompatibilitySummary}.`
                          : '',
                        psdDifferenceMetrics
                          ? `Reference difference: ${psdDifferenceMetrics.differingPixelPercentage.toFixed(3)}% above `
                            + `${Math.round(psdDifferenceMetrics.threshold * 255)}/255; mean RGB error `
                            + `${(psdDifferenceMetrics.meanAbsoluteRgbError * 100).toFixed(3)}%; maximum channel error `
                            + `${(psdDifferenceMetrics.maximumChannelError * 100).toFixed(2)}%; `
                            + `${psdDifferenceMetrics.sampledPixels.toLocaleString()} sampled pixels `
                            + `(stride ${psdDifferenceMetrics.stride}).`
                          : '',
                        ...psdImportInfo.warnings
                      ].join('\n')
                    : '',
                  gpuMemoryBytes > 0
                    ? 'GPU memory is an estimate of LightTable-owned textures; browsers do not expose driver VRAM usage.'
                    : ''
                ].filter(Boolean).join('\n') || undefined}
              >
                {metadata
                  ? [
                      `${metadata.width} × ${metadata.height}`,
                      `${Math.round(activeScale * 100)}%`,
                      metadata.decoder === 'wasm-vips'
                        ? [
                            `${metadata.sourceBitDepth}-bit ${metadata.sourceFormat}`,
                            metadata.sourceProfile,
                            'wasm-vips',
                            `${Math.round(metadata.decodeDurationMs ?? 0)} ms`
                          ].filter(Boolean).join(' · ')
                        : metadata.decoder === 'ag-psd'
                          ? [
                              `${metadata.sourceBitDepth}-bit ${metadata.sourceFormat}`,
                              metadata.sourceInterpretation,
                              'Photoshop composite'
                            ].filter(Boolean).join(' · ')
                          : null,
                      startupTimings?.firstFrameMs !== undefined
                        ? `ready ${Math.round(startupTimings.firstFrameMs)} ms`
                        : null,
                      gpuMemoryBytes > 0 ? `GPU ~${formatGpuMemory(gpuMemoryBytes)}` : null
                    ].filter(Boolean).join(' · ')
                  : 'No image'}
              </div>
              <div aria-hidden="true" />
            </footer>
                </section>
              )
            }]}
            activeDocumentId="active-document"
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
              <aside className="lighttable-panel">
                <div className="lighttable-panel__controls">
                  {renderLensDistortionGroup()}
                  {renderChromaticAberrationGroup()}
                  {renderLensBlurGroup()}
                  {renderHalationGroup()}
                  {renderGrainGroup()}
                </div>
              </aside>
            )}
            grade={(

              <aside className="lighttable-panel">
            <section className="lighttable-group lighttable-master-group">
              <div className="lighttable-group__header">
                <div className="lighttable-master-group__label">
                  <strong>All</strong>
                </div>
                <div className="lighttable-group__actions">
                  <button
                    type="button"
                    className="lighttable-group__reset"
                    onClick={resetAll}
                    aria-label="Reset all corrections"
                    title="Reset all corrections"
                  >
                    <img src={lightTableIcon('settings_reset.png')} alt="" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="lighttable-group__visibility"
                    onClick={() => {
                      setShowDifference(false);
                      setShowOriginal((current) => !current);
                    }}
                    aria-label={showOriginal ? 'Show image with all settings' : 'Show original image'}
                    title={`${showOriginal ? 'Show image with all settings' : 'Show original image'} (P)`}
                  >
                    <img src={lightTableIcon(showOriginal ? 'visible_off.png' : 'visible.png')} alt="" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </section>
            <div className="lighttable-panel__controls">
              {renderAdjustmentGroup('light', 'Light', LIGHT_SLIDERS)}
              {renderAdjustmentGroup('color', 'Color', COLOR_SLIDERS)}
              {renderAdjustmentGroup('effects', 'Effects', EFFECTS_SLIDERS)}
              {renderColorMixerGroup()}
              {renderColorGradingGroup()}
              {renderCurvesGroup()}
            </div>
              </aside>
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
