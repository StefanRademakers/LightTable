export interface RenderTargetPairOptions {
  createTexture: (label: string) => GPUTexture;
  firstLabel: string;
  secondLabel: string;
}

/**
 * Owns a lazily allocated ping-pong texture pair for one render stage.
 */
export class RenderTargetPair {
  private firstTarget: GPUTexture | null = null;
  private secondTarget: GPUTexture | null = null;

  constructor(private readonly options: RenderTargetPairOptions) {}

  ensureSingle(): GPUTexture {
    this.firstTarget ??= this.options.createTexture(this.options.firstLabel);
    return this.firstTarget;
  }

  ensure(): readonly [GPUTexture, GPUTexture] {
    const first = this.ensureSingle();
    this.secondTarget ??= this.options.createTexture(this.options.secondLabel);
    return [first, this.secondTarget];
  }

  estimatedTextureBytes(width: number, height: number, bytesPerPixel: number) {
    const targetCount = Number(Boolean(this.firstTarget)) + Number(Boolean(this.secondTarget));
    return Math.max(1, width) * Math.max(1, height) * bytesPerPixel * targetCount;
  }

  destroy() {
    this.firstTarget?.destroy();
    this.secondTarget?.destroy();
    this.firstTarget = null;
    this.secondTarget = null;
  }
}
