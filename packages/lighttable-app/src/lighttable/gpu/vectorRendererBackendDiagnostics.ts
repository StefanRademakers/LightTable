export type VectorRendererBackendSelection = 'current' | 'vello';

let selection: VectorRendererBackendSelection = 'current';
let locked = false;
let renderIslandsEnabled = true;

/**
 * Diagnostic-only backend selection. Hosts must call this before the first
 * WebGPU request because Vello and Chromium must share one device identity.
 */
export const configureVectorRendererBackend = (
  next: VectorRendererBackendSelection
) => {
  if (locked && next !== selection) {
    throw new Error('The vector renderer backend cannot change after WebGPU initialization.');
  }
  selection = next;
};

export const vectorRendererBackendSelection = () => selection;

/** Keeps the per-layer Vello path available as a pixel-parity oracle/fallback. */
export const configureVectorRenderIslands = (enabled: boolean) => {
  if (locked && enabled !== renderIslandsEnabled) {
    throw new Error('Vector render-island mode cannot change after WebGPU initialization.');
  }
  renderIslandsEnabled = enabled;
};

export const vectorRenderIslandsEnabled = () => renderIslandsEnabled;

export const lockVectorRendererBackendSelection = () => {
  locked = true;
  return selection;
};
