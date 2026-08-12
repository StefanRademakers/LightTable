import type { FaceWarpDetectionResponse, FaceWarpDetectorObservation } from './faceWarpDetectorProtocol';
import type { FaceWarpPoint } from './faceWarpTypes';

export interface FaceWarpDetectionInput {
  readonly blob: Blob;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface FaceWarpDetectionResult {
  readonly meshes: readonly (readonly FaceWarpPoint[])[];
  readonly poseMatrices: readonly (readonly number[])[];
  readonly observations: readonly FaceWarpDetectorObservation[];
  readonly detectorMemory: {
    readonly beforeBytes: number | null;
    readonly afterBytes: number | null;
    readonly deltaBytes: number | null;
  };
}

export class FaceWarpDetector {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (result: FaceWarpDetectionResult) => void;
    reject: (error: Error) => void;
  }>();

  async detect(input: FaceWarpDetectionInput): Promise<FaceWarpDetectionResult> {
    const worker = this.ensureWorker();
    const image = await createImageBitmap(input.blob);
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage({
        type: 'detect', requestId, image,
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight
      }, [image]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const { reject } of this.pending.values()) reject(new Error('Face detection was cancelled.'));
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./faceWarpDetector.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FaceWarpDetectionResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.type === 'result') pending.resolve({
        meshes: response.meshes,
        poseMatrices: response.poseMatrices,
        observations: response.observations,
        detectorMemory: response.detectorMemory
      });
      else pending.reject(new Error(response.message));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The face detector worker failed.');
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }
}
