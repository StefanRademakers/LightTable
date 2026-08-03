import type {
  PdfBlendMode,
  PdfDisplayOperation,
  PdfPageDisplayList,
  PdfPaint,
  PdfPathData
} from '@lighttable/pdf-core';
import { PDF_DISPLAY_LIST_SCHEMA_VERSION, validatePdfDisplayList } from '@lighttable/pdf-core';

export interface PdfDisplayListPageInput {
  readonly page: PdfPageDisplayList;
  readonly title?: string;
  /** GPU-rendered page content below the normalized native operation suffix. */
  readonly rasterUnderlayPng?: Blob;
}

export interface PdfDisplayListPageResult {
  readonly blob: Blob;
  readonly operationCount: number;
  readonly pathCount: number;
}

const MAXIMUM_PAGE_POINTS = 14_400;
const MAXIMUM_OPERATIONS = 250_000;
const MAXIMUM_PATH_COMMANDS = 2_000_000;

const fail = (message: string): never => {
  throw new Error(`PDF display-list writer ${message}`);
};

const number = (value: number) => {
  if (!Number.isFinite(value)) fail('received a non-finite number.');
  return String(Number(value.toFixed(6)));
};

const paint = (value: PdfPaint, stroke: boolean) => {
  const operator = stroke ? { gray: 'G', rgb: 'RG', cmyk: 'K' } : { gray: 'g', rgb: 'rg', cmyk: 'k' };
  switch (value.kind) {
    case 'device-gray': return `${number(value.gray)} ${operator.gray}`;
    case 'device-rgb': return `${number(value.r)} ${number(value.g)} ${number(value.b)} ${operator.rgb}`;
    case 'device-cmyk': return `${number(value.c)} ${number(value.m)} ${number(value.y)} ${number(value.k)} ${operator.cmyk}`;
    case 'resource': return fail(`cannot yet write resource color space ${value.colorSpaceId}.`);
  }
};

const path = (value: PdfPathData) => value.commands.map(command => {
  switch (command.kind) {
    case 'move': return `${number(command.point.x)} ${number(command.point.y)} m`;
    case 'line': return `${number(command.point.x)} ${number(command.point.y)} l`;
    case 'cubic': return [
      number(command.control1.x), number(command.control1.y),
      number(command.control2.x), number(command.control2.y),
      number(command.point.x), number(command.point.y), 'c'
    ].join(' ');
    case 'close': return 'h';
  }
}).join('\n');

const blendModeName = (value: Exclude<PdfBlendMode, 'unsupported'>) => ({
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay',
  darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue',
  saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity'
})[value];

const pathPaintOperator = (
  value: Extract<PdfDisplayOperation, { kind: 'draw-path' }>
) => {
  if (value.paint === 'stroke') return 'S';
  if (value.paint === 'fill') return value.fillRule === 'evenodd' ? 'f*' : 'f';
  return value.fillRule === 'evenodd' ? 'B*' : 'B';
};

/**
 * Writes the first exact normalized-display-list subset. Unsupported resources
 * fail closed so operation order is never approximated by silently lifting or
 * flattening individual objects.
 */
