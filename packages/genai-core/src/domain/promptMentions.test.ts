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
});
