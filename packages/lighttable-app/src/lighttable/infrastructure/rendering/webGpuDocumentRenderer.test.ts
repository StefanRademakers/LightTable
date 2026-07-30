import { describe, expect, it, vi } from 'vitest';

vi.mock('../../gpu/WebGpuEngine', () => ({
  WebGpuEngine: {
    create: vi.fn()
  }
}));

import {
  createWebGpuDocumentRenderer,
  type DocumentRendererPort
} from './webGpuDocumentRenderer';

describe('createWebGpuDocumentRenderer', () => {
  it('keeps concrete engine construction behind an injectable adapter', async () => {
    const canvas = {} as HTMLCanvasElement;
    const callbacks = { onFirstFrame: vi.fn() };
    const scopeCanvases = {
      hueDistribution: {} as HTMLCanvasElement,
      parade: {} as HTMLCanvasElement,
      vectorscope: {} as HTMLCanvasElement
    };
    const renderer = { destroy: vi.fn() } as unknown as DocumentRendererPort;
    const createEngine = vi.fn(async () => renderer);

    await expect(createWebGpuDocumentRenderer(
      canvas,
      callbacks,
      scopeCanvases,
      createEngine
    )).resolves.toBe(renderer);
    expect(createEngine).toHaveBeenCalledWith(canvas, callbacks, scopeCanvases);
  });
});
