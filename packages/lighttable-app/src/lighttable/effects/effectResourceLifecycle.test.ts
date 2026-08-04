import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromaticAberrationEffect } from './chromaticAberration/ChromaticAberrationEffect';
import { createDefaultChromaticAberrationSettings } from './chromaticAberration/settings';
import { GrainEffect } from './grain/GrainEffect';
import { createDefaultGrainSettings } from './grain/settings';
import { HalationEffect } from './halation/HalationEffect';
import { createDefaultHalationSettings } from './halation/settings';
import { LensDistortionEffect } from './lensDistortion/LensDistortionEffect';
import { createDefaultLensDistortionSettings } from './lensDistortion/settings';

const texture = () => ({ createView: vi.fn(() => ({})), destroy: vi.fn() });
const pipeline = () => ({ getBindGroupLayout: vi.fn(() => ({})) });

const harness = () => {
  const createTexture = vi.fn(texture);
  const pass = {
    setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn()
  };
  const device = {
    queue: { writeBuffer: vi.fn() },
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipelineAsync: vi.fn(async () => pipeline()),
    createTexture,
    createBindGroup: vi.fn(() => ({}))
  } as unknown as GPUDevice;
  const encoder = { beginRenderPass: vi.fn(() => pass) } as unknown as GPUCommandEncoder;
  return { device, encoder, createTexture };
};

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
});

describe('optional effect image resource lifecycle', () => {
  it.each([
    ['Lens Distortion', (test: ReturnType<typeof harness>) => {
      const settings = { ...createDefaultLensDistortionSettings(), enabled: true };
      return new LensDistortionEffect(test.device, {} as GPUSampler, {} as GPUShaderModule, settings);
    }, 1],
    ['Chromatic Aberration', (test: ReturnType<typeof harness>) => {
      const settings = { ...createDefaultChromaticAberrationSettings(), enabled: true };
      return new ChromaticAberrationEffect(test.device, {} as GPUSampler, {} as GPUShaderModule, settings);
    }, 1],
    ['Halation', (test: ReturnType<typeof harness>) => {
      const settings = { ...createDefaultHalationSettings(), enabled: true };
      return new HalationEffect(test.device, {} as GPUSampler, {} as GPUShaderModule, settings);
    }, 3],
    ['Grain', (test: ReturnType<typeof harness>) => {
      const settings = { ...createDefaultGrainSettings(), enabled: true };
      return new GrainEffect(test.device, {} as GPUSampler, {} as GPUShaderModule, settings);
    }, 3]
  ])('%s retains settings but defers textures until its first encode', async (_name, create, textureCount) => {
    const test = harness();
    const effect = create(test);

    effect.resize(640, 360);
    expect(test.createTexture).not.toHaveBeenCalled();
    expect(effect.estimatedTextureBytes()).toBe(0);

    const input = texture() as unknown as GPUTexture;
    expect(effect.encode(test.encoder, input)).toBe(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Pipeline readiness requests another frame, but compiling alone must not
    // allocate document-sized image resources.
    expect(test.createTexture).not.toHaveBeenCalled();

    expect(effect.encode(test.encoder, input)).not.toBe(input);
    expect(test.createTexture).toHaveBeenCalledTimes(textureCount);
    expect(effect.estimatedTextureBytes()).toBeGreaterThan(0);
  });
});
