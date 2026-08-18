import { describe, expect, it, vi } from 'vitest';
import type { GenAiAssetId } from '@lighttable/genai-core';
import { prepareProjectAssetReferences } from './prepareProjectAssetReferences';
import type { ProjectAssetRemoteLink } from './projectAssetRemoteLinks';

describe('prepareProjectAssetReferences', () => {
  it('reuses valid links, publishes missing local bytes and returns a complete remote set', async () => {
    const first = 'asset-existing' as GenAiAssetId;
    const second = 'asset-local' as GenAiAssetId;
    const existingBytes = new Uint8Array([9, 8, 7]);
    const stored = new Map<string, ProjectAssetRemoteLink>([[first, {
      assetId: first, providerId: 'openart', url: 'https://relay.test/existing.png',
      mediaType: 'image/png', sourceRevision: {
        byteLength: 3, sha256: '06df4f7e1394f1c57cc6583fba4d8060a5a66f4f4771c14aeff6b9af8a28c9b3'
      }, updatedAt: new Date().toISOString()
    }]]);
    const read = vi.fn(async (id: GenAiAssetId) => id === first
      ? { name: 'existing.png', mediaType: 'image/png', bytes: existingBytes }
      : { name: 'local.png', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
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

    expect(read).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ name: 'local.png' }));
    expect(links.map(({ assetId }) => assetId)).toEqual([first, second]);
  });

  it('republishes when bytes at the same asset id changed', async () => {
    const assetId = 'same-path' as GenAiAssetId;
    const publish = vi.fn(async () => ({ providerAssetId: 'fresh-media', mediaType: 'image/png' }));
    const stored: ProjectAssetRemoteLink[] = [{
      assetId, providerId: 'higgsfield', providerAssetId: 'stale-media', mediaType: 'image/png',
      sourceRevision: { byteLength: 3, sha256: 'stale' }, updatedAt: new Date().toISOString()
    }];
    await prepareProjectAssetReferences([assetId], 'higgsfield', {
      resolve: async () => stored,
      read: async () => ({ name: 'same.png', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }),
      publish,
      record: async (link) => { stored.splice(0, stored.length, { ...link, updatedAt: new Date().toISOString() }); }
    });
    expect(publish).toHaveBeenCalledOnce();
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
