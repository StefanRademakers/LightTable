import {
  buildVectorEditingOverlay,
  buildVectorSelectionFrame,
  type VectorSelectionFrame,
  type VectorEditingOverlay
} from '@lighttable/vector-rendering';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import {
  vectorElementsDocumentBounds,
  vectorElementsTopmostFirst
} from './vectorSceneQueries';
import { transformPoint, type AffineMatrix, type Vec2 } from '@lighttable/vector-core';
import { resolveVectorGradientGeometry } from './vectorGradientGeometry';

export interface VectorDocumentEditingOverlay extends VectorEditingOverlay {
  layerId: string;
}

export interface VectorDocumentEditingSceneOverlay {
  paths: readonly VectorDocumentEditingOverlay[];
  /** Non-printing locator for selected geometry that has neither fill nor stroke. */
  unpaintedElementOutlines: readonly VectorDocumentEditingOverlay[];
  selectionFrame: VectorSelectionFrame | null;
  gradientHandles: readonly VectorEditingOverlay[];
}

const EMPTY_VECTOR_DOCUMENT_EDITING_SCENE: VectorDocumentEditingSceneOverlay = {
  paths: [],
  unpaintedElementOutlines: [],
  selectionFrame: null,
  gradientHandles: []
};

const transformedBounds = (
  bounds: { x: number; y: number; width: number; height: number },
  matrix: AffineMatrix
) => {
  const points: Vec2[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height }
  ].map(point => transformPoint(matrix, point));
  const left = Math.min(...points.map(({ x }) => x));
  const top = Math.min(...points.map(({ y }) => y));
  const right = Math.max(...points.map(({ x }) => x));
  const bottom = Math.max(...points.map(({ y }) => y));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Projects renderer-owned whole-object movement into the GPU editing overlay. */
export const transformVectorDocumentEditingSceneOverlay = (
  scene: VectorDocumentEditingSceneOverlay,
  matrix: AffineMatrix
): VectorDocumentEditingSceneOverlay => {
  const point = (value: Vec2) => transformPoint(matrix, value);
  const overlay = <T extends VectorEditingOverlay>(value: T): T => ({
    ...value,
    resourceKey: `${value.resourceKey}:preview:${matrix.a}:${matrix.b}:${matrix.c}:${matrix.d}:${matrix.tx}:${matrix.ty}`,
    cubics: value.cubics.map(cubic => ({
      ...cubic,
      p0: point(cubic.p0), p1: point(cubic.p1),
      p2: point(cubic.p2), p3: point(cubic.p3)
    })),
    anchors: value.anchors.map(anchor => ({ ...anchor, point: point(anchor.point) })),
    handles: value.handles.map(handle => ({
      ...handle, anchor: point(handle.anchor), point: point(handle.point)
    }))
  } as T);
  const frame = scene.selectionFrame;
  return {
    paths: scene.paths.map(overlay),
    unpaintedElementOutlines: scene.unpaintedElementOutlines.map(overlay),
    gradientHandles: scene.gradientHandles.map(overlay),
    selectionFrame: frame ? {
      ...frame,
      resourceKey: `${frame.resourceKey}:preview:${matrix.a}:${matrix.b}:${matrix.c}:${matrix.d}:${matrix.tx}:${matrix.ty}`,
      bounds: transformedBounds(frame.bounds, matrix),
      pivot: point(frame.pivot),
      edges: frame.edges.map(edge => ({ start: point(edge.start), end: point(edge.end) })),
      handles: frame.handles.map(handle => ({ ...handle, point: point(handle.point) }))
    } : null
  };
};

const vectorSelectionIsEmpty = (selection: VectorEditorSelection) => (
  selection.elements.length === 0
  && selection.paths.length === 0
  && selection.anchors.length === 0
  && selection.active === null
);

