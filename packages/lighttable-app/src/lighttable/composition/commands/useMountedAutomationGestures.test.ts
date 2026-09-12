import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../../application/workspace/workspaceSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { BrushSettings } from '../../editor/session/editorSession';
import { useMountedAutomationGestures } from './useMountedAutomationGestures';

interface Effect { setup(): void | (() => void); deps: unknown[]; cleanup?: () => void; changed: boolean }
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Effect[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (create: () => unknown, deps: unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as { value: unknown; deps: unknown[] } | undefined;
    if (!old || deps.some((value, i) => value !== old.deps[i])) hooks.slots[index] = { value: create(), deps };
    return (hooks.slots[index] as { value: unknown }).value;
  },
  useLayoutEffect: (setup: Effect['setup'], deps: unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as Effect | undefined;
    if (!old) { const effect = { setup, deps, changed: true }; hooks.slots[index] = effect; hooks.effects.push(effect); }
    else { old.changed = deps.some((value, i) => value !== old.deps[i]); old.setup = setup; old.deps = deps; }
  }
}));
const workspaces: WorkspaceSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => {
  for (const effect of hooks.effects) effect.cleanup?.();
  for (const workspace of workspaces.splice(0)) workspace.dispose();
});
const flush = () => { for (const effect of hooks.effects) if (effect.changed) {
  effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; effect.changed = false;
} };
const session = () => {
  const workspace = new WorkspaceSession({ createId: () => 'same-public-id' as never }); workspaces.push(workspace);
  const opened = workspace.open({ source: { id: 'image', name: 'Image', mediaType: 'image/png' } });
  if (!opened.ok) throw new Error('Fixture failed');
  opened.value.setDocument(createImageDocument('Image', 100, 100, 'image')); opened.value.setReady();
  return opened.value;
};
const selectionPorts = () => ({
  begin: vi.fn(() => true), move: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => true),
  beginPaint: vi.fn(() => true), movePaint: vi.fn(() => true), finishPaint: vi.fn(() => true), cancelPaint: vi.fn(() => true)
});
const fixture = () => {
  const runtime = { session: session(), renderer: {} as object | null, lifecycle: {}, generation: 1, ready: true };
  const ports = { getDocument: () => runtime.session.getSnapshot().document,
    getBrush: () => ({ size: 20 } as BrushSettings), documentMutations: { begin: vi.fn(() => null) },
    selection: selectionPorts(), paint: { begin: vi.fn(() => true), move: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => true) } };
  const render = () => { hooks.cursor = 0; return useMountedAutomationGestures({ ...runtime }, { ...ports },
    () => ({ isCurrent: () => true })); };
  return { runtime, ports, render };
};

describe('mounted automation hook lifecycle', () => {
  it('retains the active owner across status/zoom/inspector-style rerenders with fresh callback identities', () => {
    const f = fixture(); const commands = f.render(); flush();
    const original = f.ports.selection;
    commands.beginGesture('selection-rectangle', 7, {}, { x: 0, y: 0 });
    f.ports.selection = selectionPorts(); f.ports.getBrush = () => ({ size: 40 } as BrushSettings);
    for (let i = 0; i < 3; i++) { expect(f.render()).toBe(commands); flush(); }
    expect(original.cancel).not.toHaveBeenCalled();
    expect(commands.updateGesture('selection-rectangle', 7, { x: 20, y: 30 })).toBe(true);
    expect(commands.finishGesture('selection-rectangle', 7, true)).toBe(true);
    expect(original.move).toHaveBeenCalledOnce(); expect(original.finish).toHaveBeenCalledOnce();
    expect(f.ports.selection.move).not.toHaveBeenCalled();
    commands.beginGesture('selection-rectangle', 8, {}, { x: 0, y: 0 });
    commands.finishGesture('selection-rectangle', 8, true);
    expect(f.ports.selection.finish).toHaveBeenCalledExactlyOnceWith(8);
  });
  it.each(['session', 'renderer', 'lifecycle', 'generation', 'ready'] as const)(
    'rejects old %s lifetime even before layout cleanup and accepts only the replacement pointer', kind => {
      const f = fixture(); const old = f.render(); flush();
      old.beginGesture('selection-rectangle', 7, {}, { x: 0, y: 0 });
      if (kind === 'session') f.runtime.session = session();
      else if (kind === 'renderer') f.runtime.renderer = {};
      else if (kind === 'lifecycle') f.runtime.lifecycle = {};
      else if (kind === 'generation') f.runtime.generation++;
      else f.runtime.ready = false;
      const next = f.render();
      expect(old.updateGesture('selection-rectangle', 7, { x: 9, y: 9 })).toBe(false);
      flush(); expect(f.ports.selection.cancel).toHaveBeenCalledExactlyOnceWith(7);
      expect(next.finishGesture('selection-rectangle', 7, true)).toBe(false);
      if (kind !== 'ready') {
        expect(next.beginGesture('selection-rectangle', 8, {}, { x: 0, y: 0 })).toBe(true);
        expect(next.finishGesture('selection-rectangle', 8, true)).toBe(true);
      }
    });
  it('rearms after StrictMode layout replay without reopening callbacks after unmount', () => {
    const f = fixture(); const commands = f.render(); flush();
    commands.beginGesture('selection-rectangle', 7, {}, { x: 0, y: 0 });
    const effect = hooks.effects[0]; effect.cleanup?.(); effect.cleanup = effect.setup() || undefined;
    expect(f.ports.selection.cancel).toHaveBeenCalledExactlyOnceWith(7);
    expect(commands.beginGesture('selection-rectangle', 8, {}, { x: 0, y: 0 })).toBe(true);
    effect.cleanup?.(); effect.cleanup = undefined;
    expect(commands.beginGesture('selection-rectangle', 9, {}, { x: 0, y: 0 })).toBe(false);
    expect(commands.finishGesture('selection-rectangle', 8, true)).toBe(false);
  });
  it('admits after real renderer startup instead of retaining a render-null memo', () => {
    const f = fixture(); f.runtime.renderer = null;
    const early = f.render(); flush();
    expect(early.beginGesture('selection-rectangle', 7, {}, { x: 0, y: 0 })).toBe(false);
    f.runtime.renderer = {}; const ready = f.render(); flush();
    expect(ready.beginGesture('selection-rectangle', 8, {}, { x: 0, y: 0 })).toBe(true);
  });
});
