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
import { resolveVectorGradientGeometry } from './vectorGradientGeometry';

export interface VectorDocumentEditingOverlay extends VectorEditingOverlay {
  layerId: string;
}

export interface VectorDocumentEditingSceneOverlay {
  paths: readonly VectorDocumentEditingOverlay[];
  selectionFrame: VectorSelectionFrame | null;
  gradientHandles: readonly VectorEditingOverlay[];
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
  .filter(({ layerId, elementId }) => selection.elements.some(
    (reference) => reference.layerId === layerId && reference.elementId === elementId
  ) || selection.paths.some(
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

/**
 * Builds the complete transient vector-editing scene.
 *
 * Path outlines and the shared whole-element frame remain separate resources:
 * selecting multiple elements creates one transform frame without coupling
 * their live geometry or invalidating artwork caches.
 */
export const buildVectorDocumentEditingSceneOverlay = (
  document: Pick<ImageDocument, 'layers' | 'revision'>,
  selection: VectorEditorSelection
): VectorDocumentEditingSceneOverlay => {
  const paths = buildVectorDocumentEditingOverlays(document, selection);
  const bounds = vectorElementsDocumentBounds(document, selection.elements);
  const selectionKey = selection.elements
    .map(({ layerId, elementId }) => `${layerId}/${elementId}`)
    .sort()
    .join(',');
  return {
    paths,
    gradientHandles: gradientHandleOverlays(document, selection),
    selectionFrame: bounds
      ? buildVectorSelectionFrame(bounds, {
          resourceKey: `selection-frame:${document.revision}:${selectionKey}`
        })
      : null
  };
};
