/** Owns immutable export inputs from synchronous capture through asynchronous encoding. */
export class LayerAssetExportSnapshot {
  private readonly textures = new Set<GPUTexture>();
  private phase: 'capturing' | 'submitted' | 'disposed' = 'capturing';

  constructor(private readonly capture: (source: GPUTexture) => GPUTexture,
    private readonly submitCopies: () => void) {}

  submit(): void {
    if (this.phase !== 'capturing') throw new Error('Export snapshot capture is already closed.');
    if (this.textures.size) this.submitCopies();
    this.phase = 'submitted';
  }

  retain(source: GPUTexture): GPUTexture {
    if (this.phase !== 'capturing') throw new Error('Export snapshot capture is already closed.');
    const texture = this.capture(source);
    this.textures.add(texture);
    return texture;
  }

  release(texture: GPUTexture): void {
    if (this.textures.delete(texture)) texture.destroy();
  }

  dispose(): void {
    for (const texture of this.textures) texture.destroy();
    this.textures.clear();
    this.phase = 'disposed';
  }
}

export const createLayerAssetExportSnapshot = (device: GPUDevice): LayerAssetExportSnapshot => {
  let encoder: GPUCommandEncoder | null = null;
  return new LayerAssetExportSnapshot((source) => {
    encoder ??= device.createCommandEncoder({ label: 'LightTable immutable export capture' });
    const snapshot = device.createTexture({
      label: `LightTable export snapshot: ${source.label}`,
      size: [source.width, source.height, source.depthOrArrayLayers],
      format: source.format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
    });
    try {
      encoder.copyTextureToTexture({ texture: source }, { texture: snapshot },
        [source.width, source.height, source.depthOrArrayLayers]);
      return snapshot;
    } catch (error) {
      snapshot.destroy();
      throw error;
    }
  }, () => {
    if (!encoder) throw new Error('Export snapshot has no captured textures.');
    device.queue.submit([encoder.finish()]);
    encoder = null;
  });
};
