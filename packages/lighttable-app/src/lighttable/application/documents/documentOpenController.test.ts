import { describe, expect, it, vi } from 'vitest';
import { DocumentRendererLifecycle } from '../rendering/documentRendererLifecycle';
import { DocumentTaskRegistry } from '../tasks/documentTaskRegistry';
import type { DocumentSessionId } from './documentSession';
import {
  DocumentOpenController
} from './documentOpenController';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
};

const renderer = () => ({ destroy: vi.fn() });

describe('DocumentOpenController', () => {
  it('retains one successfully hydrated renderer until close', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    const controller = new DocumentOpenController(
      new DocumentTaskRegistry('document-1' as DocumentSessionId),
      lifecycle
    );
    const target = renderer();
    const hydrate = vi.fn();

    await controller.open({
      createRenderer: async () => target,
      loadSource: async () => new Blob(),
      hydrate
    });

    expect(controller.getRenderer()).toBe(target);
    expect(hydrate).toHaveBeenCalledOnce();
    expect(lifecycle.getSnapshot().status).toBe('ready');
    controller.close();
    expect(target.destroy).toHaveBeenCalledOnce();
    expect(lifecycle.getSnapshot().status).toBe('idle');
  });

  it('destroys a late renderer after the document is closed', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    const controller = new DocumentOpenController(
      new DocumentTaskRegistry('document-1' as DocumentSessionId),
      lifecycle
    );
    const pendingRenderer = deferred<ReturnType<typeof renderer>>();
    const target = renderer();

    const opening = controller.open({
      createRenderer: () => pendingRenderer.promise,
      loadSource: async () => new Blob(),
      hydrate: vi.fn()
    });
    controller.close();
    pendingRenderer.resolve(target);
    await opening;

    expect(controller.getRenderer()).toBeNull();
    expect(target.destroy).toHaveBeenCalledOnce();
  });
});
