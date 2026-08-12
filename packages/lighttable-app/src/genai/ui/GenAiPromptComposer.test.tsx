import { describe, expect, it } from 'vitest';
import type { GenAiAssetId, GenAiAssetMentionOption } from '@lighttable/genai-core';
import { renderPromptMarkup } from './GenAiPromptComposer';

const mentions: readonly GenAiAssetMentionOption[] = [{
  token: '@face',
  asset: { id: 'face' as GenAiAssetId, projectId: 'project', label: 'face.png', mediaType: 'image/png' }
}];

describe('GenAiPromptComposer mention editing', () => {
  it('keeps an unresolved typo editable instead of turning it into an atomic token', () => {
    expect(renderPromptMarkup('@facee', mentions, {})).toBe('@facee');
  });

  it('only renders an exactly resolved asset reference as an atomic token', () => {
    const markup = renderPromptMarkup('@face', mentions, {});
    expect(markup).toContain('class="genai-prompt-token"');
    expect(markup).toContain('data-token="@face"');
  });
});
