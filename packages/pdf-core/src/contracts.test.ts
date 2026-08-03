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
      baseName: 'ABCDEF+Inter', subsetTag: 'ABCDEF', fontProgramResourceId: 'font-program:subset',
      encodingName: 'Identity-H',
      toUnicode: 'present', authoring: 'recoverable', embedding: 'embedded'
    }],
    fontPrograms: [{
      id: 'font-program:subset', assetId: 'asset:font', byteLength: 8192,
      fingerprintSha256: 'b'.repeat(64), format: 'opentype', source: 'embedded'
    }],
    semanticMappings: [{
      id: 'semantic:run-a', positionedRunId: 'run:0', extractedText: 'A',
      logicalOrderConfidence: 1,
      spans: [{ glyphStart: 0, glyphEnd: 1, unicode: 'A', provenance: 'to-unicode', confidence: 1 }]
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
          id: `run:${renderingMode}`, fontResourceId: 'font:subset',
          semanticMappingResourceId: renderingMode === 0 ? 'semantic:run-a' : null,
          fontSize: 12, textMatrix: identity,
          characterSpacing: 0, wordSpacing: 0, horizontalScale: 100, rise: 0, renderingMode,
          glyphs: [{
            sourceCode: [0, 65], cid: 65, glyphId: 42,
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
      sourceCode: [0, 65], cid: 65, glyphId: 42,
      glyphMatrix: [12, 0, 0, 12, 10, 20]
    });
    expect(serialized.resources.fonts[0]).toMatchObject({ subsetTag: 'ABCDEF', fontProgramResourceId: 'font-program:subset' });
    expect(serialized.resources.fontPrograms[0]).toMatchObject({ assetId: 'asset:font', source: 'embedded' });
    expect(serialized.resources.semanticMappings[0].spans[0]).toMatchObject({ unicode: 'A', provenance: 'to-unicode' });
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
      maximumResourceCount: 100,
      maximumSemanticSpans: 100,
      maximumFontProgramBytes: 100_000
    })).toThrow('page limit');
    expect(() => validatePdfDisplayList(value, {
      maximumPages: 10,
      maximumOperationsPerPage: 1,
      maximumGlyphsPerRun: 100,
      maximumPathCommands: 100,
      maximumResourceCount: 100,
      maximumSemanticSpans: 100,
      maximumFontProgramBytes: 100_000
    })).toThrow('operation limit');
    expect(() => validatePdfDisplayList(value, {
      maximumPages: 10,
      maximumOperationsPerPage: 100,
      maximumGlyphsPerRun: 0,
      maximumPathCommands: 100,
      maximumResourceCount: 100,
      maximumSemanticSpans: 100,
      maximumFontProgramBytes: 100_000
    })).toThrow('glyph limit');
  });

  it('keeps embedded programs and semantic mappings typed and referentially exact', () => {
    const missingProgram = transportClone(fixture());
    (missingProgram.resources.fonts[0] as { fontProgramResourceId: string }).fontProgramResourceId = 'image:hero';
    expect(() => validatePdfDisplayList(missingProgram)).toThrow('missing font-program resource');

    const detachedMapping = transportClone(fixture());
    (detachedMapping.resources.semanticMappings[0] as { positionedRunId: string }).positionedRunId = 'run:other';
    expect(() => validatePdfDisplayList(detachedMapping)).toThrow('does not target this positioned run');

    const overflowingSpan = transportClone(fixture());
    (overflowingSpan.resources.semanticMappings[0].spans[0] as { glyphEnd: number }).glyphEnd = 2;
    expect(() => validatePdfDisplayList(overflowingSpan)).toThrow('exceeds the glyph count');

    const noEmbeddedProgram = transportClone(fixture());
    (noEmbeddedProgram.resources.fonts[0] as { fontProgramResourceId: string | null }).fontProgramResourceId = null;
    expect(() => validatePdfDisplayList(noEmbeddedProgram)).toThrow('is required for an embedded font');
  });
});
