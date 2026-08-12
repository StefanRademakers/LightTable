import { describe, expect, it, vi } from 'vitest';
import type { GenAiAssetId } from '@lighttable/genai-core';
import { prepareProjectAssetReferences } from './prepareProjectAssetReferences';
import type { ProjectAssetRemoteLink } from './projectAssetRemoteLinks';

describe('prepareProjectAssetReferences', () => {
  it('reuses valid links, publishes missing local bytes and returns a complete remote set', async () => {
    const first = 'asset-existing' as GenAiAssetId;
    const second = 'asset-local' as GenAiAssetId;
    const stored = new Map<string, ProjectAssetRemoteLink>([[first, {
      assetId: first, providerId: 'openart', url: 'https://relay.test/existing.png',
      mediaType: 'image/png', updatedAt: new Date().toISOString()
    }]]);
    const read = vi.fn(async () => ({
      name: 'local.png', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3])
    }));
    const publish = vi.fn(async () => ({
      url: 'https://relay.test/local.png', mediaType: 'image/png', expiresAt: Date.now() + 60_000
    }));
    const record = vi.fn(async (link: Omit<ProjectAssetRemoteLink, 'updatedAt'>): Promise<void> => {
      stored.set(link.assetId, { ...link, updatedAt: new Date().toISOString() });
    });
    const links = await prepareProjectAssetReferences([first, second], 'openart', {
      resolve: async (ids) => ids.flatMap((id) => stored.get(id) ?? []),
      read,
      publish,
      record
    });

    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(second);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ name: 'local.png' }));
    expect(links.map(({ assetId }) => assetId)).toEqual([first, second]);
  });

  it('refuses a paid submit when any selected asset cannot be resolved', async () => {
    await expect(prepareProjectAssetReferences(['missing' as GenAiAssetId], 'openart', {
      resolve: async () => [], read: async () => null,
      publish: vi.fn(), record: vi.fn()
    })).rejects.toThrow('no longer exists');
  });

  it('identifies the local asset when secure publication is unavailable', async () => {
    await expect(prepareProjectAssetReferences(['local' as GenAiAssetId], 'openart', {
      resolve: async () => [],
      read: async () => ({
        name: 'character.png', mediaType: 'image/png', bytes: new Uint8Array([1])
      }),
      publish: async () => { throw new Error('Reference publishing is not connected.'); },
      record: vi.fn()
    })).rejects.toThrow('Could not publish the local reference "character.png". Reference publishing is not connected.');
  });
});
