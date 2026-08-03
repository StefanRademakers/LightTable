import type {
  PdfDisplayOperation,
  PdfNativeTextPage,
  PdfNativeTextRun
} from '@lighttable/pdf-core';
import type { PdfEmbeddedFontResource } from '../../application/pdf/materializePdfFonts';
import { parseSfntPdfFontMetrics } from './parseSfntPdfFontMetrics';
import { serializePdfDisplayListOperations } from './serializePdfDisplayListOperations';

export interface NativeVectorLayerPdfContent {
  readonly layerId: string;
  readonly operations: readonly PdfDisplayOperation[];
}

export interface NativeTextPdfPageInput {
  readonly page: PdfNativeTextPage;
  readonly fonts: readonly PdfEmbeddedFontResource[];
  readonly title?: string;
  /** GPU-rendered page content below the native text layer suffix. */
  readonly rasterUnderlayPng?: Blob;
  /** Resource-free normalized vector operations grouped by canonical layer. */
  readonly vectorLayers?: readonly NativeVectorLayerPdfContent[];
  /** Bottom-to-top native suffix order. Required when vector layers are present. */
  readonly nativeLayerOrder?: readonly string[];
}

export interface NativeTextPdfPageResult {
  readonly blob: Blob;
  readonly embeddedFontCount: number;
  readonly textRunCount: number;
  readonly glyphCount: number;
  readonly pathCount: number;
}

const fail = (message: string): never => {
  throw new Error(`PDF native text writer ${message}`);
};

const number = (value: number) => {
  if (!Number.isFinite(value)) fail('received a non-finite number.');
  return String(Number(value.toFixed(6)));
};

const codeHex = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    return fail(`character code ${value} exceeds unsigned 16-bit range.`);
  }
  return value.toString(16).padStart(4, '0').toUpperCase();
};

const utf16Hex = (value: string, includeBom = false) => {
  let output = includeBom ? 'FEFF' : '';
  for (let index = 0; index < value.length; index += 1) {
    output += value.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  }
  return output;
};

