import { describe, expect, it } from 'vitest';
import {
  PDF_DISPLAY_LIST_SCHEMA_VERSION,
  validatePdfDisplayList,
  type PdfNormalizedDisplayList,
  type PdfTextRenderingMode
} from './index';

const identity = [1, 0, 0, 1, 0, 0] as const;
const transportClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const fixture = (): PdfNormalizedDisplayList => ({
  schemaVersion: PDF_DISPLAY_LIST_SCHEMA_VERSION,
  source: {
    format: 'pdf-compatible-ai',
    originalAssetId: 'asset:source',
    byteLength: 4096,
    fingerprintSha256: 'a'.repeat(64),
    pdfVersion: '1.7',
    nativeAiData: 'preserved-unsupported'
  },
  resources: {
    fonts: [{
      id: 'font:subset', sourceObjectId: '12 0 R', subtype: 'type0-cid',
      baseName: 'ABCDEF+Inter', subsetTag: 'ABCDEF', embeddedAssetId: 'asset:font',
      embeddedByteLength: 8192, fingerprintSha256: 'b'.repeat(64), encodingName: 'Identity-H',
      toUnicode: 'present', authoring: 'recoverable', embedding: 'embedded'
    }],
    images: [{
      id: 'image:hero', sourceObjectId: '14 0 R', assetId: 'asset:image', width: 32,
      height: 16, bitsPerComponent: 8, colorSpaceId: 'color:rgb', softMaskResourceId: 'mask:alpha'
    }],
    colorSpaces: [{
      id: 'color:rgb', sourceObjectId: null, kind: 'device-rgb', componentCount: 3,
      iccProfileAssetId: null, preservedDefinition: null
    }],
    transparencyGroups: [{
      id: 'group:mask', sourceObjectId: '15 0 R', isolated: true, knockout: false,
      colorSpaceId: 'color:rgb', bounds: { x: 0, y: 0, width: 32, height: 16 }
    }],
    softMasks: [{
      id: 'mask:alpha', sourceObjectId: '16 0 R', subtype: 'alpha', groupResourceId: 'group:mask',
      backdrop: [0, 0, 0], transferFunction: 'identity'
    }]
  },
  pages: [{
    pageIndex: 0,
    sourceObjectId: '3 0 R',
    mediaBox: { x: 0, y: 0, width: 612, height: 792 },
    cropBox: { x: 0, y: 0, width: 612, height: 792 },
    rotation: 0,
    userUnit: 1,
    operations: [
      { kind: 'save-state' },
      { kind: 'set-fill-paint', paint: { kind: 'resource', colorSpaceId: 'color:rgb', components: [1, 0, 0] } },
      { kind: 'clip-path', fillRule: 'nonzero', path: { commands: [
        { kind: 'move', point: { x: 0, y: 0 } }, { kind: 'line', point: { x: 10, y: 0 } },
        { kind: 'line', point: { x: 10, y: 10 } }, { kind: 'close' }
      ] } },
      { kind: 'draw-image', imageResourceId: 'image:hero', matrix: identity },
      { kind: 'apply-soft-mask', softMaskResourceId: 'mask:alpha' },
      { kind: 'begin-transparency-group', groupResourceId: 'group:mask', matrix: identity },
      { kind: 'end-transparency-group', groupResourceId: 'group:mask' },
      { kind: 'begin-marked-content', tag: 'Span', actualText: 'A' },
      ...([0, 1, 2, 3, 4, 5, 6, 7] as PdfTextRenderingMode[]).map(renderingMode => ({
        kind: 'draw-text' as const,
        runs: [{
          fontResourceId: 'font:subset', fontSize: 12, textMatrix: identity,
          characterSpacing: 0, wordSpacing: 0, horizontalScale: 100, rise: 0, renderingMode,
          extractedText: 'A', logicalOrderConfidence: 1,
          glyphs: [{
            sourceCode: [0, 65], cid: 65, glyphId: 42, unicode: 'A', unicodeConfidence: 'to-unicode' as const,
            origin: { x: 10, y: 20 }, advance: { x: 7.2, y: 0 }, glyphMatrix: [12, 0, 0, 12, 10, 20] as const
          }]
        }]
      })),
      { kind: 'end-marked-content' },
      { kind: 'restore-state' }
    ]
  }],
  preserved: { catalogObjectId: '1 0 R', metadataAssetId: 'asset:metadata', unsupportedFeatures: ['native-ai-private-data'] }
});

describe('normalized PDF display-list contract', () => {
  it('survives worker and persistence boundaries without losing exact glyph data', () => {
    const original = fixture();
    const serialized = transportClone(original);

    expect(validatePdfDisplayList(serialized)).toBe(serialized);
    const textOperations = serialized.pages[0].operations.filter(operation => operation.kind === 'draw-text');
    expect(textOperations.map(operation => operation.runs[0].renderingMode)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(textOperations[0].runs[0].glyphs[0]).toMatchObject({
      sourceCode: [0, 65], cid: 65, glyphId: 42, unicode: 'A',
      glyphMatrix: [12, 0, 0, 12, 10, 20]
    });
    expect(serialized.resources.fonts[0]).toMatchObject({ subsetTag: 'ABCDEF', embeddedAssetId: 'asset:font' });
  });

  it.each([
    ['invalid source byte', (value: PdfNormalizedDisplayList) => ((value.pages[0].operations[8] as unknown as { runs: { glyphs: { sourceCode: number[] }[] }[] }).runs[0].glyphs[0].sourceCode[0] = 256), 'must be a byte'],
    ['non-finite matrix', (value: PdfNormalizedDisplayList) => ((value.pages[0].operations[3] as unknown as { matrix: number[] }).matrix[0] = Number.NaN), 'must be finite'],
    ['unbalanced graphics state', (value: PdfNormalizedDisplayList) => ((value.pages[0].operations as unknown as unknown[]).pop()), 'graphics state unbalanced'],
    ['missing image resource', (value: PdfNormalizedDisplayList) => ((value.pages[0].operations[3] as { imageResourceId: string }).imageResourceId = 'missing'), 'references missing image resource'],
    ['duplicate resource id', (value: PdfNormalizedDisplayList) => ((value.resources.images[0] as { id: string }).id = 'font:subset'), 'duplicate id']
  ])('rejects %s', (_name, mutate, expected) => {
    const value = transportClone(fixture());
    mutate(value);
    expect(() => validatePdfDisplayList(value)).toThrow(expected);
  });

  it('enforces configurable parser-output limits', () => {
    const value = fixture();
    expect(() => validatePdfDisplayList(value, {
      maximumPages: 0,
      maximumOperationsPerPage: 100,
      maximumGlyphsPerRun: 100,
      maximumPathCommands: 100,
      maximumResourceCount: 100
    })).toThrow('page limit');
    expect(() => validatePdfDisplayList(value, {
      maximumPages: 10,
      maximumOperationsPerPage: 1,
      maximumGlyphsPerRun: 100,
      maximumPathCommands: 100,
      maximumResourceCount: 100
    })).toThrow('operation limit');
    expect(() => validatePdfDisplayList(value, {
      maximumPages: 10,
      maximumOperationsPerPage: 100,
      maximumGlyphsPerRun: 0,
      maximumPathCommands: 100,
      maximumResourceCount: 100
    })).toThrow('glyph limit');
  });
});
