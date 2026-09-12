import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDefaultSmartSelectionOptions } from '../../editor/selection/selectionTypes';
import type { SmartSelectionBackend } from '../../application/tools/smartSelection/SmartSelectionBackend';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import { useSmartSelectionBinding } from './useSmartSelectionBinding';

interface Effect { dependencies: readonly unknown[]; setup(): void | (() => void); cleanup?: () => void; changed: boolean }
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Effect[] }));
vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => {
    hooks.cursor += 1; return getSnapshot();
  },
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    const state = hooks.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    const cell = state as { value: unknown };
    return [cell.value, (value: unknown) => { cell.value = typeof value === 'function' ? value(cell.value) : value; }];
  },
  useLayoutEffect: (setup: Effect['setup'], dependencies: readonly unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as Effect | undefined;
    if (!previous) {
      const effect = { setup, dependencies, changed: true };
      hooks.slots[index] = effect; hooks.effects.push(effect);
    } else {
      previous.changed = dependencies.some((value, i) => value !== previous.dependencies[i]);
      previous.dependencies = dependencies; previous.setup = setup;
    }
  }
}));
const flush = () => hooks.effects.forEach(effect => {
  if (!effect.changed) return;
  effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; effect.changed = false;
});
const cleanup = () => hooks.effects.forEach(effect => effect.cleanup?.());
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.runAllTimers(); vi.useRealTimers(); });

const session = () => {
  const value = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'source', name: 'SVG', mediaType: 'image/png' } });
  value.setDocument(createImageDocument('Image', 8, 6, 'source')); value.setReady();
  return value;
};
const fixture = () => {
  const backend: SmartSelectionBackend = {
    identity: { modelId: 'test', artifactRevision: 'test', precision: 'fp16', preprocessingRevision: 'test' },
    capabilities: { positivePoints: true, negativePoints: true, boxes: true, previousMask: false, automaticSubject: true },
    prepare: vi.fn(async source => ({ id: source.key, sourceKey: source.key,
      documentRevision: source.documentRevision, width: source.width, height: source.height })),
    selectPrompt: vi.fn(async () => []),
    selectSubject: vi.fn(async () => [{ id: 'subject', score: 1,
      mask: { width: 8, height: 6, data: new Uint8Array(48).fill(255) } }]),
    disposePreparedSource: vi.fn(), dispose: vi.fn()
  };
  const opening = session();
  const renderer = { exportPng: vi.fn(async () => new Blob(['png'])), setSmartSelectionPreview: vi.fn() };
  let runtime: Parameters<typeof useSmartSelectionBinding>[0] = {
    session: opening, renderer, lifecycle: {}, generation: 1, ready: true, sourceReady: true,
    enabled: false, document: opening.getSnapshot().document, sampleAllLayers: false
  };
  const commands = { recordObservedCommand: vi.fn() };
  const createBackend = vi.fn(() => backend);
  const status = vi.fn();
  const host = {
    commands, selection: { rasterMask: vi.fn(async () => true) } as unknown as SelectionSessionController,
    getOptions: createDefaultSmartSelectionOptions, setStatus: status, setDraft: vi.fn(),
    captureRendererScope: () => {
      const old = runtime;
      return { isCurrent: () => runtime.renderer === old.renderer && runtime.lifecycle === old.lifecycle };
    }
  };
  const render = () => { hooks.cursor = 0; return useSmartSelectionBinding(runtime, host, createBackend); };
  return { backend, renderer, opening, commands, createBackend, status, render,
    setRuntime: (change: Partial<typeof runtime>) => { runtime = { ...runtime, ...change }; } };
};

it('StrictMode setup replay retains one worker but invalidates the previous readback', async () => {
  const host = fixture(); const binding = host.render(); flush();
  let release!: (value: Blob) => void;
  host.renderer.exportPng.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = binding.controller.prepare();
  cleanup(); hooks.effects.forEach(effect => { effect.cleanup = effect.setup() || undefined; });
  vi.runAllTimers();
  release(new Blob(['old']));
  await expect(old).resolves.toBe(false);
  expect(host.backend.prepare).not.toHaveBeenCalled();
  expect(host.backend.dispose).not.toHaveBeenCalled();
  expect(host.render().controller).toBe(binding.controller);
  expect(host.createBackend).toHaveBeenCalledOnce();
  await expect(binding.controller.prepare()).resolves.toBe(true);
  host.opening.dispose();
});

