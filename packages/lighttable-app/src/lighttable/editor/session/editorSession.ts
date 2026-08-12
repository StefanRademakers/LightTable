import type {
  SelectionCombineMode,
  MagicWandOptions,
  SmartSelectionOptions,
  SelectionOperation,
  SelectionToolId
} from '../selection/selectionTypes';
import {
  createDefaultMagicWandOptions,
  createDefaultSmartSelectionOptions
} from '../selection/selectionTypes';
import type { WarpToolSettings } from '../../effects/warp/warpTypes';
import type { PathSelectionTarget, VectorPaint } from '@lighttable/vector-core';
import type { LayerId } from '../document/documentTypes';
import {
  createDefaultToneBrushSettings,
  type ToneBrushSettings
} from '../tools/paint/toneBrushTypes';
import type { BlendMode } from '../document/blendModes';
import type { VectorEditorToolId } from '../tools/vectorToolCatalog';
import { createDefaultGradientPaint, type GradientPaintInstance } from '@lighttable/paint-core';
import type { BrushPresetId } from '../tools/brush/brushPresets';
import type { SampledBrushSettings } from '../tools/paint/sampledBrushTypes';
import { createDefaultSnapSettings, type SnapSettings } from '../../application/tools/snapping/snapSettings';

export type ToolId =
  | 'view'
  | 'zoom'
  | 'transform'
  | 'warp'
  | 'face-warp'
  | 'fill'
  | 'brush'
  | 'clone-stamp'
  | 'healing-brush'
  | 'dodge'
  | 'burn'
  | 'sponge'
  | 'erase'
  | 'text-point'
  | 'text-paragraph'
  | 'text-vertical'
  | 'text-path'
  | VectorEditorToolId
  | SelectionToolId;
export type PaintChannel = 'pixels' | 'mask';

export interface VectorPathSelectionReference {
  layerId: LayerId;
  pathId: string;
}

export interface VectorElementSelectionReference {
  layerId: LayerId;
  elementId: string;
}

export interface VectorAnchorSelectionReference extends VectorPathSelectionReference {
  subpathId: string;
  anchorId: string;
}

export interface VectorActiveSelectionTarget extends VectorPathSelectionReference {
  target: PathSelectionTarget;
}

/**
 * Transient vector editing state for one document tab.
 *
 * References are fully scene-scoped. Path and anchor ids are only required to
 * be stable inside their owning vector layer, so storing an unscoped path id
 * here would make multi-document and nested-layer editing ambiguous.
 */
export interface VectorEditorSelection {
  elements: VectorElementSelectionReference[];
  paths: VectorPathSelectionReference[];
  anchors: VectorAnchorSelectionReference[];
  active: VectorActiveSelectionTarget | null;
}

export const createVectorEditorSelection = (): VectorEditorSelection => ({
  elements: [],
  paths: [],
  anchors: [],
  active: null
});

export const cloneVectorEditorSelection = (
  selection: VectorEditorSelection
): VectorEditorSelection => ({
  elements: selection.elements.map((reference) => ({ ...reference })),
  paths: selection.paths.map((reference) => ({ ...reference })),
  anchors: selection.anchors.map((reference) => ({ ...reference })),
  active: selection.active
    ? {
        ...selection.active,
        target: selection.active.target.kind === 'segment'
          ? {
              ...selection.active.target,
              point: { ...selection.active.target.point }
            }
          : { ...selection.active.target }
      }
    : null
});

const pathReferencesEqual = (
  left: readonly VectorPathSelectionReference[],
  right: readonly VectorPathSelectionReference[]
) => left.length === right.length && left.every((reference, index) => (
  reference.layerId === right[index]?.layerId
  && reference.pathId === right[index]?.pathId
));

const elementReferencesEqual = (
  left: readonly VectorElementSelectionReference[],
  right: readonly VectorElementSelectionReference[]
) => left.length === right.length && left.every((reference, index) => (
  reference.layerId === right[index]?.layerId
  && reference.elementId === right[index]?.elementId
));

const anchorReferencesEqual = (
  left: readonly VectorAnchorSelectionReference[],
  right: readonly VectorAnchorSelectionReference[]
) => left.length === right.length && left.every((reference, index) => (
  reference.layerId === right[index]?.layerId
  && reference.pathId === right[index]?.pathId
  && reference.subpathId === right[index]?.subpathId
  && reference.anchorId === right[index]?.anchorId
));

const targetsEqual = (
  left: PathSelectionTarget,
  right: PathSelectionTarget
) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'fill' && right.kind === 'fill') {
    return left.pathId === right.pathId;
  }
  if (left.kind === 'segment' && right.kind === 'segment') {
    return left.subpathId === right.subpathId
      && left.segmentIndex === right.segmentIndex
      && left.t === right.t
      && left.point.x === right.point.x
      && left.point.y === right.point.y;
  }
  if (left.kind !== 'fill' && left.kind !== 'segment'
    && right.kind !== 'fill' && right.kind !== 'segment') {
    return left.subpathId === right.subpathId && left.anchorId === right.anchorId;
  }
  return false;
};

/**
 * Selection is presentation state, not document state. A structural compare
 * prevents React object churn from scheduling redundant viewport frames.
 */
export const vectorEditorSelectionsEqual = (
  left: VectorEditorSelection,
  right: VectorEditorSelection
) => pathReferencesEqual(left.paths, right.paths)
  && elementReferencesEqual(left.elements, right.elements)
  && anchorReferencesEqual(left.anchors, right.anchors)
  && (
    left.active === right.active
    || (
      left.active !== null
      && right.active !== null
      && left.active.layerId === right.active.layerId
      && left.active.pathId === right.active.pathId
      && targetsEqual(left.active.target, right.active.target)
    )
  );

