import { describe, expect, it, vi } from 'vitest';
import { createEditorDocumentOpenRequest } from './createEditorDocumentOpenRequest';

const createRenderer = (name: string) => ({
  name,
  destroy: vi.fn(),
  setLensBlurDepthVisualization: vi.fn(),
  setScopeOptions: vi.fn(),
  initializeScopes: vi.fn().mockResolvedValue(undefined),
  waitForPresentation: vi.fn().mockResolvedValue(undefined)
});

describe('createEditorDocumentOpenRequest', () => {
  it('publishes and retires the renderer symmetrically', () => {
    let current: ReturnType<typeof createRenderer> | null = null;
    const lifecycleBridge = {
      callbacks: {},
      onRendererReady: vi.fn(),
      onRendererDiscarded: vi.fn(),
      onSourceReady: vi.fn(),
      onFailed: vi.fn(),
      onSettled: vi.fn()
    };
    const request = createEditorDocumentOpenRequest({
      createRenderer: async () => createRenderer('created'),
      resolveSource: async () => new Blob(),
      hydrate: async () => undefined,
      rendererSlot: {
        get: () => current,
        set: (renderer) => {
          current = renderer;
        }
      },
      lifecycleBridge
    });
    const renderer = createRenderer('active');

    request.onRendererReady?.(renderer, 12, 1);
    expect(current).toBe(renderer);
    expect(lifecycleBridge.onRendererReady).toHaveBeenCalledWith(renderer, 12);

    request.onRendererDiscarded?.(renderer);
    expect(current).toBeNull();
    expect(lifecycleBridge.onRendererDiscarded).toHaveBeenCalledWith(renderer);
  });

  it('uses the renderer presentation boundary for document-open completion', async () => {
    let current: ReturnType<typeof createRenderer> | null = null;
    const lifecycleBridge = {
      callbacks: {}, onRendererReady: vi.fn(), onRendererDiscarded: vi.fn(),
      onSourceReady: vi.fn(), onFailed: vi.fn(), onSettled: vi.fn()
    };
    const request = createEditorDocumentOpenRequest({
      createRenderer: async () => createRenderer('created'),
      resolveSource: async () => new Blob(), hydrate: async () => undefined,
      rendererSlot: {
        get: () => current,
        set: (renderer) => { current = renderer; }
      },
      lifecycleBridge
    });
    const renderer = createRenderer('active');

    await request.waitUntilPresented?.(renderer, {} as never);

    expect(renderer.waitForPresentation).toHaveBeenCalledOnce();
  });

  it('does not let a stale discard clear a replacement renderer', () => {
    const stale = createRenderer('stale');
    const replacement = createRenderer('replacement');
    let current: ReturnType<typeof createRenderer> | null = replacement;
    const lifecycleBridge = {
      callbacks: {},
      onRendererReady: vi.fn(),
      onRendererDiscarded: vi.fn(),
      onSourceReady: vi.fn(),
      onFailed: vi.fn(),
      onSettled: vi.fn()
    };
    const request = createEditorDocumentOpenRequest({
      createRenderer: async () => stale,
      resolveSource: async () => new Blob(),
      hydrate: async () => undefined,
      rendererSlot: {
        get: () => current,
        set: (renderer) => {
          current = renderer;
        }
      },
      lifecycleBridge
    });

    request.onRendererDiscarded?.(stale);

    expect(current).toBe(replacement);
    expect(lifecycleBridge.onRendererDiscarded).toHaveBeenCalledWith(stale);
  });

  it('configures every replacement renderer before publishing it', () => {
    let current: ReturnType<typeof createRenderer> | null = null;
    const configured: string[] = [];
    const lifecycleBridge = {
      callbacks: {}, onRendererReady: vi.fn(), onRendererDiscarded: vi.fn(),
      onSourceReady: vi.fn(), onFailed: vi.fn(), onSettled: vi.fn()
    };
    const request = createEditorDocumentOpenRequest({
      createRenderer: async () => createRenderer('created'),
      resolveSource: async () => new Blob(), hydrate: async () => undefined,
      rendererSlot: {
        get: () => current,
        set: (renderer) => { current = renderer; }
      },
      configureRenderer: (renderer) => {
        expect(current).toBeNull();
        configured.push(renderer.name);
      },
      lifecycleBridge
    });
    const first = createRenderer('first');
    const replacement = createRenderer('replacement');

    request.onRendererReady?.(first, 1, 1);
    current = null;
    request.onRendererReady?.(replacement, 2, 2);

    expect(configured).toEqual(['first', 'replacement']);
    expect(current).toBe(replacement);
  });
});
