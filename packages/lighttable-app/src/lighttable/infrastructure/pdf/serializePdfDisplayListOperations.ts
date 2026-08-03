import type {
  PdfBlendMode,
  PdfDisplayOperation,
  PdfPaint,
  PdfPathData
} from '@lighttable/pdf-core';
import type { PDFDocument, PDFPage } from 'pdf-lib';
import { PDFName } from 'pdf-lib';

export interface SerializedPdfDisplayListOperations {
  readonly content: string;
  readonly pathCount: number;
  readonly pathCommandCount: number;
}

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

/** Serializes an already validated resource-free operation sequence. */
export const serializePdfDisplayListOperations = (
  document: PDFDocument,
  page: PDFPage,
  operations: readonly PdfDisplayOperation[],
  graphicsStatePrefix = 'LTVGS'
): SerializedPdfDisplayListOperations => {
  const content: string[] = [];
  let stateDepth = 0;
  let graphicsStateIndex = 0;
  let pathCount = 0;
  let pathCommandCount = 0;
  const setGraphicsState = (dictionary: Record<string, unknown>) => {
    const name = `${graphicsStatePrefix}${++graphicsStateIndex}`;
    page.node.setExtGState(PDFName.of(name), document.context.obj({ Type: 'ExtGState', ...dictionary }));
    content.push(`/${name} gs`);
  };

  for (const operation of operations) {
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
      case 'set-alpha': setGraphicsState({ ca: operation.fill, CA: operation.stroke }); break;
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
        if (operation.actualText || operation.propertiesObjectId) fail('cannot yet write marked-content properties.');
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
    if (pathCommandCount > MAXIMUM_PATH_COMMANDS) fail(`path command count exceeds ${MAXIMUM_PATH_COMMANDS}.`);
  }
  if (stateDepth !== 0) fail('graphics state saves are not balanced.');
  return { content: content.join('\n'), pathCount, pathCommandCount };
};
