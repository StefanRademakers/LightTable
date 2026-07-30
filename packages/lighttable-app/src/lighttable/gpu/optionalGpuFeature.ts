export type OptionalGpuFeatureStatus = 'idle' | 'compiling' | 'ready' | 'failed' | 'disposed';

export interface OptionalGpuFeatureOptions<Resource> {
  readonly id: string;
  readonly compile: () => Promise<Resource>;
  readonly onReady?: () => void;
  readonly onError?: (message: string) => void;
}

/**
 * Publishes optional GPU resources atomically.
 *
 * Feature shaders compile asynchronously and the renderer keeps using the
 * feature's exact bypass until the complete resource bundle is valid. A failed
 * optional shader therefore cannot put an invalid pipeline in a command buffer
 * or prevent the required image path from rendering.
 */
export class OptionalGpuFeature<Resource> {
  private statusValue: OptionalGpuFeatureStatus = 'idle';
  private resourceValue: Resource | null = null;
  private failureValue: string | null = null;
  private generation = 0;
  private pending: Promise<Resource | null> | null = null;

  constructor(private readonly options: OptionalGpuFeatureOptions<Resource>) {}

  get status(): OptionalGpuFeatureStatus {
    return this.statusValue;
  }

  get resource(): Resource | null {
    return this.resourceValue;
  }

  get failure(): string | null {
    return this.failureValue;
  }

  ensure(): Promise<Resource | null> {
    if (this.statusValue === 'ready') return Promise.resolve(this.resourceValue);
    if (this.statusValue === 'failed' || this.statusValue === 'disposed') return Promise.resolve(null);
    if (this.pending) return this.pending;

    const generation = ++this.generation;
    this.statusValue = 'compiling';
    this.pending = this.options.compile().then((resource) => {
      if (this.statusValue === 'disposed' || generation !== this.generation) return null;
      this.resourceValue = resource;
      this.failureValue = null;
      this.statusValue = 'ready';
      this.options.onReady?.();
      return resource;
    }).catch((reason: unknown) => {
      if (this.statusValue === 'disposed' || generation !== this.generation) return null;
      const detail = reason instanceof Error ? reason.message : String(reason);
      const message = `LightTable ${this.options.id} pipeline compilation failed: ${detail}`;
      this.resourceValue = null;
      this.failureValue = message;
      this.statusValue = 'failed';
      this.options.onError?.(message);
      return null;
    }).finally(() => {
      if (generation === this.generation) this.pending = null;
    });
    return this.pending;
  }

  retry(): Promise<Resource | null> {
    if (this.statusValue === 'disposed') return Promise.resolve(null);
    this.generation += 1;
    this.pending = null;
    this.resourceValue = null;
    this.failureValue = null;
    this.statusValue = 'idle';
    return this.ensure();
  }

  dispose(): void {
    this.generation += 1;
    this.pending = null;
    this.resourceValue = null;
    this.failureValue = null;
    this.statusValue = 'disposed';
  }
}
