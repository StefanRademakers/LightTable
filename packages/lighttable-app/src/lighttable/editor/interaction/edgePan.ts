export const EDGE_PAN_ZONE_PX = 32;
export const EDGE_PAN_MAX_SPEED_PX_PER_SECOND = 900;

export const edgePanVelocity = (
  position: number,
  start: number,
  size: number,
  zonePx = EDGE_PAN_ZONE_PX,
  maxSpeed = EDGE_PAN_MAX_SPEED_PX_PER_SECOND
): number => {
  const local = position - start;
  if (local < zonePx) {
    return Math.min(1, (zonePx - local) / zonePx) * maxSpeed;
  }
  if (local > size - zonePx) {
    return -Math.min(1, (local - (size - zonePx)) / zonePx) * maxSpeed;
  }
  return 0;
};

export const clampEdgePanDelta = (
  delta: number,
  imageStart: number,
  imageSize: number,
  viewportSize: number
): number => {
  if (delta > 0) return Math.min(delta, Math.max(0, -imageStart));
  if (delta < 0) {
    return Math.max(delta, Math.min(0, viewportSize - imageStart - imageSize));
  }
  return 0;
};

export const edgePanFrameDelta = (input: {
  readonly clientX: number;
  readonly clientY: number;
  readonly viewportLeft: number;
  readonly viewportTop: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly elapsedMs: number;
}) => {
  const elapsedSeconds = Math.min(Math.max(input.elapsedMs, 0), 32) / 1_000;
  const requestedX = edgePanVelocity(
    input.clientX, input.viewportLeft, input.viewportWidth
  ) * elapsedSeconds;
  const requestedY = edgePanVelocity(
    input.clientY, input.viewportTop, input.viewportHeight
  ) * elapsedSeconds;
  return {
    x: clampEdgePanDelta(
      requestedX, input.imageX, input.imageWidth, input.viewportWidth
    ),
    y: clampEdgePanDelta(
      requestedY, input.imageY, input.imageHeight, input.viewportHeight
    )
  };
};
