import { describe, expect, it } from 'vitest';
import {
  documentBlendProfileDisplayName,
  documentBlendProfileFromIccName,
  documentBlendQuantization,
  encodedDocumentToLinearSrgb,
  linearSrgbToEncodedDocument
} from './documentColorTransform';

describe('document color transform', () => {
  it('uses a referential compatibility label for the third-party profile', () => {
    expect(documentBlendProfileDisplayName('adobe-rgb-1998'))
      .toBe('Compatible with Adobe RGB (1998) ICC profile');
    expect(documentBlendProfileDisplayName('srgb')).toBe('sRGB');
  });

  it('recognizes the bounded matrix/TRC profiles', () => {
    expect(documentBlendProfileFromIccName('Adobe RGB (1998)')).toBe('adobe-rgb-1998');
    expect(documentBlendProfileFromIccName('sRGB IEC61966-2.1')).toBe('srgb');
    expect(documentBlendProfileFromIccName(null)).toBe('srgb');
  });

  it('uses Photoshop encoded blend precision for 8-bit and 16-bit documents', () => {
    expect(documentBlendQuantization(8)).toBe(255);
    expect(documentBlendQuantization(16)).toBe(32_768);
    expect(documentBlendQuantization(32)).toBe(0);
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
