export interface Point {
  x: number;
  y: number;
}

export interface RectLike extends Point {
  width: number;
  height: number;
}

export interface ViewTransform {
  scale: number;
  panX: number;
  panY: number;
}

export interface DocumentPointer extends Point {
  pressure: number;
}

export const pointInsideRect = (point: Point, rect: RectLike) => (
  point.x >= rect.x
  && point.y >= rect.y
  && point.x <= rect.x + rect.width
  && point.y <= rect.y + rect.height
);

export const clientToLocalPoint = (
  client: Point,
  bounds: Pick<RectLike, 'x' | 'y'>
): Point => ({
  x: client.x - bounds.x,
  y: client.y - bounds.y
});

export const localToDocumentPointer = (
  local: Point,
  imageRect: RectLike,
  scale: number,
  documentSize: Pick<RectLike, 'width' | 'height'>,
  pressure = 1
): DocumentPointer | null => {
  const safeScale = Math.max(scale, 0.0001);
  const x = (local.x - imageRect.x) / safeScale;
  const y = (local.y - imageRect.y) / safeScale;
  if (
    x < 0
    || y < 0
    || x > documentSize.width
    || y > documentSize.height
  ) {
    return null;
  }
  return {
    x,
    y,
    pressure: pressure > 0 ? pressure : 1
  };
};

export const zoomViewAtPoint = ({
  cursor,
  viewport,
  view,
  wheelDelta,
  minScale,
  maxScale,
  sensitivity = 0.0015
}: {
  cursor: Point;
  viewport: Pick<RectLike, 'width' | 'height'>;
  view: ViewTransform;
  wheelDelta: number;
  minScale: number;
  maxScale: number;
  sensitivity?: number;
}): ViewTransform => {
  const currentScale = Math.max(view.scale, 0.0001);
  const scale = Math.min(
    maxScale,
    Math.max(minScale, currentScale * Math.exp(-wheelDelta * sensitivity))
  );
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const imageX = (cursor.x - centerX - view.panX) / currentScale;
  const imageY = (cursor.y - centerY - view.panY) / currentScale;
  return {
    scale,
    panX: cursor.x - centerX - imageX * scale,
    panY: cursor.y - centerY - imageY * scale
  };
};

export const panViewFromGesture = ({
  origin,
  current,
  initialView
}: {
  origin: Point;
  current: Point;
  initialView: Pick<ViewTransform, 'panX' | 'panY'>;
}) => ({
  panX: initialView.panX + current.x - origin.x,
  panY: initialView.panY + current.y - origin.y
});
