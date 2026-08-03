import type {
  PdfDisplayOperation,
  PdfMatrix,
  PdfPageDisplayList,
  PdfPathData,
  PdfPaint
} from '@lighttable/pdf-core';
import {
  multiplyMatrices,
  realizeLiveShape,
  type AffineMatrix,
  type SolidPaint,
  type VectorPath,
  type VectorSubpath
} from '@lighttable/vector-core';
import type { ImageDocument, LayerId, LayerNode, VectorLayer } from '../../editor/document/documentTypes';
import { buildSceneTransformIndex, requireSceneTransform } from '../../editor/document/sceneTransformGraph';

export interface PdfNativeVectorPageDependencies {
  readonly document: ImageDocument;
  readonly nativeVectorLayerIds: ReadonlySet<LayerId>;
  readonly pixelsPerInch?: number;
}

export interface PdfNativeVectorLayerOperations {
  readonly layerId: LayerId;
  readonly operations: readonly PdfDisplayOperation[];
}

export interface PdfNativeVectorLayerPage {
  readonly page: PdfPageDisplayList;
  readonly layers: readonly PdfNativeVectorLayerOperations[];
}

const DEFAULT_PIXELS_PER_INCH = 300;

const fail = (message: string): never => {
  throw new Error(`PDF native vector page ${message}`);
};

const pdfMatrix = (matrix: AffineMatrix): PdfMatrix => [
  matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty
];

const pdfPaint = (value: SolidPaint): PdfPaint => ({
  kind: 'device-rgb', r: value.color[0], g: value.color[1], b: value.color[2]
});

const samePoint = (left: { x: number; y: number }, right: { x: number; y: number }) => (
  left.x === right.x && left.y === right.y
);

const segment = (
  from: VectorSubpath['anchors'][number],
  to: VectorSubpath['anchors'][number]
): PdfPathData['commands'][number] => {
  const control1 = from.handleOut ?? from.position;
  const control2 = to.handleIn ?? to.position;
  return samePoint(control1, from.position) && samePoint(control2, to.position)
    ? { kind: 'line', point: { ...to.position } }
    : { kind: 'cubic', control1: { ...control1 }, control2: { ...control2 }, point: { ...to.position } };
};

const pathData = (path: VectorPath): PdfPathData => ({
  commands: path.subpaths.flatMap(subpath => {
    const first = subpath.anchors[0];
    if (!first) return [];
    const commands: PdfPathData['commands'][number][] = [
      { kind: 'move', point: { ...first.position } }
    ];
    for (let index = 1; index < subpath.anchors.length; index += 1) {
      commands.push(segment(subpath.anchors[index - 1]!, subpath.anchors[index]!));
    }
    if (subpath.closed && subpath.anchors.length > 1) {
      commands.push(segment(subpath.anchors.at(-1)!, first), { kind: 'close' });
    }
    return commands;
  })
});

const selectedLayers = (
  nodes: readonly LayerNode[],
  selected: ReadonlySet<LayerId>,
  result: VectorLayer[] = []
) => {
  nodes.forEach(node => {
    if (node.type === 'group') selectedLayers(node.children, selected, result);
    else if (node.type === 'vector' && selected.has(node.id)) result.push(node);
  });
  return result;
};

const elementOperations = (
  layer: VectorLayer,
  path: VectorPath,
  layerToPage: AffineMatrix
): PdfDisplayOperation[] => {
  const fill = path.style.fill;
  const stroke = path.style.stroke;
  if (!fill && !stroke) return [];
  if (stroke && (stroke.alignment ?? 'center') !== 'center') {
    return fail(`layer ${layer.id} uses unsupported ${stroke.alignment} stroke alignment.`);
  }
  const operations: PdfDisplayOperation[] = [
    { kind: 'save-state' },
    { kind: 'concat-transform', matrix: pdfMatrix(multiplyMatrices(layerToPage, path.transform)) }
  ];
  if (fill) operations.push({ kind: 'set-fill-paint', paint: pdfPaint(fill) });
  if (stroke) {
    operations.push(
      { kind: 'set-stroke-paint', paint: pdfPaint(stroke.paint) },
      { kind: 'set-stroke-state', stroke: {
        width: stroke.width, cap: stroke.cap, join: stroke.join,
        miterLimit: stroke.miterLimit, dash: [...stroke.dash], dashPhase: stroke.dashOffset
      } }
    );
  }
  operations.push({
    kind: 'set-alpha',
    fill: (fill?.color[3] ?? 1) * path.style.opacity * layer.opacity * layer.fillOpacity,
    stroke: (stroke?.paint.color[3] ?? 1) * path.style.opacity * layer.opacity * layer.fillOpacity
  });
  operations.push({
    kind: 'draw-path', path: pathData(path), fillRule: path.fillRule,
    paint: fill && stroke ? 'fill-stroke' : fill ? 'fill' : 'stroke',
    sourceObjectId: `${layer.id}:${path.id}`
  });
  operations.push({ kind: 'restore-state' });
  return operations;
};

/** Converts selected canonical vector layers into exact PDF page operations. */
export const buildPdfNativeVectorLayerPage = ({
  document,
  nativeVectorLayerIds,
  pixelsPerInch = DEFAULT_PIXELS_PER_INCH
}: PdfNativeVectorPageDependencies): PdfNativeVectorLayerPage => {
  if (!Number.isFinite(pixelsPerInch) || pixelsPerInch <= 0 || pixelsPerInch > 2_400) {
    fail('pixelsPerInch must be between zero and 2400.');
  }
  const layers = selectedLayers(document.layers, nativeVectorLayerIds);
  if (layers.length !== nativeVectorLayerIds.size) fail('contains a stale or non-vector layer id.');
  const scale = 72 / pixelsPerInch;
  const heightPoints = document.height * scale;
  const documentToPage: AffineMatrix = {
    a: scale, b: 0, c: 0, d: -scale, tx: 0, ty: heightPoints
  };
  const scene = buildSceneTransformIndex(document);
  const outputLayers = layers.map(layer => {
    const layerToPage = multiplyMatrices(
      documentToPage,
      requireSceneTransform(scene, layer.id).localToDocument
    );
    return {
      layerId: layer.id,
      operations: layer.elements.flatMap(element => elementOperations(
        layer,
        element.type === 'path' ? element : realizeLiveShape(element),
        layerToPage
      ))
    };
  });
  const page: PdfPageDisplayList = {
    pageIndex: 0,
    sourceObjectId: `lighttable:${document.id}:page:1`,
    mediaBox: { x: 0, y: 0, width: document.width * scale, height: heightPoints },
    cropBox: { x: 0, y: 0, width: document.width * scale, height: heightPoints },
    rotation: 0,
    userUnit: 1,
    operations: outputLayers.flatMap(layer => layer.operations)
  };
  return { page, layers: outputLayers };
};

export const buildPdfNativeVectorPage = (
  dependencies: PdfNativeVectorPageDependencies
): PdfPageDisplayList => buildPdfNativeVectorLayerPage(dependencies).page;
