import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';

export type BackgroundRemovalBackend = 'webgpu' | 'wasm';

export interface BackgroundRemovalProgress {
  readonly phase: 'download' | 'decode' | 'inference' | 'refinement';
  readonly message: string;
  readonly percent?: number;
}
export interface BackgroundRemovalResult {
  readonly mask: RasterSelectionMask;
  readonly modelId: string;
  readonly backend: BackgroundRemovalBackend;
  readonly durationMs: number;
}

export interface BackgroundRemovalModel {
  remove(
    image: Blob,
    options?: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (progress: BackgroundRemovalProgress) => void;
    }
  ): Promise<BackgroundRemovalResult>;
  dispose(): void;
}
