import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentGpuRecoveryController, type DocumentGpuRecoveryScope, type GpuRecoverySource } from './DocumentGpuRecoveryController';
import { DocumentRendererLifecycle } from './documentRendererLifecycle';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { DocumentOpenController } from '../documents/documentOpenController';
import { DocumentTaskRegistry } from '../tasks/documentTaskRegistry';
import type { DocumentSessionId } from '../documents/documentSession';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const fixture = (owner = new DocumentGpuRecoveryController()) => {
  const lifecycle = new DocumentRendererLifecycle(); lifecycle.beginStart();
  let current = true;
  const scope: DocumentGpuRecoveryScope = { session: {}, lifecycle, renderer: {}, isCurrent: () => current,
    getSource: vi.fn((): GpuRecoverySource => ({ kind: 'startup' })), reportError: vi.fn(), requestReopen: vi.fn() };
  return { owner, scope, retire: () => { current = false; }, fail: () => lifecycle.markFailed(lifecycle.getSnapshot().generation, 'WebGPU device lost: test') };
};
const semantic = () => {
  const document = createImageDocument('vector', 32, 32, 'source'); document.layers = [createVectorLayer([], 'Vector')];
  return document;
};

it('budgets two actual reopens across the host and forgives only a continuous 30s ready window', () => {
  const owner = new DocumentGpuRecoveryController();
  const a = fixture(owner); owner.connect(a.scope); a.fail(); vi.advanceTimersByTime(50);
  const b = fixture(owner); owner.connect(b.scope); b.fail(); vi.advanceTimersByTime(50);
  const c = fixture(owner); owner.connect(c.scope); c.fail(); vi.advanceTimersByTime(50);
  expect(a.scope.requestReopen).toHaveBeenCalledOnce(); expect(b.scope.requestReopen).toHaveBeenCalledOnce();
  expect(c.scope.requestReopen).not.toHaveBeenCalled(); expect(c.scope.reportError).toHaveBeenCalledWith(expect.stringContaining('2 consecutive'));
  const d = fixture(owner); owner.connect(d.scope); d.scope.lifecycle.markReady(1); vi.advanceTimersByTime(29_999);
  d.scope.lifecycle.setActive(false); vi.advanceTimersByTime(1); d.scope.lifecycle.setActive(true);
  vi.advanceTimersByTime(30_000); d.fail(); vi.advanceTimersByTime(50);
  expect(d.scope.requestReopen).toHaveBeenCalledOnce();
  expect(owner.canReuseRenderer(a.scope.renderer!)).toBe(false);
});

it('StrictMode disconnect reconnect rearms a pending retry without consuming budget or repeating dispatched work', () => {
  const { owner, scope, fail } = fixture();
  const disconnect = owner.connect(scope); fail(); vi.advanceTimersByTime(25); disconnect();
  owner.connect(scope); vi.advanceTimersByTime(50); expect(scope.requestReopen).toHaveBeenCalledOnce();
  owner.connect(scope); vi.advanceTimersByTime(50); expect(scope.requestReopen).toHaveBeenCalledOnce();
  const next = fixture(owner); owner.connect(next.scope); next.fail(); vi.advanceTimersByTime(50);
  expect(next.scope.requestReopen).toHaveBeenCalledOnce();
});

it('equal scalar generations in different concrete sessions/lifecycles are distinct failures', () => {
  const owner = new DocumentGpuRecoveryController(), a = fixture(owner), b = fixture(owner);
  owner.connect(a.scope); a.fail(); vi.advanceTimersByTime(50);
  owner.connect(b.scope); b.fail(); vi.advanceTimersByTime(50);
  expect(a.scope.requestReopen).toHaveBeenCalledOnce(); expect(b.scope.requestReopen).toHaveBeenCalledOnce();
});

