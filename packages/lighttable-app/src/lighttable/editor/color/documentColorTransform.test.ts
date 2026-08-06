import { describe, expect, it } from 'vitest';
import {
  documentBlendProfileFromIccName,
  encodedDocumentToLinearSrgb,
  linearSrgbToEncodedDocument
} from './documentColorTransform';

describe('document color transform', () => {
  it('recognizes the bounded matrix/TRC profiles', () => {
    expect(documentBlendProfileFromIccName('Adobe RGB (1998)')).toBe('adobe-rgb-1998');
    expect(documentBlendProfileFromIccName('sRGB IEC61966-2.1')).toBe('srgb');
    expect(documentBlendProfileFromIccName(null)).toBe('srgb');
  });

  it('roundtrips Adobe RGB encoded values through canonical linear sRGB', () => {
    const source = { r: 0.82, g: 0.31, b: 0.67 };
    const restored = linearSrgbToEncodedDocument(
      encodedDocumentToLinearSrgb(source, 'adobe-rgb-1998'),
      'adobe-rgb-1998'
    );
    expect(restored.r).toBeCloseTo(source.r, 4);
    expect(restored.g).toBeCloseTo(source.g, 4);
    expect(restored.b).toBeCloseTo(source.b, 4);
  });
});
