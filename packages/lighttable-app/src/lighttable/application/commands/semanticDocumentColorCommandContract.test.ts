import { describe, expect, it } from 'vitest';
import { parseSemanticAssignProfileCommand } from './semanticDocumentColorCommandContract';

describe('semantic document color command contract', () => {
  it('accepts only the current semantic sRGB assignment', () => {
    expect(parseSemanticAssignProfileCommand({ profile: 'srgb' }))
      .toEqual({ profile: 'srgb' });
    for (const invalid of [
      {},
      { profile: 'adobe-rgb-1998' },
      { profile: 'srgb', convertPixels: true },
      { profile: 'srgb', iccBytes: 'base64' }
    ]) expect(parseSemanticAssignProfileCommand(invalid)).toHaveProperty('message');
  });
});
