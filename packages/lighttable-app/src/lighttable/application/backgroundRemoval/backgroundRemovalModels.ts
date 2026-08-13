export interface BackgroundRemovalModelProfile {
  readonly id: string;
  readonly modelId: string;
  readonly revision: string;
  readonly artifactSha256: string;
  readonly license: 'MIT';
  readonly inputSize: 1024;
  readonly production: boolean;
}

/**
 * The revision and FP16 artifact digest are pinned so a cache refresh cannot
 * silently replace the model used by a released LightTable build.
 */
export const BEN2_BASE_PROFILE: BackgroundRemovalModelProfile = {
  id: 'ben2-base',
  modelId: 'onnx-community/BEN2-ONNX',
  revision: 'c552aa82688edce09f0ac9d2e31ad53d9d629010',
  artifactSha256: 'dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1',
  license: 'MIT',
  inputSize: 1024,
  production: true
};

/** Benchmark-only alternate behind the same product boundary. */
export const BIREFNET_LITE_BENCHMARK_PROFILE: BackgroundRemovalModelProfile = {
  id: 'birefnet-lite-benchmark',
  modelId: 'onnx-community/BiRefNet_lite-ONNX',
  revision: 'main',
  artifactSha256: 'benchmark-artifact-must-be-pinned-before-production',
  license: 'MIT',
  inputSize: 1024,
  production: false
};
