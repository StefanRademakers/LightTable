import { cloneGradientPaint, type GradientPaintInstance } from '@lighttable/paint-core';
import {
  cloneVectorElement,
  cloneVectorLiveShape,
  createVectorLiveShape,
  identityAffineMatrix,
  transformPoint,
  type AffineMatrix,
  type Vec2,
  type VectorLiveShape
} from '@lighttable/vector-core';
import { VectorDocumentController } from './VectorDocumentController';
import type { BlendMode } from '../../editor/document/blendModes';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { vectorElementsTopmostFirst } from './vectorSceneQueries';
import { resolveVectorGradientGeometry } from './vectorGradientGeometry';

export interface GradientToolSettingsSnapshot {
  readonly paint: GradientPaintInstance;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly transparency: boolean;
}

export interface GradientToolSelectionTarget {
  readonly layerId: LayerId;
  readonly elementId: string;
}

interface EditableGradientTarget extends GradientToolSelectionTarget {
  readonly documentToPaintParent: AffineMatrix;
  readonly openingStart: Vec2;
  readonly openingEnd: Vec2;
}

type GradientEditHandle = 'axis' | 'start' | 'end';

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

const editableGradientTarget = (
  document: ImageDocument,
  position: Vec2,
  hitRadius: number
): { target: EditableGradientTarget; handle: GradientEditHandle } | null => {
  const activeLayer = document.activeLayerId
    ? findDocumentLayer(document, document.activeLayerId)
    : null;
  if (activeLayer?.type !== 'vector'
    || activeLayer.role !== 'gradient-fill'
    || layerIsLocked(activeLayer, 'pixels')) return null;
  const resolved = vectorElementsTopmostFirst(document).find(({ layerId, element }) =>
    layerId === activeLayer.id && element.style.fill && 'kind' in element.style.fill);
  const geometry = resolved ? resolveVectorGradientGeometry(resolved) : null;
  if (!resolved || !geometry) return null;
  const distanceSquared = (point: Vec2) =>
    (point.x - position.x) ** 2 + (point.y - position.y) ** 2;
  const radiusSquared = hitRadius ** 2;
  const handle = distanceSquared(geometry.startInDocument) <= radiusSquared
    ? 'start'
    : distanceSquared(geometry.endInDocument) <= radiusSquared
      ? 'end'
      : 'axis';
  return {
    target: {
      layerId: resolved.layerId,
      elementId: resolved.elementId,
      documentToPaintParent: geometry.documentToPaintParent,
      openingStart: geometry.startInPaintParent,
      openingEnd: geometry.endInPaintParent
    },
    handle
  };
};

/** Creates a Gradient Fill once, then keeps the active fill in on-canvas edit mode. */
export class GradientToolController {
  private start: Vec2 | null = null;
  private shape: VectorLiveShape | null = null;
  private documentToLayer: AffineMatrix = identityAffineMatrix();
  private edit: { target: EditableGradientTarget; handle: GradientEditHandle } | null = null;
  private mutationStarted = false;

  constructor(
    private readonly documents: VectorDocumentController,
    private readonly settings: () => GradientToolSettingsSnapshot,
    private readonly selectTarget: (target: GradientToolSelectionTarget) => void = () => {},
    private readonly minimumDragDistance = 0.5
  ) {}

  pointerDown(position: Vec2, hitRadius = 0) {
    if (this.start) return false;
    this.start = { ...position };
    const document = this.documents.currentDocument();
    this.edit = document ? editableGradientTarget(document, position, hitRadius) : null;
    return true;
  }

  pointerMove(position: Vec2, constrainAngle = false) {
    if (!this.start) return false;
    const end = constrainedGradientEnd(this.start, position, constrainAngle);
    if (!this.shape && !this.mutationStarted
      && Math.hypot(end.x - this.start.x, end.y - this.start.y) < this.minimumDragDistance) {
      return false;
    }
    const document = this.documents.currentDocument();
    if (!document) return false;
    if (this.edit) {
      if (!this.mutationStarted) {
        if (!this.documents.beginElementMutation(this.edit.target.layerId, this.edit.target.elementId)) {
          this.reset();
          return false;
        }
        this.mutationStarted = true;
      }
      const positionInPaintParent = transformPoint(
        this.edit.target.documentToPaintParent,
        end
      );
      const gestureStart = transformPoint(
        this.edit.target.documentToPaintParent,
        this.start
      );
      const gradientStart = this.edit.handle === 'start'
        ? positionInPaintParent
        : this.edit.handle === 'end'
          ? this.edit.target.openingStart
          : gestureStart;
      const gradientEnd = this.edit.handle === 'end'
        ? positionInPaintParent
        : this.edit.handle === 'start'
          ? this.edit.target.openingEnd
          : positionInPaintParent;
      return this.documents.previewElementMutation((openingElement) => {
        const fill = openingElement.style.fill;
        if (!fill || !('kind' in fill)) return openingElement;
        const next = cloneVectorElement(openingElement);
        next.style.fill = {
          ...cloneGradientPaint(fill),
          transform: {
            ...fill.transform,
            a: gradientEnd.x - gradientStart.x,
            b: gradientEnd.y - gradientStart.y,
            tx: gradientStart.x,
            ty: gradientStart.y
          }
        };
        next.styleRevision += 1;
        return next;
      });
    }
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
    if (this.mutationStarted && this.edit) {
      const target = {
        layerId: this.edit.target.layerId,
        elementId: this.edit.target.elementId
      };
      const committed = this.documents.commitElementMutation();
      if (committed) this.selectTarget(target);
      this.reset();
      return committed;
    }
    if (!this.shape) {
      this.reset();
      return false;
    }
    const committed = this.documents.commitElementCreation();
    if (committed && this.shape) {
      const document = this.documents.currentDocument();
      if (document?.activeLayerId) {
        this.selectTarget({ layerId: document.activeLayerId, elementId: this.shape.id });
      }
    }
    this.reset();
    return committed;
  }

  cancel() {
    if (!this.start) return false;
    const previewed = Boolean(this.shape) || this.mutationStarted;
    const editing = this.mutationStarted;
    this.reset();
    return previewed
      ? editing ? this.documents.cancelElementMutation() : this.documents.cancelElementCreation()
      : true;
  }

  dispose() {
    this.cancel();
  }

  private reset() {
    this.start = null;
    this.shape = null;
    this.documentToLayer = identityAffineMatrix();
    this.edit = null;
    this.mutationStarted = false;
  }
}
