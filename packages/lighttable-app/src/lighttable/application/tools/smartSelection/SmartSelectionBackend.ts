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
  readonly refineEdges: boolean;
  readonly refinementQuality: 'fast' | 'standard' | 'high';
  readonly signal?: AbortSignal;
}

export interface SmartSelectionBackendIdentity {
  readonly modelId: string;
  readonly artifactRevision: string;
  readonly precision: string;
  readonly preprocessingRevision: string;
}

export interface SmartSelectionBackendCapabilities {
  readonly positivePoints: true;
  readonly negativePoints: boolean;
  readonly boxes: boolean;
  readonly previousMask: boolean;
  readonly automaticSubject: boolean;
}

export interface SmartSelectionPointPrompt {
  readonly point: SelectionPoint;
  readonly label: 'positive' | 'negative';
}

/** Model-neutral prompt history for one object on one prepared source. */
export interface SmartSelectionPrompt {
  readonly points: readonly SmartSelectionPointPrompt[];
  readonly box?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly previousMask?: RasterSelectionMask;
}

/**
 * Model-neutral boundary for promptable object selection.
 *
 * Neither tool/UI code nor the normal selection engine may depend on model
 * tensors. A backend returns one document-sized alpha mask; the existing GPU
 * selection compositor owns New/Add/Subtract/Intersect from that point on.
 */
export interface SmartSelectionBackend {
  readonly identity: SmartSelectionBackendIdentity;
  readonly capabilities: SmartSelectionBackendCapabilities;
  prepare(source: SmartSelectionSource, signal?: AbortSignal): Promise<PreparedSmartSelectionSource>;
  selectPrompt(
    source: PreparedSmartSelectionSource,
    prompt: SmartSelectionPrompt,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[]>;
  selectSubject?(
    source: PreparedSmartSelectionSource,
    options: SmartSelectionRequestOptions
  ): Promise<SmartSelectionCandidate[]>;
  disposePreparedSource(source: PreparedSmartSelectionSource): void;
  dispose(): void;
}
