import type { BackgroundRemovalModelProfile } from './backgroundRemovalModels';

export type BackgroundRemovalWorkerRequest =
  | { readonly type: 'remove'; readonly requestId: number; readonly image: Blob; readonly profile: BackgroundRemovalModelProfile }
  | { readonly type: 'dispose' };

export type BackgroundRemovalWorkerResponse =
  | { readonly type: 'status'; readonly requestId: number; readonly status: 'download' | 'decode' | 'inference' | 'refinement'; readonly phase: 'download' | 'decode' | 'inference' | 'refinement'; readonly message: string; readonly progress?: number }
  | { readonly type: 'result'; readonly requestId: number; readonly width: number; readonly height: number; readonly mask: ArrayBuffer; readonly modelId: string; readonly backend: 'webgpu' | 'wasm'; readonly durationMs: number }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string };
