import { describe, expect, it, vi } from 'vitest';
import { DocumentEffectRuntime, type DocumentEffectSet } from './DocumentEffectRuntime';

const texture = (name: string) => ({ name }) as unknown as GPUTexture;

const effect = (id: string) => ({
  encode: vi.fn((_encoder: GPUCommandEncoder, input: GPUTexture) =>
    texture(`${(input as unknown as { name: string }).name}>${id}`)),
  resize: vi.fn(),
  destroyImageResources: vi.fn(),
  destroy: vi.fn(),
  estimatedTextureBytes: vi.fn(() => 10),
  setSettings: vi.fn()
});

const createRuntime = () => {
  const grain = effect('grain');
  const halation = effect('halation');
  const chromaticAberration = effect('chromatic');
  const lensDistortion = effect('distortion');
  const lensBlur = {
    ...effect('lens-blur'),
    setDistortionSettings: vi.fn(),
    setDepthMap: vi.fn(),
    setInteractionActive: vi.fn(),
    setDepthVisualization: vi.fn(),
    hasDepth: true
  };
  const effects = {
    grain,
    halation,
    chromaticAberration,
    lensDistortion,
    lensBlur
  } as unknown as DocumentEffectSet;
  return { runtime: new DocumentEffectRuntime(effects), effects };
};

describe('DocumentEffectRuntime', () => {
  it('evaluates source geometry in the declared order', () => {
    const { runtime } = createRuntime();
    const result = runtime.encodeSourceGeometry({} as GPUCommandEncoder, texture('source'));
    expect((result as unknown as { name: string }).name).toBe('source>distortion>chromatic');
  });

  it('keeps depth visualization free of halation and display grain', () => {
    const { runtime, effects } = createRuntime();
    const linear = runtime.encodeLinearSpatial(
      {} as GPUCommandEncoder,
      texture('grade'),
      { visualizeDepth: true }
    );
    const display = runtime.encodeDisplayPost({} as GPUCommandEncoder, linear, true);

    expect((display as unknown as { name: string }).name).toBe('grade>lens-blur');
    expect(effects.halation.encode).not.toHaveBeenCalled();
    expect(effects.grain.encode).not.toHaveBeenCalled();
  });

  it('owns aggregate lifecycle and memory accounting', () => {
    const { runtime, effects } = createRuntime();
    runtime.resize(1920, 1080);
    expect(runtime.estimatedTextureBytes()).toBe(50);
    runtime.destroyImageResources();
    runtime.destroy();

    Object.values(effects).forEach((current) => {
      expect(current.resize).toHaveBeenCalledWith(1920, 1080);
      expect(current.destroyImageResources).toHaveBeenCalledOnce();
      expect(current.destroy).toHaveBeenCalledOnce();
    });
  });
});
