import { describe, expect, it, vi } from 'vitest';
import { createEditorDocumentOpenRequest } from './createEditorDocumentOpenRequest';

const createRenderer = (name: string) => ({
  name,
  destroy: vi.fn(),
  setLensBlurDepthVisualization: vi.fn(),
  setScopeOptions: vi.fn(),
  initializeScopes: vi.fn().mockResolvedValue(undefined)
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
});
