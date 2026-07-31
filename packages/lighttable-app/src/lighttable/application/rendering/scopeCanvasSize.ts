export interface ScopeCanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Resolves a scope canvas' CSS bounds to the exact backing-store dimensions
 * consumed by WebGPU. Zero-sized panels have no drawable surface yet.
 */
export const resolveScopeCanvasSize = (
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number
): ScopeCanvasSize | null => {
  if (cssWidth < 1 || cssHeight < 1) return null;
  const dpr = Math.max(1, devicePixelRatio || 1);
  return {
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr))
  };
};

export const scopeCanvasSizesEqual = (
  left: ScopeCanvasSize | null,
  right: ScopeCanvasSize | null
): boolean => left?.width === right?.width && left?.height === right?.height;
