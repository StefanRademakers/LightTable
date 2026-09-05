import type { PathTextLayout } from '@lighttable/text-core';
import { nearestPathArcLength, type PathArcLengthTable } from '@lighttable/vector-rendering';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { setFlowTextLayout } from '../../editor/document/textLayerCommands';
import type { AffineMatrix, Vec2 } from '../../editor/geometry/affine';
import {
  hitTestPathTextHandle,
  pathTextHandlePresentation,
  type PathTextHandleKind
} from '../../text/rendering/pathTextHandles';
import type { RigidPathGlyphProjection } from '../../text/rendering/rigidPathGlyphProjection';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

export interface PathTextHandleRealization {
  readonly table: PathArcLengthTable;
  readonly projection: RigidPathGlyphProjection;
  readonly localToDocument: AffineMatrix;
}

export interface PathTextHandleDependencies {
  getDocument(): ImageDocument | null;
  getEditingLayerId(): LayerId | null;
  getRealization(layerId: LayerId): PathTextHandleRealization | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
}

interface ActiveHandle {
  readonly pointerId: number;
  readonly layerId: LayerId;
  readonly transaction: DocumentMutationTransaction;
  readonly openingLayout: PathTextLayout;
  readonly realization: PathTextHandleRealization;
  readonly kind: PathTextHandleKind;
}

const inversePoint = (matrix: AffineMatrix, point: Vec2): Vec2 | null => {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const x = point.x - matrix.tx;
  const y = point.y - matrix.ty;
  return {
    x: (matrix.d * x - matrix.c * y) / determinant,
    y: (-matrix.b * x + matrix.a * y) / determinant
  };
};

const traversalOffset = (
  table: PathArcLengthTable,
  canonicalOffset: number,
  direction: 'forward' | 'reverse'
) => {
  if (direction === 'forward') return canonicalOffset;
  const reversed = table.length - canonicalOffset;
  return table.closed && table.length > 0 ? reversed % table.length : reversed;
};

/** Owns one path-text handle gesture and keeps raw pointer updates outside React. */
export class PathTextHandleController {
  private active: ActiveHandle | null = null;

  constructor(private readonly dependencies: () => PathTextHandleDependencies) {}

  begin(pointerId: number, documentPoint: Vec2, radius: number) {
    this.cancel();
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const layerId = dependencies.getEditingLayerId();
    const layer = document && layerId ? findDocumentLayer(document, layerId) : null;
    const layout = layer?.type === 'text' && layer.text.source.kind === 'flow'
      && layer.text.source.layout.mode === 'path' ? layer.text.source.layout : null;
    const realization = layerId ? dependencies.getRealization(layerId) : null;
    if (!document || !layerId || !layout || !realization) return false;
    const kind = hitTestPathTextHandle(
      pathTextHandlePresentation(layout, realization.table, realization.projection),
      realization.localToDocument,
      documentPoint,
      radius
    );
    if (!kind) return false;
    const transaction = dependencies.documentMutations.begin(
      `path-text:${layerId}`,
      { label: 'Edit Path Text', type: 'text.path.edit' }
    );
    if (!transaction) return false;
    this.active = {
      pointerId, layerId, transaction,
      openingLayout: structuredClone(layout), realization, kind
    };
    return true;
  }

  owns(pointerId: number) {
    return this.active?.pointerId === pointerId;
  }

  move(pointerId: number, documentPoint: Vec2) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    if (!active.transaction.active) {
      active.transaction.cancel();
      this.active = null;
      return false;
    }
    if (active.kind === 'direction') return true;
    const localPoint = inversePoint(active.realization.localToDocument, documentPoint);
    if (!localPoint) return false;
    const nearest = nearestPathArcLength(active.realization.table, localPoint);
    const direction = active.openingLayout.direction ?? 'forward';
    let offset = traversalOffset(active.realization.table, nearest.offset, direction);
    if (!active.realization.table.closed) {
      offset = active.kind === 'start'
        ? Math.min(active.realization.projection.range.end, offset)
        : Math.max(active.realization.projection.range.start, offset);
    }
    const layout: PathTextLayout = active.kind === 'start'
      ? { ...active.openingLayout, startOffset: offset }
      : { ...active.openingLayout, endOffset: offset };
    return active.transaction.change(() => setFlowTextLayout(
      active.transaction.before,
      active.layerId,
      layout
    ));
  }

  finish(pointerId: number, documentPoint: Vec2) {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) return false;
    if (active.kind === 'direction') {
      active.transaction.change(() => setFlowTextLayout(
        active.transaction.before,
        active.layerId,
        {
          ...active.openingLayout,
          direction: (active.openingLayout.direction ?? 'forward') === 'forward'
            ? 'reverse' : 'forward'
        }
      ));
    } else {
      this.move(pointerId, documentPoint);
    }
    this.active = null;
    return active.transaction.commit();
  }

  cancel(pointerId?: number) {
    const active = this.active;
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId)) return false;
    this.active = null;
    active.transaction.cancel();
    return true;
  }
}
