import type {
  ImageDocument,
  LayerNode,
  RasterMask,
  RasterPixelSource
} from '../../editor/document/documentTypes';
import type { AffineMatrix } from '../../editor/rendering/renderContract';

const transformsEqual = (left: AffineMatrix, right: AffineMatrix) =>
  left === right
  || (
    left.a === right.a
    && left.b === right.b
    && left.c === right.c
    && left.d === right.d
    && left.tx === right.tx
    && left.ty === right.ty
  );

const pixelSourcesEqual = (left: RasterPixelSource, right: RasterPixelSource) =>
  left === right
  || (
    left.kind === right.kind
    && (left.kind === 'imported-image'
      ? left.assetId === (right as Extract<RasterPixelSource, { kind: 'imported-image' }>).assetId
      : left.runtimeId === (right as Extract<RasterPixelSource, { kind: 'runtime-raster' }>).runtimeId)
  );

const masksEqual = (left: RasterMask | null, right: RasterMask | null) =>
  left === right
  || Boolean(
    left
    && right
    && left.id === right.id
    && left.enabled === right.enabled
    && left.linked === right.linked
    && transformsEqual(left.transform, right.transform)
    && left.density === right.density
    && left.feather === right.feather
    && left.pixelRevision === right.pixelRevision
  );

const commonLayerRenderStateEqual = (left: LayerNode, right: LayerNode) =>
  left.id === right.id
  && left.type === right.type
  && left.visible === right.visible
  && left.opacity === right.opacity
  && left.fillOpacity === right.fillOpacity
  && left.blendMode === right.blendMode
  && left.clipping === right.clipping
  && left.styleStack === right.styleStack
  && left.geometryRevision === right.geometryRevision
  && transformsEqual(left.transform, right.transform);

const layerListsEqual = (left: readonly LayerNode[], right: readonly LayerNode[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((layer, index) => layerRenderStatesEqual(layer, right[index]));
};

const layerRenderStatesEqual = (left: LayerNode, right: LayerNode): boolean => {
  if (left === right) return true;
  if (!commonLayerRenderStateEqual(left, right)) return false;

  if (left.type === 'raster' && right.type === 'raster') {
    return left.adjustmentStack === right.adjustmentStack
      && left.pixelRevision === right.pixelRevision
      && left.width === right.width
      && left.height === right.height
      && left.offsetX === right.offsetX
      && left.offsetY === right.offsetY
      && pixelSourcesEqual(left.pixelSource, right.pixelSource)
      && masksEqual(left.mask, right.mask);
  }

  if (left.type === 'group' && right.type === 'group') {
    return left.compositing === right.compositing
      && masksEqual(left.mask, right.mask)
      && layerListsEqual(left.children, right.children);
  }

  if (left.type === 'adjustment' && right.type === 'adjustment') {
    return left.adjustmentStack === right.adjustmentStack
      && masksEqual(left.mask, right.mask);
  }

  if (left.type === 'vector' && right.type === 'vector') {
    return left.elements === right.elements
      && masksEqual(left.mask, right.mask);
  }

  if (left.type === 'text' && right.type === 'text') {
    const leftRevisions = left.text.revisions;
    const rightRevisions = right.text.revisions;
    return left.text.source.kind === right.text.source.kind
      && leftRevisions.content === rightRevisions.content
      && leftRevisions.font === rightRevisions.font
      && leftRevisions.layout === rightRevisions.layout
      && leftRevisions.paint === rightRevisions.paint
      && leftRevisions.path === rightRevisions.path
      && leftRevisions.geometry === rightRevisions.geometry
      && masksEqual(left.mask, right.mask);
  }

  return false;
};

/**
 * Compares only state that can change rendered pixels.
 *
 * ImageDocument also carries editor/persistence state such as names, locks,
 * timestamps, active selection and import diagnostics. Those publications
 * must reach the UI without rebuilding the compositor or downstream scopes.
 * Immutable document commands retain references for unchanged render-bearing
 * stacks and assets, making this check cheap and deliberately conservative.
 */
export const documentRenderStatesEqual = (
  current: ImageDocument | null,
  next: ImageDocument
): boolean => {
  if (!current || current.id !== next.id) return false;
  // Preview projections may deliberately keep the canonical document revision
  // while publishing a new render-bearing layer/adjustment snapshot. Object
  // identity is therefore the only safe whole-document fast path here.
  if (current === next) return true;
  return current.width === next.width
    && current.height === next.height
    && current.assets === next.assets
    && layerListsEqual(current.layers, next.layers);
};
