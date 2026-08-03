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
      type3GlyphProgramResourceIds: [],
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
    type3GlyphPrograms: [],
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

const addType3Font = (value: PdfNormalizedDisplayList, id: string, programId: string) => {
  (value.resources.fonts as Array<PdfNormalizedDisplayList['resources']['fonts'][number]>).push({
    id, sourceObjectId: `${id}:object`, subtype: 'type3', baseName: id, subsetTag: null,
    fontProgramResourceId: null, type3GlyphProgramResourceIds: [programId],
    encodingName: null, toUnicode: 'absent', authoring: 'outline-only', embedding: 'embedded'
  });
};

const type3TextOperation = (id: string, fontResourceId: string, glyphId = 65) => ({
  kind: 'draw-text' as const,
  runs: [{
    id, fontResourceId, semanticMappingResourceId: null, fontSize: 1, textMatrix: identity,
    characterSpacing: 0, wordSpacing: 0, horizontalScale: 100, rise: 0,
    renderingMode: 0 as PdfTextRenderingMode,
    glyphs: [{
      sourceCode: [glyphId], glyphId, origin: { x: 0, y: 0 }, advance: { x: 1, y: 0 },
      glyphMatrix: identity
    }]
  }]
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
    ['duplicate resource id', (value: PdfNormalizedDisplayList) => ((value.resources.images[0] as { id: string }).id = 'font:subset'), 'duplicate id'],
    ['missing original source asset', (value: PdfNormalizedDisplayList) => ((value.source as { originalAssetId: string }).originalAssetId = ''), 'preserved original bytes'],
    ['invalid source fingerprint', (value: PdfNormalizedDisplayList) => ((value.source as { fingerprintSha256: string }).fingerprintSha256 = 'bad'), 'SHA-256'],
    ['private AI data on plain PDF', (value: PdfNormalizedDisplayList) => {
      (value.source as { format: 'pdf'; nativeAiData: 'preserved-unsupported' }).format = 'pdf';
    }, 'PDF-compatible Illustrator']
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

  it('validates bounded, separately owned Type 3 glyph programs', () => {
    const value = transportClone(fixture());
    addType3Font(value, 'font:type3', 'type3:glyph-a');
    (value.resources.type3GlyphPrograms as Array<PdfNormalizedDisplayList['resources']['type3GlyphPrograms'][number]>).push({
      id: 'type3:glyph-a', sourceObjectId: '30 0 R', fontResourceId: 'font:type3',
      glyphId: 65, sourceCode: [65], advance: { x: 1, y: 0 },
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      operations: [{ kind: 'draw-path', paint: 'fill', fillRule: 'nonzero', path: { commands: [
        { kind: 'move', point: { x: 0, y: 0 } }, { kind: 'line', point: { x: 1, y: 0 } },
        { kind: 'line', point: { x: 1, y: 1 } }, { kind: 'close' }
      ] } }]
    });

    expect(validatePdfDisplayList(value)).toBe(value);
    expect(() => validatePdfDisplayList(value, { maximumType3OperationsPerGlyph: 0 }))
      .toThrow('operation limit');
    expect(() => validatePdfDisplayList(value, { maximumTotalPathCommands: 3 }))
      .toThrow('document path-command budget');
  });

  it('rejects recursive and over-deep Type 3 resource graphs', () => {
    const recursive = transportClone(fixture());
    addType3Font(recursive, 'font:type3', 'type3:glyph-a');
    (recursive.resources.type3GlyphPrograms as Array<PdfNormalizedDisplayList['resources']['type3GlyphPrograms'][number]>).push({
      id: 'type3:glyph-a', sourceObjectId: '31 0 R', fontResourceId: 'font:type3', glyphId: 65,
      sourceCode: [65], advance: { x: 1, y: 0 }, bounds: null,
      operations: [type3TextOperation('run:type3-recursive', 'font:type3')]
    });
    expect(() => validatePdfDisplayList(recursive)).toThrow('recursive Type 3 program');

    const nested = transportClone(fixture());
    addType3Font(nested, 'font:type3-a', 'type3:glyph-a');
    addType3Font(nested, 'font:type3-b', 'type3:glyph-b');
    (nested.resources.type3GlyphPrograms as Array<PdfNormalizedDisplayList['resources']['type3GlyphPrograms'][number]>).push(
      {
        id: 'type3:glyph-a', sourceObjectId: '32 0 R', fontResourceId: 'font:type3-a', glyphId: 65,
        sourceCode: [65], advance: { x: 1, y: 0 }, bounds: null,
        operations: [type3TextOperation('run:type3-a', 'font:type3-b', 66)]
      },
      {
        id: 'type3:glyph-b', sourceObjectId: '33 0 R', fontResourceId: 'font:type3-b', glyphId: 66,
        sourceCode: [66], advance: { x: 1, y: 0 }, bounds: null, operations: []
      }
    );
    expect(() => validatePdfDisplayList(nested, { maximumType3NestingDepth: 1 }))
      .toThrow('Type 3 nesting limit');
  });

  it('follows the exact referenced glyph instead of treating a Type 3 font as recursive', () => {
    const value = transportClone(fixture());
    addType3Font(value, 'font:type3', 'type3:glyph-a');
    (value.resources.fonts.at(-1)!.type3GlyphProgramResourceIds as string[]).push('type3:glyph-b');
    (value.resources.type3GlyphPrograms as Array<PdfNormalizedDisplayList['resources']['type3GlyphPrograms'][number]>).push(
      {
        id: 'type3:glyph-a', sourceObjectId: '34 0 R', fontResourceId: 'font:type3', glyphId: 65,
        sourceCode: [65], advance: { x: 1, y: 0 }, bounds: null,
        operations: [type3TextOperation('run:type3-a-to-b', 'font:type3', 66)]
      },
      {
        id: 'type3:glyph-b', sourceObjectId: '35 0 R', fontResourceId: 'font:type3', glyphId: 66,
        sourceCode: [66], advance: { x: 1, y: 0 }, bounds: null, operations: []
      }
    );
    expect(validatePdfDisplayList(value)).toBe(value);
  });

  it('enforces document-wide hostile-resource budgets', () => {
    const value = fixture();
    expect(() => validatePdfDisplayList(value, { maximumTotalOperations: 1 })).toThrow('document operation budget');
    expect(() => validatePdfDisplayList(value, { maximumTotalGlyphs: 7 })).toThrow('document glyph budget');
    expect(() => validatePdfDisplayList(value, { maximumTotalImagePixels: 511 })).toThrow('document image-pixel budget');
    expect(() => validatePdfDisplayList(value, { maximumTotalFontProgramBytes: 8191 })).toThrow('font-program byte budget');
  });
});
