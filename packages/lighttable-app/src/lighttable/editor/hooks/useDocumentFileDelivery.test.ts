import { afterEach, expect, it, vi } from 'vitest';
import { useDocumentFileDelivery } from './useDocumentFileDelivery';
import { DocumentTaskRegistry } from '../../application/tasks/documentTaskRegistry';
import type { DocumentSessionId } from '../../application/documents/documentSession';
import type { DocumentFileDeliverySource } from '../../application/documents/captureDocumentFileDelivery';

const hooks = vi.hoisted(() => ({ layoutCleanup: undefined as undefined | (() => void) }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useLayoutEffect: (setup: () => () => void) => { hooks.layoutCleanup = setup(); }
}));
afterEach(() => { hooks.layoutCleanup?.(); hooks.layoutCleanup = undefined; });

const fixture = () => {
  const taskRegistry = new DocumentTaskRegistry('A' as DocumentSessionId);
  const renderer = {}; const host = vi.fn(async () => ({ status: 'committed' as const, durability: 'atomic-replace' as const }));
  const ports: DocumentFileDeliverySource = { taskRegistry, commandHistory: {},
    getDocument: () => ({ id: 'A' }), getRenderer: () => renderer, getRendererGeneration: () => 1,
    setError: vi.fn(), setStatus: vi.fn(), onExportFile: host };
  const capture = useDocumentFileDelivery(() => ports, vi.fn());
  return { ports, host, taskRegistry, capture, delivery: capture(), file: new File(['png'], 'file.png') };
};

it('retires delivery in layout cleanup before a pending artifact continuation, without waiting for passive cleanup', async () => {
  const f = fixture(); let resolve!: () => void; const artifact = new Promise<void>(yes => { resolve = yes; });
  const pending = artifact.then(() => f.delivery.deliver(f.file));
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  hooks.layoutCleanup!(); resolve(); await rejected;
  f.delivery.error('Late error'); f.delivery.status('Late saved');
  expect(f.host).not.toHaveBeenCalled(); expect(f.ports.setError).not.toHaveBeenCalled();
  expect(f.ports.setStatus).not.toHaveBeenCalled();
});

it('rejects a disposed document task owner before React has cleaned up the mounted hook', async () => {
  const f = fixture(); f.taskRegistry.dispose();
  await expect(f.delivery.deliver(f.file)).rejects.toMatchObject({ name: 'AbortError' });
  f.delivery.error('Late error'); f.delivery.status('Late saved');
  expect(f.host).not.toHaveBeenCalled(); expect(f.ports.setError).not.toHaveBeenCalled();
  expect(f.ports.setStatus).not.toHaveBeenCalled();
});

it('a retained capture callback cannot acquire fresh delivery authority after unmount cleanup', () => {
  const f = fixture(); hooks.layoutCleanup!();
  expect(f.capture).toThrow('unmounted'); expect(f.host).not.toHaveBeenCalled();
});
