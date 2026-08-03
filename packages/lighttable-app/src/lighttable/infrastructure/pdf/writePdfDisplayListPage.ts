import type { PdfBlendMode, PdfDisplayOperation, PdfPageDisplayList } from '@lighttable/pdf-core';
import { PDF_DISPLAY_LIST_SCHEMA_VERSION, validatePdfDisplayList } from '@lighttable/pdf-core';
import {
  pdfBlendModeResourceName,
  serializePdfDisplayListOperations
} from './serializePdfDisplayListOperations';

export interface PdfTransparencyGroupContent {
  readonly operations: readonly PdfDisplayOperation[];
  readonly opacity: number;
  readonly blendMode: Exclude<PdfBlendMode, 'unsupported'>;
  readonly isolated?: boolean;
  readonly knockout?: boolean;
}

export interface PdfDisplayListPageInput {
  readonly page: PdfPageDisplayList;
  readonly title?: string;
  /** GPU-rendered page content below the normalized native operation suffix. */
  readonly rasterUnderlayPng?: Blob;
  /** Ordered isolated Form XObjects painted after the ordinary page suffix. */
  readonly transparencyGroups?: readonly PdfTransparencyGroupContent[];
}

export interface PdfDisplayListPageResult {
  readonly blob: Blob;
  readonly operationCount: number;
  readonly pathCount: number;
}

const MAXIMUM_PAGE_POINTS = 14_400;
const MAXIMUM_OPERATIONS = 250_000;

const fail = (message: string): never => {
  throw new Error(`PDF display-list writer ${message}`);
};

/**
 * Writes the first exact normalized-display-list subset. Unsupported resources
 * fail closed so operation order is never approximated by silently lifting or
 * flattening individual objects.
 */
export const writePdfDisplayListPage = async ({
  page: source,
  title,
  rasterUnderlayPng,
  transparencyGroups = []
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
  const groupOperationCount = transparencyGroups.reduce(
    (total, group) => total + group.operations.length,
    0
  );
  if (source.operations.length + groupOperationCount > MAXIMUM_OPERATIONS) {
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

  const serialized = serializePdfDisplayListOperations(document, source.operations);
  serialized.graphicsStates.forEach(({ name, dictionary }) => {
    page.node.setExtGState(PDFName.of(name), document.context.obj(dictionary));
  });
  const contentRef = document.context.register(document.context.flateStream(serialized.content));
  page.node.addContentStream(contentRef);
  let pathCount = serialized.pathCount;
  transparencyGroups.forEach((group, index) => {
    if (!Number.isFinite(group.opacity) || group.opacity < 0 || group.opacity > 1) {
      fail(`transparency group ${index + 1} opacity must be between zero and one.`);
    }
    const groupContent = serializePdfDisplayListOperations(
      document,
      group.operations,
      `LTG${index + 1}GS`
    );
    pathCount += groupContent.pathCount;
    const extGState = document.context.obj({});
    groupContent.graphicsStates.forEach(({ name, dictionary }) => {
      extGState.set(PDFName.of(name), document.context.obj(dictionary));
    });
    const resources = document.context.obj({ ExtGState: extGState });
    const box = source.mediaBox;
    const form = document.context.flateStream(groupContent.content, {
      Type: 'XObject', Subtype: 'Form', FormType: 1,
      BBox: [box.x, box.y, box.x + box.width, box.y + box.height],
      Resources: resources,
      Group: {
        S: 'Transparency',
        I: group.isolated ?? true,
        K: group.knockout ?? false
      }
    });
    const formRef = document.context.register(form);
    const formName = `LTGroup${index + 1}`;
    page.node.setXObject(PDFName.of(formName), formRef);
    const stateName = `LTGroupState${index + 1}`;
    page.node.setExtGState(PDFName.of(stateName), document.context.obj({
      Type: 'ExtGState', ca: group.opacity, CA: group.opacity,
      BM: PDFName.of(pdfBlendModeResourceName(group.blendMode))
    }));
    page.node.addContentStream(document.context.register(document.context.flateStream(
      `q\n/${stateName} gs\n/${formName} Do\nQ`
    )));
  });
  const bytes = await document.save({ addDefaultPage: false, useObjectStreams: true });
  return {
    blob: new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }),
    operationCount: source.operations.length + groupOperationCount,
    pathCount
  };
};
