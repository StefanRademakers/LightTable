import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../../application/workspace/workspaceSession';
import { createImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { useTransformCanvasPickIntent } from './useTransformCanvasPickIntent';
import type { TransformLayerAlphaPicker } from '../../application/tools/transform/transformLayerPicker';

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
const fixture = () => {
  const runtime = { session: session(), renderer: null as TransformLayerAlphaPicker | null,
    lifecycle: {}, generation: 1, ready: true };
  const document = () => runtime.session.getSnapshot().document!;
  const renderer = { pickTopLayerAtPoint: vi.fn(async () => document().activeLayerId) };
  runtime.renderer = renderer;
  const ports = {
    read: () => ({ document: document(), selectedLayerIds: [document().activeLayerId!],
      autoSelect: true, historyBusy: false, tool: 'transform' }),
    commitTransform: vi.fn(async () => undefined), publishSelection: vi.fn(),
    selectLayer: vi.fn(async (_id: LayerId, isCurrent: () => boolean, onSelected: () => void) => {
      if (!isCurrent()) return false;
      onSelected(); return true;
    }),
    activateTransform: vi.fn(), reportError: vi.fn()
  };
  let scopeCurrent = true;
  const render = () => { hooks.cursor = 0; return useTransformCanvasPickIntent({ ...runtime }, { ...ports },
    () => ({ isCurrent: () => scopeCurrent })); };
  const delay = () => {
    let release!: (id: LayerId | null) => void;
    renderer.pickTopLayerAtPoint.mockImplementationOnce(() => new Promise<LayerId | null>(resolve => { release = resolve; }));
    return () => release(document().activeLayerId);
  };
  return { runtime, ports, render, delay, retireScope: () => { scopeCurrent = false; } };
};

describe('mounted transform canvas pick intent', () => {
  it('keeps a pending pick across ordinary rerenders and captures its originating mutation ports', async () => {
    const f = fixture(); const intent = f.render(); flush(); const release = f.delay();
    const originalSelect = f.ports.selectLayer;
    const request = intent.request({ x: 10, y: 10 });
    f.ports.selectLayer = vi.fn(async () => false);
    for (let i = 0; i < 3; i++) { expect(f.render()).toBe(intent); flush(); }
    release(); expect(await request).toBe(true);
    expect(originalSelect).toHaveBeenCalledOnce(); expect(f.ports.selectLayer).not.toHaveBeenCalled();
    expect(f.ports.activateTransform).toHaveBeenCalledOnce();
  });
  it.each(['session', 'renderer', 'generation', 'lifecycle', 'ready', 'disposed', 'scope'] as const)(
    'drops pending work at %s retirement before layout cleanup', async reason => {
      const f = fixture(); const old = f.render(); flush(); const release = f.delay();
      const pending = old.request({ x: 10, y: 10 });
      if (reason === 'session') f.runtime.session = session();
      else if (reason === 'renderer') f.runtime.renderer = { pickTopLayerAtPoint: vi.fn(async () => null) };
      else if (reason === 'generation') f.runtime.generation++;
      else if (reason === 'lifecycle') f.runtime.lifecycle = {};
      else if (reason === 'ready') f.runtime.ready = false;
      else if (reason === 'disposed') f.runtime.session.dispose();
      else f.retireScope();
      f.render(); release(); expect(await pending).toBe(false);
      expect(f.ports.commitTransform).not.toHaveBeenCalled(); expect(f.ports.selectLayer).not.toHaveBeenCalled();
      flush();
      expect(await old.request({ x: 10, y: 10 })).toBe(false);
    });
  it('rearms StrictMode setup and permanently closes retained callbacks after unmount', async () => {
    const f = fixture(); const intent = f.render(); flush(); const release = f.delay();
    const pending = intent.request({ x: 10, y: 10 }); const effect = hooks.effects[0];
    effect.cleanup?.(); effect.cleanup = effect.setup() || undefined;
    release(); expect(await pending).toBe(false);
    expect(await intent.request({ x: 10, y: 10 })).toBe(true);
    effect.cleanup?.(); effect.cleanup = undefined;
    expect(await intent.request({ x: 10, y: 10 })).toBe(false);
  });
  it('admits only after renderer startup and rejects the old null-renderer callback', async () => {
    const f = fixture(); const renderer = f.runtime.renderer; f.runtime.renderer = null;
    const early = f.render(); flush(); expect(await early.request({ x: 10, y: 10 })).toBe(false);
    f.runtime.renderer = renderer; const current = f.render(); flush();
    expect(await current.request({ x: 10, y: 10 })).toBe(true);
    expect(await early.request({ x: 10, y: 10 })).toBe(false);
  });
});
