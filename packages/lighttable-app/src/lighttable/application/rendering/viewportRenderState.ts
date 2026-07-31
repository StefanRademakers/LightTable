export interface ViewportRenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportRenderState {
  pixelWidth: number;
  pixelHeight: number;
  uniforms: Float32Array<ArrayBuffer>;
}

/**
 * Resolves DOM viewport measurements to the exact values consumed by WebGPU.
 * Comparing this state prevents layout-object churn from producing redundant
 * uniform uploads and render requests.
 */
export const resolveViewportRenderState = (
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  rect: ViewportRenderRect
): ViewportRenderState => {
  const pixelWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  return {
    pixelWidth,
    pixelHeight,
    uniforms: new Float32Array([
      pixelWidth,
      pixelHeight,
      rect.x * devicePixelRatio,
      rect.y * devicePixelRatio,
      Math.max(1, rect.width * devicePixelRatio),
      Math.max(1, rect.height * devicePixelRatio),
      12 * devicePixelRatio,
      0
    ])
  };
};

export const viewportRenderStatesEqual = (
  left: ViewportRenderState | null,
  right: ViewportRenderState
) => {
  if (!left ||
      left.pixelWidth !== right.pixelWidth ||
      left.pixelHeight !== right.pixelHeight ||
      left.uniforms.length !== right.uniforms.length) {
    return false;
  }
  for (let index = 0; index < left.uniforms.length; index += 1) {
    if (!Object.is(left.uniforms[index], right.uniforms[index])) return false;
  }
  return true;
};
