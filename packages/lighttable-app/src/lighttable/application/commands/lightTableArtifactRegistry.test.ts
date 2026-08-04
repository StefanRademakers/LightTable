import { describe, expect, it } from 'vitest';
import { LightTableArtifactRegistry } from './lightTableArtifactRegistry';

describe('LightTableArtifactRegistry', () => {
  it('keeps binary payloads behind bounded opaque handles', () => {
    const registry = new LightTableArtifactRegistry({ maximumArtifacts: 2 });
    const first = registry.register(new File(['one'], 'one.psd', { type: 'image/vnd.adobe.photoshop' }), 'input');
    const second = registry.register(new File(['two'], 'two.png', { type: 'image/png' }), 'png-export');
    const third = registry.register(new File(['three'], 'three.lighttable'), 'native-document');
    expect(registry.query(first.id)).toBeNull();
    expect(registry.resolve(second.id)?.name).toBe('two.png');
    expect(registry.list()).toEqual([second, third]);
    expect(Object.keys(third)).not.toContain('file');
  });

  it('rejects oversized payloads and releases exact handles', () => {
    const registry = new LightTableArtifactRegistry({ maximumArtifactBytes: 2 });
    expect(() => registry.register(new File(['abc'], 'large.bin'), 'input')).toThrow(/limit/);
    const artifact = registry.register(new File(['a'], 'small.bin'), 'input');
    expect(registry.release(artifact.id)).toBe(true);
    expect(registry.resolve(artifact.id)).toBeNull();
  });
});
