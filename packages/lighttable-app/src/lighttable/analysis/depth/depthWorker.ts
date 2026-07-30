/// <reference lib="webworker" />

import { pipeline, type DepthEstimationPipeline } from '@huggingface/transformers';
import { normalizeRelativeDepth } from './normalization';

const MODEL_ID = 'onnx-community/depth-anything-v2-small-ONNX';
type DepthPipelineOptions = {
  device: 'webgpu' | 'wasm';
  dtype: 'fp16' | 'fp32' | 'q8';
  progress_callback: (event: { status?: string; progress?: number; file?: string }) => void;
};
const createDepthPipeline = pipeline as unknown as (
  task: 'depth-estimation',
  model: string,
  options: DepthPipelineOptions
) => Promise<DepthEstimationPipeline>;
let estimator: DepthEstimationPipeline | null = null;
let backend: 'webgpu' | 'wasm' | null = null;

type WorkerRequest =
  | { type: 'estimate'; requestId: number; source: Blob }
  | { type: 'dispose' };

const postStatus = (requestId: number, status: 'loading-model' | 'estimating', message?: string, progress?: number) => {
  self.postMessage({ type: 'status', requestId, status, message, progress });
};

const createEstimator = async (requestId: number) => {
  if (estimator) return estimator;
  postStatus(requestId, 'loading-model', 'Loading Depth Anything V2…');
  const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'fp32' | 'q8' }> = [];
  if ('gpu' in navigator) {
    attempts.push({ device: 'webgpu', dtype: 'fp16' }, { device: 'webgpu', dtype: 'fp32' });
  }
  attempts.push({ device: 'wasm', dtype: 'q8' }, { device: 'wasm', dtype: 'fp32' });
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const created = await createDepthPipeline('depth-estimation', MODEL_ID, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: (event: { status?: string; progress?: number; file?: string }) => {
          const progress = typeof event.progress === 'number' ? Math.max(0, Math.min(100, event.progress)) : undefined;
          postStatus(requestId, 'loading-model', event.file ? `Loading ${event.file}` : 'Loading depth model…', progress);
        }
      });
      estimator = created;
      backend = attempt.device;
      return estimator;
    } catch (reason) {
      lastError = reason;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Depth Anything could not be initialized.');
};

const retryWithWasm = async (requestId: number) => {
  await estimator?.dispose();
  estimator = null;
  backend = null;
  postStatus(requestId, 'loading-model', 'WebGPU depth failed; switching to WASM…');
  let lastError: unknown = null;
  for (const dtype of ['q8', 'fp32'] as const) {
    try {
      estimator = await createDepthPipeline('depth-estimation', MODEL_ID, {
        device: 'wasm',
        dtype,
        progress_callback: (event: { status?: string; progress?: number; file?: string }) => {
          postStatus(
            requestId,
            'loading-model',
            event.file ? `Loading ${event.file}` : 'Loading WASM depth model…',
            typeof event.progress === 'number' ? Math.max(0, Math.min(100, event.progress)) : undefined
          );
        }
      });
      backend = 'wasm';
      return estimator;
    } catch (reason) {
      lastError = reason;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('WASM depth fallback could not be initialized.');
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'dispose') {
    void estimator?.dispose();
    estimator = null;
    backend = null;
    return;
  }
  void (async () => {
    const model = await createEstimator(request.requestId);
    postStatus(request.requestId, 'estimating', `Estimating depth on ${backend === 'webgpu' ? 'WebGPU' : 'WASM'}…`);
    let output;
    try {
      output = await model(request.source);
    } catch (reason) {
      if (backend !== 'webgpu') throw reason;
      const fallback = await retryWithWasm(request.requestId);
      postStatus(request.requestId, 'estimating', 'Estimating depth on WASM…');
      output = await fallback(request.source);
    }
    if (Array.isArray(output)) throw new Error('Depth estimator returned an unexpected batch.');
    const dimensions = output.predicted_depth.dims;
    const height = dimensions[dimensions.length - 2];
    const width = dimensions[dimensions.length - 1];
    const raw = Float32Array.from(output.predicted_depth.data as ArrayLike<number>);
    const normalized = normalizeRelativeDepth(raw, width, height, true);
    self.postMessage({
      type: 'result',
      requestId: request.requestId,
      width: normalized.width,
      height: normalized.height,
      data: normalized.data.buffer,
      backend
    }, { transfer: [normalized.data.buffer] });
  })().catch((reason: unknown) => {
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: reason instanceof Error ? reason.message : 'Depth estimation failed.'
    });
  });
};

export {};
