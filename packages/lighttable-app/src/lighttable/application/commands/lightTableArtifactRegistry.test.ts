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

  it('evicts oldest binary handles to stay within the aggregate byte budget', () => {
    const registry = new LightTableArtifactRegistry({
      maximumArtifacts: 10,
      maximumArtifactBytes: 10,
      maximumTotalBytes: 5
    });
    const first = registry.register(new File(['abc'], 'first.bin'), 'input');
    const second = registry.register(new File(['def'], 'second.bin'), 'input');

    expect(registry.resolve(first.id)).toBeNull();
    expect(registry.resolve(second.id)?.name).toBe('second.bin');
  });

  it('publishes structured PSD compatibility findings without exposing the file', () => {
    const registry = new LightTableArtifactRegistry();
    const artifact = registry.register(
      new File(['psd'], 'degraded.psd', { type: 'image/vnd.adobe.photoshop' }),
      'psd-export',
      [{
        severity: 'degraded-editability',
        code: 'face-warp-baked',
        path: 'layers[0]',
        message: 'Face Warp was baked.'
      }]
    );

    expect(artifact.compatibilityFindings).toEqual([{
      severity: 'degraded-editability',
      code: 'face-warp-baked',
      path: 'layers[0]',
      message: 'Face Warp was baked.'
    }]);
    expect(Object.keys(artifact)).not.toContain('file');
  });

  it('retains exact revision and dimensions for bounded render previews', () => {
    const registry = new LightTableArtifactRegistry();
    const artifact = registry.registerPreview(
      new File(['png'], 'preview.png', { type: 'image/png' }),
      { documentId: 'document-1', canonicalRevision: 4,
        width: 512, height: 288, maxEdge: 512 }
    );
    expect(artifact).toMatchObject({ kind: 'render-preview', preview: {
      documentId: 'document-1', canonicalRevision: 4,
      width: 512, height: 288, maxEdge: 512
    } });
    expect(Object.keys(artifact)).not.toContain('file');
  });
});
