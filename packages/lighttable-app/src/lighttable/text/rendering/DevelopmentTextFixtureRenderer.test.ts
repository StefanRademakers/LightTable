import { describe, expect, it, vi } from 'vitest';
import { TEXT_LAYOUT_SCHEMA_VERSION, type FontAssetRef, type RealizedTextLayout } from '@lighttable/text-core';
import { DevelopmentTextFixtureRenderer } from './DevelopmentTextFixtureRenderer';

const font: FontAssetRef = {
  assetId: 'fixture-font', faceIndex: 0,
  fingerprintSha256: 'a'.repeat(64), source: 'bundled', container: 'sfnt', outline: 'truetype',
  postScriptName: 'FixtureFont',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }
};

const layout = (key: string): RealizedTextLayout => ({
  schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
  key,
  glyphRuns: [{
    font: { font, variableAxes: {}, syntheticBold: false, syntheticItalic: false },
    fontResolution: { kind: 'flow-exact', sourceRunIndex: 0, requested: { families: ['Fixture'] } },
    fontSize: 48,
    paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 1, b: 1, a: 1 } } },
    renderingMode: 'fill', direction: 'ltr',
    glyphIds: new Uint32Array([7]), clusters: new Uint32Array([0]),
    geometry: new Float32Array([4, 12, 9, 0])
  }],
  lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
  inkBounds: { x: 4, y: 0, width: 8, height: 12 },
  logicalBounds: { x: 0, y: 0, width: 16, height: 16 }, warnings: []
});

describe('DevelopmentTextFixtureRenderer', () => {
  it('is inert while off and publishes only a complete immutable rgba16float plan', async () => {
    const encode = vi.fn(() => 1);
    const dispose = vi.fn();
    const retireSubmittedResources = vi.fn(async () => undefined);
    const backend = {
      lookupGlyph: vi.fn(() => null),
      prepareGlyph: vi.fn(() => ({
        placement: {
          serializedKey: 'glyph', pageId: 1, pageGeneration: 1, atlasGeneration: 1,
          x: 0, y: 0, width: 8, height: 12, bearingX: 0, bearingY: 10, empty: false
        }, bearingX: 0, bearingY: 10
      })),
      encode,
      dispose,
      retireSubmittedResources
    };
    let resolveRaster!: (value: {
      raster: { width: number; height: number; bearingX: number; bearingY: number; pixels: Uint8Array };
      metrics: { operationDurationMs: number; wasmLinearMemoryBytes: number };
      roundTripDurationMs: number;
      responseTransferBytes: number;
    }) => void;
    const client = {
      probe: vi.fn(async () => ({ engineVersion: 'test', loadDurationMs: 1 })),
      registerFontDetailed: vi.fn(async () => ({
        metrics: { operationDurationMs: 1, wasmLinearMemoryBytes: 1 },
        roundTripDurationMs: 1, responseTransferBytes: 0
      })),
      realizeTextDetailed: vi.fn(async (request: { cacheKey: string }) => ({
        layout: layout(request.cacheKey),
        metrics: { operationDurationMs: 1, wasmLinearMemoryBytes: 1 },
        roundTripDurationMs: 1, responseTransferBytes: 24
      })),
      rasterizeGlyph: vi.fn(() => new Promise((resolve) => { resolveRaster = resolve; })),
      releaseSession: vi.fn(async () => undefined)
    };
    const loadDependencies = vi.fn(async () => ({
      client,
      createBackend: vi.fn(() => backend),
      loadAsset: vi.fn(async () => ({ family: 'Fixture', font, bytes: new Uint8Array([1]) }))
    }));
    const changed = vi.fn();
    const renderer = new DevelopmentTextFixtureRenderer(
      {} as GPUDevice,
      changed,
      loadDependencies as never
    );
    const texture = { createView: vi.fn(() => ({ view: true })) } as unknown as GPUTexture;

    expect(renderer.snapshot).toEqual({ enabled: false, status: 'off', error: null });
    expect(renderer.encode({} as GPUCommandEncoder, texture, { width: 320, height: 180 })).toBe(0);
    await renderer.setEnabled(false);
    expect(loadDependencies).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();

    const preparing = renderer.setEnabled(true);
    expect(renderer.snapshot.status).toBe('preparing');
    expect(renderer.encode({} as GPUCommandEncoder, texture, { width: 320, height: 180 })).toBe(0);
    await vi.waitFor(() => expect(client.rasterizeGlyph).toHaveBeenCalledOnce());
    expect(client.releaseSession).not.toHaveBeenCalled();
    resolveRaster({
      raster: { width: 8, height: 12, bearingX: 0, bearingY: 10, pixels: new Uint8Array(96) },
      metrics: { operationDurationMs: 1, wasmLinearMemoryBytes: 1 },
      roundTripDurationMs: 1, responseTransferBytes: 96
    });
    await preparing;

    expect(renderer.snapshot.status).toBe('ready');
    expect(Object.isFrozen(renderer.readyPlan)).toBe(true);
    expect(Object.isFrozen(renderer.readyPlan?.draws)).toBe(true);
    expect(renderer.encode({} as GPUCommandEncoder, texture, { width: 320, height: 180 })).toBe(1);
    expect(renderer.encode({} as GPUCommandEncoder, texture, { width: 320, height: 180 })).toBe(1);
    expect(encode).toHaveBeenCalledWith(expect.anything(), {
      view: { view: true }, format: 'rgba16float', width: 320, height: 180, loadOp: 'load'
    }, [expect.objectContaining({ x: 36, y: 108, color: [1, 1, 1, 1], transform: [1, 0, 0, 1] })]);
    expect(client.rasterizeGlyph).toHaveBeenCalledOnce();
    expect(backend.prepareGlyph).toHaveBeenCalledOnce();
    expect(client.releaseSession).toHaveBeenCalledOnce();

    await renderer.setEnabled(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.encode({} as GPUCommandEncoder, texture, { width: 320, height: 180 })).toBe(0);
    renderer.handleDeviceLoss();
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.snapshot.status).toBe('off');
    expect(renderer.encode({} as GPUCommandEncoder, texture, { width: 320, height: 180 })).toBe(0);
  });

  it('drops an in-flight preparation without publishing stale work after device loss', async () => {
    let resolveDependencies!: (value: never) => void;
    const dependencyLoader = vi.fn(() => new Promise((resolve) => {
      resolveDependencies = resolve;
    }));
    const changed = vi.fn();
    const renderer = new DevelopmentTextFixtureRenderer(
      {} as GPUDevice,
      changed,
      dependencyLoader as never
    );

    const pending = renderer.setEnabled(true);
    renderer.handleDeviceLoss();
    resolveDependencies({
      client: {},
      createBackend: vi.fn(),
      loadAsset: vi.fn()
    } as never);
    await pending;

    expect(renderer.snapshot).toEqual({ enabled: false, status: 'off', error: null });
    expect(renderer.readyPlan).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ enabled: true, status: 'preparing', error: null });
  });
});
