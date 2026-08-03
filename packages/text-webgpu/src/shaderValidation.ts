import { COVERAGE_ATLAS_WGSL } from './coverageShader';
import { HB_GPU_DRAW_WGSL, HB_GPU_SOURCE_REVISION } from './hbGpuShader.generated';

export interface TextShaderValidationResult {
  readonly candidate: 'coverage-atlas' | 'hb-gpu';
  readonly validated: boolean;
  readonly sourceRevision?: string;
  readonly messages: readonly string[];
}

const coveragePipeline = (device: GPUDevice, module: GPUShaderModule) => device.createRenderPipeline({
  layout: 'auto',
  vertex: { module, entryPoint: 'coverageVertex' },
  fragment: { module, entryPoint: 'coverageFragment', targets: [{ format: 'rgba8unorm' }] },
  primitive: { topology: 'triangle-list' }
});

const hbGpuPipeline = (device: GPUDevice, module: GPUShaderModule) => device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module,
    entryPoint: 'lighttable_hb_gpu_vertex',
    buffers: [{
      arrayStride: 32,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x2' },
        { shaderLocation: 2, offset: 16, format: 'float32x2' },
        { shaderLocation: 3, offset: 24, format: 'float32' },
        { shaderLocation: 4, offset: 28, format: 'uint32' }
      ]
    }]
  },
  fragment: { module, entryPoint: 'lighttable_hb_gpu_fragment', targets: [{ format: 'rgba8unorm' }] },
  primitive: { topology: 'triangle-list' }
});

const compile = async (
  device: GPUDevice,
  candidate: TextShaderValidationResult['candidate'],
  code: string,
  createPipeline: (device: GPUDevice, module: GPUShaderModule) => GPURenderPipeline,
  sourceRevision?: string
): Promise<TextShaderValidationResult> => {
  device.pushErrorScope('validation');
  const messages: string[] = [];
  try {
    const module = device.createShaderModule({ label: `LightTable ${candidate} bakeoff shader`, code });
    const info = await module.getCompilationInfo();
    messages.push(...info.messages.map(
      (message) => `${message.type}:${message.lineNum}:${message.linePos} ${message.message}`
    ));
    if (!info.messages.some((message) => message.type === 'error')) createPipeline(device, module);
  } catch (reason) {
    messages.push(reason instanceof Error ? reason.message : 'Pipeline creation failed.');
  }
  const error = await device.popErrorScope();
  if (error) messages.push(`validation: ${error.message}`);
  return {
    candidate,
    validated: messages.every((message) => !/^(?:error|validation:)/i.test(message)),
    sourceRevision,
    messages
  };
};

export const validateTextBakeoffShaders = async (device: GPUDevice) => Promise.all([
  compile(device, 'coverage-atlas', COVERAGE_ATLAS_WGSL, coveragePipeline),
  compile(device, 'hb-gpu', HB_GPU_DRAW_WGSL, hbGpuPipeline, HB_GPU_SOURCE_REVISION)
]);
