import type { ImageDocument, LayerNode, Rect } from '../../editor/document/documentTypes';
import type { AffineMatrix } from '../../editor/geometry/affine';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import {
  multiplyMatrices,
  invertMatrix,
  rotationMatrix,
  transformPoint,
  translationMatrix
} from '../../editor/geometry/affine';

export type CanvasAnchor = 0 | 0.5 | 1;
export type OrthogonalDocumentRotation = 'clockwise-90' | 'counter-clockwise-90' | '180';
export type DocumentFlip = 'horizontal' | 'vertical';

export type DocumentGeometryRequest =
  | { readonly operation: 'canvas-size'; readonly width: number; readonly height: number; readonly anchorX: CanvasAnchor; readonly anchorY: CanvasAnchor }
  | { readonly operation: 'crop'; readonly bounds: Rect }
  | { readonly operation: 'rotate'; readonly rotation: OrthogonalDocumentRotation | { readonly degrees: number } }
  | { readonly operation: 'flip'; readonly axis: DocumentFlip };

export interface DocumentGeometryPlan {
  readonly operation: DocumentGeometryRequest['operation'];
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly oldDocumentToNewDocument: AffineMatrix;
  readonly sampling: 'exact-copy' | 'exact-orthogonal' | 'filtered-affine';
  readonly expansionRegions: readonly Rect[];
}

export const MAX_DOCUMENT_GEOMETRY_DIMENSION = 16_384;
const VALID_ANCHORS = new Set<CanvasAnchor>([0, 0.5, 1]);
const EPSILON = 1e-9;

export const parseDocumentGeometryRequest = (
  value: unknown
): DocumentGeometryRequest | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Document geometry parameters must be an object.' };
  }
  const input = value as Record<string, unknown>;
  if (input.operation === 'canvas-size') {
    if (!Number.isInteger(input.width) || !Number.isInteger(input.height)
      || !VALID_ANCHORS.has(input.anchorX as CanvasAnchor)
      || !VALID_ANCHORS.has(input.anchorY as CanvasAnchor)) {
      return { message: 'Canvas Size requires integer dimensions and a valid 3 x 3 anchor.' };
    }
    return { operation: 'canvas-size', width: Number(input.width), height: Number(input.height),
      anchorX: input.anchorX as CanvasAnchor, anchorY: input.anchorY as CanvasAnchor };
  }
  if (input.operation === 'crop') {
    const bounds = input.bounds;
    if (typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) {
      return { message: 'Crop requires document-space bounds.' };
    }
    const rect = bounds as Record<string, unknown>;
    if (![rect.x, rect.y, rect.width, rect.height].every((number) => typeof number === 'number' && Number.isFinite(number))) {
      return { message: 'Crop bounds must contain finite x, y, width and height values.' };
    }
    return { operation: 'crop', bounds: { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) } };
  }
  if (input.operation === 'flip' && (input.axis === 'horizontal' || input.axis === 'vertical')) {
    return { operation: 'flip', axis: input.axis };
  }
  if (input.operation === 'rotate') {
    if (input.rotation === 'clockwise-90' || input.rotation === 'counter-clockwise-90' || input.rotation === '180') {
      return { operation: 'rotate', rotation: input.rotation };
    }
    if (typeof input.rotation === 'object' && input.rotation !== null && !Array.isArray(input.rotation)) {
      const degrees = (input.rotation as Record<string, unknown>).degrees;
      if (typeof degrees === 'number' && Number.isFinite(degrees)) {
        return { operation: 'rotate', rotation: { degrees } };
      }
    }
  }
  return { message: 'Document geometry operation is invalid.' };
};

const assertDimension = (value: number, name: string) => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DOCUMENT_GEOMETRY_DIMENSION) {
    throw new Error(`${name} must be an integer from 1 to ${MAX_DOCUMENT_GEOMETRY_DIMENSION} pixels.`);
  }
};

const normalizedNumber = (value: number) => Math.abs(value) <= EPSILON ? 0 : value;
const normalizedMatrix = (matrix: AffineMatrix): AffineMatrix => ({
  a: normalizedNumber(matrix.a), b: normalizedNumber(matrix.b),
  c: normalizedNumber(matrix.c), d: normalizedNumber(matrix.d),
  tx: normalizedNumber(matrix.tx), ty: normalizedNumber(matrix.ty)
});

