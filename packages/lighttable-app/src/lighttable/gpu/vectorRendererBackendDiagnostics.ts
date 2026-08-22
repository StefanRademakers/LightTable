export type VectorRendererBackendSelection = 'current' | 'vello';

let selection: VectorRendererBackendSelection = 'current';
let locked = false;

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

export const lockVectorRendererBackendSelection = () => {
  locked = true;
  return selection;
};

