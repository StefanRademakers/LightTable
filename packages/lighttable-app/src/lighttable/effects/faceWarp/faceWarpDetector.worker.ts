/// <reference lib="webworker" />
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import modelUrl from '../../../assets/models/face-warp/face_landmarker.task?url';
import type { FaceWarpDetectionRequest, FaceWarpDetectionResponse } from './faceWarpDetectorProtocol';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

const workerHeapBytes = (): number | null => {
  const memory = (performance as Performance & {
    readonly memory?: { readonly usedJSHeapSize?: number };
  }).memory;
  const value = memory?.usedJSHeapSize;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const landmarker = () => landmarkerPromise ??= FaceLandmarker.createFromOptions(
  { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
  {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 8,
    minFaceDetectionConfidence: 0.35,
    minFacePresenceConfidence: 0.35,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true
  }
);

self.onmessage = async (event: MessageEvent<FaceWarpDetectionRequest>) => {
  const request = event.data;
  try {
    const beforeBytes = workerHeapBytes();
    const detector = await landmarker();
    const result = detector.detect(request.image);
    const afterBytes = workerHeapBytes();
    request.image.close();
    const meshes = result.faceLandmarks.map((landmarks) => landmarks.map((point) => ({
      x: point.x * request.sourceWidth,
      y: point.y * request.sourceHeight,
      z: point.z * request.sourceWidth
    })));
    const poseMatrices = result.facialTransformationMatrixes.map(({ data }) => [...data]);
    self.postMessage({
      type: 'result', requestId: request.requestId, meshes, poseMatrices,
      detectorMemory: {
        beforeBytes,
        afterBytes,
        deltaBytes: beforeBytes === null || afterBytes === null ? null : afterBytes - beforeBytes
      }
    } satisfies FaceWarpDetectionResponse);
  } catch (error) {
    request.image.close();
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error)
    } satisfies FaceWarpDetectionResponse);
  }
};
