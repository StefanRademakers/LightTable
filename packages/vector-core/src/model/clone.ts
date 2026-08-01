import type { VectorAnchor, VectorPath, VectorStyle, VectorSubpath } from './types';

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

export const cloneVectorStyle = (style: VectorStyle): VectorStyle => ({
  ...style,
  fill: style.fill ? { ...style.fill, color: [...style.fill.color] } : null,
  stroke: style.stroke ? {
    ...style.stroke,
    paint: { ...style.stroke.paint, color: [...style.stroke.paint.color] },
    dash: [...style.stroke.dash]
  } : null
});

export const cloneVectorPath = (path: VectorPath): VectorPath => ({
  ...path,
  transform: { ...path.transform },
  style: cloneVectorStyle(path.style),
  subpaths: path.subpaths.map(cloneVectorSubpath)
});
