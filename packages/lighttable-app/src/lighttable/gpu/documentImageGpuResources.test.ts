import { describe, expect, it, vi } from 'vitest';
import { DocumentImageGpuResources } from './documentImageGpuResources';

const destroyable = () => ({ destroy: vi.fn() });

describe('DocumentImageGpuResources', () => {
  it('destroys every owned image resource and clears derived bind groups', () => {
    const resources = new DocumentImageGpuResources();
    const source = destroyable();
    const output = destroyable();
    const histogram = destroyable();
    resources.sourceTexture = source as unknown as GPUTexture;
    resources.finalTexture = output as unknown as GPUTexture;
    resources.histogramBuffer = histogram as unknown as GPUBuffer;
    resources.blitOriginalBindGroup = {} as GPUBindGroup;
    resources.histogramCorrectedBindGroup = {} as GPUBindGroup;

    resources.reset();

    expect(source.destroy).toHaveBeenCalledOnce();
    expect(output.destroy).toHaveBeenCalledOnce();
    expect(histogram.destroy).toHaveBeenCalledOnce();
    expect(resources.sourceTexture).toBeNull();
    expect(resources.finalTexture).toBeNull();
    expect(resources.histogramBuffer).toBeNull();
    expect(resources.blitOriginalBindGroup).toBeNull();
    expect(resources.histogramCorrectedBindGroup).toBeNull();
  });

  it('destroys an aliased resource only once', () => {
    const resources = new DocumentImageGpuResources();
    const shared = destroyable();
    resources.correctedTexture = shared as unknown as GPUTexture;
    resources.finalTexture = shared as unknown as GPUTexture;

    resources.reset();

    expect(shared.destroy).toHaveBeenCalledOnce();
  });

  it('is idempotent across repeated reset calls', () => {
    const resources = new DocumentImageGpuResources();
    const source = destroyable();
    resources.sourceTexture = source as unknown as GPUTexture;

    resources.reset();
    resources.reset();

    expect(source.destroy).toHaveBeenCalledOnce();
  });
});
