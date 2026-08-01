import type {
  LiveShapeGeometry,
  VectorAnchor,
  VectorElement,
  VectorLiveShape,
  VectorPath,
  VectorStyle,
  VectorSubpath
} from './types';

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

export const cloneLiveShapeGeometry = (geometry: LiveShapeGeometry): LiveShapeGeometry =>
  geometry.kind === 'rectangle'
    ? { ...geometry, cornerRadii: [...geometry.cornerRadii] }
    : geometry.kind === 'line'
      ? {
          ...geometry,
          start: { ...geometry.start },
          end: { ...geometry.end },
          startArrow: geometry.startArrow ? { ...geometry.startArrow } : null,
          endArrow: geometry.endArrow ? { ...geometry.endArrow } : null
        }
    : { ...geometry };

export const cloneVectorLiveShape = (shape: VectorLiveShape): VectorLiveShape => ({
  ...shape,
  geometry: cloneLiveShapeGeometry(shape.geometry),
  transform: { ...shape.transform },
  style: cloneVectorStyle(shape.style)
});

export const cloneVectorElement = (element: VectorElement): VectorElement =>
  element.type === 'path' ? cloneVectorPath(element) : cloneVectorLiveShape(element);