it('exact retirement before cleanup prevents a queued retry or stability timer affecting a successor', () => {
  const a = fixture(); a.owner.connect(a.scope); a.fail(); a.retire(); vi.advanceTimersByTime(50);
  expect(a.scope.requestReopen).not.toHaveBeenCalled();
  const b = fixture(a.owner); a.owner.connect(b.scope); b.fail(); vi.advanceTimersByTime(50);
  const c = fixture(a.owner); a.owner.connect(c.scope); c.fail(); vi.advanceTimersByTime(50);
  const ready = fixture(a.owner); a.owner.connect(ready.scope); ready.scope.lifecycle.markReady(1); ready.retire();
  vi.advanceTimersByTime(30_000);
  const d = fixture(a.owner); a.owner.connect(d.scope); d.fail(); vi.advanceTimersByTime(50);
  expect(d.scope.requestReopen).not.toHaveBeenCalled();
});

it('canonical raster policy is checked again immediately before retry and never restores authored pixels from empty resources', () => {
  const { owner, scope, fail } = fixture(); let source: GpuRecoverySource = { kind: 'document', document: semantic() };
  vi.mocked(scope.getSource).mockImplementation(() => source);
  owner.connect(scope); fail();
  source = { kind: 'document', document: createImageDocument('painted', 32, 32, 'pixels') };
  vi.advanceTimersByTime(50);
  expect(scope.requestReopen).not.toHaveBeenCalled();
  expect(scope.reportError).toHaveBeenCalledWith(expect.stringContaining('protect raster pixels'));
  expect(owner.canReuseRenderer(scope.renderer!)).toBe(false);
});

it('unavailable canonical state is not equivalent to an explicitly fresh startup source', () => {
  const { owner, scope, fail } = fixture(); vi.mocked(scope.getSource).mockReturnValue({ kind: 'unavailable' });
  owner.connect(scope); fail(); vi.advanceTimersByTime(50);
  expect(scope.requestReopen).not.toHaveBeenCalled();
  expect(scope.reportError).toHaveBeenCalledWith(expect.stringContaining('canonical document state is unavailable'));
});

it('non-device failures never request automatic recovery', () => {
  const { owner, scope } = fixture(); owner.connect(scope);
  scope.lifecycle.markFailed(1, 'Shader validation failed'); vi.advanceTimersByTime(30_100);
  expect(scope.requestReopen).not.toHaveBeenCalled(); expect(scope.reportError).not.toHaveBeenCalled();
});

it('the existing opener checks its retained destroyed renderer even when the external presentation slot is empty', async () => {
  const recovery = new DocumentGpuRecoveryController(), lifecycle = new DocumentRendererLifecycle();
  const opener = new DocumentOpenController<{ destroy(): void }>(new DocumentTaskRegistry('loss' as DocumentSessionId), lifecycle);
  const lost = { destroy: vi.fn() }, replacement = { destroy: vi.fn() };
  let presentationSlot: object | null = null;
  await opener.open({ createRenderer: async () => lost, loadSource: async () => new Blob(), hydrate: async () => {},
    onRendererReady: renderer => { presentationSlot = renderer; } });
  expect(presentationSlot).toBe(lost);
  recovery.connect({ session: {}, renderer: lost, lifecycle, isCurrent: () => true,
    getSource: () => ({ kind: 'document', document: createImageDocument('raster', 32, 32, 'source') }), reportError: vi.fn(), requestReopen: vi.fn() });
  lost.destroy(); lifecycle.markFailed(1, 'WebGPU device lost: physical loss');
  // Open lifecycle cleanup resets the status before the next gate; identity must remain excluded.
  opener.cancelOpen(); presentationSlot = null;
  const gate = vi.fn((candidate: object) => {
    expect(presentationSlot).toBeNull();
    return recovery.canReuseRenderer(candidate);
  });
  await opener.open({ createRenderer: async () => replacement, loadSource: async () => new Blob(), hydrate: async () => {} },
    { reuseRenderer: true, canReuseRenderer: gate });
  expect(gate).toHaveBeenCalledWith(lost); expect(opener.getRenderer()).toBe(replacement);
});
