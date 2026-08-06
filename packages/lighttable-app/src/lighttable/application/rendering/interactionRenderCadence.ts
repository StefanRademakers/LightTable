/**
 * Bounds live warp submissions on large canvases while retaining every input
 * sample in the newest immutable document snapshot. Small documents stay at
 * display cadence; large documents avoid building a long GPU queue that keeps
 * running after the pointer has already moved on.
 */
export const warpInteractionFrameIntervalMs = (width: number, height: number) => {
  const pixels = Math.max(1, width) * Math.max(1, height);
  if (pixels <= 4_000_000) return 0;
  return pixels <= 8_000_000 ? 100 : 500;
};

export const interactionFrameIntervalMs = (
  effectIntervalMs: number,
  warpActive: boolean,
  dimensions: { readonly width: number; readonly height: number } | null
) => Math.max(
  effectIntervalMs,
  warpActive && dimensions
    ? warpInteractionFrameIntervalMs(dimensions.width, dimensions.height)
    : 0
);
