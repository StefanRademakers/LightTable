import {
  cloneVectorLiveShape,
  cloneVectorStyle,
  createVectorLiveShape,
  identityAffineMatrix,
  multiplyMatrices,
  translationMatrix,
  type ArrowheadGeometry,
  type VectorIdSource,
  type VectorLiveShape,
  type VectorStyle,
  type Vec2
} from '@lighttable/vector-core';
import type { LayerId } from '../../editor/document/documentTypes';
import { VectorDocumentController } from './VectorDocumentController';

export type LiveShapeToolPreset =
  | { kind: 'rectangle'; cornerRadii?: [number, number, number, number]; linkedCorners?: boolean }
  | { kind: 'ellipse' }
  | { kind: 'triangle'; cornerRadius?: number }
  | { kind: 'polygon'; sides?: number; cornerRadius?: number }
  | { kind: 'star'; points?: number; innerRatio?: number; cornerRadius?: number }
  | { kind: 'line'; startArrow?: ArrowheadGeometry | null; endArrow?: ArrowheadGeometry | null };

export interface LiveShapeToolControllerOptions {
  ids?: VectorIdSource;
  style?: () => VectorStyle;
  layerName?: string;
  shapeName?: (preset: LiveShapeToolPreset) => string;
  minimumDragDistance?: number;
}

export interface LiveShapeToolSnapshot {
  layerId: LayerId | null;
  shape: VectorLiveShape | null;
  gestureActive: boolean;
}

export interface LiveShapeDragOptions {
  /** Constrain rectangular shapes to equal sides and lines to 45-degree steps. */
  preserveAspect?: boolean;
  /** Treat the pointer-down position as the shape centre instead of a corner. */
  fromCenter?: boolean;
}

export interface LiveShapeDragUpdateOptions extends LiveShapeDragOptions {
  /** Translate the gesture origin by the latest pointer delta without resizing. */
  moveOrigin?: boolean;
}

const uuidIds: VectorIdSource = {
  next: (kind) => `${kind}-${crypto.randomUUID()}`
};

const defaultShapeStyle = (): VectorStyle => ({
  fill: { type: 'solid', color: [0, 0, 0, 1] },
  stroke: null,
  opacity: 1
});

const defaultShapeName = (preset: LiveShapeToolPreset) =>
  `${preset.kind[0].toUpperCase()}${preset.kind.slice(1)}`;

const positive = (value: number) => Math.max(Number.EPSILON, value);

export const resolveLiveShapeDrag = (
  origin: Vec2,
  pointer: Vec2,
  preset: LiveShapeToolPreset,
  options: LiveShapeDragOptions = {}
): readonly [Vec2, Vec2] => {
  let dx = pointer.x - origin.x;
  let dy = pointer.y - origin.y;

  if (options.preserveAspect) {
    if (preset.kind === 'line') {
      const length = Math.hypot(dx, dy);
      if (length > Number.EPSILON) {
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = Math.cos(angle) * length;
        dy = Math.sin(angle) * length;
      }
    } else if (
      preset.kind === 'rectangle'
      || preset.kind === 'ellipse'
      || preset.kind === 'triangle'
    ) {
      const extent = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * extent;
      dy = (dy < 0 ? -1 : 1) * extent;
    }
  }

  const constrained = { x: origin.x + dx, y: origin.y + dy };
  if (!options.fromCenter || preset.kind === 'polygon' || preset.kind === 'star') {
    return [{ ...origin }, constrained];
  }
  return [
    { x: origin.x - dx, y: origin.y - dy },
    constrained
  ];
};

/** Builds canonical local geometry plus an explicit local-to-document transform. */
export const createLiveShapeFromDrag = (
  id: string,
  start: Vec2,
  current: Vec2,
  preset: LiveShapeToolPreset,
  style: VectorStyle,
  name = defaultShapeName(preset)
): VectorLiveShape => {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const width = positive(Math.abs(dx));
  const height = positive(Math.abs(dy));
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  let shape: VectorLiveShape;

  if (preset.kind === 'rectangle') {
    shape = createVectorLiveShape(id, {
      kind: 'rectangle',
      width,
      height,
      cornerRadii: preset.cornerRadii ?? [0, 0, 0, 0],
      linkedCorners: preset.linkedCorners ?? true
    }, name);
    shape.transform = translationMatrix(left, top);
  } else if (preset.kind === 'ellipse') {
    shape = createVectorLiveShape(id, { kind: 'ellipse', width, height }, name);
    shape.transform = translationMatrix(left, top);
  } else if (preset.kind === 'triangle') {
    shape = createVectorLiveShape(id, {
      kind: 'triangle', width, height, cornerRadius: preset.cornerRadius ?? 0
    }, name);
    shape.transform = translationMatrix(left, top);
  } else if (preset.kind === 'polygon' || preset.kind === 'star') {
    const radius = positive(Math.hypot(dx, dy));
    const rotationRadians = Math.atan2(dy, dx);
    shape = preset.kind === 'polygon'
      ? createVectorLiveShape(id, {
          kind: 'polygon',
          sides: Math.max(3, Math.round(preset.sides ?? 5)),
          radius,
          rotationRadians,
          cornerRadius: preset.cornerRadius ?? 0
        }, name)
      : createVectorLiveShape(id, {
          kind: 'star',
          points: Math.max(3, Math.round(preset.points ?? 5)),
          outerRadius: radius,
          innerRadius: radius * Math.min(1, Math.max(0, preset.innerRatio ?? 0.5)),
          rotationRadians,
          cornerRadius: preset.cornerRadius ?? 0
        }, name);
    shape.transform = translationMatrix(start.x, start.y);
  } else {
    shape = createVectorLiveShape(id, {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: dx, y: dy },
      startArrow: preset.startArrow ?? null,
      endArrow: preset.endArrow ?? null
    }, name);
    shape.transform = translationMatrix(start.x, start.y);
  }

  shape.style = cloneVectorStyle(style);
  // Lines have no enclosed area. Keeping fill disabled also prevents the
  // degenerate line geometry from participating in fill tessellation.
  if (preset.kind === 'line') shape.style.fill = null;
  return shape;
};

