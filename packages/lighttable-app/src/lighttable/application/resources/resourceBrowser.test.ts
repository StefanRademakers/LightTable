import { describe, expect, it, vi } from 'vitest';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import { createFontResourceProvider } from './fontResourceProvider';
import { LightTableResourceBrowser } from './resourceBrowser';

const font = (index: number): DocumentFontAsset => ({
  assetId: `font-${index}`,
  source: 'system',
  container: 'sfnt',
  outline: 'truetype',
  faceIndex: 0,
  fingerprintSha256: `${index}`.padStart(64, '0'),
  familyNames: [`Family ${String(index).padStart(4, '0')}`],
  styleName: index % 2 ? 'Regular' : 'Bold',
  weight: index % 2 ? 400 : 700,
  stretch: 100,
  italic: false,
  byteLength: 1_000_000,
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
});

describe('LightTableResourceBrowser', () => {
  it('pages and filters thousands of metadata-only font entries without loading bytes', async () => {
    const fonts = Array.from({ length: 2_000 }, (_, index) => font(index));
    const load = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const browser = new LightTableResourceBrowser();
    browser.register(createFontResourceProvider('desktop-fonts', async () => fonts, { load }));

    const first = await browser.search('desktop-fonts', {
      kind: 'font',
      search: 'Family 01',
      pageSize: 50
    });
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(100);
    expect(first.nextCursor).toBe('50');
    expect(load).not.toHaveBeenCalled();

    const second = await browser.search('desktop-fonts', {
      kind: 'font',
      search: 'Family 01',
      cursor: first.nextCursor,
      pageSize: 50
    });
    expect(second.items).toHaveLength(50);
    expect(second.nextCursor).toBeUndefined();
    expect(load).not.toHaveBeenCalled();

    await expect(browser.load<Uint8Array>('desktop-fonts', second.items[0]!.id))
      .resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('caps provider pages and rejects unbounded provider results', async () => {
    const browser = new LightTableResourceBrowser();
    const search = vi.fn(async () => ({ items: [], total: 0 }));
    browser.register({ id: 'gradients', kinds: ['gradient'], search, load: async () => null });
    await browser.search('gradients', { kind: 'gradient', pageSize: 10_000 });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }), undefined);

    browser.register({
      id: 'broken',
      kinds: ['brush'],
      search: async () => ({
        items: Array.from({ length: 101 }, (_, index) => ({
          id: String(index), kind: 'brush', name: String(index), providerId: 'broken'
        }))
      }),
      load: async () => null
    });
    await expect(browser.search('broken', { kind: 'brush' })).rejects.toThrow('unbounded page');
  });

  it('supports future resource kinds and cancellation without changing the contract', async () => {
    const browser = new LightTableResourceBrowser();
    browser.register({ id: 'patterns', kinds: ['pattern'], search: async () => ({ items: [] }), load: async () => null });
    expect(browser.providersFor('pattern')).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    await expect(browser.search('patterns', { kind: 'pattern' }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
