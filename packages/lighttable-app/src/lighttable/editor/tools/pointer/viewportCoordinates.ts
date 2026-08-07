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
  pressure = 1,
  allowOutsideDocument = false
): DocumentPointer | null => {
  const safeScale = Math.max(scale, 0.0001);
  const x = (local.x - imageRect.x) / safeScale;
  const y = (local.y - imageRect.y) / safeScale;
  if (
    !allowOutsideDocument
    && (
    x < 0
    || y < 0
    || x > documentSize.width
    || y > documentSize.height
    )
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
  const scale = Math.min(
    maxScale,
    Math.max(minScale, Math.max(view.scale, 0.0001) * Math.exp(-wheelDelta * sensitivity))
  );
  return zoomViewToScaleAtPoint({ cursor, viewport, view, scale });
};

export const zoomViewToScaleAtPoint = ({
  cursor,
  viewport,
  view,
  scale
}: {
  cursor: Point;
  viewport: Pick<RectLike, 'width' | 'height'>;
  view: ViewTransform;
  scale: number;
}): ViewTransform => {
  const currentScale = Math.max(view.scale, 0.0001);
  const safeScale = Math.max(scale, 0.0001);
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const imageX = (cursor.x - centerX - view.panX) / currentScale;
  const imageY = (cursor.y - centerY - view.panY) / currentScale;
  return {
    scale: safeScale,
    panX: cursor.x - centerX - imageX * safeScale,
    panY: cursor.y - centerY - imageY * safeScale
  };
};

export const zoomViewToViewportRect = ({
  rect,
  viewport,
  view,
  minScale,
  maxScale
}: {
  rect: RectLike;
  viewport: Pick<RectLike, 'width' | 'height'>;
  view: ViewTransform;
  minScale: number;
  maxScale: number;
}): ViewTransform => {
  const width = Math.max(rect.width, 1e-6);
  const height = Math.max(rect.height, 1e-6);
  const scale = Math.min(
    maxScale,
    Math.max(minScale, view.scale * Math.min(viewport.width / width, viewport.height / height))
  );
  const cursor = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const anchored = zoomViewToScaleAtPoint({ cursor, viewport, view, scale });
  return {
    scale: anchored.scale,
    panX: anchored.panX + viewport.width / 2 - cursor.x,
    panY: anchored.panY + viewport.height / 2 - cursor.y
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

export const panViewFromWheel = ({
  initialView,
  deltaX,
  deltaY,
  shiftKey = false,
  deltaMultiplier = 1
}: {
  initialView: Pick<ViewTransform, 'panX' | 'panY'>;
  deltaX: number;
  deltaY: number;
  shiftKey?: boolean;
  deltaMultiplier?: number;
}) => {
  const horizontalDelta = shiftKey && deltaX === 0 ? deltaY : deltaX;
  const verticalDelta = shiftKey && deltaX === 0 ? 0 : deltaY;
  return {
    panX: initialView.panX - horizontalDelta * deltaMultiplier,
    panY: initialView.panY - verticalDelta * deltaMultiplier
  };
};
