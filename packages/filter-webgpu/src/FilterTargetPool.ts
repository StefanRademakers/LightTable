/**
 * Small document-sized target pool shared by filter executors.
 *
 * A filter may never render into a texture sampled by the same pass. Three
 * targets are sufficient for a two-pass operation even when its input already
 * belongs to this pool. Allocation is document-size keyed and never occurs on
 * slider updates.
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

  private ensureTargets(): void {
    if (this.targets.length === this.targetCount) return;
    if (this.width < 1 || this.height < 1) {
      throw new Error('Filter target pool is not configured.');
    }
    this.targets = Array.from({ length: this.targetCount }, (_, index) => this.device.createTexture({
      label: `LightTable filter target ${index + 1}`,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    }));
  }

  acquire(excluded: readonly GPUTexture[]): GPUTexture {
    this.ensureTargets();
    const target = this.targets.find((candidate) => !excluded.includes(candidate));
    if (!target) throw new Error('Filter target pool has no alias-safe render target.');
    return target;
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
