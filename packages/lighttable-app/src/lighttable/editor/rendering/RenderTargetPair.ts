export interface RenderTargetPairOptions {
  createTexture: (label: string) => GPUTexture;
  firstLabel: string;
  secondLabel: string;
}

/**
 * Owns a lazily allocated ping-pong texture pair for one render stage.
 */
export class RenderTargetPair {
  private targets: readonly [GPUTexture, GPUTexture] | null = null;

  constructor(private readonly options: RenderTargetPairOptions) {}

  ensure(): readonly [GPUTexture, GPUTexture] {
    this.targets ??= [
      this.options.createTexture(this.options.firstLabel),
      this.options.createTexture(this.options.secondLabel)
    ];
    return this.targets;
  }

  estimatedTextureBytes(width: number, height: number, bytesPerPixel: number) {
    return this.targets
      ? Math.max(1, width) * Math.max(1, height) * bytesPerPixel * 2
      : 0;
  }

  destroy() {
    if (!this.targets) return;
    this.targets[0].destroy();
    this.targets[1].destroy();
    this.targets = null;
  }
}
