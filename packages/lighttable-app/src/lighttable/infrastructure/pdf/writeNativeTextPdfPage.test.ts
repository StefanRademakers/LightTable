import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PdfNativeTextPage, PdfNativeTextRun } from '@lighttable/pdf-core';
import { createHarfBuzzFontSubsetter } from './HarfBuzzFontSubsetter';
import { writeNativeTextPdfPage } from './writeNativeTextPdfPage';

const workspace = fileURLToPath(new URL('../../../../../../', import.meta.url));

const resources = async (glyphIds: readonly number[]) => {
  const [font, wasm] = await Promise.all([
    readFile(`${workspace}test/fixtures/fonts/Anton-Regular.ttf`),
    readFile(`${workspace}node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm`)
  ]);
  const subsetter = await createHarfBuzzFontSubsetter(new Uint8Array(wasm));
  const bytes = subsetter.subset({
    fontBytes: new Uint8Array(font), faceIndex: 0, glyphIds
  });
  return [{
    instanceId: 'anton',
    assetId: 'anton',
    sourceFingerprintSha256: 'a'.repeat(64),
    postScriptName: 'Anton-Regular',
    faceIndex: 0,
    disposition: 'subset' as const,
    bytes,
    glyphIds,
    retainGlyphIds: true
  }];
};

const run = (change: Partial<PdfNativeTextRun> = {}): PdfNativeTextRun => ({
  runId: 'run-1',
  layerId: 'layer-1',
  fontInstanceId: 'anton',
  encodingId: 'encoding-1',
  fontSize: 32,
  renderingMode: 0,
  paint: {
    fill: { kind: 'device-rgb', r: 0.1, g: 0.2, b: 0.3 },
    fillAlpha: 1,
    stroke: null
  },
  encoding: [{ code: 1, glyphId: 36, unicode: 'A' }],
  actualText: [],
  glyphs: [{
    code: 1,
    glyphId: 36,
    unicode: 'A',
    origin: { x: 20, y: 50 },
    advance: { x: 20, y: 0 },
    textMatrix: [1, 0, 0, 1, 20, 50]
  }],
  ...change
});

const page = (textRun: PdfNativeTextRun): PdfNativeTextPage => ({
  widthPoints: 200,
  heightPoints: 100,
  pixelsPerInch: 72,
  runs: [textRun]
});

const extractedText = async (blob: Blob) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
    useWorkerFetch: false
  });
  try {
    const document = await loading.promise;
    const pdfPage = await document.getPage(1);
    const content = await pdfPage.getTextContent();
    await pdfPage.getOperatorList();
    return content.items.flatMap(item => 'str' in item ? [item.str] : []).join('');
  } finally {
    await loading.destroy();
  }
};

describe('writeNativeTextPdfPage', () => {
  it('embeds a retain-GID Type0 font and reopens as searchable Unicode text', async () => {
    const result = await writeNativeTextPdfPage({
      page: page(run()),
      fonts: await resources([0, 36]),
      title: 'Native text'
    });

    expect(result).toMatchObject({ embeddedFontCount: 1, textRunCount: 1, glyphCount: 1 });
    expect(result.blob.type).toBe('application/pdf');
    expect(await extractedText(result.blob)).toBe('A');
  });

  it('round-trips multi-glyph semantics through marked-content ActualText', async () => {
    const ligatureRun = run({
      encoding: [
        { code: 1, glyphId: 36, unicode: null },
        { code: 2, glyphId: 37, unicode: null }
      ],
      actualText: [{ glyphStart: 0, glyphEnd: 2, unicode: 'fi' }],
      glyphs: [
        {
          code: 1, glyphId: 36, unicode: null,
          origin: { x: 20, y: 50 }, advance: { x: 15.52, y: 0 },
          textMatrix: [1, 0, 0, 1, 20, 50]
        },
        {
          code: 2, glyphId: 37, unicode: null,
          origin: { x: 35.52, y: 50 }, advance: { x: 15.52, y: 0 },
          textMatrix: [1, 0, 0, 1, 35.52, 50]
        }
      ]
    });
    const result = await writeNativeTextPdfPage({
      page: page(ligatureRun),
      fonts: await resources([0, 36, 37])
    });
    expect(await extractedText(result.blob)).toBe('fi');
  });
});
