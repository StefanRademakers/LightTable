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

  it('reuses one renderer while replacing only its active document binding', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    const controller = new DocumentOpenController(
      new DocumentTaskRegistry('application-editor' as DocumentSessionId),
      lifecycle
    );
    const target = renderer();
    const createRenderer = vi.fn(async () => target);
    const firstHydrate = vi.fn();
    const secondHydrate = vi.fn();

    await controller.open({
      createRenderer,
      loadSource: async () => new Blob(['first']),
      hydrate: firstHydrate
    }, { reuseRenderer: true });
    await controller.open({
      createRenderer,
      loadSource: async () => new Blob(['second']),
      hydrate: secondHydrate
    }, { reuseRenderer: true });

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(firstHydrate).toHaveBeenCalledOnce();
    expect(secondHydrate).toHaveBeenCalledOnce();
    expect(controller.getRenderer()).toBe(target);
    expect(target.destroy).not.toHaveBeenCalled();
    controller.close();
    expect(target.destroy).toHaveBeenCalledOnce();
  });

  it('replaces the renderer when a newer open overlaps an unfinished hydration', async () => {
    const lifecycle = new DocumentRendererLifecycle();
    const controller = new DocumentOpenController(
      new DocumentTaskRegistry('application-editor' as DocumentSessionId),
      lifecycle
    );
    const first = renderer();
    const replacement = renderer();
    const pendingHydration = deferred<void>();
    const hydrationStarted = deferred<void>();
    const createRenderer = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement);

    await controller.open({
      createRenderer,
      loadSource: async () => new Blob(['initial']),
      hydrate: vi.fn()
    }, { reuseRenderer: true });

    const overlapping = controller.open({
      createRenderer,
      loadSource: async () => new Blob(['overlapping']),
      hydrate: () => {
        hydrationStarted.resolve();
        return pendingHydration.promise;
      }
    }, { reuseRenderer: true });
    await hydrationStarted.promise;

    const newest = controller.open({
      createRenderer,
      loadSource: async () => new Blob(['newest']),
      hydrate: vi.fn()
    }, { reuseRenderer: true });
    pendingHydration.resolve();
    await Promise.all([overlapping, newest]);

    expect(first.destroy).toHaveBeenCalledOnce();
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(controller.getRenderer()).toBe(replacement);
    expect(replacement.destroy).not.toHaveBeenCalled();
    controller.close();
  });
});
