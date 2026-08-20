import type { LayerId, LayerNode } from '../../editor/document/documentTypes';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';

export interface VectorContentQuerySummary {
  readonly elementCount: number;
  readonly elements: readonly {
    readonly id: string;
    readonly elementType: 'path' | 'live-shape';
    readonly fill: 'none' | 'solid' | 'gradient';
    readonly stroke: null | {
      readonly paint: 'solid' | 'gradient';
      readonly width: number;
      readonly opacity: number;
      readonly alignment: 'inside' | 'center' | 'outside';
      readonly cap: 'butt' | 'round' | 'square';
      readonly join: 'miter' | 'round' | 'bevel';
      readonly miterLimit: number;
      readonly dash: readonly number[];
      readonly dashOffset: number;
    };
    readonly opacity: number;
    readonly transform: LayerNode['transform'];
  }[];
}

export function projectVectorContentQuery(
  node: Extract<LayerNode, { readonly type: 'vector' }>
): VectorContentQuerySummary {
  return {
    elementCount: node.elements.length,
    elements: node.elements.map((element) => ({
      id: element.id,
      elementType: element.type,
      fill: element.style.fill === null ? 'none'
        : 'kind' in element.style.fill ? 'gradient' : 'solid',
      stroke: element.style.stroke ? {
        paint: 'kind' in element.style.stroke.paint ? 'gradient' : 'solid',
        width: element.style.stroke.width,
        opacity: element.style.stroke.opacity ?? 1,
        alignment: element.style.stroke.alignment ?? 'center',
        cap: element.style.stroke.cap,
        join: element.style.stroke.join,
        miterLimit: element.style.stroke.miterLimit,
        dash: [...element.style.stroke.dash],
        dashOffset: element.style.stroke.dashOffset
      } : null,
      opacity: element.style.opacity,
      transform: { ...element.transform }
    }))
  };
}

export interface LayerQuerySummary {
  readonly id: LayerId;
  readonly parentId: LayerId | null;
  readonly depth: number;
  readonly type: LayerNode['type'];
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly fillOpacity: number;
  readonly blendMode: LayerNode['blendMode'];
  readonly clipping: boolean;
  readonly hasMask: boolean;
  readonly maskContent: {
    readonly raster: null | {
      readonly enabled: boolean;
      readonly linked: boolean;
      readonly density: number;
      readonly feather: number;
      readonly pixelRevision: number;
    };
    /** Photoshop vector-mask geometry retained independently from raster pixels. */
    readonly preservedVector: boolean;
    readonly simultaneousRasterAndVector: boolean;
  };
  readonly hasActiveEffects: boolean;
  readonly transform: LayerNode['transform'];
  readonly rasterSurface: {
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
  } | null;
  readonly textLayout: {
    readonly sourceKind: 'flow' | 'positioned';
    readonly mode: 'point' | 'paragraph' | 'path' | 'positioned';
    readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' | null;
  } | null;
  readonly vectorContent: VectorContentQuerySummary | null;
}

export function projectLayerQuery(
  node: LayerNode,
  parentId: LayerId | null,
  depth: number
): LayerQuerySummary {
  const preservedVector = node.type !== 'vector'
    && Boolean(node.photoshop?.preserved.vectorMask);
  return {
    id: node.id,
    parentId,
    depth,
    type: node.type,
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    fillOpacity: node.fillOpacity,
    blendMode: node.blendMode,
    clipping: node.clipping,
    hasMask: Boolean(node.mask) || preservedVector,
    maskContent: {
      raster: node.mask ? {
        enabled: node.mask.enabled,
        linked: node.mask.linked,
        density: node.mask.density,
        feather: node.mask.feather,
        pixelRevision: node.mask.pixelRevision
      } : null,
      preservedVector,
      simultaneousRasterAndVector: Boolean(node.mask) && preservedVector
    },
    hasActiveEffects: layerStyleStackIsActive(node.styleStack),
    transform: { ...node.transform },
    rasterSurface: node.type === 'raster' ? {
      width: node.width,
      height: node.height,
      offsetX: node.offsetX,
      offsetY: node.offsetY
    } : null,
    textLayout: node.type === 'text' ? node.text.source.kind === 'flow' ? {
      sourceKind: 'flow',
      mode: node.text.source.layout.mode,
      writingMode: node.text.source.layout.mode === 'path'
        ? null : node.text.source.layout.writingMode
    } : {
      sourceKind: 'positioned',
      mode: 'positioned',
      writingMode: null
    } : null,
    vectorContent: node.type === 'vector' ? projectVectorContentQuery(node) : null
  };
}
