import { assertPaintSceneIsValid, type PaintScene } from '@lighttable/paint-scene';
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
  readonly uploadedFragments: number;
}

interface SyncedScene {
  readonly revisions: ReadonlyMap<string, string>;
  readonly order: readonly string[];
}

const equalOrder = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Thin zero-copy consumer for LightTable's shared immutable paint scene.
 * The WASM runtime submits Vello work on the exact GPUDevice used by the app;
 * the target remains a JavaScript-owned texture sampled by the compositor.
 */
export class VelloPaintSceneBackend {
  private readonly runtime;
  private readonly syncedScenes = new Map<string, SyncedScene>();

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
    sourceKey = scene.sourceId
  ): VelloPaintSceneRenderMetrics {
    assertPaintSceneIsValid(scene);
    const previous = this.syncedScenes.get(sourceKey);
    const revisions = new Map(scene.fragments.map(fragment => [
      fragment.stableId, fragment.revisionKey
    ]));
    const order = scene.fragments.map(fragment => fragment.stableId);
    const upserts = scene.fragments.filter(fragment =>
      previous?.revisions.get(fragment.stableId) !== fragment.revisionKey
    );
    const removals = previous
      ? [...previous.revisions.keys()].filter(stableId => !revisions.has(stableId))
      : [];
    const update = {
      sourceRevision: scene.sourceRevision,
      order: !previous || !equalOrder(previous.order, order)
        ? scene.fragments.map(({ stableId }) => ({ stableId }))
        : undefined,
      upserts,
      removals
    };
    const sceneCacheHit = this.runtime.bridge.render_incremental_paint_scene_texture(
      surface.texture,
      surface.width,
      surface.height,
      sourceKey,
      JSON.stringify(update)
    );
    this.syncedScenes.set(sourceKey, { revisions, order });
    return {
      sceneCacheHit,
      compiledSceneEntries: this.runtime.bridge.scene_cache_entries(),
      uploadedFragments: upserts.length
    };
  }

  releaseSource(sourceKey: string): void {
    this.syncedScenes.delete(sourceKey);
    this.runtime.bridge.release_paint_scene_source(sourceKey);
  }
}
