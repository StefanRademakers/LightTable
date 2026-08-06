import { describe, expect, it } from 'vitest';
import { classifyWebGpuSupport, type WebGpuLimitSnapshot } from './webGpuSupportTier';

const limits = (overrides: Partial<WebGpuLimitSnapshot> = {}): WebGpuLimitSnapshot => ({
  maxTextureDimension2D: 8192,
  maxBufferSize: 256 * 1024 * 1024,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxComputeWorkgroupStorageSize: 32 * 1024,
  ...overrides
});

describe('classifyWebGpuSupport', () => {
  it('refuses adapters below a required renderer limit', () => {
    expect(classifyWebGpuSupport(limits({ maxTextureDimension2D: 4096 })).id).toBe('below-floor');
    expect(classifyWebGpuSupport(limits({ maxBufferSize: 128 * 1024 * 1024 })).id).toBe('below-floor');
  });

  it('separates candidate minimum and recommended capability without claiming physical qualification', () => {
    expect(classifyWebGpuSupport(limits()).id).toBe('candidate-minimum');
    expect(classifyWebGpuSupport(limits({
      maxTextureDimension2D: 16384, maxBufferSize: 1024 * 1024 * 1024
    }))).toMatchObject({ id: 'candidate-recommended', action: expect.stringContaining('physical-device') });
  });
});
