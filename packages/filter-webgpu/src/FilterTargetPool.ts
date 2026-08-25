/**
 * Small document-sized target pool shared by filter executors.
 *
 * A filter may never render into a texture sampled by the same pass. Three
 * targets are sufficient for a two-pass operation even when its input already
 * belongs to this pool. Targets are allocated lazily up to that ceiling,
 * document-size keyed, and never allocated on slider updates after warm-up.
 */
export class FilterTargetPool {
  private targets: GPUTexture[] = [];
  private width = 0;
  private height = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly targetCount = 3
  ) {
    if (!Number.isInteger(targetCount) || targetCount < 1) {
      throw new RangeError('Filter target count must be a positive integer.');
    }
  }

  configure(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.destroy();
    this.width = width;
    this.height = height;
  }

  private createTarget(): GPUTexture {
    if (this.width < 1 || this.height < 1) {
      throw new Error('Filter target pool is not configured.');
    }
    const target = this.device.createTexture({
      label: `LightTable filter target ${this.targets.length + 1}`,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
    this.targets.push(target);
    return target;
  }

  acquire(excluded: readonly GPUTexture[]): GPUTexture {
    const target = this.targets.find((candidate) => !excluded.includes(candidate));
    if (target) return target;
    if (this.targets.length < this.targetCount) return this.createTarget();
    throw new Error('Filter target pool has no alias-safe render target.');
  }

  estimatedTextureBytes(): number {
    return this.targets.length * this.width * this.height * 8;
  }

  destroy(): void {
    for (const target of this.targets) target.destroy();
    this.targets = [];
    this.width = 0;
    this.height = 0;
  }
}
