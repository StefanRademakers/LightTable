import { cloneGradientPaint, type GradientPaintInstance } from '@lighttable/paint-core';
import {
  cloneVectorLiveShape,
  createVectorLiveShape,
  identityAffineMatrix,
  type AffineMatrix,
  type Vec2,
  type VectorLiveShape
} from '@lighttable/vector-core';
import { VectorDocumentController } from './VectorDocumentController';
import type { BlendMode } from '../../editor/document/blendModes';

export interface GradientToolSettingsSnapshot {
  readonly paint: GradientPaintInstance;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly transparency: boolean;
}

export const constrainedGradientEnd = (start: Vec2, end: Vec2, constrained: boolean): Vec2 => {
  if (!constrained) return { ...end };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= Number.EPSILON) return { ...end };
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
};

export const gradientPaintFromDrag = (
  source: GradientPaintInstance,
  start: Vec2,
  end: Vec2,
  transparency: boolean
): GradientPaintInstance => {
  const cloned = cloneGradientPaint(source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const asset = transparency ? cloned.asset : {
    ...cloned.asset,
    opacityStops: cloned.asset.opacityStops.map((stop) => ({ ...stop, opacity: 1 }))
  };
  return {
    ...cloned,
    asset,
    coordinateSpace: 'document',
    transform: { a: dx, b: dy, c: -dy, d: dx, tx: start.x, ty: start.y }
  };
};

/** Creates one full-canvas, editable Gradient Fill layer per drag gesture. */
export class GradientToolController {
  private start: Vec2 | null = null;
  private shape: VectorLiveShape | null = null;
  private documentToLayer: AffineMatrix = identityAffineMatrix();

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly settings: () => GradientToolSettingsSnapshot,
    private readonly minimumDragDistance = 0.5
  ) {}

  pointerDown(position: Vec2) {
    if (this.start) return false;
    this.start = { ...position };
    return true;
  }

  pointerMove(position: Vec2, constrainAngle = false) {
    if (!this.start) return false;
    const end = constrainedGradientEnd(this.start, position, constrainAngle);
    if (!this.shape && Math.hypot(end.x - this.start.x, end.y - this.start.y) < this.minimumDragDistance) {
      return false;
    }
    const document = this.documents.currentDocument();
    if (!document) return false;
    const current = this.settings();
    const draft = createVectorLiveShape(
      this.shape?.id ?? `gradient-fill-shape-${crypto.randomUUID()}`,
      {
        kind: 'rectangle', width: document.width, height: document.height,
        cornerRadii: [0, 0, 0, 0], linkedCorners: true
      },
      'Gradient Fill'
    );
    draft.style = {
      fill: gradientPaintFromDrag(current.paint, this.start, end, current.transparency),
      stroke: null,
      opacity: 1
    };
    draft.styleRevision = (this.shape?.styleRevision ?? 0) + 1;

    if (!this.shape) {
      const placement = this.documents.beginElementCreation(
        draft,
        'Gradient Fill',
        {
          alwaysCreateLayer: true,
          role: 'gradient-fill',
          opacity: Math.max(0, Math.min(1, current.opacity)),
          blendMode: current.blendMode
        }
      );
      if (!placement || placement.element.type !== 'live-shape') {
        this.reset();
        return false;
      }
      this.documentToLayer = { ...placement.documentToLayer };
      this.shape = cloneVectorLiveShape(placement.element);
      return true;
    }

    draft.transform = { ...this.documentToLayer };
    if (!this.documents.previewElementCreation(draft)) {
      this.reset();
      return false;
    }
    this.shape = cloneVectorLiveShape(draft);
    return true;
  }

  pointerUp(position: Vec2, constrainAngle = false) {
    if (!this.start) return false;
    this.pointerMove(position, constrainAngle);
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
    const previewed = Boolean(this.shape);
    this.reset();
    return previewed ? this.documents.cancelElementCreation() : true;
  }

  dispose() {
    this.cancel();
  }

  private reset() {
    this.start = null;
    this.shape = null;
    this.documentToLayer = identityAffineMatrix();
  }
}
