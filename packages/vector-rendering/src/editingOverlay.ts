import {
  segmentAt,
  segmentCount,
  transformPoint,
  type CubicSegment,
  type Vec2,
  type VectorPath
} from '@lighttable/vector-core';

export interface VectorOverlayAnchorReference {
  subpathId: string;
  anchorId: string;
}

export interface VectorOverlaySelection {
  anchors: readonly VectorOverlayAnchorReference[];
  activeAnchor: VectorOverlayAnchorReference | null;
}

export interface VectorOverlayCubic {
  subpathId: string;
  segmentIndex: number;
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

export interface VectorOverlayHandle {
  subpathId: string;
  anchorId: string;
  kind: 'in' | 'out';
  anchor: Vec2;
  point: Vec2;
  /** Marker diameter is interpreted in screen pixels by the overlay backend. */
  markerSizePx: number;
}

export interface VectorOverlayAnchor {
  subpathId: string;
  anchorId: string;
  point: Vec2;
  selected: boolean;
  active: boolean;
  /** Presentation shape; gradient handles use circles while path anchors stay square. */
  markerKind?: 'square' | 'circle' | 'diamond';
  /** Optional swatch fill; omitted markers use the overlay theme. */
  markerColor?: readonly [number, number, number, number];
  /** Marker diameter is interpreted in screen pixels by the overlay backend. */
  markerSizePx: number;
}

/**
 * Renderer-neutral direct-selection overlay for one document-space path.
 *
 * Curves and line endpoints are in document coordinates. Marker sizes remain
 * in screen pixels so zooming never makes anchors unusably small or large.
 * Building this contract does not realize or invalidate fill/stroke geometry.
 */
export interface VectorEditingOverlay {
  pathId: string;
  /** Stable cache identity supplied by the scene adapter. */
  resourceKey: string;
  geometryRevision: number;
  transformRevision: number;
  cubics: readonly VectorOverlayCubic[];
  anchors: readonly VectorOverlayAnchor[];
  handles: readonly VectorOverlayHandle[];
}

export interface BuildVectorEditingOverlayOptions {
  selection?: VectorOverlaySelection;
  anchorSizePx?: number;
  handleSizePx?: number;
  /** Parent/group transforms must be represented by this caller-owned key. */
  sceneRevision?: number;
}

const sameAnchor = (
  left: VectorOverlayAnchorReference,
  right: VectorOverlayAnchorReference
) => left.subpathId === right.subpathId && left.anchorId === right.anchorId;

const transformCubic = (
  path: VectorPath,
  subpathId: string,
  segmentIndex: number,
  segment: CubicSegment
): VectorOverlayCubic => ({
  subpathId,
  segmentIndex,
  p0: transformPoint(path.transform, segment.p0),
  p1: transformPoint(path.transform, segment.p1),
  p2: transformPoint(path.transform, segment.p2),
  p3: transformPoint(path.transform, segment.p3)
});

export const buildVectorEditingOverlay = (
  documentPath: VectorPath,
  options: BuildVectorEditingOverlayOptions = {}
): VectorEditingOverlay => {
  const selection = options.selection ?? { anchors: [], activeAnchor: null };
  const anchorSizePx = options.anchorSizePx ?? 11;
  const handleSizePx = options.handleSizePx ?? 10;
  if (!(anchorSizePx > 0) || !Number.isFinite(anchorSizePx)) {
    throw new RangeError('Vector overlay anchor size must be finite and greater than zero.');
  }
  if (!(handleSizePx > 0) || !Number.isFinite(handleSizePx)) {
    throw new RangeError('Vector overlay handle size must be finite and greater than zero.');
  }

  const cubics: VectorOverlayCubic[] = [];
  const anchors: VectorOverlayAnchor[] = [];
  const handles: VectorOverlayHandle[] = [];

  for (const subpath of documentPath.subpaths) {
    for (let index = 0; index < segmentCount(subpath); index += 1) {
      cubics.push(transformCubic(
        documentPath,
        subpath.id,
        index,
        segmentAt(subpath, index)
      ));
    }
    for (const anchor of subpath.anchors) {
      const reference = { subpathId: subpath.id, anchorId: anchor.id };
      const selected = selection.anchors.some((item) => sameAnchor(item, reference));
      const active = selection.activeAnchor
        ? sameAnchor(selection.activeAnchor, reference)
        : false;
      const anchorPoint = transformPoint(documentPath.transform, anchor.position);
      anchors.push({
        ...reference,
        point: anchorPoint,
        selected,
        active,
        markerSizePx: anchorSizePx
      });

      // Handles are intentionally selection-only. This keeps dense paths
      // readable and mirrors direct-selection behavior in mature editors.
      if (!selected && !active) continue;
      if (anchor.handleIn) {
        handles.push({
          ...reference,
          kind: 'in',
          anchor: anchorPoint,
          point: transformPoint(documentPath.transform, anchor.handleIn),
          markerSizePx: handleSizePx
        });
      }
      if (anchor.handleOut) {
        handles.push({
          ...reference,
          kind: 'out',
          anchor: anchorPoint,
          point: transformPoint(documentPath.transform, anchor.handleOut),
          markerSizePx: handleSizePx
        });
      }
    }
  }

  return {
    pathId: documentPath.id,
    resourceKey: [
      documentPath.id,
      documentPath.geometryRevision,
      documentPath.transformRevision,
      options.sceneRevision ?? 0,
      selection.anchors
        .map(({ subpathId, anchorId }) => `${subpathId}/${anchorId}`)
        .sort()
        .join(','),
      selection.activeAnchor
        ? `${selection.activeAnchor.subpathId}/${selection.activeAnchor.anchorId}`
        : '-'
    ].join(':'),
    geometryRevision: documentPath.geometryRevision,
    transformRevision: documentPath.transformRevision,
    cubics,
    anchors,
    handles
  };
};
