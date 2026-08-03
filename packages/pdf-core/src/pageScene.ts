import type {
  PdfBlendMode,
  PdfDisplayOperation,
  PdfMatrix,
  PdfPageDisplayList,
  PdfPaint,
  PdfPathData,
  PdfPositionedTextRun,
  PdfStrokeState
} from './types';

export const PDF_IDENTITY_MATRIX: PdfMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);

/** PDF affine multiplication: the returned matrix applies `right`, then `left`. */
export const multiplyPdfMatrices = (left: PdfMatrix, right: PdfMatrix): PdfMatrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5]
];

export interface PdfPagePathClip {
  readonly kind: 'path';
  readonly path: PdfPathData;
  readonly fillRule: 'nonzero' | 'evenodd';
  readonly localToPage: PdfMatrix;
}

export interface PdfPageTextClip {
  readonly kind: 'positioned-text';
  /** Only runs with PDF rendering modes 4-7 participate in this clip. */
  readonly runs: readonly PdfPositionedTextRun[];
}

export type PdfPageClip = PdfPagePathClip | PdfPageTextClip;

export interface PdfPagePaintSnapshot {
  readonly fillPaint: PdfPaint;
  readonly strokePaint: PdfPaint;
  readonly stroke: PdfStrokeState;
  readonly fillAlpha: number;
  readonly strokeAlpha: number;
  readonly blendMode: PdfBlendMode;
  readonly clips: readonly PdfPageClip[];
  readonly softMaskResourceId: string | null;
  readonly transparencyGroups: readonly string[];
}

interface PdfPageSceneItemBase {
  readonly sourceObjectId?: string;
  readonly paintState: PdfPagePaintSnapshot;
}

export type PdfPageSceneItem =
  | (PdfPageSceneItemBase & {
    readonly kind: 'path';
    readonly path: PdfPathData;
    readonly paint: 'fill' | 'stroke' | 'fill-stroke';
    readonly fillRule: 'nonzero' | 'evenodd';
    readonly localToPage: PdfMatrix;
  })
  | (PdfPageSceneItemBase & {
    readonly kind: 'image';
    readonly imageResourceId: string;
    readonly localToPage: PdfMatrix;
  })
  | (PdfPageSceneItemBase & {
    readonly kind: 'positioned-text';
    /** Glyph matrices are already in page-user space and are never reshaped. */
    readonly runs: readonly PdfPositionedTextRun[];
  });

export interface PdfPageScene {
  readonly pageIndex: number;
  readonly sourceObjectId: string;
  readonly mediaBox: PdfPageDisplayList['mediaBox'];
  readonly cropBox: PdfPageDisplayList['cropBox'];
  readonly rotation: PdfPageDisplayList['rotation'];
  readonly userUnit: number;
  readonly items: readonly PdfPageSceneItem[];
  readonly preservedUnsupported: readonly Extract<PdfDisplayOperation, { kind: 'preserved-unsupported' }>[];
}

interface GraphicsState {
  transform: PdfMatrix;
  fillPaint: PdfPaint;
  strokePaint: PdfPaint;
  stroke: PdfStrokeState;
  fillAlpha: number;
  strokeAlpha: number;
  blendMode: PdfBlendMode;
  clips: PdfPageClip[];
  softMaskResourceId: string | null;
  transparencyGroups: string[];
}

const defaultState = (): GraphicsState => ({
  transform: PDF_IDENTITY_MATRIX,
  fillPaint: { kind: 'device-gray', gray: 0 },
  strokePaint: { kind: 'device-gray', gray: 0 },
  stroke: { width: 1, cap: 'butt', join: 'miter', miterLimit: 10, dash: [], dashPhase: 0 },
  fillAlpha: 1,
  strokeAlpha: 1,
  blendMode: 'normal',
  clips: [],
  softMaskResourceId: null,
  transparencyGroups: []
});

const copyState = (state: GraphicsState): GraphicsState => ({
  ...state,
  transform: [...state.transform] as unknown as PdfMatrix,
  clips: [...state.clips],
  transparencyGroups: [...state.transparencyGroups]
});

const snapshot = (state: GraphicsState): PdfPagePaintSnapshot => ({
  fillPaint: state.fillPaint,
  strokePaint: state.strokePaint,
  stroke: state.stroke,
  fillAlpha: state.fillAlpha,
  strokeAlpha: state.strokeAlpha,
  blendMode: state.blendMode,
  clips: state.clips,
  softMaskResourceId: state.softMaskResourceId,
  transparencyGroups: state.transparencyGroups
});

/** Replays validated PDF operations into immutable, renderer-neutral page items. */
export const importPdfPageScene = (page: PdfPageDisplayList): PdfPageScene => {
  let state = defaultState();
  const stack: GraphicsState[] = [];
  const items: PdfPageSceneItem[] = [];
  const preservedUnsupported: Extract<PdfDisplayOperation, { kind: 'preserved-unsupported' }>[] = [];

  for (const operation of page.operations) {
    switch (operation.kind) {
      case 'save-state': stack.push(copyState(state)); break;
      case 'restore-state': state = stack.pop() ?? state; break;
      case 'concat-transform':
        state.transform = multiplyPdfMatrices(state.transform, operation.matrix);
        break;
      case 'set-fill-paint': state.fillPaint = operation.paint; break;
      case 'set-stroke-paint': state.strokePaint = operation.paint; break;
      case 'set-stroke-state': state.stroke = operation.stroke; break;
      case 'set-blend-mode': state.blendMode = operation.blendMode; break;
      case 'set-alpha': state.fillAlpha = operation.fill; state.strokeAlpha = operation.stroke; break;
      case 'clip-path':
        state.clips = [...state.clips, {
          kind: 'path',
          path: operation.path,
          fillRule: operation.fillRule,
          localToPage: state.transform
        }];
        break;
      case 'draw-path':
        items.push({
          kind: 'path', path: operation.path, paint: operation.paint,
          fillRule: operation.fillRule, localToPage: state.transform,
          sourceObjectId: operation.sourceObjectId, paintState: snapshot(state)
        });
        break;
      case 'draw-image':
        items.push({
          kind: 'image', imageResourceId: operation.imageResourceId,
          localToPage: multiplyPdfMatrices(state.transform, operation.matrix),
          sourceObjectId: operation.sourceObjectId, paintState: snapshot(state)
        });
        break;
      case 'draw-text':
        items.push({
          kind: 'positioned-text', runs: operation.runs,
          sourceObjectId: operation.sourceObjectId, paintState: snapshot(state)
        });
        {
          const clippingRuns = operation.runs.filter(run => run.renderingMode >= 4);
          if (clippingRuns.length > 0) {
            state.clips = [...state.clips, { kind: 'positioned-text', runs: clippingRuns }];
          }
        }
        break;
      case 'begin-transparency-group':
        state.transparencyGroups = [...state.transparencyGroups, operation.groupResourceId];
        break;
      case 'end-transparency-group':
        state.transparencyGroups = state.transparencyGroups.slice(0, -1);
        break;
      case 'apply-soft-mask': state.softMaskResourceId = operation.softMaskResourceId; break;
      case 'preserved-unsupported': preservedUnsupported.push(operation); break;
      case 'begin-marked-content':
      case 'end-marked-content':
        break;
    }
  }

  return {
    pageIndex: page.pageIndex,
    sourceObjectId: page.sourceObjectId,
    mediaBox: page.mediaBox,
    cropBox: page.cropBox,
    rotation: page.rotation,
    userUnit: page.userUnit,
    items,
    preservedUnsupported
  };
};
