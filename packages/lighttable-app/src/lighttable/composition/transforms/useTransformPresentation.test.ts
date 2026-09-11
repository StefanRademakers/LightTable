import { beforeEach, expect, it, vi } from 'vitest';
import { useTransformPresentation } from './useTransformPresentation';
import { createEditorSession } from '../../editor/session/editorSession';
import { identityMatrix } from '../../editor/tools/transform/affine';
import type { TransformPresentationInputs } from '../../application/tools/transform/TransformPresentationBinding';

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<{
  setup: () => void | (() => void); dependencies: readonly unknown[];
}> }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useMemo: (create: () => unknown) => create(),
  useLayoutEffect: (setup: () => void | (() => void), dependencies: readonly unknown[]) => {
    lifecycle.effects.push({ setup, dependencies });
  }
}));
beforeEach(() => { lifecycle.effects = []; });

it('closes callbacks during cleanup and rearms them on StrictMode setup replay', () => {
  let current = true;
  const renderer = { setTransformEditingFrame: vi.fn(), setSmartGuideEditingFrame: vi.fn() };
  const operations = { update: vi.fn(() => null), updateProjective: vi.fn(() => null) };
  const inputs: TransformPresentationInputs = { state: null, frameOverride: null,
    temporaryMove: false, scale: 1, frameMode: 'document', snap: createEditorSession().snap,
    selectionFeedback: { matches: [], bounds: null }, document: null, selectedLayerIds: [] };
  const binding = useTransformPresentation(renderer, {}, 1, {},
    () => ({ isCurrent: () => current }), () => inputs, operations);
  binding.update(identityMatrix(), []);
  expect(operations.update).not.toHaveBeenCalled();
  const cleanup = lifecycle.effects[0].setup() as () => void;
  binding.update(identityMatrix(), []);
  expect(operations.update).toHaveBeenCalledOnce();
  cleanup(); binding.update(identityMatrix(), []);
  expect(operations.update).toHaveBeenCalledOnce();
  lifecycle.effects[0].setup(); binding.update(identityMatrix(), []);
  expect(operations.update).toHaveBeenCalledTimes(2);
  current = false;
  renderer.setTransformEditingFrame.mockClear();
  cleanup(); binding.update(identityMatrix(), []);
  expect(operations.update).toHaveBeenCalledTimes(2);
  expect(renderer.setTransformEditingFrame).not.toHaveBeenCalled();
  // React schedules projection only for presentation inputs, never document/chrome identity.
  expect(lifecycle.effects[1].dependencies).toEqual([binding, inputs.state, inputs.frameOverride,
    inputs.temporaryMove, inputs.scale, inputs.frameMode, inputs.snap.extrasVisible,
    inputs.snap.smartGuidesVisible, inputs.selectionFeedback]);
});
