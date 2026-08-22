import type { PaintScene, PaintSceneCapabilityIssue, PaintSceneCompileResult } from './types';

/** Centralizes status semantics so adapters cannot report lossy output as ready. */
export const createPaintSceneCompileResult = (
  scene: PaintScene,
  issues: readonly PaintSceneCapabilityIssue[]
): PaintSceneCompileResult => ({
  status: issues.length === 0
    ? 'ready'
    : scene.fragments.some(fragment => fragment.commands.length > 0) ? 'partial' : 'unsupported',
  scene,
  issues
});
