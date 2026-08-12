import { describe, expect, it } from 'vitest';
import type { GenAiAssetId, GenAiAssetReference } from './contracts';
import { createGenAiAssetMentionOptions, resolveGenAiPromptMentions } from './promptMentions';

describe('GenAI prompt mentions', () => {
  it('creates stable unique tokens and preserves editor/provider prompts separately', () => {
    const assets: GenAiAssetReference[] = [
      { id: 'b' as GenAiAssetId, projectId: 'p', label: 'Hero image.png', mediaType: 'image/png' },
      { id: 'a' as GenAiAssetId, projectId: 'p', label: 'Hero image.jpg', mediaType: 'image/jpeg' }
    ];
    const options = createGenAiAssetMentionOptions(assets);
    expect(options.map(({ token }) => token)).toEqual(['@Hero_image', '@Hero_image_2']);
    const result = resolveGenAiPromptMentions('Use @Hero_image and @missing', options);
    expect(result.providerPrompt).toBe('Use @image1 and @missing');
    expect(result.bindings).toHaveLength(1);
    expect(result.missingTokens).toEqual(['@missing']);
  });

  it('keeps explicit visual references without requiring prompt tokens', () => {
    const asset: GenAiAssetReference = {
      id: 'face' as GenAiAssetId, projectId: 'p', label: 'face.png', mediaType: 'image/png'
    };
    const result = resolveGenAiPromptMentions('Retouch the portrait', createGenAiAssetMentionOptions([asset]), [asset]);
    expect(result.references).toEqual([asset]);
    expect(result.providerPrompt).toBe('Retouch the portrait');
  });

  it('uses explicit reference order for provider prompt labels', () => {
    const assets: GenAiAssetReference[] = [
      { id: 'face' as GenAiAssetId, projectId: 'p', label: 'face.png', mediaType: 'image/png' },
      { id: 'style' as GenAiAssetId, projectId: 'p', label: 'style.png', mediaType: 'image/png' }
    ];
    const result = resolveGenAiPromptMentions('Use @style', createGenAiAssetMentionOptions(assets), assets);
    expect(result.providerPrompt).toBe('Use @image2');
    expect(result.references).toEqual(assets);
  });
});
