import { describe, expect, it, vi } from 'vitest';
import type { DocumentAssetId } from '../document/documentTypes';
import { DocumentPatternResourceRepository } from './DocumentPatternResourceRepository';
import { PatternAssetStore } from './PatternAssetStore';

const texture = () => ({ destroy: vi.fn(), width: 4, height: 4 }) as unknown as GPUTexture;

describe('DocumentPatternResourceRepository', () => {
  it('retains a pattern across renderer facades and releases it on document close', () => {
    const repository = new DocumentPatternResourceRepository();
    const firstRenderer = new PatternAssetStore(repository);
    const secondRenderer = new PatternAssetStore(repository);
    const id = 'pattern-a' as DocumentAssetId;
    const source = new Blob(['pattern']);
    const pixels = texture();

    firstRenderer.bind('document-a');
    firstRenderer.set(id, source, pixels);
    firstRenderer.destroy();
    secondRenderer.bind('document-a');

    expect(secondRenderer.getSource(id)).toBe(source);
    expect(secondRenderer.getTexture(id)).toBe(pixels);
    expect(pixels.destroy).not.toHaveBeenCalled();
    repository.release('document-a');
    expect(pixels.destroy).toHaveBeenCalledOnce();
  });
});
