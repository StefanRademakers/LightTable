export interface WebGpuLimitSnapshot {
  readonly maxTextureDimension2D: number;
  readonly maxBufferSize: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxComputeWorkgroupStorageSize: number;
}

export type WebGpuSupportTierId = 'below-floor' | 'candidate-minimum' | 'candidate-recommended';

export interface WebGpuSupportTier {
  readonly id: WebGpuSupportTierId;
  readonly label: string;
  readonly action: string;
}

export const REQUIRED_WEBGPU_LIMITS = {
  maxTextureDimension2D: 8192,
  maxBufferSize: 256 * 1024 * 1024
} as const;

export const snapshotWebGpuLimits = (limits: GPUSupportedLimits): WebGpuLimitSnapshot => ({
  maxTextureDimension2D: limits.maxTextureDimension2D,
  maxBufferSize: limits.maxBufferSize,
  maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
  maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize
});

export const classifyWebGpuSupport = (limits: WebGpuLimitSnapshot): WebGpuSupportTier => {
  if (limits.maxTextureDimension2D < REQUIRED_WEBGPU_LIMITS.maxTextureDimension2D
    || limits.maxBufferSize < REQUIRED_WEBGPU_LIMITS.maxBufferSize) {
    return {
      id: 'below-floor',
      label: 'Below the required WebGPU capability',
      action: 'Update the GPU driver or use a device that supports 8192 px textures and 256 MiB buffers.'
    };
  }
  if (limits.maxTextureDimension2D >= 16384 && limits.maxBufferSize >= 1024 * 1024 * 1024) {
    return {
      id: 'candidate-recommended',
      label: 'Recommended WebGPU capability',
      action: 'Large layered documents still require a measured physical-device qualification.'
    };
  }
  return {
    id: 'candidate-minimum',
    label: 'Minimum WebGPU capability',
    action: 'Use recommended hardware for large layered documents and high-resolution effects.'
  };
};
