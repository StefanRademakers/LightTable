import { describe, expect, it } from 'vitest';
import { nextAutomaticTextLayerName, textLayerNameFromContent } from './textLayerName';

describe('text layer automatic names', () => {
  it('uses normalized visible content and a stable empty fallback', () => {
    expect(textLayerNameFromContent('  Hello\n\tworld  ')).toBe('Hello world');
    expect(textLayerNameFromContent(' \n ')).toBe('Text');
  });

  it('limits by Unicode code point rather than splitting a surrogate pair', () => {
    expect(textLayerNameFromContent(`🙂${'a'.repeat(50)}`))
      .toBe(`🙂${'a'.repeat(39)}`);
  });

  it('upgrades legacy generic names without overwriting an explicit name', () => {
    expect(nextAutomaticTextLayerName('Text', 'Old content', 'New content')).toBe('New content');
    expect(nextAutomaticTextLayerName('Campaign title', 'Old content', 'New content'))
      .toBe('Campaign title');
  });
});
