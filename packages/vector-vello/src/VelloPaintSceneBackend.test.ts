import { describe, expect, it, vi } from 'vitest';
import { PAINT_SCENE_SCHEMA_VERSION, type PaintScene } from '@lighttable/paint-scene';
import { VelloPaintSceneBackend } from './VelloPaintSceneBackend';
import type { VelloRuntime } from './velloRuntime';

const scene: PaintScene = {
  schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
  sourceId: 'fixture',
  sourceRevision: '7',
  fragments: []
};

describe('VelloPaintSceneBackend', () => {
  it('renders the immutable scene into the exact JavaScript-owned texture', () => {
    const render = vi.fn(() => true);
    const runtime = {
      bridge: {
        render_paint_scene_texture: render,
        scene_cache_entries: vi.fn(() => 3)
      }
    } as unknown as VelloRuntime;
    const device = {} as GPUDevice;
    const backend = new VelloPaintSceneBackend(device, runtime);
    const texture = {} as GPUTexture;

    expect(backend.render({
      texture, width: 320, height: 180, estimatedBytes: 230_400,
      dispose: vi.fn()
    }, scene)).toEqual({ sceneCacheHit: true, compiledSceneEntries: 3 });
    expect(render).toHaveBeenCalledWith(
      texture, 320, 180, 'fixture:7', JSON.stringify(scene)
    );
  });

  it('owns a bounded rgba8 zero-copy surface and destroys it idempotently', () => {
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4, STORAGE_BINDING: 8
    });
    const destroy = vi.fn();
    const createTexture = vi.fn(() => ({ destroy }));
    const runtime = { bridge: {} } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({ createTexture } as unknown as GPUDevice, runtime);

    const surface = backend.createSurface(64, 32, 'fixture');
    expect(surface.estimatedBytes).toBe(8_192);
    expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({
      format: 'rgba8unorm', size: [64, 32, 1], usage: 15
    }));
    surface.dispose();
    surface.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('passes a balanced clip stack to the native Vello encoder', () => {
    const render = vi.fn(() => false);
    const runtime = { bridge: {
      render_paint_scene_texture: render,
      scene_cache_entries: vi.fn(() => 1)
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    const clipped: PaintScene = {
      schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
      sourceId: 'clip', sourceRevision: '1',
      fragments: [{
        stableId: 'clipped', revisionKey: '1',
        paths: [{ stableId: 'outline', revisionKey: '1', commands: [] }],
        commands: [
          { kind: 'push-clip', pathId: 'outline', transform: [1, 0, 0, 1, 0, 0], fillRule: 'evenodd' },
          { kind: 'pop-clip' }
        ]
      }]
    };
    backend.render({
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    }, clipped);
    expect(render).toHaveBeenCalledWith(
      expect.anything(), 32, 32, 'clip:1', JSON.stringify(clipped)
    );
  });

  it('rejects an unbalanced clip stack before crossing the WASM boundary', () => {
    const render = vi.fn();
    const runtime = { bridge: {
      render_paint_scene_texture: render,
      scene_cache_entries: vi.fn()
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    expect(() => backend.render({
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    }, {
      schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
      sourceId: 'bad', sourceRevision: '1',
      fragments: [{ stableId: 'bad', revisionKey: '1', paths: [], commands: [{ kind: 'pop-clip' }] }]
    })).toThrow('empty clip stack');
    expect(render).not.toHaveBeenCalled();
  });
});
