import { describe, expect, it } from 'vitest';
import { DesktopMediaSourceRegistry } from './desktopMediaSourceRegistry';

describe('DesktopMediaSourceRegistry', () => {
  it('resolves only issued capabilities and revokes them deterministically', () => {
    const registry = new DesktopMediaSourceRegistry();
    const source = registry.authorize('C:\\media\\clip.mp4', 'video/mp4', 123_456);

    expect(source.url).not.toContain('clip.mp4');
    expect(registry.resolve(source.url)).toMatchObject({
      path: 'C:\\media\\clip.mp4',
      mediaType: 'video/mp4',
      byteLength: 123_456
    });
    expect(registry.resolve('lighttable-media://local/not-issued')).toBeNull();
    expect(registry.resolve(`${source.url}/escape`)).toBeNull();
    expect(registry.release(source.id)).toBe(true);
    expect(registry.resolve(source.url)).toBeNull();
    expect(registry.size).toBe(0);
  });
});