/**
 * Keeps document-space editing projections stable across viewport-only frames.
 *
 * Image documents are immutable snapshots and WebGpuEngine replaces its
 * VectorEditorSelection object whenever the authored selection changes. Object
 * identity is therefore the exact dependency boundary for this cache: panning
 * and zooming may redraw the viewport, but must not traverse or clone artwork.
 */
export class VectorDocumentEditingSceneCache {
  private document: Pick<ImageDocument, 'layers' | 'revision'> | null = null;
  private documentRevision = -1;
  private selection: VectorEditorSelection | null = null;
  private scene: VectorDocumentEditingSceneOverlay = EMPTY_VECTOR_DOCUMENT_EDITING_SCENE;

  resolve(
    document: Pick<ImageDocument, 'layers' | 'revision'>,
    selection: VectorEditorSelection
  ): VectorDocumentEditingSceneOverlay {
    if (
      this.document === document
      && this.documentRevision === document.revision
      && this.selection === selection
    ) return this.scene;
    this.document = document;
    this.documentRevision = document.revision;
    this.selection = selection;
    this.scene = buildVectorDocumentEditingSceneOverlay(document, selection);
    return this.scene;
  }

  clear() {
    this.document = null;
    this.documentRevision = -1;
    this.selection = null;
    this.scene = EMPTY_VECTOR_DOCUMENT_EDITING_SCENE;
  }
}

const gradientHandleOverlays = (
  document: Pick<ImageDocument, 'layers' | 'revision'>,
  selection: VectorEditorSelection
): VectorEditingOverlay[] => vectorElementsTopmostFirst(document).flatMap((resolved) => {
  if (!selection.elements.some(({ layerId, elementId }) =>
    layerId === resolved.layerId && elementId === resolved.elementId)) return [];
  const geometry = resolveVectorGradientGeometry(resolved);
  if (!geometry) return [];
  const fill = resolved.element.style.fill;
  if (!fill || !('kind' in fill)) return [];
  const colorStops = [...fill.asset.colorStops].sort((a, b) => a.position - b.position);
  const firstColor = colorStops[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 };
  const lastColor = colorStops.at(-1)?.color ?? { r: 1, g: 1, b: 1, a: 1 };
  const startColor = fill.reverse ? lastColor : firstColor;
  const endColor = fill.reverse ? firstColor : lastColor;
  const start = geometry.startInDocument;
  const end = geometry.endInDocument;
  return [{
    pathId: `gradient:${resolved.elementId}`,
    resourceKey: `gradient:${resolved.elementId}:${resolved.element.styleRevision}:${document.revision}`,
    geometryRevision: 0,
    transformRevision: 0,
    cubics: [{
      subpathId: 'gradient-axis', segmentIndex: 0,
      p0: start, p1: start, p2: end, p3: end
    }],
    anchors: [
      { subpathId: 'gradient-axis', anchorId: 'start', point: start,
        markerKind: 'circle', markerColor: [startColor.r, startColor.g, startColor.b, startColor.a],
        markerSizePx: 14, selected: false, active: false },
      { subpathId: 'gradient-axis', anchorId: 'end', point: end,
        markerKind: 'circle', markerColor: [endColor.r, endColor.g, endColor.b, endColor.a],
        markerSizePx: 18, selected: false, active: true }
    ],
    handles: []
  }];
});

const samePath = (
  reference: { layerId: string; pathId: string },
  layerId: string,
  pathId: string
) => reference.layerId === layerId && reference.pathId === pathId;

/**
 * Projects scene-scoped editor selection into renderer-neutral overlays.
 *
 * The function only reads the current document and transient session state.
 * It neither realizes raster geometry nor mutates document revisions, keeping
 * selection and viewport feedback outside the expensive artwork cache.
 */
