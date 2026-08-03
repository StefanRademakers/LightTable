import { describe, expect, it, vi } from 'vitest';
import { CONTRACT_FIXTURE_FONT_ASSET } from '@lighttable/text-core';
import { TextGlyphOutlineRepository } from './TextGlyphOutlineRepository';

const outline = () => ({
  unitsPerEm: 1_000,
  verbs: new Uint8Array([0, 1, 1, 4]),
  coordinates: new Float32Array([0, 0, 10, 0, 10, 10]),
  bounds: new Float32Array([0, 0, 10, 10])
});

const request = (glyphId = 36) => ({
  documentSessionId: 'document',
  sessionGeneration: 1,
  fontSnapshotRevision: 2,
  font: CONTRACT_FIXTURE_FONT_ASSET,
  glyphId,
  variationCoordinates: {}
});

describe('TextGlyphOutlineRepository', () => {
  it('deduplicates concurrent worker requests and then serves owned cache data', async () => {
    let resolveWorker!: (value: { outline: ReturnType<typeof outline> }) => void;
    const extractGlyphOutline = vi.fn(() => new Promise<{ outline: ReturnType<typeof outline> }>(
      (resolve) => { resolveWorker = resolve; }
    ));
    const repository = new TextGlyphOutlineRepository({ extractGlyphOutline } as never);
    const first = repository.resolve(request());
    const shared = repository.resolve(request());
    expect(extractGlyphOutline).toHaveBeenCalledTimes(1);
    resolveWorker({ outline: outline() });
    await expect(first).resolves.toMatchObject({ source: 'worker' });
    await expect(shared).resolves.toMatchObject({ source: 'shared-worker' });
    await expect(repository.resolve(request())).resolves.toMatchObject({ source: 'cache' });
    expect(extractGlyphOutline).toHaveBeenCalledTimes(1);
  });

  it('lets one waiter abort without cancelling shared useful work', async () => {
    let resolveWorker!: (value: { outline: ReturnType<typeof outline> }) => void;
    const extractGlyphOutline = vi.fn(() => new Promise<{ outline: ReturnType<typeof outline> }>(
      (resolve) => { resolveWorker = resolve; }
    ));
    const repository = new TextGlyphOutlineRepository({ extractGlyphOutline } as never);
    const controller = new AbortController();
    const cancelled = repository.resolve(request(), controller.signal);
    const retained = repository.resolve(request());
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    resolveWorker({ outline: outline() });
    await expect(retained).resolves.toMatchObject({ source: 'shared-worker' });
    await expect(repository.resolve(request())).resolves.toMatchObject({ source: 'cache' });
  });

  it('does not retain failed worker work', async () => {
    const extractGlyphOutline = vi.fn()
      .mockRejectedValueOnce(new Error('outline failed'))
      .mockResolvedValueOnce({ outline: outline() });
    const repository = new TextGlyphOutlineRepository({ extractGlyphOutline } as never);
    await expect(repository.resolve(request())).rejects.toThrow('outline failed');
    await expect(repository.resolve(request())).resolves.toMatchObject({ source: 'worker' });
    expect(extractGlyphOutline).toHaveBeenCalledTimes(2);
  });
});
