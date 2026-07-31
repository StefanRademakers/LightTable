import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentAssetId } from '../document/documentTypes';
import type { NativeDecodedImage } from '../../image-io/types';
import { PatternAssetLoader } from './PatternAssetLoader';

const patternId = 'pattern-1' as DocumentAssetId;

const texture = () => ({
  createView: vi.fn(() => ({})),
  destroy: vi.fn()
}) as unknown as GPUTexture;

const decodedImage = () => ({
  bitmap: { width: 8, height: 4 },
  close: vi.fn()
}) as unknown as NativeDecodedImage;

const harness = (
  decodeImage: (source: Blob) => Promise<NativeDecodedImage>,
  generation: () => number,
  onSubmittedWorkDone: () => Promise<void> = () => Promise.resolve()
) => {
  const encoded = texture();
  const target = texture();
  const createTexture = vi.fn()
    .mockReturnValueOnce(encoded)
    .mockReturnValueOnce(target);
  const store = { set: vi.fn() };
  const invalidateStyledLayers = vi.fn();
  const drawFullscreen = vi.fn();
  const submit = vi.fn();
  const loader = new PatternAssetLoader({
    device: {
      createTexture,
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => ({ finish: () => 'commands' })),
      queue: {
        copyExternalImageToTexture: vi.fn(),
        submit,
        onSubmittedWorkDone
      }
    } as unknown as GPUDevice,
    sampler: {} as GPUSampler,
    decodePipeline: {
      getBindGroupLayout: vi.fn(() => ({}))
    } as unknown as GPURenderPipeline,
    store: store as never,
    generation,
    invalidateStyledLayers,
    drawFullscreen,
    decodeImage
  });
  return {
    loader,
    encoded,
    target,
    createTexture,
    store,
    invalidateStyledLayers,
    drawFullscreen,
    submit
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PatternAssetLoader', () => {
  it('publishes a decoded pattern atomically and transfers target ownership', async () => {
    vi.stubGlobal('GPUTextureUsage', {
      TEXTURE_BINDING: 1,
      RENDER_ATTACHMENT: 2,
      COPY_SRC: 4,
      COPY_DST: 8
    });
    const decoded = decodedImage();
    const source = new Blob(['pattern']);
    const test = harness(async () => decoded, () => 1);

    await test.loader.load({ patternId, source });

    expect(test.invalidateStyledLayers).toHaveBeenCalledOnce();
    expect(test.drawFullscreen).toHaveBeenCalledOnce();
    expect(test.submit).toHaveBeenCalledOnce();
    expect(test.store.set).toHaveBeenCalledWith(patternId, source, test.target);
    expect(test.encoded.destroy).toHaveBeenCalledOnce();
    expect(test.target.destroy).not.toHaveBeenCalled();
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it('rejects stale decoded assets before allocating or publishing GPU state', async () => {
    let resolveDecode!: (value: NativeDecodedImage) => void;
    const decoded = decodedImage();
    const pendingDecode = new Promise<NativeDecodedImage>((resolve) => {
      resolveDecode = resolve;
    });
    let activeGeneration = 1;
    const test = harness(() => pendingDecode, () => activeGeneration);
    const loading = test.loader.load({
      patternId,
      source: new Blob(['pattern'])
    });

    activeGeneration = 2;
    resolveDecode(decoded);

    await expect(loading).rejects.toThrow(
      'LightTable was closed while restoring its patterns.'
    );
    expect(test.createTexture).not.toHaveBeenCalled();
    expect(test.store.set).not.toHaveBeenCalled();
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it('does not publish a pattern when the document changes during submission', async () => {
    vi.stubGlobal('GPUTextureUsage', {
      TEXTURE_BINDING: 1,
      RENDER_ATTACHMENT: 2,
      COPY_SRC: 4,
      COPY_DST: 8
    });
    const decoded = decodedImage();
    let activeGeneration = 1;
    let completeSubmission!: () => void;
    const test = harness(
      async () => decoded,
      () => activeGeneration,
      () => new Promise<void>((resolve) => {
        completeSubmission = resolve;
      })
    );
    const loading = test.loader.load({
      patternId,
      source: new Blob(['pattern'])
    });

    await Promise.resolve();
    activeGeneration = 2;
    completeSubmission();

    await expect(loading).rejects.toThrow(
      'LightTable was closed while restoring its patterns.'
    );
    expect(test.store.set).not.toHaveBeenCalled();
    expect(test.target.destroy).toHaveBeenCalledOnce();
    expect(decoded.close).toHaveBeenCalledOnce();
  });
});
