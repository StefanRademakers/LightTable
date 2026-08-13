import { WorkerInferenceClient } from '../../analysis/inference/WorkerInferenceClient';
import { BEN2_BASE_PROFILE, type BackgroundRemovalModelProfile } from './backgroundRemovalModels';
import type { BackgroundRemovalWorkerResponse } from './backgroundRemovalProtocol';
import type { BackgroundRemovalModel, BackgroundRemovalResult } from './backgroundRemovalTypes';

export class Ben2BackgroundRemovalModel implements BackgroundRemovalModel {
  private generation = 0;
  private readonly client: WorkerInferenceClient<Blob, BackgroundRemovalResult>;

  constructor(private readonly profile: BackgroundRemovalModelProfile = BEN2_BASE_PROFILE) {
    this.client = new WorkerInferenceClient({
      createWorker: () => new Worker(new URL('./backgroundRemoval.worker.ts', import.meta.url), { type: 'module' }),
      createRequest: (requestId, image) => ({ type: 'remove', requestId, image, profile: this.profile }),
      parseResult: (raw) => {
        const message = raw as unknown as Extract<BackgroundRemovalWorkerResponse, { type: 'result' }>;
        if (message.type !== 'result' || !(message.mask instanceof ArrayBuffer)) {
          throw new Error('Background removal returned an invalid result.');
        }
        return {
          mask: { width: message.width, height: message.height, data: new Uint8Array(message.mask) },
          modelId: message.modelId,
          backend: message.backend,
          durationMs: message.durationMs
        };
      },
      cacheSize: 0,
      disposeMessage: { type: 'dispose' },
      defaultErrorMessage: 'Background removal'
    });
  }

  async remove(image: Blob, options: Parameters<BackgroundRemovalModel['remove']>[1] = {}) {
    const generation = ++this.generation;
    if (options?.signal?.aborted) throw new DOMException('Background removal was canceled.', 'AbortError');
    const abort = () => this.cancel();
    options?.signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await this.client.run(image, `${generation}`, (progress) => options?.onProgress?.({
        phase: (progress.status as 'download' | 'decode' | 'inference' | 'refinement') ?? 'inference',
        message: progress.message ?? 'Removing background…',
        percent: progress.progress
      }));
      if (generation !== this.generation) throw new DOMException('Background removal was superseded.', 'AbortError');
      return result;
    } finally {
      options?.signal?.removeEventListener('abort', abort);
    }
  }

  cancel() { this.generation += 1; this.client.dispose(); }
  dispose() { this.cancel(); }
}
