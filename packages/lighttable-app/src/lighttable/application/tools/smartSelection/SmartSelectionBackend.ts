import type { RasterSelectionMask, SelectionPoint } from '../../../editor/selection/selectionTypes';

export interface SmartSelectionSource {
  readonly key: string;
  readonly documentRevision: number;
  readonly width: number;
  readonly height: number;
  readonly image: Blob;
}

export interface PreparedSmartSelectionSource {
  readonly id: string;
  readonly sourceKey: string;
  readonly documentRevision: number;
  readonly width: number;
  readonly height: number;
}

export interface SmartSelectionCandidate {
  readonly id: string;
  readonly score: number;
  readonly mask: RasterSelectionMask;
}

export interface SmartSelectionRequestOptions {
  readonly hardEdge: boolean;
  readonly signal?: AbortSignal;
}

/**
 * Model-neutral boundary for promptable object selection.
 *
 * Neither tool/UI code nor the normal selection engine may depend on model
 * tensors. A backend returns one document-sized alpha mask; the existing GPU
 * selection compositor owns New/Add/Subtract/Intersect from that point on.
 */
export interface SmartSelectionBackend {
  prepare(source: SmartSelectionSource, signal?: AbortSignal): Promise<PreparedSmartSelectionSource>;
  selectPoint(
    source: PreparedSmartSelectionSource,
    point: SelectionPoint,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[]>;
  selectBox(
    source: PreparedSmartSelectionSource,
    bounds: { x: number; y: number; width: number; height: number },
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[]>;
  selectSubject?(
    source: PreparedSmartSelectionSource,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[]>;
  disposePreparedSource(source: PreparedSmartSelectionSource): void;
  dispose(): void;
}