export const buildVectorDocumentEditingOverlays = (
  document: Pick<ImageDocument, 'layers' | 'revision'>,
  selection: VectorEditorSelection
): VectorDocumentEditingOverlay[] => vectorElementsTopmostFirst(document)
  .filter(({ layerId, elementId }) => selection.paths.some(
    (reference) => samePath(reference, layerId, elementId)
  ) || selection.anchors.some(
    (reference) => samePath(reference, layerId, elementId)
  ))
  .map(({ layerId, elementId, documentPath }) => {
    const wholeElementSelected = selection.elements.some(
      (reference) => reference.layerId === layerId && reference.elementId === elementId
    );
    const anchors = selection.anchors
      .filter((reference) => samePath(reference, layerId, elementId))
      .map(({ subpathId, anchorId }) => ({ subpathId, anchorId }));
    const active = selection.active;
    const activeAnchor = active
      && samePath(active, layerId, elementId)
      && (active.target.kind === 'anchor'
        || active.target.kind === 'handle-in'
        || active.target.kind === 'handle-out')
      ? {
          subpathId: active.target.subpathId,
          anchorId: active.target.anchorId
        }
      : null;
    const overlay = buildVectorEditingOverlay(documentPath, {
      selection: { anchors, activeAnchor },
      sceneRevision: document.revision
    });
    return {
      layerId,
      ...overlay,
      pathId: elementId,
      resourceKey: `${elementId}:${overlay.resourceKey}`,
      anchors: wholeElementSelected ? [] : overlay.anchors,
      handles: wholeElementSelected ? [] : overlay.handles
    };
  });

const unpaintedElementOutlines = (
  document: Pick<ImageDocument, 'layers' | 'revision'>,
  selection: VectorEditorSelection
): VectorDocumentEditingOverlay[] => vectorElementsTopmostFirst(document)
  .filter(({ layerId, elementId, element }) => {
    const selected = selection.elements.some(
      (reference) => reference.layerId === layerId && reference.elementId === elementId
    );
    const explicitlyEdited = selection.paths.some(
      (reference) => samePath(reference, layerId, elementId)
    ) || selection.anchors.some(
      (reference) => samePath(reference, layerId, elementId)
    );
    return selected && !explicitlyEdited && !element.style.fill && !element.style.stroke;
  })
  .map(({ layerId, elementId, documentPath }) => {
    const overlay = buildVectorEditingOverlay(documentPath, {
      sceneRevision: document.revision
    });
    return {
      layerId,
      ...overlay,
      pathId: elementId,
      resourceKey: `unpainted:${elementId}:${overlay.resourceKey}`,
      anchors: [],
      handles: []
    };
  });

/**
 * Builds the complete transient vector-editing scene.
 *
 * Direct/path selection owns path outlines. Whole-element selection owns one
 * shared transform frame instead of redundantly drawing every realized path;
 * this keeps simple Gradient Fill layers from replaying their document-sized
 * rectangle through the path-editing overlay.
 */
export const buildVectorDocumentEditingSceneOverlay = (
  document: Pick<ImageDocument, 'layers' | 'revision'>,
  selection: VectorEditorSelection
): VectorDocumentEditingSceneOverlay => {
  // An idle vector tool has nothing to project. In particular, do not call
  // vectorElementsTopmostFirst here: that helper intentionally clones resolved
  // paths, which turns viewport panning into O(document geometry) allocation.
  if (vectorSelectionIsEmpty(selection)) return EMPTY_VECTOR_DOCUMENT_EDITING_SCENE;
  const paths = buildVectorDocumentEditingOverlays(document, selection);
  const bounds = vectorElementsDocumentBounds(document, selection.elements);
  const selectionKey = selection.elements
    .map(({ layerId, elementId }) => `${layerId}/${elementId}`)
    .sort()
    .join(',');
  return {
    paths,
    unpaintedElementOutlines: unpaintedElementOutlines(document, selection),
    gradientHandles: gradientHandleOverlays(document, selection),
    selectionFrame: bounds
      ? buildVectorSelectionFrame(bounds, {
          resourceKey: `selection-frame:${document.revision}:${selectionKey}`
        })
      : null
  };
};
