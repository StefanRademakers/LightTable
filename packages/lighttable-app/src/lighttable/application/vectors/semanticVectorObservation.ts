import { cloneVectorStyle, type VectorLiveShape, type VectorPath } from '@lighttable/vector-core';
import type { LayerId } from '../../editor/document/documentTypes';
import type { SemanticVectorCommand, SemanticVectorPrimitive
} from '../commands/semanticVectorCommandContract';

const observedSubpaths = (path: VectorPath) => path.subpaths.map((subpath) => ({
  id: subpath.id,
  closed: subpath.closed,
  anchors: subpath.anchors.map((anchor) => ({
    id: anchor.id,
    x: anchor.position.x,
    y: anchor.position.y,
    handleIn: anchor.handleIn ? { ...anchor.handleIn } : null,
    handleOut: anchor.handleOut ? { ...anchor.handleOut } : null,
    mode: anchor.mode
  }))
}));

export const observedVectorPathCreateCommand = (
  path: VectorPath,
  existingLayerId?: LayerId,
  layerName?: string
): Omit<Extract<SemanticVectorCommand, { readonly kind: 'create' }>, 'kind'> => ({
  ...(existingLayerId ? { layerId: existingLayerId } : {}),
  ...(!existingLayerId && layerName ? { layerName } : {}),
  name: path.name,
  subpaths: observedSubpaths(path),
  fillRule: path.fillRule,
  transform: { ...path.transform },
  style: cloneVectorStyle(path.style)
});

export const observedVectorPathUpdateCommand = (
  path: VectorPath,
  layerId: LayerId
): Omit<Extract<SemanticVectorCommand, { readonly kind: 'update' }>, 'kind'> => ({
  layerId,
  elementId: path.id,
  name: path.name,
  subpaths: observedSubpaths(path),
  fillRule: path.fillRule,
  transform: { ...path.transform },
  style: cloneVectorStyle(path.style)
});

/** Projects a committed editable live shape into its lossless replay contract. */
export const observedLiveShapeCreateCommand = (
  element: VectorLiveShape,
  existingLayerId?: LayerId,
  layerName?: string
): Omit<Extract<SemanticVectorCommand, { readonly kind: 'create' }>, 'kind'> | null => {
  const geometry = element.geometry;
  let primitive: SemanticVectorPrimitive;
  if (geometry.kind === 'rectangle') {
    primitive = { kind: 'rectangle', x: 0, y: 0, width: geometry.width,
      height: geometry.height, cornerRadii: [...geometry.cornerRadii],
      linkedCorners: geometry.linkedCorners };
  } else if (geometry.kind === 'ellipse') {
    primitive = { kind: 'ellipse', x: 0, y: 0, width: geometry.width, height: geometry.height };
  } else if (geometry.kind === 'triangle') {
    primitive = { kind: 'triangle', x: 0, y: 0, width: geometry.width,
      height: geometry.height, cornerRadius: geometry.cornerRadius };
  } else if (geometry.kind === 'line') {
    primitive = { kind: 'line', x1: geometry.start.x, y1: geometry.start.y,
      x2: geometry.end.x, y2: geometry.end.y,
      startArrow: structuredClone(geometry.startArrow),
      endArrow: structuredClone(geometry.endArrow) };
  } else {
    return null;
  }
  return {
    ...(existingLayerId ? { layerId: existingLayerId } : {}),
    ...(!existingLayerId && layerName ? { layerName } : {}),
    name: element.name,
    primitive,
    transform: { ...element.transform },
    style: cloneVectorStyle(element.style)
  };
};
