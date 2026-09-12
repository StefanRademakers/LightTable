import { beforeEach, expect, it, vi } from 'vitest';
import type { TextToShapeConfirmation } from '../../application/text/TextToShapeIntent';
import { useEditorDialogController } from './useEditorDialogController';
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], pending: [] as (() => void)[] }));
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => hooks.pending.push(() => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    })];
  }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.pending = []; });
const render = () => { hooks.cursor = 0; return useEditorDialogController(); };
const flush = () => { hooks.pending.splice(0).forEach(update => update()); return render(); };
const request = (isCurrent: () => boolean): TextToShapeConfirmation => ({ layerId: 'text' as TextToShapeConfirmation['layerId'],
  isCurrent, confirm: vi.fn(async () => {}), cancel: vi.fn() });
it('does not publish a retired confirmation through a deferred React updater', () => {
  let current = true; const owner = render(), old = request(() => current);
  owner.requestTextToShape(old); current = false; expect(flush().textToShapeRequest).toBeNull();
});
it('late identity-close cannot erase a successor confirmation', () => {
  const owner = render(), old = request(() => true), next = request(() => true);
  owner.requestTextToShape(old); flush(); owner.requestTextToShape(next); owner.closeTextToShape(old);
  expect(flush().textToShapeRequest).toBe(next);
});