const chunks = <T>(values: readonly T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const cmapHeader = (name: string, type: 1 | 2) => [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def',
  `/CMapName /${name} def`,
  `/CMapType ${type} def`,
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange'
];

const cmapFooter = ['endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'];

const encodingCMap = (name: string, run: PdfNativeTextRun) => {
  const mappings = [...new Map(run.encoding.map(entry => [entry.code, entry])).values()]
    .sort((left, right) => left.code - right.code);
  const lines = cmapHeader(name, 1);
  for (const group of chunks(mappings, 100)) {
    lines.push(`${group.length} begincidchar`);
    group.forEach(entry => lines.push(`<${codeHex(entry.code)}> ${entry.code}`));
    lines.push('endcidchar');
  }
  return [...lines, ...cmapFooter].join('\n');
};

const toUnicodeCMap = (name: string, run: PdfNativeTextRun) => {
  const unicodeByCode = new Map<number, string>();
  run.encoding.forEach(entry => {
    if (entry.unicode !== null) unicodeByCode.set(entry.code, entry.unicode);
  });
  run.actualText.forEach(span => {
    const glyphs = run.glyphs.slice(span.glyphStart, span.glyphEnd);
    if (glyphs.length === 0) return;
    const characters = [...span.unicode];
    if (characters.length === glyphs.length) {
      glyphs.forEach((glyph, index) => {
        if (!unicodeByCode.has(glyph.code)) unicodeByCode.set(glyph.code, characters[index]!);
      });
      return;
    }
    if (!unicodeByCode.has(glyphs[0]!.code)) {
      unicodeByCode.set(glyphs[0]!.code, span.unicode);
    }
    glyphs.slice(1).forEach(glyph => {
      if (!unicodeByCode.has(glyph.code)) unicodeByCode.set(glyph.code, '');
    });
  });
  const mappings = [...unicodeByCode]
    .map(([code, unicode]) => ({ code, unicode }))
    .sort((left, right) => left.code - right.code);
  const lines = cmapHeader(name, 2);
  for (const group of chunks(mappings, 100)) {
    lines.push(`${group.length} beginbfchar`);
    group.forEach(entry => lines.push(
      `<${codeHex(entry.code)}> <${utf16Hex(entry.unicode)}>`
    ));
    lines.push('endbfchar');
  }
  return [...lines, ...cmapFooter].join('\n');
};

const subsetName = (instanceId: string, postScriptName: string | null) => {
  let hash = 2_166_136_261;
  for (let index = 0; index < instanceId.length; index += 1) {
    hash = Math.imul(hash ^ instanceId.charCodeAt(index), 16_777_619) >>> 0;
  }
  let tag = '';
  for (let index = 0; index < 6; index += 1) {
    tag += String.fromCharCode(65 + hash % 26);
    hash = Math.floor(hash / 26) ^ (hash << 5);
  }
  const safeName = (postScriptName ?? 'LightTableFont').replace(/[^A-Za-z0-9_.-]/g, '-');
  return `${tag}+${safeName}`;
};

const cidToGidMap = (run: PdfNativeTextRun) => {
  const entries = [...new Map(run.encoding.map(entry => [entry.code, entry])).values()];
  const maximumCid = Math.max(0, ...entries.map(entry => entry.code));
  const bytes = new Uint8Array((maximumCid + 1) * 2);
  entries.forEach(entry => {
    bytes[entry.code * 2] = entry.glyphId >>> 8;
    bytes[entry.code * 2 + 1] = entry.glyphId & 0xff;
  });
  return bytes;
};

const contentForRun = (
  run: PdfNativeTextRun,
  fontName: string,
  graphicsStateName: string | null,
  widths: ReadonlyMap<number, number>
) => {
  if (run.paint.stroke) fail(`run ${run.runId} requires unsupported stroked-text output.`);
  const lines = ['q'];
  if (run.paint.fill?.kind === 'device-rgb') {
    lines.push(`${number(run.paint.fill.r)} ${number(run.paint.fill.g)} ${number(run.paint.fill.b)} rg`);
  }
  if (graphicsStateName) lines.push(`/${graphicsStateName} gs`);
  const showGlyphs = (glyphs: readonly PdfNativeTextRun['glyphs'][number][]) => {
    const first = glyphs[0]!;
    const [a, b, c, d] = first.textMatrix;
    const determinant = a * d - b * c;
    const canUsePositionedArray = glyphs.length > 1
      && Math.abs(determinant) > 1e-12
      && glyphs.every(glyph => glyph.textMatrix.slice(0, 4).every(
        (value, index) => Math.abs(value - first.textMatrix[index]!) <= 1e-6
      ));
    const array: string[] = [`<${codeHex(first.code)}>`];
    if (canUsePositionedArray) {
      for (let index = 0; index < glyphs.length - 1; index += 1) {
        const glyph = glyphs[index]!;
        const next = glyphs[index + 1]!;
        const dx = next.textMatrix[4] - glyph.textMatrix[4];
        const dy = next.textMatrix[5] - glyph.textMatrix[5];
        const localX = (d * dx - c * dy) / determinant;
        const localY = (-b * dx + a * dy) / determinant;
        if (Math.abs(localY) > 1e-5) {
          array.length = 0;
          break;
        }
        const width = widths.get(glyph.glyphId)
          ?? fail(`run ${run.runId} is missing width for glyph ${glyph.glyphId}.`);
        array.push(number((width / 1000 * run.fontSize - localX) * 1000 / run.fontSize));
        array.push(`<${codeHex(next.code)}>`);
      }
    }
    if (array.length > 0 && glyphs.length > 1) {
      lines.push(
        'BT',
        `/${fontName} ${number(run.fontSize)} Tf`,
        `${run.renderingMode} Tr`,
        `${first.textMatrix.map(number).join(' ')} Tm`,
        `[${array.join(' ')}] TJ`,
        'ET'
      );
      return;
    }
    glyphs.forEach(glyph => lines.push(
      'BT',
      `/${fontName} ${number(run.fontSize)} Tf`,
      `${run.renderingMode} Tr`,
      `${glyph.textMatrix.map(number).join(' ')} Tm`,
      `<${codeHex(glyph.code)}> Tj`,
      'ET'
    ));
  };
  const starts = new Map(run.actualText.map(span => [span.glyphStart, span]));
  for (let index = 0; index < run.glyphs.length;) {
    const actualText = starts.get(index);
    if (!actualText) {
      showGlyphs([run.glyphs[index]!]);
      index += 1;
      continue;
    }
    lines.push(`/Span << /ActualText <${utf16Hex(actualText.unicode, true)}> >> BDC`);
    showGlyphs(run.glyphs.slice(actualText.glyphStart, actualText.glyphEnd));
    lines.push('EMC');
    index = actualText.glyphEnd;
  }
  lines.push('Q');
  return lines.join('\n');
};

/** Writes exact, retained-GID TrueType text objects; no run is reshaped. */
export const writeNativeTextPdfPage = async ({
  page: source,
  fonts,
  title,
  rasterUnderlayPng,
  vectorLayers = [],
  nativeLayerOrder
}: NativeTextPdfPageInput): Promise<NativeTextPdfPageResult> => {
  if (!Number.isFinite(source.widthPoints) || !Number.isFinite(source.heightPoints)
    || source.widthPoints <= 0 || source.heightPoints <= 0
    || source.widthPoints > 14_400 || source.heightPoints > 14_400) {
    fail('page dimensions must be positive and no larger than 14400 points.');
  }
  const { PDFDocument, PDFName, PDFString } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setProducer('LightTable');
  document.setCreator('LightTable');
  if (title) document.setTitle(title);
  const page = document.addPage([source.widthPoints, source.heightPoints]);
  if (rasterUnderlayPng) {
    if (rasterUnderlayPng.size <= 0 || rasterUnderlayPng.size > 64 * 1024 * 1024) {
      fail('raster underlay must contain at most 67108864 bytes.');
    }
    if (rasterUnderlayPng.type && rasterUnderlayPng.type !== 'image/png') {
      fail('raster underlay must be a PNG.');
    }
    const underlay = await document.embedPng(await rasterUnderlayPng.arrayBuffer());
    page.drawImage(underlay, {
      x: 0,
      y: 0,
      width: source.widthPoints,
      height: source.heightPoints
    });
  }
  const context = document.context;
  const fontByInstance = new Map(fonts.map(font => [font.instanceId, font]));
  const shared = new Map<string, {
    readonly resource: PdfEmbeddedFontResource;
    readonly metrics: ReturnType<typeof parseSfntPdfFontMetrics>;
    readonly baseName: string;
    readonly descriptorRef: ReturnType<typeof context.register>;
  }>();

  for (const run of source.runs) {
    if (shared.has(run.fontInstanceId)) continue;
    const resource = fontByInstance.get(run.fontInstanceId)
      ?? fail(`is missing font resource ${run.fontInstanceId}.`);
    const glyphIds = source.runs
      .filter(entry => entry.fontInstanceId === run.fontInstanceId)
      .flatMap(entry => entry.glyphs.map(glyph => glyph.glyphId));
    const metrics = parseSfntPdfFontMetrics(resource.bytes, glyphIds);
    if (metrics.outline !== 'truetype') {
      fail(`font ${run.fontInstanceId} requires the future CFF writer path.`);
    }
    const baseName = subsetName(run.fontInstanceId, resource.postScriptName);
    const fontFileRef = context.register(context.flateStream(resource.bytes, {
      Length1: resource.bytes.byteLength
    }));
    const descriptorRef = context.register(context.obj({
      Type: 'FontDescriptor',
      FontName: baseName,
      Flags: metrics.flags,
      FontBBox: [...metrics.boundingBox],
      ItalicAngle: metrics.italicAngle,
      Ascent: metrics.ascent,
      Descent: metrics.descent,
      CapHeight: metrics.capHeight,
      StemV: metrics.stemV,
      MissingWidth: metrics.missingWidth,
      FontFile2: fontFileRef
    }));
    shared.set(run.fontInstanceId, { resource, metrics, baseName, descriptorRef });
  }

  const textContentByLayer = new Map<string, string[]>();
  let fontIndex = 0;
  for (const run of source.runs) {
    const font = shared.get(run.fontInstanceId)!;
    const fontName = `LTF${++fontIndex}`;
    const cmapName = `LTEncoding${fontIndex}`;
    const encodingRef = context.register(context.flateStream(encodingCMap(cmapName, run)));
    const toUnicodeRef = context.register(context.flateStream(
      toUnicodeCMap(`LTUnicode${fontIndex}`, run)
    ));
    const cidMapRef = context.register(context.flateStream(cidToGidMap(run)));
    const widths = [...new Map(run.encoding.map(entry => [entry.code, entry])).values()]
      .sort((left, right) => left.code - right.code)
      .flatMap(entry => [entry.code, [
        font.metrics.widths.get(entry.glyphId)
          ?? fail(`font ${run.fontInstanceId} is missing width for glyph ${entry.glyphId}.`)
      ]]);
    const descendantRef = context.register(context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: font.baseName,
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Identity'),
        Supplement: 0
      },
      FontDescriptor: font.descriptorRef,
      DW: font.metrics.missingWidth,
      W: widths,
      CIDToGIDMap: cidMapRef
    }));
    const type0Ref = context.register(context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: font.baseName,
      Encoding: encodingRef,
      DescendantFonts: [descendantRef],
      ToUnicode: toUnicodeRef
    }));
    page.node.setFontDictionary(PDFName.of(fontName), type0Ref);
    let graphicsStateName: string | null = null;
    if (run.paint.fillAlpha !== 1) {
      graphicsStateName = `LTGS${fontIndex}`;
      const state = context.obj({ Type: 'ExtGState', ca: run.paint.fillAlpha, CA: 1 });
      page.node.setExtGState(PDFName.of(graphicsStateName), state);
    }
    const layerContent = textContentByLayer.get(run.layerId) ?? [];
    layerContent.push(contentForRun(run, fontName, graphicsStateName, font.metrics.widths));
    textContentByLayer.set(run.layerId, layerContent);
  }
  const vectorByLayer = new Map<string, readonly PdfDisplayOperation[]>();
  vectorLayers.forEach(layer => {
    if (vectorByLayer.has(layer.layerId)) fail(`received duplicate vector layer ${layer.layerId}.`);
    vectorByLayer.set(layer.layerId, layer.operations);
  });
  const nativeIds = new Set([...textContentByLayer.keys(), ...vectorByLayer.keys()]);
  const order = nativeLayerOrder ?? [...textContentByLayer.keys()];
  if (vectorLayers.length > 0 && !nativeLayerOrder) fail('requires nativeLayerOrder when vector layers are present.');
  if (new Set(order).size !== order.length
    || order.length !== nativeIds.size
    || order.some(layerId => !nativeIds.has(layerId))) {
    fail('nativeLayerOrder must contain every native text/vector layer exactly once.');
  }
  let pathCount = 0;
  order.forEach((layerId, layerIndex) => {
    const vectorOperations = vectorByLayer.get(layerId);
    if (vectorOperations) {
      const serialized = serializePdfDisplayListOperations(
        document,
        page,
        vectorOperations,
        `LTV${layerIndex + 1}GS`
      );
      pathCount += serialized.pathCount;
      page.node.addContentStream(context.register(context.flateStream(serialized.content)));
    }
    const textContent = textContentByLayer.get(layerId);
    if (textContent) {
      page.node.addContentStream(context.register(context.flateStream(textContent.join('\n'))));
    }
  });
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: true });
  return {
    blob: new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }),
    embeddedFontCount: shared.size,
    textRunCount: source.runs.length,
    glyphCount: source.runs.reduce((total, run) => total + run.glyphs.length, 0),
    pathCount
  };
};