const differenceRectangles = (width: number, height: number, covered: Rect): Rect[] => {
  const left = Math.max(0, Math.min(width, covered.x));
  const top = Math.max(0, Math.min(height, covered.y));
  const right = Math.max(left, Math.min(width, covered.x + covered.width));
  const bottom = Math.max(top, Math.min(height, covered.y + covered.height));
  const result: Rect[] = [];
  if (top > 0) result.push({ x: 0, y: 0, width, height: top });
  if (bottom < height) result.push({ x: 0, y: bottom, width, height: height - bottom });
  if (left > 0 && bottom > top) result.push({ x: 0, y: top, width: left, height: bottom - top });
  if (right < width && bottom > top) result.push({ x: right, y: top, width: width - right, height: bottom - top });
  return result.filter(({ width: rectWidth, height: rectHeight }) => rectWidth > 0 && rectHeight > 0);
};

const transformedCanvasBounds = (
  matrix: AffineMatrix,
  width: number,
  height: number
): Rect => {
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: width, y: 0 }),
    transformPoint(matrix, { x: width, y: height }),
    transformPoint(matrix, { x: 0, y: height })
  ];
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const createDocumentGeometryPlan = (
  source: { readonly width: number; readonly height: number },
  request: DocumentGeometryRequest
): DocumentGeometryPlan => {
  assertDimension(source.width, 'Source width');
  assertDimension(source.height, 'Source height');
  if (request.operation === 'canvas-size') {
    assertDimension(request.width, 'Canvas width'); assertDimension(request.height, 'Canvas height');
    if (!VALID_ANCHORS.has(request.anchorX) || !VALID_ANCHORS.has(request.anchorY)) {
      throw new Error('Canvas anchor must use left/center/right and top/center/bottom positions.');
    }
    const matrix = translationMatrix(
      (request.width - source.width) * request.anchorX,
      (request.height - source.height) * request.anchorY
    );
    return {
      operation: request.operation, sourceWidth: source.width, sourceHeight: source.height,
      targetWidth: request.width, targetHeight: request.height,
      oldDocumentToNewDocument: matrix, sampling: 'exact-copy',
      expansionRegions: differenceRectangles(request.width, request.height,
        { x: matrix.tx, y: matrix.ty, width: source.width, height: source.height })
    };
  }
  if (request.operation === 'crop') {
    const { x, y, width, height } = request.bounds;
    if (![x, y, width, height].every(Number.isFinite)) throw new Error('Crop bounds must be finite.');
    assertDimension(Math.round(width), 'Crop width'); assertDimension(Math.round(height), 'Crop height');
    const targetWidth = Math.round(width); const targetHeight = Math.round(height);
    const matrix = translationMatrix(-Math.round(x), -Math.round(y));
    return {
      operation: request.operation, sourceWidth: source.width, sourceHeight: source.height,
      targetWidth, targetHeight, oldDocumentToNewDocument: matrix, sampling: 'exact-copy',
      expansionRegions: differenceRectangles(targetWidth, targetHeight,
        { x: matrix.tx, y: matrix.ty, width: source.width, height: source.height })
    };
  }
  if (request.operation === 'flip') {
    const horizontal = request.axis === 'horizontal';
    return {
      operation: request.operation, sourceWidth: source.width, sourceHeight: source.height,
      targetWidth: source.width, targetHeight: source.height,
      oldDocumentToNewDocument: horizontal
        ? { a: -1, b: 0, c: 0, d: 1, tx: source.width, ty: 0 }
        : { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: source.height },
      sampling: 'exact-orthogonal', expansionRegions: []
    };
  }
  if (typeof request.rotation === 'string') {
    const matrix: AffineMatrix = request.rotation === 'clockwise-90'
      ? { a: 0, b: 1, c: -1, d: 0, tx: source.height, ty: 0 }
      : request.rotation === 'counter-clockwise-90'
        ? { a: 0, b: -1, c: 1, d: 0, tx: 0, ty: source.width }
        : { a: -1, b: 0, c: 0, d: -1, tx: source.width, ty: source.height };
    return {
      operation: request.operation, sourceWidth: source.width, sourceHeight: source.height,
      targetWidth: request.rotation === '180' ? source.width : source.height,
      targetHeight: request.rotation === '180' ? source.height : source.width,
      oldDocumentToNewDocument: matrix, sampling: 'exact-orthogonal', expansionRegions: []
    };
  }
  if (!Number.isFinite(request.rotation.degrees)) throw new Error('Rotation angle must be finite.');
  const radians = request.rotation.degrees * Math.PI / 180;
  const centered = multiplyMatrices(
    translationMatrix(source.width / 2, source.height / 2),
    multiplyMatrices(rotationMatrix(radians), translationMatrix(-source.width / 2, -source.height / 2))
  );
  const bounds = transformedCanvasBounds(centered, source.width, source.height);
  const targetWidth = Math.max(1, Math.ceil(bounds.width - EPSILON));
  const targetHeight = Math.max(1, Math.ceil(bounds.height - EPSILON));
  assertDimension(targetWidth, 'Rotated width'); assertDimension(targetHeight, 'Rotated height');
  const matrix = normalizedMatrix(multiplyMatrices(
    translationMatrix(-bounds.x + (targetWidth - bounds.width) / 2, -bounds.y + (targetHeight - bounds.height) / 2),
    centered
  ));
  return {
    operation: request.operation, sourceWidth: source.width, sourceHeight: source.height,
    targetWidth, targetHeight, oldDocumentToNewDocument: matrix,
    sampling: 'filtered-affine', expansionRegions: []
  };
};

