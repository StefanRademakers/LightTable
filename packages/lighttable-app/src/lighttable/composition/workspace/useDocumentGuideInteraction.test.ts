import { beforeEach, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { useDocumentGuideInteraction } from './useDocumentGuideInteraction';
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
const setup = () => {
  const session = new DocumentSession({ id: 'a' as DocumentSessionId, source: { id: 'a', name: 'A', mediaType: 'image/png' } });
  const document = createImageDocument('A', 200, 100, 'a'); session.setDocument(document); session.setReady();
  const renderer = {}, lifecycle = {}, changeDocument = vi.fn(() => true);
  let ready = true, currentRenderer: object = renderer;
  const render = () => { hooks.cursor = 0; hooks.effects = []; return useDocumentGuideInteraction(session, renderer, lifecycle, 1, ready,
    document.id, () => ({ isCurrent: () => true }), { changeDocument, reportFailure: vi.fn(), getRenderer: () => currentRenderer }); };
  return { session, render, changeDocument, notReady: () => { ready = false; }, replaceRenderer: () => { currentRenderer = {}; } };
};
it('retires a disposed canonical session before React cleanup and does not publish from retained pointer callbacks', () => {
  const f = setup(), owner = f.render(); hooks.effects.forEach(effect => effect());
  const lease = owner.beginNew('vertical')!; lease.move({ x: 30, y: 20, scale: 1, altKey: false, shiftKey: false });
  f.session.dispose(); expect(owner.getSnapshot()).toBeNull(); expect(lease.isCurrent()).toBe(false);
  lease.finish({ x: 30, y: 20, scale: 1, altKey: false, shiftKey: false }, true);
  expect(f.changeDocument).not.toHaveBeenCalled();
});
it('supports StrictMode reconnect without reviving an old lease and retires readiness loss', () => {
  const f = setup(), owner = f.render(); const cleanups = hooks.effects.map(effect => effect());
  const old = owner.beginNew('vertical')!; cleanups.forEach(cleanup => cleanup?.());
  expect(old.isCurrent()).toBe(false); f.render(); hooks.effects.forEach(effect => effect());
  expect(owner.beginNew('vertical')).not.toBeNull(); expect(old.isCurrent()).toBe(false);
  f.notReady(); f.render(); hooks.effects.forEach(effect => effect());
  expect(owner.beginNew('vertical')).toBeNull(); expect(owner.getSnapshot()).toBeNull();
});
it('cannot capture a replacement renderer scope through an old render binding before layout', () => {
  const f = setup(), owner = f.render(); f.replaceRenderer(); hooks.effects.forEach(effect => effect());
  expect(owner.beginNew('vertical')).toBeNull(); expect(f.changeDocument).not.toHaveBeenCalled();
});
