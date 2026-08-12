/// <reference lib="webworker" />
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import modelUrl from '../../../assets/models/face-warp/face_landmarker.task?url';
import type { FaceWarpDetectionRequest, FaceWarpDetectionResponse } from './faceWarpDetectorProtocol';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

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
    const detector = await landmarker();
    const result = detector.detect(request.image);
    request.image.close();
    const meshes = result.faceLandmarks.map((landmarks) => landmarks.map((point) => ({
      x: point.x * request.sourceWidth,
      y: point.y * request.sourceHeight,
      z: point.z * request.sourceWidth
    })));
    const poseMatrices = result.facialTransformationMatrixes.map(({ data }) => [...data]);
    self.postMessage({
      type: 'result', requestId: request.requestId, meshes, poseMatrices
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
