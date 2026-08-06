import type { LayerNode } from '../../editor/document/documentTypes';

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
