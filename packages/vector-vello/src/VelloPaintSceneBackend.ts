import type { PaintScene } from '@lighttable/paint-scene';
import { activeVelloWebGpuRuntime, type VelloRuntime } from './velloRuntime';

export interface VelloPaintSceneSurface {
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  readonly estimatedBytes: number;
  dispose(): void;
}

export interface VelloPaintSceneRenderMetrics {
  readonly sceneCacheHit: boolean;
  readonly compiledSceneEntries: number;
}

/**
 * Thin zero-copy consumer for LightTable's shared immutable paint scene.
 * The WASM runtime submits Vello work on the exact GPUDevice used by the app;
 * the target remains a JavaScript-owned texture sampled by the compositor.
 */
export class VelloPaintSceneBackend {
  private readonly runtime;

  constructor(private readonly device: GPUDevice, runtime?: VelloRuntime) {
    this.runtime = runtime ?? activeVelloWebGpuRuntime(device);
  }

  createSurface(width: number, height: number, label: string): VelloPaintSceneSurface {
    const texture = this.device.createTexture({
      label,
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.STORAGE_BINDING
    });
    let disposed = false;
    return {
      texture,
      width,
      height,
      estimatedBytes: width * height * 4,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        texture.destroy();
      }
    };
  }

  render(
    surface: VelloPaintSceneSurface,
    scene: PaintScene,
    sceneKey = `${scene.sourceId}:${scene.sourceRevision}`
  ): VelloPaintSceneRenderMetrics {
    const sceneCacheHit = this.runtime.bridge.render_paint_scene_texture(
      surface.texture,
      surface.width,
      surface.height,
      sceneKey,
      JSON.stringify(scene)
    );
    return {
      sceneCacheHit,
      compiledSceneEntries: this.runtime.bridge.scene_cache_entries()
    };
  }
}
