import type { VectorAnchor, VectorPath, VectorSubpath } from './types';

export const cloneVectorAnchor = (anchor: VectorAnchor): VectorAnchor => ({
  ...anchor,
  position: { ...anchor.position },
  handleIn: anchor.handleIn ? { ...anchor.handleIn } : null,
  handleOut: anchor.handleOut ? { ...anchor.handleOut } : null
});

export const cloneVectorSubpath = (subpath: VectorSubpath): VectorSubpath => ({
  ...subpath,
  anchors: subpath.anchors.map(cloneVectorAnchor)
});

export const cloneVectorPath = (path: VectorPath): VectorPath => ({
  ...path,
  transform: { ...path.transform },
  style: {
    ...path.style,
    fill: path.style.fill ? { ...path.style.fill, color: [...path.style.fill.color] } : null,
    stroke: path.style.stroke ? {
      ...path.style.stroke,
      paint: { ...path.style.stroke.paint, color: [...path.style.stroke.paint.color] },
      dash: [...path.style.stroke.dash]
    } : null
  },
  subpaths: path.subpaths.map(cloneVectorSubpath)
});