export const writePdfDisplayListPage = async ({
  page: source,
  title,
  rasterUnderlayPng
}: PdfDisplayListPageInput): Promise<PdfDisplayListPageResult> => {
  const unsupported = source.operations.find(operation => [
    'draw-image', 'draw-form', 'draw-text', 'begin-transparency-group',
    'end-transparency-group', 'apply-soft-mask', 'preserved-unsupported'
  ].includes(operation.kind));
  if (unsupported) fail(`does not support ${unsupported.kind} yet.`);
  try {
    validatePdfDisplayList({
      schemaVersion: PDF_DISPLAY_LIST_SCHEMA_VERSION,
      source: {
        format: 'pdf', originalAssetId: 'writer:normalized-page', byteLength: 1,
        fingerprintSha256: '0'.repeat(64), pdfVersion: null, nativeAiData: 'absent'
      },
      pages: [source],
      resources: {
        fonts: [], fontPrograms: [], semanticMappings: [], type3GlyphPrograms: [],
        forms: [], images: [], colorSpaces: [], transparencyGroups: [], softMasks: []
      },
      preserved: { catalogObjectId: null, metadataAssetId: null, unsupportedFeatures: [] }
    });
  } catch (error) {
    fail(`received an invalid normalized page: ${error instanceof Error ? error.message : String(error)}`);
  }
  const boxes = [source.mediaBox, source.cropBox];
  boxes.forEach((box, index) => {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0
      || box.width * source.userUnit > MAXIMUM_PAGE_POINTS
      || box.height * source.userUnit > MAXIMUM_PAGE_POINTS) {
      fail(`${index === 0 ? 'media' : 'crop'} box is invalid or exceeds ${MAXIMUM_PAGE_POINTS} points.`);
    }
  });
  if (!Number.isFinite(source.userUnit) || source.userUnit <= 0 || source.userUnit > 75_000) {
    fail('user unit must be finite, positive and no larger than 75000.');
  }
  if (source.operations.length > MAXIMUM_OPERATIONS) {
    fail(`operation count exceeds ${MAXIMUM_OPERATIONS}.`);
  }

  const { PDFDocument, PDFName, degrees } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setProducer('LightTable');
  document.setCreator('LightTable');
  if (title) document.setTitle(title);
  const page = document.addPage([source.mediaBox.width, source.mediaBox.height]);
  page.setMediaBox(source.mediaBox.x, source.mediaBox.y, source.mediaBox.width, source.mediaBox.height);
  page.setCropBox(source.cropBox.x, source.cropBox.y, source.cropBox.width, source.cropBox.height);
  page.setRotation(degrees(source.rotation));
  if (source.userUnit !== 1) page.node.set(PDFName.of('UserUnit'), document.context.obj(source.userUnit));
  if (rasterUnderlayPng) {
    if (rasterUnderlayPng.size <= 0 || rasterUnderlayPng.size > 64 * 1024 * 1024) {
      fail('raster underlay must contain at most 67108864 bytes.');
    }
    if (rasterUnderlayPng.type && rasterUnderlayPng.type !== 'image/png') {
      fail('raster underlay must be a PNG.');
    }
    const underlay = await document.embedPng(await rasterUnderlayPng.arrayBuffer());
    page.drawImage(underlay, {
      x: source.cropBox.x,
      y: source.cropBox.y,
      width: source.cropBox.width,
      height: source.cropBox.height
    });
  }

  const content: string[] = [];
  let stateDepth = 0;
  let graphicsStateIndex = 0;
  let pathCount = 0;
  let pathCommandCount = 0;
  const setGraphicsState = (dictionary: Record<string, unknown>) => {
    const name = `LTGS${++graphicsStateIndex}`;
    page.node.setExtGState(PDFName.of(name), document.context.obj({ Type: 'ExtGState', ...dictionary }));
    content.push(`/${name} gs`);
  };

  for (const operation of source.operations) {
    switch (operation.kind) {
      case 'save-state': content.push('q'); stateDepth += 1; break;
      case 'restore-state':
        if (stateDepth === 0) fail('graphics state restores without a matching save.');
        content.push('Q'); stateDepth -= 1; break;
      case 'concat-transform': content.push(`${operation.matrix.map(number).join(' ')} cm`); break;
      case 'set-fill-paint': content.push(paint(operation.paint, false)); break;
      case 'set-stroke-paint': content.push(paint(operation.paint, true)); break;
      case 'set-stroke-state':
        content.push(
          `${number(operation.stroke.width)} w`,
          `${({ butt: 0, round: 1, square: 2 })[operation.stroke.cap]} J`,
          `${({ miter: 0, round: 1, bevel: 2 })[operation.stroke.join]} j`,
          `${number(operation.stroke.miterLimit)} M`,
          `[${operation.stroke.dash.map(number).join(' ')}] ${number(operation.stroke.dashPhase)} d`
        );
        break;
      case 'set-alpha':
        setGraphicsState({ ca: operation.fill, CA: operation.stroke });
        break;
      case 'set-blend-mode':
        if (operation.blendMode === 'unsupported') {
          fail(`cannot write blend mode ${operation.sourceName ?? 'unsupported'}.`);
        } else {
          setGraphicsState({ BM: PDFName.of(blendModeName(operation.blendMode)) });
        }
        break;
      case 'clip-path':
        pathCommandCount += operation.path.commands.length;
        content.push(path(operation.path), operation.fillRule === 'evenodd' ? 'W* n' : 'W n');
        break;
      case 'draw-path':
        pathCommandCount += operation.path.commands.length;
        pathCount += 1;
        content.push(path(operation.path), pathPaintOperator(operation));
        break;
      case 'begin-marked-content':
        if (operation.actualText || operation.propertiesObjectId) {
          fail('cannot yet write marked-content properties.');
        }
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(operation.tag)) fail('received an unsafe marked-content tag.');
        content.push(`/${operation.tag} BMC`);
        break;
      case 'end-marked-content': content.push('EMC'); break;
      case 'draw-image':
      case 'draw-form':
      case 'draw-text':
      case 'begin-transparency-group':
      case 'end-transparency-group':
      case 'apply-soft-mask':
      case 'preserved-unsupported':
        fail(`does not support ${operation.kind} yet.`);
    }
    if (pathCommandCount > MAXIMUM_PATH_COMMANDS) {
      fail(`path command count exceeds ${MAXIMUM_PATH_COMMANDS}.`);
    }
  }
  if (stateDepth !== 0) fail('graphics state saves are not balanced.');

  const contentRef = document.context.register(document.context.flateStream(content.join('\n')));
  page.node.addContentStream(contentRef);
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: true });
  return {
    blob: new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }),
    operationCount: source.operations.length,
    pathCount
  };
};