export interface BrushSettings {
  presetId: BrushPresetId;
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  smooth: number;
  color: string;
  backgroundColor: string;
}

/** Authoring style used by native vector shape and Pen tools. */
export interface VectorToolStyleSettings {
  fillEnabled: boolean;
  fillColor: string;
  /** Selected/native gradient authority; ordinary solid tool defaults omit it. */
  fillPaint?: VectorPaint | null;
  strokeEnabled: boolean;
  strokeColor: string;
  /** Selected/native gradient authority; ordinary solid tool defaults omit it. */
  strokePaint?: VectorPaint | null;
  strokeOpacity?: number;
  strokeWidth: number;
  strokeAlignment: 'inside' | 'center' | 'outside';
  strokeCap?: 'butt' | 'round' | 'square';
  strokeJoin?: 'miter' | 'round' | 'bevel';
  strokeMiterLimit?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
}

export interface ShapeToolSettings {
  mode: 'shape' | 'pixels';
  geometry: 'unrestricted' | 'fixed' | 'proportional';
  width: number;
  height: number;
  fromCenter: boolean;
  snapToPixels: boolean;
  rectangleCornerRadii: [number, number, number, number];
  linkedCorners: boolean;
  lineStartArrow: boolean;
  lineEndArrow: boolean;
  lineArrowWidth: number;
  lineArrowLength: number;
  lineRotationDegrees: number;
}

export interface TextToolSettings {
  family: string;
  style: string;
  size: number;
  antiAlias: 'smooth';
  alignment: 'start' | 'center' | 'end' | 'justify';
  fillEnabled: boolean;
}

export interface GradientToolSettings {
  paint: GradientPaintInstance;
  opacity: number;
  blendMode: BlendMode;
  transparency: boolean;
  application: 'fill-layer' | 'pixels';
}

export interface PenToolSettings {
  autoAddDelete: boolean;
  rubberBand: boolean;
}

export const createGradientToolSettings = (): GradientToolSettings => ({
  paint: createDefaultGradientPaint('gradient-tool', 'document'),
  opacity: 1,
  blendMode: 'normal',
  transparency: true,
  application: 'fill-layer'
});

export interface EditorSession {
  activeTool: ToolId;
  pointerId: number | null;
  activeChannel: PaintChannel;
  selection: SelectionOperation[];
  vectorSelection: VectorEditorSelection;
  selectionCombineMode: SelectionCombineMode;
  selectionPixelSnap: boolean;
  selectionRowHeight: number;
  selectionColumnWidth: number;
  selectionSmooth: number;
  magicWand: MagicWandOptions;
  smartSelection: SmartSelectionOptions;
  /** Photoshop-style Move/Transform picking of the top visible painted layer. */
  transformAutoSelectLayer: boolean;
  snap: SnapSettings;
  brush: BrushSettings;
  sampledBrush: SampledBrushSettings;
  toneBrush: ToneBrushSettings;
  gradient: GradientToolSettings;
  vectorStyle: VectorToolStyleSettings;
  pen: PenToolSettings;
  shape: ShapeToolSettings;
  text: TextToolSettings;
  warp: WarpToolSettings;
}

export const createEditorSession = (): EditorSession => ({
  activeTool: 'view',
  pointerId: null,
  activeChannel: 'pixels',
  selection: [],
  vectorSelection: createVectorEditorSelection(),
  selectionCombineMode: 'replace',
  selectionPixelSnap: true,
  selectionRowHeight: 1,
  selectionColumnWidth: 1,
  selectionSmooth: 0,
  magicWand: createDefaultMagicWandOptions(),
  smartSelection: createDefaultSmartSelectionOptions(),
  transformAutoSelectLayer: true,
  snap: createDefaultSnapSettings(),
  brush: {
    presetId: 'round',
    size: 48,
    hardness: 0.75,
    opacity: 1,
    flow: 0.35,
    spacing: 0.05,
    smooth: 0,
    color: '#000000',
    backgroundColor: '#ffffff'
  },
  sampledBrush: {
    aligned: true,
    sampleMode: 'current-and-below',
    diffusion: 5,
    healingHardness: 0,
    healingOpacity: 1
  },
  toneBrush: createDefaultToneBrushSettings(),
  gradient: createGradientToolSettings(),
  vectorStyle: {
    fillEnabled: true,
    fillColor: '#000000',
    strokeEnabled: true,
    strokeColor: '#ffffff',
    strokeOpacity: 1,
    strokeWidth: 3,
    strokeAlignment: 'center',
    strokeCap: 'round',
    strokeJoin: 'round',
    strokeMiterLimit: 4,
    strokeStyle: 'solid',
    opacity: 1
  },
  pen: {
    autoAddDelete: true,
    rubberBand: true
  },
  shape: {
    mode: 'shape',
    geometry: 'unrestricted',
    width: 100,
    height: 100,
    fromCenter: false,
    snapToPixels: true,
    rectangleCornerRadii: [0, 0, 0, 0],
    linkedCorners: true,
    lineStartArrow: false,
    lineEndArrow: false,
    lineArrowWidth: 18,
    lineArrowLength: 24,
    lineRotationDegrees: 0
  },
  text: {
    family: 'Inter',
    style: 'Regular',
    size: 50,
    antiAlias: 'smooth',
    alignment: 'start',
    fillEnabled: true
  },
  warp: {
    mode: 'push',
    debugView: 'result',
    diameterPx: 500,
    strength: 1,
    hardness: 0.5,
    flow: 1,
    spacing: 0.04,
    smooth: 0,
    pressureSize: true,
    pressureStrength: true
  }
});
