import { describe, expect, it, vi } from 'vitest';
import { PAINT_SCENE_SCHEMA_VERSION, type PaintScene } from '@lighttable/paint-scene';
import { VelloPaintSceneBackend } from './VelloPaintSceneBackend';
import type { VelloRuntime } from './velloRuntime';

const scene: PaintScene = {
  schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
  sourceId: 'fixture',
  sourceRevision: '7',
  fragments: [],
  clips: [],
  composition: []
};

describe('VelloPaintSceneBackend', () => {
  it('renders the immutable scene into the exact JavaScript-owned texture', () => {
    const render = vi.fn(() => false);
    const runtime = {
      bridge: {
        render_incremental_paint_scene_texture: render,
        scene_cache_entries: vi.fn(() => 3)
      }
    } as unknown as VelloRuntime;
    const device = {} as GPUDevice;
    const backend = new VelloPaintSceneBackend(device, runtime);
    const texture = {} as GPUTexture;

    expect(backend.render({
      texture, width: 320, height: 180, estimatedBytes: 230_400,
      dispose: vi.fn()
    }, scene)).toMatchObject({
      sceneCacheHit: false, compiledSceneEntries: 3, uploadedFragments: 0, uploadedClips: 0
    });
    expect(render).toHaveBeenCalledWith(
      texture, 320, 180, 'fixture', JSON.stringify({
        sourceRevision: '7', composition: [], upserts: [], removals: [],
        clipUpserts: [], clipRemovals: []
      })
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
      render_incremental_paint_scene_texture: render,
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
      }],
      clips: [],
      composition: [{ kind: 'fragment', stableId: 'clipped' }]
    };
    backend.render({
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    }, clipped);
    expect(render).toHaveBeenCalledWith(
      expect.anything(), 32, 32, 'clip', JSON.stringify({
        sourceRevision: '1', composition: clipped.composition,
        upserts: clipped.fragments, removals: [], clipUpserts: [], clipRemovals: []
      })
    );
  });

  it('rejects an unbalanced clip stack before crossing the WASM boundary', () => {
    const render = vi.fn();
    const runtime = { bridge: {
      render_incremental_paint_scene_texture: render,
      scene_cache_entries: vi.fn()
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    expect(() => backend.render({
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    }, {
      schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
      sourceId: 'bad', sourceRevision: '1',
      fragments: [{ stableId: 'bad', revisionKey: '1', paths: [], commands: [{ kind: 'pop-clip' }] }],
      clips: [], composition: [{ kind: 'fragment', stableId: 'bad' }]
    })).toThrow('empty clip stack');
    expect(render).not.toHaveBeenCalled();
  });

  it('uploads only changed fragments after the initial scene sync', () => {
    const render = vi.fn(() => false);
    const runtime = { bridge: {
      render_incremental_paint_scene_texture: render,
      scene_cache_entries: vi.fn(() => 1)
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    const surface = {
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    };
    const first: PaintScene = { ...scene, fragments: [{
      stableId: 'a', revisionKey: '1', paths: [], commands: []
    }, {
      stableId: 'b', revisionKey: '1', paths: [], commands: []
    }], composition: [
      { kind: 'fragment', stableId: 'a' }, { kind: 'fragment', stableId: 'b' }
    ] };
    backend.render(surface, first);
    const changed: PaintScene = { ...first, sourceRevision: '8', fragments: [
      first.fragments[0], { ...first.fragments[1], revisionKey: '2' }
    ] };
    expect(backend.render(surface, changed).uploadedFragments).toBe(1);
    const calls = render.mock.calls as unknown as string[][];
    expect(JSON.parse(calls[1][4])).toEqual({
      sourceRevision: '8', upserts: [changed.fragments[1]], removals: [],
      clipUpserts: [], clipRemovals: []
    });
  });

  it('rehydrates a retained scene after the bounded Rust cache evicts it', () => {
    let nativeSourceExists = false;
    const render = vi.fn(() => false);
    const runtime = { bridge: {
      has_paint_scene_source: vi.fn(() => nativeSourceExists),
      render_incremental_paint_scene_texture: render,
      scene_cache_entries: vi.fn(() => 1)
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    const surface = {
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    };
    const retained: PaintScene = {
      ...scene,
      fragments: [{ stableId: 'a', revisionKey: '1', paths: [], commands: [] }],
      composition: [{ kind: 'fragment', stableId: 'a' }]
    };

    backend.render(surface, retained);
    nativeSourceExists = true;
    expect(backend.render(surface, retained).uploadedFragments).toBe(0);
    nativeSourceExists = false;
    expect(backend.render(surface, retained).uploadedFragments).toBe(1);

    const calls = render.mock.calls as unknown as string[][];
    expect(JSON.parse(calls[2][4])).toEqual({
      sourceRevision: '7', composition: retained.composition,
      upserts: retained.fragments, removals: [], clipUpserts: [], clipRemovals: []
    });
  });

  it('uploads clip resources independently from unchanged child fragments', () => {
    const render = vi.fn(() => false);
    const runtime = { bridge: {
      render_incremental_paint_scene_texture: render,
      scene_cache_entries: vi.fn(() => 1)
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    const surface = {
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    };
    const clipped: PaintScene = {
      ...scene,
      fragments: [{ stableId: 'child', revisionKey: '1', paths: [], commands: [] }],
      clips: [{
        stableId: 'mask', revisionKey: '1',
        path: { stableId: 'mask:path', revisionKey: '1', commands: [] },
        transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero'
      }],
      composition: [{
        kind: 'clip', stableId: 'mask', children: [{ kind: 'fragment', stableId: 'child' }]
      }]
    };
    expect(backend.render(surface, clipped)).toMatchObject({
      uploadedFragments: 1, uploadedClips: 1
    });
    const changed = {
      ...clipped, sourceRevision: '8',
      clips: [{ ...clipped.clips[0], revisionKey: '2', transform: [1, 0, 0, 1, 2, 0] as const }]
    };
    expect(backend.render(surface, changed)).toMatchObject({
      uploadedFragments: 0, uploadedClips: 1
    });
    const calls = render.mock.calls as unknown as string[][];
    expect(JSON.parse(calls[1][4])).toMatchObject({ upserts: [], clipUpserts: changed.clips });
  });

  it('mutates isolated opacity composition without re-uploading fragments', () => {
    const render = vi.fn(() => false);
    const runtime = { bridge: {
      render_incremental_paint_scene_texture: render,
      scene_cache_entries: vi.fn(() => 1)
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    const surface = {
      texture: {} as GPUTexture, width: 32, height: 32, estimatedBytes: 4096, dispose: vi.fn()
    };
    const fragment = { stableId: 'child', revisionKey: '1', paths: [], commands: [] };
    backend.render(surface, {
      ...scene, fragments: [fragment],
      composition: [{ kind: 'fragment', stableId: 'child' }]
    });
    const composition: PaintScene['composition'] = [{
      kind: 'opacity-group', opacity: 0.5,
      children: [{ kind: 'fragment', stableId: 'child' }]
    }];
    expect(backend.render(surface, {
      ...scene, sourceRevision: '8', fragments: [fragment], composition
    })).toMatchObject({ uploadedFragments: 0, uploadedClips: 0 });
    const calls = render.mock.calls as unknown as string[][];
    expect(JSON.parse(calls[1][4])).toEqual({
      sourceRevision: '8', composition, upserts: [], removals: [],
      clipUpserts: [], clipRemovals: []
    });
  });

  it('releases native fragment state with its source lifecycle', () => {
    const release = vi.fn();
    const runtime = { bridge: {
      render_incremental_paint_scene_texture: vi.fn(() => false),
      scene_cache_entries: vi.fn(() => 1),
      release_paint_scene_source: release
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    backend.releaseSource('layer-7');
    expect(release).toHaveBeenCalledWith('layer-7');
  });

  it('keeps teardown idempotent after the shared runtime was released', () => {
    const release = vi.fn();
    const runtime = { released: true, bridge: {
      release_paint_scene_source: release
    } } as unknown as VelloRuntime;
    const backend = new VelloPaintSceneBackend({} as GPUDevice, runtime);
    backend.releaseSource('closed-document');
    expect(release).not.toHaveBeenCalled();
    expect(() => backend.render({
      texture: {} as GPUTexture, width: 1, height: 1, estimatedBytes: 4, dispose: vi.fn()
    }, scene)).toThrow('released after device loss');
  });
});