const projectRoot = (node: LayerNode, matrix: AffineMatrix, now: number): LayerNode => {
  const inverse = invertMatrix(matrix);
  if (!inverse) throw new Error('Document geometry mapping is not invertible.');
  return ({
  ...node,
  transform: multiplyMatrices(matrix, node.transform),
  mask: node.mask ? {
    ...node.mask,
    // Mask pixels are physically transferred into the new document-sized
    // surface. Conjugating retains an authored independent mask transform
    // without applying the document mapping a second time.
    transform: multiplyMatrices(matrix, multiplyMatrices(node.mask.transform, inverse)),
    revision: node.mask.revision + 1,
    dirtyBounds: null
  } : null,
  geometryRevision: node.geometryRevision + 1,
  revision: node.revision + 1,
  modifiedAt: now
  });
};

export const projectDocumentGeometry = (
  document: ImageDocument,
  plan: DocumentGeometryPlan
): ImageDocument => {
  if (document.width !== plan.sourceWidth || document.height !== plan.sourceHeight) {
    throw new Error('Document geometry plan no longer matches the source document.');
  }
  const now = Date.now();
  const guidePoint = (orientation: 'horizontal' | 'vertical', position: number) => orientation === 'horizontal'
    ? { x: 0, y: position } : { x: position, y: 0 };
  // The current guide model only represents horizontal and vertical lines.
  // Orthogonal operations can project those exactly; arbitrary rotation cannot.
  // Drop guides for that operation instead of silently approximating angled lines.
  const guides = plan.sampling === 'filtered-affine' ? [] : document.guides.map((guide) => {
    const point = transformPoint(plan.oldDocumentToNewDocument, guidePoint(guide.orientation, guide.position));
    const swapsAxes = Math.abs(plan.oldDocumentToNewDocument.b) > 0.5;
    const orientation = swapsAxes
      ? (guide.orientation === 'horizontal' ? 'vertical' : 'horizontal')
      : guide.orientation;
    return { ...guide, orientation, position: orientation === 'horizontal' ? point.y : point.x };
  });
  return {
    ...document,
    width: plan.targetWidth,
    height: plan.targetHeight,
    guides,
    layers: document.layers.map((node) => projectRoot(node, plan.oldDocumentToNewDocument, now)),
    revision: document.revision + 1,
    modifiedAt: now
  };
};

/** Projects replayable selection semantics through one authoritative document matrix. */
export const projectSelectionTransform = (
  selection: readonly SelectionOperation[],
  matrix: AffineMatrix
): SelectionOperation[] => selection.map((operation) => ({
  ...operation,
  source: operation.source ? structuredClone(operation.source) : undefined,
  shape: { ...operation.shape, points: operation.shape.points.map((point) => ({ ...point })) },
  transform: multiplyMatrices(
    matrix,
    operation.transform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
  )
}));

/** Projects selection semantics through the same matrix as document geometry. */
export const projectSelectionGeometry = (
  selection: readonly SelectionOperation[],
  plan: DocumentGeometryPlan
): SelectionOperation[] => projectSelectionTransform(
  selection,
  plan.oldDocumentToNewDocument
);