it('rejects an equal-ID successor before layout cleanup and attributes fresh work to its current session', async () => {
  const host = fixture(); const binding = host.render(); flush();
  let release!: (value: Blob) => void;
  host.renderer.exportPng.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = binding.controller.prepare();
  const successor = session();
  host.setRuntime({ session: successor, document: successor.getSnapshot().document }); host.render();
  release(new Blob(['old']));
  await expect(old).resolves.toBe(false);
  expect(host.backend.prepare).not.toHaveBeenCalled();
  flush();
  await expect(binding.controller.selectSubject()).resolves.toBe(true);
  expect(host.commands.recordObservedCommand).toHaveBeenCalledOnce();
  expect(host.commands.recordObservedCommand.mock.calls[0]?.[1]).toBe(successor.id);
  host.opening.dispose(); successor.dispose();
});

it('does not reuse preparation across a same-generation renderer replacement', async () => {
  const host = fixture(); const binding = host.render(); flush();
  await expect(binding.controller.prepare()).resolves.toBe(true);
  const renderer = { exportPng: vi.fn(async () => new Blob(['replacement'])), setSmartSelectionPreview: vi.fn() };
  host.setRuntime({ renderer }); host.render(); flush();
  await expect(binding.controller.prepare()).resolves.toBe(true);
  expect(renderer.exportPng).toHaveBeenCalledOnce();
  expect(host.backend.prepare).toHaveBeenCalledTimes(2);
  host.opening.dispose();
});

it('rejects disposed sessions before React cleanup and starts on null-to-ready renderer binding', async () => {
  const host = fixture(); host.setRuntime({ renderer: null, ready: false });
  const binding = host.render(); flush();
  await expect(binding.controller.prepare()).resolves.toBe(false);
  host.setRuntime({ renderer: host.renderer, ready: true }); host.render(); flush();
  await expect(binding.controller.prepare()).resolves.toBe(true);
  host.opening.dispose(); host.status.mockClear();
  await expect(binding.controller.selectSubject()).resolves.toBe(false);
  expect(host.status).not.toHaveBeenCalled();
});

it('retires displayed hover on processing publication without readback before renderer publication finishes', async () => {
  const host = fixture();
  host.setRuntime({ enabled: true });
  const binding = host.render(); flush();
  vi.mocked(host.backend.selectPrompt).mockResolvedValue([{ id: 'hover', score: 1,
    mask: { width: 8, height: 6, data: new Uint8Array(48).fill(255) } }]);
  await binding.controller.prepare();
  binding.controller.hover({ x: 2, y: 2 });
  await vi.waitFor(() => expect(host.renderer.setSmartSelectionPreview).toHaveBeenCalledWith(
    expect.objectContaining({ width: 8, height: 6 })));
  host.renderer.setSmartSelectionPreview.mockClear();
  const exports = host.renderer.exportPng.mock.calls.length;
  const document = host.opening.getSnapshot().document;
  host.opening.publishProcessing({ globalGradeStrength: 25 });
  expect(host.opening.getSnapshot().document).toBe(document);
  expect(host.renderer.setSmartSelectionPreview).toHaveBeenCalledWith(null);
  expect(host.renderer.exportPng).toHaveBeenCalledTimes(exports);
  host.render(); flush();
  await binding.controller.prepare();
  expect(host.renderer.exportPng).toHaveBeenCalledTimes(exports + 1);
  expect(host.backend.prepare).toHaveBeenCalledTimes(2);
  host.opening.dispose();
});

it('retains its embedding across canonical selection and editor-only publications', async () => {
  const host = fixture(); host.setRuntime({ enabled: true });
  const binding = host.render(); flush();
  await binding.controller.prepare();
  const before = host.opening.getSnapshot().documentRevision;
  host.opening.updateEditor(current => ({ ...current,
    selectionRevision: current.selectionRevision + 1, pointerId: 41 }));
  expect(host.opening.getSnapshot().documentRevision).toBeGreaterThan(before);
  host.render(); flush();
  await binding.controller.prepare();
  expect(host.renderer.exportPng).toHaveBeenCalledOnce();
  expect(host.backend.prepare).toHaveBeenCalledOnce();
  expect(host.backend.disposePreparedSource).not.toHaveBeenCalled();
  host.opening.dispose();
});
