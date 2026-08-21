/// <reference lib="webworker" />

import { pipeline, RawImage, type ProgressInfo } from '@huggingface/transformers';
import { refineBackgroundRemovalMask } from './backgroundRemovalMask';
import type { BackgroundRemovalWorkerRequest, BackgroundRemovalWorkerResponse } from './backgroundRemovalProtocol';

type BackgroundPipeline = ((image: Blob) => Promise<RawImage[]>) & { dispose(): Promise<void> };
let runtime: BackgroundPipeline | null = null;
let loadedProfileId: string | null = null;
let backend: 'webgpu' | 'wasm' = 'wasm';

const modelArtifactUrl = (
  profile: Extract<BackgroundRemovalWorkerRequest, { type: 'remove' }>['profile']
) => `https://huggingface.co/${profile.modelId}/resolve/${encodeURIComponent(profile.revision)}/onnx/model_fp16.onnx`;

const fp16ModelIsCached = async (
  profile: Extract<BackgroundRemovalWorkerRequest, { type: 'remove' }>['profile']
): Promise<boolean> => {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open('transformers-cache');
    return Boolean(await cache.match(modelArtifactUrl(profile)));
  } catch {
    return false;
  }
};

const publish = (message: BackgroundRemovalWorkerResponse, transfer?: Transferable[]) =>
  self.postMessage(message, transfer ?? []);

const load = async (
  requestId: number,
  profile: Extract<BackgroundRemovalWorkerRequest, { type: 'remove' }>['profile']
) => {
  if (runtime && loadedProfileId === profile.id) return runtime;
  await runtime?.dispose();
  runtime = null;
  const cachedFp16 = await fp16ModelIsCached(profile);
  const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'q8' }> = [];
  if ('gpu' in navigator) attempts.push({ device: 'webgpu', dtype: 'fp16' });
  attempts.push({ device: 'wasm', dtype: 'q8' });
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const created = await pipeline('background-removal', profile.modelId, {
        revision: profile.revision,
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: (event: ProgressInfo) => {
          const file = 'file' in event && typeof event.file === 'string' ? event.file : null;
          const isFp16Artifact = attempt.dtype === 'fp16' && file?.endsWith('model_fp16.onnx');
          const initializing = isFp16Artifact && 'status' in event && event.status === 'done';
          publish({
            type: 'status', requestId, status: 'download', phase: 'download',
            message: initializing
              ? 'Initializing WebGPU model...'
              : file
                ? isFp16Artifact
                  ? `${cachedFp16 ? 'Loading cached' : 'Downloading'} ${file}`
                  : `Preparing ${file}`
                : 'Preparing background-removal model...',
            progress: 'progress' in event && typeof event.progress === 'number'
              ? event.progress : undefined
          });
        }
      });
      runtime = created as unknown as BackgroundPipeline;
      loadedProfileId = profile.id;
      backend = attempt.device;
      return runtime;
    } catch (reason) {
      lastError = reason;
      await runtime?.dispose(); runtime = null;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Background removal could not initialize.');
};

self.onmessage = (event: MessageEvent<BackgroundRemovalWorkerRequest>) => {
  if (event.data.type === 'dispose') {
    void runtime?.dispose(); runtime = null; loadedProfileId = null;
    return;
  }
  const request = event.data;
  void (async () => {
    const startedAt = performance.now();
    try {
      const active = await load(request.requestId, request.profile);
      publish({ type: 'status', requestId: request.requestId, status: 'decode', phase: 'decode', message: 'Preparing active layer…' });
      const source = await RawImage.fromBlob(request.image);
      publish({ type: 'status', requestId: request.requestId, status: 'inference', phase: 'inference', message: 'Removing background…' });
      const [output] = await active(request.image);
      if (!output) throw new Error('The background-removal model returned no image.');
      output.rgba(); source.rgba();
      if (output.width !== source.width || output.height !== source.height) {
        throw new Error('The background-removal model returned an unexpected output size.');
      }
      publish({ type: 'status', requestId: request.requestId, status: 'refinement', phase: 'refinement', message: 'Refining edges…' });
      const predicted = new Uint8Array(output.width * output.height);
      for (let i = 0; i < predicted.length; i += 1) predicted[i] = output.data[i * 4 + 3]!;
      const mask = refineBackgroundRemovalMask(predicted, source.data, output.width, output.height);
      publish({
        type: 'result', requestId: request.requestId,
        width: output.width, height: output.height, mask: mask.buffer,
        modelId: request.profile.modelId, backend, durationMs: performance.now() - startedAt
      }, [mask.buffer]);
    } catch (reason) {
      publish({
        type: 'error', requestId: request.requestId,
        message: reason instanceof Error ? reason.message : 'Background removal failed.'
      });
    }
  })();
};
