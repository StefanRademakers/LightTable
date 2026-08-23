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
  readonly uploadedClips: number;
  readonly profile: VelloPaintSceneRenderProfile;
}

export type VelloPaintSceneProfilePhase =
  | 'cache-lookup-invalidation'
  | 'js-object-construction'
  | 'json-stringify'
  | 'js-wasm-roundtrip'
  | 'js-wasm-transfer-estimate'
  | 'rust-deserialization'
  | 'rust-fragment-encoding'
  | 'rust-scene-synchronization'
  | 'vello-scene-preparation'
  | 'vello-render-submit-cpu';

export interface VelloPaintSceneRenderProfile {
  readonly phasesMs: Readonly<Partial<Record<VelloPaintSceneProfilePhase, number>>>;
  /** Timestamp queries are reported separately; a synchronous WASM call is not GPU execution. */
  readonly actualGpuRenderMs: number | null;
}

interface RustIncrementalProfile {
  readonly totalMs: number;
  readonly deserializationMs: number;
  readonly fragmentEncodingMs: number;
  readonly sceneSynchronizationMs: number;
  readonly scenePreparationMs: number;
  readonly velloRenderSubmitCpuMs: number;
  readonly actualGpuRenderMs: number | null;
}

interface SyncedScene {
  readonly fragmentRevisions: ReadonlyMap<string, string>;
  readonly clipRevisions: ReadonlyMap<string, string>;
  readonly composition: string;
}

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
    if (this.runtime.released) {
      throw new Error('The Vello WebGPU runtime was released after device loss.');
    }
    assertPaintSceneIsValid(scene);
    const cacheStartedAt = performance.now();
    // Rust owns the bounded retained-scene cache and can evict a source while
    // this backend still has its revision index. Never send a delta against a
    // native scene that no longer exists: rehydrate it from the canonical
    // PaintScene instead.
    const nativeSourceExists = typeof this.runtime.bridge.has_paint_scene_source !== 'function'
      || this.runtime.bridge.has_paint_scene_source(sourceKey);
    if (!nativeSourceExists) this.syncedScenes.delete(sourceKey);
    const previous = nativeSourceExists ? this.syncedScenes.get(sourceKey) : undefined;
    const fragmentRevisions = new Map(scene.fragments.map(fragment => [
      fragment.stableId, fragment.revisionKey
    ]));
    const clipRevisions = new Map(scene.clips.map(clip => [clip.stableId, clip.revisionKey]));
    const composition = JSON.stringify(scene.composition);
    const upserts = scene.fragments.filter(fragment =>
      previous?.fragmentRevisions.get(fragment.stableId) !== fragment.revisionKey
    );
    const removals = previous
      ? [...previous.fragmentRevisions.keys()].filter(stableId => !fragmentRevisions.has(stableId))
      : [];
    const clipUpserts = scene.clips.filter(clip =>
      previous?.clipRevisions.get(clip.stableId) !== clip.revisionKey
    );
    const clipRemovals = previous
      ? [...previous.clipRevisions.keys()].filter(stableId => !clipRevisions.has(stableId))
      : [];
    const cacheLookupInvalidationMs = performance.now() - cacheStartedAt;
    const objectStartedAt = performance.now();
    const update = {
      sourceRevision: scene.sourceRevision,
      composition: !previous || previous.composition !== composition
        ? scene.composition
        : undefined,
      upserts,
      removals,
      clipUpserts,
      clipRemovals
    };
    const jsObjectConstructionMs = performance.now() - objectStartedAt;
    const stringifyStartedAt = performance.now();
    const updateJson = JSON.stringify(update);
    const jsonStringifyMs = performance.now() - stringifyStartedAt;
    const wasmStartedAt = performance.now();
    const sceneCacheHit = this.runtime.bridge.render_incremental_paint_scene_texture(
      surface.texture,
      surface.width,
      surface.height,
      sourceKey,
      updateJson
    );
    const jsWasmRoundtripMs = performance.now() - wasmStartedAt;
    const rustProfile = typeof this.runtime.bridge.incremental_profile_json === 'function'
      ? JSON.parse(this.runtime.bridge.incremental_profile_json()) as RustIncrementalProfile
      : {
          totalMs: jsWasmRoundtripMs,
          deserializationMs: 0,
          fragmentEncodingMs: 0,
          sceneSynchronizationMs: 0,
          scenePreparationMs: 0,
          velloRenderSubmitCpuMs: jsWasmRoundtripMs,
          actualGpuRenderMs: null
        };
    this.syncedScenes.set(sourceKey, { fragmentRevisions, clipRevisions, composition });
    return {
      sceneCacheHit,
      compiledSceneEntries: this.runtime.bridge.scene_cache_entries(),
      uploadedFragments: upserts.length,
      uploadedClips: clipUpserts.length,
      profile: {
        phasesMs: {
          'cache-lookup-invalidation': cacheLookupInvalidationMs,
          'js-object-construction': jsObjectConstructionMs,
          'json-stringify': jsonStringifyMs,
          'js-wasm-roundtrip': jsWasmRoundtripMs,
          'js-wasm-transfer-estimate': Math.max(0, jsWasmRoundtripMs - rustProfile.totalMs),
          'rust-deserialization': rustProfile.deserializationMs,
          'rust-fragment-encoding': rustProfile.fragmentEncodingMs,
          'rust-scene-synchronization': rustProfile.sceneSynchronizationMs,
          'vello-scene-preparation': rustProfile.scenePreparationMs,
          'vello-render-submit-cpu': rustProfile.velloRenderSubmitCpuMs
        },
        actualGpuRenderMs: rustProfile.actualGpuRenderMs
      }
    };
  }

  releaseSource(sourceKey: string): number {
    this.syncedScenes.delete(sourceKey);
    if (this.runtime.released) return 0;
    this.runtime.bridge.release_paint_scene_source(sourceKey);
    return this.runtime.bridge.scene_cache_entries();
  }

  sceneEntries(): number {
    return this.runtime.released ? 0 : this.runtime.bridge.scene_cache_entries();
  }
}
