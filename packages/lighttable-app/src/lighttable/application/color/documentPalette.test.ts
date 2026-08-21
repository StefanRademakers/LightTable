import { describe, expect, it, vi } from 'vitest';
import {
  buildDocumentPaletteHistogram,
  DocumentPaletteExtractor,
  extractDocumentPalette
} from './documentPalette';

const pixels = (...values: readonly (readonly [number, number, number, number])[]) => (
  new Uint8Array(values.flatMap((value) => [...value]))
);

describe('document palette extraction', () => {
  it('returns one real color for a solid image', () => {
    const histogram = buildDocumentPaletteHistogram(pixels(
      [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]
    ));
    expect(extractDocumentPalette(histogram, 16)).toEqual([expect.objectContaining({
      rgb: [255, 0, 0], hex: '#FF0000', coverage: 1
    })]);
  });

  it('orders a two-color image by perceptual-cluster coverage', () => {
    const source = new Uint8Array(100 * 4);
    for (let index = 0; index < 100; index += 1) {
      source.set(index < 75 ? [255, 0, 0, 255] : [0, 0, 255, 255], index * 4);
    }
    const result = extractDocumentPalette(buildDocumentPaletteHistogram(source), 2);
    expect(result.map(({ hex }) => hex)).toEqual(['#FF0000', '#0000FF']);
    expect(result.map(({ coverage }) => coverage)).toEqual([0.75, 0.25]);
  });

  it('ignores effectively transparent RGB values', () => {
    const result = extractDocumentPalette(buildDocumentPaletteHistogram(pixels(
      [255, 0, 255, 0], [0, 255, 0, 12], [10, 20, 30, 13]
    )), 8);
    expect(result.map(({ hex }) => hex)).toEqual(['#0A141E']);
  });

  it('only returns exact RGB values present in the sampled histogram', () => {
    const sourceColors = new Set(['#D85A32', '#DA6035', '#D65D30', '#DC6238']);
    const source = pixels(
      [216, 90, 50, 255], [218, 96, 53, 255], [214, 93, 48, 255], [220, 98, 56, 255],
      [218, 96, 53, 255], [218, 96, 53, 255], [214, 93, 48, 255]
    );
    const result = extractDocumentPalette(buildDocumentPaletteHistogram(source), 4);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(({ hex }) => expect(sourceColors.has(hex)).toBe(true));
  });

  it('is byte-for-byte deterministic across supported K values', () => {
    const source = new Uint8Array(1024 * 4);
    for (let index = 0; index < 1024; index += 1) {
      source.set([index & 255, (index * 13) & 255, (index * 37) & 255, 255], index * 4);
    }
    const histogram = buildDocumentPaletteHistogram(source);
    for (const count of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
      expect(extractDocumentPalette(histogram, count)).toEqual(extractDocumentPalette(histogram, count));
    }
  });

  it('samples once per revision and caches K-specific results', async () => {
    const sample = vi.fn(async () => ({
      pixels: pixels([10, 20, 30, 255], [200, 210, 220, 255]), width: 2, height: 1
    }));
    const extractor = new DocumentPaletteExtractor(sample);
    await extractor.getPalette(2, 4);
    await extractor.getPalette(2, 4);
    await extractor.getPalette(2, 8);
    expect(sample).toHaveBeenCalledOnce();
    await extractor.getPalette(3, 4);
    expect(sample).toHaveBeenCalledTimes(2);
  });
});
