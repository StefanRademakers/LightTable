/// <reference lib="webworker" />
import { FaceDetector, FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import modelUrl from '../../../assets/models/face-warp/face_landmarker.task?url';
import detectorModelUrl from '../../../assets/models/face-warp/blaze_face_short_range.tflite?url';
import type { FaceWarpDetectionRequest, FaceWarpDetectionResponse } from './faceWarpDetectorProtocol';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let detectorPromise: Promise<FaceDetector> | null = null;

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

const faceDetector = () => detectorPromise ??= FaceDetector.createFromOptions(
  { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
  {
    baseOptions: { modelAssetPath: detectorModelUrl, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.35
  }
);

self.onmessage = async (event: MessageEvent<FaceWarpDetectionRequest>) => {
  const request = event.data;
  try {
    const beforeBytes = workerHeapBytes();
    const [landmarkDetector, regionDetector] = await Promise.all([landmarker(), faceDetector()]);
    const regionResult = regionDetector.detect(request.image);
    const result = landmarkDetector.detect(request.image);
    const afterBytes = workerHeapBytes();
    request.image.close();
    const meshes = result.faceLandmarks.map((landmarks) => landmarks.map((point) => ({
      x: point.x * request.sourceWidth,
      y: point.y * request.sourceHeight,
      z: point.z * request.sourceWidth
    })));
    const poseMatrices = result.facialTransformationMatrixes.map(({ data }) => [...data]);
    const observations = regionResult.detections.map((detection) => ({
      score: detection.categories[0]?.score ?? 0,
      bounds: {
        x: detection.boundingBox?.originX ?? 0,
        y: detection.boundingBox?.originY ?? 0,
        width: detection.boundingBox?.width ?? 0,
        height: detection.boundingBox?.height ?? 0
      },
      keypoints: detection.keypoints.map((point) => ({
        x: point.x * request.sourceWidth,
        y: point.y * request.sourceHeight,
        ...(point.label ? { label: point.label } : {})
      }))
    }));
    self.postMessage({
      type: 'result', requestId: request.requestId, meshes, poseMatrices, observations,
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
