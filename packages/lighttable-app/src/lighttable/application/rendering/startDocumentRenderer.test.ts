import { describe, expect, it, vi } from 'vitest';
import { startDocumentRenderer } from './startDocumentRenderer';

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
};

describe('startDocumentRenderer', () => {
  it('starts renderer creation and source loading in parallel before hydration', async () => {
    const rendererReady = deferred<{ destroy: () => void }>();
    const sourceReady = deferred<Blob>();
    const renderer = { destroy: vi.fn<() => void>() };
    const source = new Blob(['image']);
    const hydrate = vi.fn(async () => undefined);
    const request = startDocumentRenderer({
      createRenderer: vi.fn(() => rendererReady.promise),
      loadSource: vi.fn(() => sourceReady.promise),
      hydrate,
      isCanceled: () => false
    });

    rendererReady.resolve(renderer);
    sourceReady.resolve(source);

    await expect(request).resolves.toBe(renderer);
    expect(hydrate).toHaveBeenCalledWith(renderer, source, expect.any(Function));
    expect(renderer.destroy).not.toHaveBeenCalled();
  });

  it('releases resources still owned by a prepared source after hydration', async () => {
    const renderer = { destroy: vi.fn<() => void>() };
    const source = { dispose: vi.fn<() => void>() };

    await expect(startDocumentRenderer({
      createRenderer: async () => renderer,
      loadSource: async () => source,
      hydrate: async () => undefined,
      disposeSource: (prepared) => prepared.dispose(),
      isCanceled: () => false
    })).resolves.toBe(renderer);

    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.destroy).not.toHaveBeenCalled();
  });

  it('destroys a renderer when hydration fails', async () => {
    const renderer = { destroy: vi.fn<() => void>() };
    const source = { dispose: vi.fn<() => void>() };

    await expect(startDocumentRenderer({
      createRenderer: async () => renderer,
      loadSource: async () => source,
      hydrate: async () => {
        throw new Error('hydrate failed');
      },
      disposeSource: (prepared) => prepared.dispose(),
      isCanceled: () => false
    })).rejects.toThrow('hydrate failed');
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(source.dispose).toHaveBeenCalledTimes(1);
  });

  it('destroys a renderer that resolves after source loading has failed', async () => {
    const rendererReady = deferred<{ destroy: () => void }>();
    const renderer = { destroy: vi.fn<() => void>() };
    const request = startDocumentRenderer({
      createRenderer: () => rendererReady.promise,
      loadSource: async () => {
        throw new Error('download failed');
      },
      hydrate: async () => undefined,
      isCanceled: () => false
    });

    await expect(request).rejects.toThrow('download failed');
    rendererReady.resolve(renderer);
    await rendererReady.promise;
    await Promise.resolve();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects stale starts and destroys their renderer before hydration', async () => {
    const renderer = { destroy: vi.fn<() => void>() };
    let canceled = false;
    const sourceReady = deferred<Blob>();
    const hydrate = vi.fn(async () => undefined);
    const request = startDocumentRenderer({
      createRenderer: async () => renderer,
      loadSource: () => sourceReady.promise,
      hydrate,
      isCanceled: () => canceled
    });

    canceled = true;
    sourceReady.resolve(new Blob(['image']));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(hydrate).not.toHaveBeenCalled();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });
});
