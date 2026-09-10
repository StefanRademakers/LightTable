import type { ImageDocument, LayerId, Rect } from '../../../editor/document/documentTypes';
import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionCoverageBounds } from '../../../editor/selection/selectionCoverage';
import type {
  MagicWandOptions,
  RasterSelectionMask,
  SelectionCombineMode,
  SelectionOperation,
  SelectionPoint,
  SelectionShape,
} from '../../../editor/selection/selectionTypes';
import type { BrushDab, BrushPoint } from '../../../editor/tools/brush/strokeBuilder';
import type { SnapFeature, SnapMatch } from '../snapping/snapEngine';

export interface SelectionPaintPreviewPort {
  paintSelectionDabs(
    dabs: BrushDab[], hardness: number, opacity: number, mode: 'add' | 'subtract'
  ): Promise<boolean>;
  restoreSelectionSnapshot(snapshot: SelectionMaskSnapshot): Promise<boolean>;
  captureSelectionSnapshot(): Promise<SelectionMaskSnapshot>;
  measureSelectionBounds(): Promise<SelectionCoverageBounds | null>;
  release(): void;
}

export interface SelectionRendererPort {
  setSelectionPreviewProjection(
    operations: readonly SelectionOperation[],
    translation?: Readonly<{ x: number; y: number }>
  ): void;
  setCommittedSelectionProjection(operations: readonly SelectionOperation[]): void;
  beginSelectionPaintPreview(baseline: SelectionMaskSnapshot): SelectionPaintPreviewPort | null;
}

/** Ports at the gesture boundary; committed writes enter through commit*. */
export interface SelectionSessionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): SelectionRendererPort | null;
  getSelection(): SelectionOperation[];
  getSelectionMaskSnapshot(): SelectionMaskSnapshot | null;
  getSelectionSupportBounds?(): Rect | null;
  publishSelection(
    operations: SelectionOperation[],
    pointerId: number | null,
    snapshot?: SelectionMaskSnapshot,
    commit?: { readonly supportBounds: Rect | null }
  ): void;
  publishPointer?(pointerId: number | null): void;
  publishDraft(shape: SelectionShape | null): void;
  setError(message: string | null): void;
  getSnapContext?(movingBounds: Rect): {
    targets: readonly SnapFeature[];
    zoom: number;
    enabled: boolean;
  };
  publishSnapFeedback?(matches: readonly SnapMatch[], bounds: Rect | null): void;
  onShapeCommitted?(command: {
    readonly mode: SelectionCombineMode;
    readonly shape: SelectionShape;
    readonly featherRadius: number;
    readonly antiAlias: boolean;
  }): void;
  commitShape(command: {
    readonly mode: SelectionCombineMode;
    readonly shape: SelectionShape;
    readonly featherRadius: number;
    readonly antiAlias: boolean;
    readonly provenance: SelectionOperation;
  }): Promise<boolean>;
  commitTranslation(command: {
    readonly x: number;
    readonly y: number;
    readonly provenance: SelectionOperation;
  }): Promise<boolean>;
  commitPaint(command: {
    readonly dabs: readonly BrushDab[];
    readonly hardness: number;
    readonly opacity: number;
    readonly mode: 'add' | 'subtract';
    readonly provenance: SelectionOperation;
  }): Promise<boolean>;
  commitMagicWand(command: {
    readonly layerId: LayerId;
    readonly point: SelectionPoint;
    readonly mode: SelectionCombineMode;
    readonly options: MagicWandOptions;
    readonly provenance: SelectionOperation;
  }, signal: AbortSignal): Promise<boolean>;
  commitOperation(command: {
    readonly operation: SelectionOperation | null;
  }): Promise<boolean>;
  commitRasterMask(command: {
    readonly mask: RasterSelectionMask;
    readonly mode: SelectionCombineMode;
    readonly provenance: SelectionOperation;
  }, signal: AbortSignal): Promise<boolean>;
  onMagicWandCommitted?(command: {
    readonly kind: 'magic-wand';
    readonly layerId: LayerId;
    readonly point: SelectionPoint;
    readonly mode: SelectionCombineMode;
    readonly options: MagicWandOptions;
  }): void;
  onPaintCommitted?(command: {
    readonly kind: 'selection-paint';
    readonly mode: 'add' | 'subtract';
    readonly dabs: BrushDab[];
    readonly samples: BrushPoint[];
    readonly size: number;
    readonly hardness: number;
    readonly opacity: number;
    readonly smooth: number;
  }): void;
}