/**
 * Framework-neutral drag controller for parametric shape creation.
 *
 * It owns only one gesture. The document controller owns the provisional
 * layer insertion and collapses every preview into one undoable commit.
 */
export class LiveShapeToolController {
  private start: Vec2 | null = null;
  private lastPointer: Vec2 | null = null;
  private shape: VectorLiveShape | null = null;
  private layerId: LayerId | null = null;
  private documentToLayer = identityAffineMatrix();
  private readonly ids: VectorIdSource;
  private readonly style: () => VectorStyle;
  private readonly layerName: string;
  private readonly shapeName: (preset: LiveShapeToolPreset) => string;
  private readonly minimumDragDistanceSquared: number;
  private dragOptions: LiveShapeDragOptions = {};

  constructor(
    private readonly documents: VectorDocumentController,
    private preset: LiveShapeToolPreset,
    options: LiveShapeToolControllerOptions = {}
  ) {
    this.ids = options.ids ?? uuidIds;
    this.style = options.style ?? defaultShapeStyle;
    this.layerName = options.layerName ?? 'Shape';
    this.shapeName = options.shapeName ?? defaultShapeName;
    const minimum = Math.max(0, options.minimumDragDistance ?? 0.5);
    this.minimumDragDistanceSquared = minimum * minimum;
  }

  setPreset(preset: LiveShapeToolPreset) {
    if (this.start) return false;
    this.preset = preset;
    return true;
  }

  pointerDown(position: Vec2, options: LiveShapeDragOptions = {}) {
    if (this.start) return false;
    this.start = { ...position };
    this.lastPointer = { ...position };
    this.dragOptions = { ...options };
    return true;
  }

  pointerMove(position: Vec2, options: LiveShapeDragUpdateOptions = {}) {
    if (!this.start) return false;
    if (options.moveOrigin && this.lastPointer) {
      this.start = {
        x: this.start.x + position.x - this.lastPointer.x,
        y: this.start.y + position.y - this.lastPointer.y
      };
    }
    this.lastPointer = { ...position };
    const dragOptions: LiveShapeDragOptions = {
      preserveAspect: options.preserveAspect ?? this.dragOptions.preserveAspect,
      fromCenter: options.fromCenter ?? this.dragOptions.fromCenter
    };
    const dx = position.x - this.start.x;
    const dy = position.y - this.start.y;
    if (!this.shape && dx * dx + dy * dy < this.minimumDragDistanceSquared) return false;

    const [shapeStart, shapeCurrent] = resolveLiveShapeDrag(
      this.start,
      position,
      this.preset,
      dragOptions
    );
    const draft = createLiveShapeFromDrag(
      this.shape?.id ?? this.ids.next('live-shape'),
      shapeStart,
      shapeCurrent,
      this.preset,
      this.shape?.style ?? this.style(),
      this.shape?.name ?? this.shapeName(this.preset)
    );

    // A drag preview mutates both canonical geometry and its placement. The
    // renderer's GPU geometry cache is revision keyed, so reusing the factory
    // defaults here would leave every later preview (and the committed shape)
    // displaying the first threshold-sized mesh.
    if (this.shape) {
      draft.geometryRevision = this.shape.geometryRevision + 1;
      draft.transformRevision = this.shape.transformRevision + 1;
    }

    if (!this.shape) {
      const placement = this.documents.beginElementCreation(draft, this.layerName);
      if (!placement || placement.element.type !== 'live-shape') {
        this.reset();
        return false;
      }
      this.layerId = placement.layerId;
      this.documentToLayer = { ...placement.documentToLayer };
      this.shape = cloneVectorLiveShape(placement.element);
      return true;
    }

    draft.transform = multiplyMatrices(this.documentToLayer, draft.transform);
    if (!this.documents.previewElementCreation(draft)) {
      this.reset();
      return false;
    }
    this.shape = cloneVectorLiveShape(draft);
    return true;
  }

  pointerUp(position: Vec2, options: LiveShapeDragUpdateOptions = {}) {
    if (!this.start) return false;
    this.pointerMove(position, options);
    if (!this.shape) {
      this.reset();
      return false;
    }
    const committed = this.documents.commitElementCreation();
    this.reset();
    return committed;
  }

  cancel() {
    if (!this.start) return false;
    const hasDocumentPreview = Boolean(this.shape);
    this.reset();
    return hasDocumentPreview ? this.documents.cancelElementCreation() : true;
  }

  snapshot(): LiveShapeToolSnapshot {
    return {
      layerId: this.layerId,
      shape: this.shape ? cloneVectorLiveShape(this.shape) : null,
      gestureActive: Boolean(this.start)
    };
  }

  dispose() {
    this.cancel();
  }

  private reset() {
    this.start = null;
    this.lastPointer = null;
    this.shape = null;
    this.layerId = null;
    this.documentToLayer = identityAffineMatrix();
    this.dragOptions = {};
  }
}
