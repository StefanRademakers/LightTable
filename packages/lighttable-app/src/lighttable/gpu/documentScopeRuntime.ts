import type { LightTableImageMetadata } from '../types';
import type { DocumentRendererScopeCanvases } from '../application/rendering/rendererTypes';
import { WebGpuScopeEngine, type WebGpuScopeOptions } from './WebGpuScopeEngine';

interface ScopeTextures {
  readonly source: GPUTexture;
  readonly final: GPUTexture;
  readonly metadata: LightTableImageMetadata;
}

/**
 * Owns the optional scope engine and all state that may arrive before it.
 *
 * Scope compilation remains deferred from first-image rendering. Callers can
 * set document textures and view options immediately; initialization replays
 * the latest state atomically when the accessory panel becomes available.
 */
export class DocumentScopeRuntime {
  private engine: WebGpuScopeEngine | null = null;
  private initialization: Promise<void> | null = null;
  private options: WebGpuScopeOptions | null = null;
  private textures: ScopeTextures | null = null;
  private before = false;
  private interactionActive = false;
  private destroyed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly onError: ((message: string) => void) | undefined,
    private readonly onReady: () => void
  ) {}

  async initialize(canvases: DocumentRendererScopeCanvases): Promise<void> {
    if (this.destroyed || this.engine) return;
    if (this.initialization) return this.initialization;
    this.initialization = this.create(canvases);
    try {
      await this.initialization;
    } finally {
      this.initialization = null;
    }
  }

  setTextures(source: GPUTexture, final: GPUTexture, metadata: LightTableImageMetadata): void {
    this.textures = { source, final, metadata };
    this.engine?.setTextures(source, final, metadata);
  }

  clearTextures(): void {
    this.textures = null;
    this.engine?.clearTextures();
  }

  setBefore(before: boolean): void {
    this.before = before;
    this.engine?.setBefore(before);
  }

  setOptions(options: WebGpuScopeOptions): void {
    this.options = { ...options };
    this.engine?.setOptions(options);
  }

  setInteractionActive(active: boolean): void {
    this.interactionActive = active;
    this.engine?.setInteractionActive(active);
  }

  markImageDirty(): void {
    this.engine?.markImageDirty();
  }

  resize(): void {
    this.engine?.resize();
  }

  encode(encoder: GPUCommandEncoder): void {
    this.engine?.encode(encoder);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.engine?.destroy();
    this.engine = null;
    this.textures = null;
  }

  private async create(canvases: DocumentRendererScopeCanvases): Promise<void> {
    try {
      const engine = await WebGpuScopeEngine.create(this.device, canvases, this.onError);
      if (this.destroyed) {
        engine.destroy();
        return;
      }
      this.engine = engine;
      if (this.options) engine.setOptions(this.options);
      engine.setInteractionActive(this.interactionActive);
      engine.setBefore(this.before);
      if (this.textures) {
        engine.setTextures(
          this.textures.source,
          this.textures.final,
          this.textures.metadata
        );
      }
      engine.resize();
      this.onReady();
    } catch (reason) {
      this.onError?.(
        reason instanceof Error ? reason.message : 'LightTable scopes could not be initialized.'
      );
    }
  }
}
