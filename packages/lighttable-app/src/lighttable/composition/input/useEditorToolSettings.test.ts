import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditorToolSettings } from './useEditorToolSettings';
import { useDocumentEditorSession } from '../../editor/hooks/useDocumentEditorState';
import { EditorApplicationSession } from '../../application/workspace/editorApplicationSession';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: new Map<number, {
  dependencies: readonly unknown[]; setup: () => void | (() => void); cleanup?: () => void; changed: boolean;
}>() }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useState: (initial: unknown) => {
    const index = hooks.cursor++, state = hooks.slots[index] as { value: unknown } | undefined;
    const slot = state ?? { value: typeof initial === 'function' ? initial() : initial }; hooks.slots[index] = slot;
    return [slot.value, (update: unknown) => { slot.value = typeof update === 'function' ? update(slot.value) : update; }];
  },
  useMemo: (create: () => unknown, dependencies: readonly unknown[]) => {
    const index = hooks.cursor++, prior = hooks.slots[index] as { value: unknown; dependencies: readonly unknown[] } | undefined;
    if (prior && dependencies.every((value, i) => value === prior.dependencies[i])) return prior.value;
    const slot = { value: create(), dependencies }; hooks.slots[index] = slot; return slot.value;
  },
  useCallback: (callback: unknown) => { hooks.cursor++; return callback; },
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => { hooks.cursor++; return getSnapshot(); },
  useLayoutEffect: (setup: () => void | (() => void), dependencies: readonly unknown[]) => {
    const index = hooks.cursor++, previous = hooks.effects.get(index);
    hooks.effects.set(index, { setup, dependencies, cleanup: previous?.cleanup,
      changed: !previous || dependencies.some((value, i) => value !== previous.dependencies[i]) });
  }
}));
const sessions: DocumentSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects.clear(); vi.spyOn(performance, 'now').mockReturnValue(0); });
afterEach(() => { hooks.effects.forEach(effect => effect.cleanup?.()); sessions.splice(0).forEach(session => session.dispose()); vi.restoreAllMocks(); });
const makeSession = (id: string) => {
  const session = new DocumentSession({ id: id as DocumentSessionId, source: { id, name: id, mediaType: 'image/png' } });
  session.setDocument(createImageDocument(id, 100, 50, id)); session.setReady(); sessions.push(session); return session;
};
const commit = () => { hooks.effects.forEach(effect => { if (!effect.changed) return;
  effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; effect.changed = false;
}); };
const fixture = () => {
  const application = new EditorApplicationSession(), a = makeSession('A'), b = makeSession('B');
  let active = a;
  const render = () => { hooks.cursor = 0; const [view, update] = useDocumentEditorSession(active, application);
    const owner = useEditorToolSettings(active.id, update); return { owner, view }; };
  return { a, b, application, render, activateB: () => { active = b; }, activateA: () => { active = a; } };
};
it('actual combined-session adapter preserves both canonical document snapshots while sharing tool defaults across tabs', () => {
  const f = fixture(), originalA = f.a.getSnapshot(), originalB = f.b.getSnapshot();
  const { owner } = f.render(); commit();
  owner.brush({ size: 80, color: '#123456', backgroundColor: '#abcdef' }); owner.swapColors(); owner.swapColors();
  owner.selection({ selectionFeather: 3, selectionMarqueeWidth: 16, selectionMarqueeHeight: 9 });
  expect(f.application.getSnapshot().brush).toMatchObject({ size: 80, color: '#123456', backgroundColor: '#abcdef' });
  f.activateB(); const next = f.render(); commit(); expect(next.owner).toBe(owner);
  expect(next.view.brush.size).toBe(80); owner.warp({ diameterPx: 100 });
  f.activateA(); const back = f.render(); commit(); expect(back.view.warp.diameterPx).toBe(100);
  expect(f.a.getSnapshot()).toBe(originalA); expect(f.b.getSnapshot()).toBe(originalB);
});
it('tool changes and unrelated rerenders keep paired digits; tab change and keyboard blur reset only the digit buffer', () => {
  const f = fixture(), { owner } = f.render(); commit(); owner.inputBrushPercent('opacity', 4);
  f.application.update(current => ({ ...current, activeTool: 'warp' })); f.render(); commit();
  owner.inputBrushPercent('opacity', 5); expect(f.application.getSnapshot().brush.opacity).toBe(0.45);
  owner.inputBrushPercent('opacity', 2); f.activateB(); f.render(); commit();
  owner.inputBrushPercent('opacity', 3); expect(f.application.getSnapshot().brush.opacity).toBe(0.3);
  owner.clearPercentInput(); owner.inputBrushPercent('opacity', 7); expect(f.application.getSnapshot().brush.opacity).toBe(0.7);
  owner.clearPercentInput(); f.render(); commit(); owner.inputBrushPercent('opacity', 1); f.render(); commit();
  owner.inputBrushPercent('opacity', 2); expect(f.application.getSnapshot().brush.opacity).toBe(0.12);
});
it('retained unmounted callbacks cannot update defaults; StrictMode setup replays without a second state owner', () => {
  const f = fixture(), { owner } = f.render(), before = f.application.getSnapshot();
  owner.brush({ size: 100 }); expect(f.application.getSnapshot()).toBe(before); commit();
  owner.inputBrushPercent('opacity', 4);
  hooks.effects.forEach(effect => effect.cleanup?.());
  const after = f.application.getSnapshot(); owner.brush({ size: 200 }); expect(f.application.getSnapshot()).toBe(after);
  hooks.effects.forEach(effect => { effect.cleanup = effect.setup() || undefined; });
  owner.inputBrushPercent('opacity', 5); expect(f.application.getSnapshot().brush.opacity).toBe(0.5);
});
