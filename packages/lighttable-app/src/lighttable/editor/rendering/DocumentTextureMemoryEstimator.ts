import type { DocumentDimensions } from './DocumentResourceState';

export interface DocumentTextureMemoryContext extends DocumentDimensions {
  pixels: number;
  rgba16Bytes: number;
  coverage16Bytes: number;
}

export interface DocumentTextureMemoryEstimatorOptions {
  dimensions: () => DocumentDimensions;
  sources: readonly ((context: DocumentTextureMemoryContext) => number)[];
}

/**
 * Aggregates estimates for LightTable-owned GPU textures.
 *
 * Browsers do not expose driver VRAM usage, so every resource owner contributes
 * its own deterministic estimate without leaking that ownership into the
 * renderer facade.
 */
export class DocumentTextureMemoryEstimator {
  constructor(private readonly options: DocumentTextureMemoryEstimatorOptions) {}

  estimate() {
    const { width, height } = this.options.dimensions();
    const pixels = Math.max(1, width) * Math.max(1, height);
    const context: DocumentTextureMemoryContext = {
      width,
      height,
      pixels,
      rgba16Bytes: pixels * 8,
      coverage16Bytes: pixels * 2
    };
    return this.options.sources.reduce(
      (total, source) => total + source(context),
      0
    );
  }
}
