import type { DocumentRendererCallbacks } from './rendererTypes';

/**
 * Prevents renderer callbacks from a stale document generation from
 * publishing into the currently active editor composition.
 *
 * The asynchronous work may still finish, but every presentation callback is
 * rejected at the document boundary.
 */
export const guardDocumentRendererCallbacks = (
  isCurrent: () => boolean,
  callbacks: DocumentRendererCallbacks
): DocumentRendererCallbacks => ({
  onHistogram: (histogram) => {
    if (isCurrent()) callbacks.onHistogram?.(histogram);
  },
  onGpuMemoryEstimate: (bytes) => {
    if (isCurrent()) callbacks.onGpuMemoryEstimate?.(bytes);
  },
  onTextRenderPresentation: (snapshot) => {
    if (isCurrent()) callbacks.onTextRenderPresentation?.(snapshot);
  },
  onDeviceLost: (message) => {
    if (isCurrent()) callbacks.onDeviceLost?.(message);
  },
  onScopeError: (message) => {
    if (isCurrent()) callbacks.onScopeError?.(message);
  },
  onFeatureError: (featureId, message) => {
    if (isCurrent()) callbacks.onFeatureError?.(featureId, message);
  },
  onFirstFrame: () => {
    if (isCurrent()) callbacks.onFirstFrame?.();
  }
});
