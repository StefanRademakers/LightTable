import {
  IDENTITY_MATRIX_3,
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  createTextLayoutCacheKey,
  type FontAssetRef,
  type RealizedTextLayout
} from '@lighttable/text-core';
import type {
  CoverageAtlasBackend,
  CoverageAtlasDrawCommand,
  PreparedCoverageGlyph
} from '@lighttable/text-webgpu';
import { planCoverageText, serializeCoverageAtlasGlyphKey } from '@lighttable/text-rendering';
import type { TextEngineClient } from '../wasm/TextEngineClient';

const FIXTURE_TEXT = 'LightTable GPU text';
const FIXTURE_FONT_SIZE = 48;
const FIXTURE_LOCAL_TO_DOCUMENT = Object.freeze([
  1, 0, 32,
  0, 1, 96,
  0, 0, 1
] as const);

interface FixtureAsset {
  readonly family: string;
  readonly font: FontAssetRef;
  readonly bytes: Uint8Array;
}

interface FixtureDependencies {
  readonly client: Pick<TextEngineClient,
    'probe' | 'registerFontDetailed' | 'realizeTextDetailed' | 'rasterizeGlyph' | 'releaseSession'>;
  readonly createBackend: (device: GPUDevice) => CoverageAtlasBackend;
  readonly loadAsset: () => Promise<FixtureAsset>;
}

export interface DevelopmentTextFixtureReadyPlan {
  readonly backend: CoverageAtlasBackend;
  readonly draws: readonly CoverageAtlasDrawCommand[];
}

export interface DevelopmentTextFixtureSnapshot {
  readonly enabled: boolean;
  readonly status: 'off' | 'preparing' | 'ready' | 'error';
  readonly error: string | null;
}

const loadDefaultDependencies = async (): Promise<FixtureDependencies> => {
  if (!import.meta.env.DEV) {
    throw new Error('The canvas text fixture is available only in development builds.');
  }
  const [{ lightTableTextEngine }, { CoverageAtlasBackend }, fixture] = await Promise.all([
    import('../wasm/TextEngineClient'),
    import('@lighttable/text-webgpu'),
    import('./developmentTextCanvasFixture.dev')
  ]);
  return {
    client: lightTableTextEngine,
    createBackend: (device) => new CoverageAtlasBackend(device),
    loadAsset: fixture.loadDevelopmentTextCanvasFixture
  };
};

let fixtureSessionGeneration = 0;

/**
 * Development-only owner for the one fixed solid-fill canvas fixture.
 *
 * Its constructor is deliberately inert. The worker, WASM, fixture bytes and
 * atlas backend are reached only after the explicit enable action. encode()
 * is synchronous and can consume only the last completely prepared plan.
 */
export class DevelopmentTextFixtureRenderer {
  private snapshotValue: DevelopmentTextFixtureSnapshot = {
    enabled: false,
    status: 'off',
    error: null
  };
  private readyPlanValue: DevelopmentTextFixtureReadyPlan | null = null;
  private generation = 0;
  private abort: AbortController | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly onChanged: (snapshot: DevelopmentTextFixtureSnapshot) => void,
    private readonly dependencyLoader: () => Promise<FixtureDependencies> = loadDefaultDependencies
  ) {}

  get snapshot() {
    return this.snapshotValue;
  }

  get hasReadyPlan() {
    return this.readyPlanValue !== null;
  }

  get readyPlan(): DevelopmentTextFixtureReadyPlan | null {
    return this.readyPlanValue;
  }

  async setEnabled(enabled: boolean): Promise<DevelopmentTextFixtureSnapshot> {
    if (!enabled) {
      this.disable();
      return this.snapshotValue;
    }
    if (!import.meta.env.DEV) {
      throw new Error('The canvas text fixture is available only in development builds.');
    }
    if (this.snapshotValue.enabled && this.snapshotValue.status === 'ready') {
      return this.snapshotValue;
    }

    const generation = ++this.generation;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ enabled: true, status: 'preparing', error: null });
    const resources: { backend: CoverageAtlasBackend | null } = { backend: null };
    try {
      const dependencies = await this.dependencyLoader();
      const asset = await dependencies.loadAsset();
      const plan = await this.prepare(dependencies, asset, abort.signal, (created) => {
        resources.backend = created;
      });
      if (abort.signal.aborted || generation !== this.generation) {
        plan.backend.dispose();
        return this.snapshotValue;
      }
      this.readyPlanValue?.backend.dispose();
      this.readyPlanValue = plan;
      this.publish({ enabled: true, status: 'ready', error: null });
    } catch (reason) {
      resources.backend?.dispose();
      if (abort.signal.aborted || generation !== this.generation) return this.snapshotValue;
      const error = reason instanceof Error ? reason.message : 'The canvas text fixture could not be prepared.';
      this.publish({ enabled: true, status: 'error', error });
      throw reason;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
    return this.snapshotValue;
  }

  encode(
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
    dimensions: { readonly width: number; readonly height: number }
  ): number {
    const plan = this.readyPlanValue;
    if (!plan || !this.snapshotValue.enabled) return 0;
    return plan.backend.encode(encoder, {
      view: texture.createView(),
      format: 'rgba16float',
      width: dimensions.width,
      height: dimensions.height,
      loadOp: 'load'
    }, plan.draws);
  }

  retireSubmittedResources() {
    const backend = this.readyPlanValue?.backend;
    if (backend) void backend.retireSubmittedResources();
  }

  dispose() {
    this.disable();
  }

  handleDeviceLoss() {
    this.disable(false);
  }

  private disable(notify = true) {
    const changed = this.snapshotValue.status !== 'off'
      || this.snapshotValue.enabled
      || this.readyPlanValue !== null
      || this.abort !== null;
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.readyPlanValue?.backend.dispose();
    this.readyPlanValue = null;
    if (notify && changed) this.publish({ enabled: false, status: 'off', error: null });
    else this.snapshotValue = Object.freeze({ enabled: false, status: 'off', error: null });
  }

  private publish(snapshot: DevelopmentTextFixtureSnapshot) {
    this.snapshotValue = Object.freeze(snapshot);
    this.onChanged(this.snapshotValue);
  }

  private async prepare(
    dependencies: FixtureDependencies,
    asset: FixtureAsset,
    signal: AbortSignal,
    captureBackend: (backend: CoverageAtlasBackend) => void
  ): Promise<DevelopmentTextFixtureReadyPlan> {
    const documentSessionId = `canvas-text-fixture-${Date.now()}`;
    const sessionGeneration = ++fixtureSessionGeneration;
    const fontSnapshotRevision = 1;
    try {
      await dependencies.client.probe();
      await dependencies.client.registerFontDetailed({
        kind: 'register-font', documentSessionId, sessionGeneration,
        font: asset.font, fontSnapshotRevision,
        bytes: Uint8Array.from(asset.bytes), byteSource: 'transferred',
        transferOwnership: 'dedicated'
      }, signal);
      const defaults = createDefaultFlowTextSource(FIXTURE_TEXT);
      const style = defaults.styleRuns[0];
      const layer = {
        ...createDefaultTextLayerData(),
        source: {
          ...defaults,
          styleRuns: [{
            ...style,
            fontSize: FIXTURE_FONT_SIZE,
            requestedFont: {
              families: [asset.family],
              postScriptName: asset.font.postScriptName,
              preferredAsset: asset.font
            },
            fill: { kind: 'solid' as const, color: { colorSpace: 'srgb' as const, r: 1, g: 1, b: 1, a: 1 } }
          }]
        }
      };
      const options = { quality: 'final' as const, effectiveScale: 1, maxGlyphCount: 256 };
      const identity = {
        documentSessionId, sessionGeneration, layerId: 'development.canvas-text-fixture',
        revisions: layer.revisions, fontSnapshotRevision, pathDependencyRevision: 0, options
      };
      const realization = await dependencies.client.realizeTextDetailed({
        kind: 'realize-text', documentSessionId, sessionGeneration,
        layerId: identity.layerId, layer, localToDocument: IDENTITY_MATRIX_3,
        flowFontSelections: [{
          sourceRunIndex: 0,
          font: asset.font,
          familyName: asset.family,
          resolution: {
            kind: 'flow-exact', sourceRunIndex: 0,
            requested: layer.source.styleRuns[0]!.requestedFont
          }
        }],
        fontSnapshotRevision, pathDependencyRevision: 0,
        cacheKey: createTextLayoutCacheKey(identity), options
      }, signal);
      return await this.prepareAtlas(
        dependencies,
        asset,
        realization.layout,
        documentSessionId,
        sessionGeneration,
        fontSnapshotRevision,
        signal,
        captureBackend
      );
    } finally {
      await dependencies.client.releaseSession(documentSessionId, sessionGeneration).catch(() => undefined);
    }
  }

  private async prepareAtlas(
    dependencies: FixtureDependencies,
    asset: FixtureAsset,
    layout: RealizedTextLayout,
    documentSessionId: string,
    sessionGeneration: number,
    fontSnapshotRevision: number,
    signal: AbortSignal,
    captureBackend: (backend: CoverageAtlasBackend) => void
  ): Promise<DevelopmentTextFixtureReadyPlan> {
    const backend = dependencies.createBackend(this.device);
    captureBackend(backend);
    const renderPlan = planCoverageText(
      layout,
      FIXTURE_LOCAL_TO_DOCUMENT,
      fontSnapshotRevision
    );
    const glyphs = new Map<string, PreparedCoverageGlyph>();
    const uniqueRasters = new Map(renderPlan.glyphs.map((draw) => [
      serializeCoverageAtlasGlyphKey(draw.raster.key),
      draw.raster
    ]));
    for (const [serializedKey, rasterPlan] of uniqueRasters) {
      const resident = backend.lookupGlyph(rasterPlan.key);
      if (resident) {
        glyphs.set(serializedKey, resident);
        continue;
      }
      const report = await dependencies.client.rasterizeGlyph({
        kind: 'rasterize-glyph', documentSessionId, sessionGeneration,
        assetId: rasterPlan.assetId, faceIndex: rasterPlan.faceIndex,
        glyphId: rasterPlan.glyphId, ppem: rasterPlan.ppem,
        fontSnapshotRevision: rasterPlan.fontSnapshotRevision,
        variationCoordinates: rasterPlan.key.variationCoordinates,
        syntheticBold: rasterPlan.key.syntheticBold,
        syntheticItalic: rasterPlan.key.syntheticItalic,
        hinting: rasterPlan.key.hinting, renderMode: rasterPlan.key.renderMode
      }, signal);
      glyphs.set(serializedKey, backend.prepareGlyph(rasterPlan.key, report.raster));
    }
    const draws = renderPlan.glyphs.map((draw) => {
      const glyph = glyphs.get(serializeCoverageAtlasGlyphKey(draw.raster.key));
      if (!glyph) throw new Error(`Missing prepared fixture glyph ${draw.raster.glyphId}.`);
      return Object.freeze({
        glyph,
        x: draw.x,
        y: draw.y,
        transform: draw.transform,
        color: draw.color
      });
    });
    return Object.freeze({ backend, draws: Object.freeze(draws) });
  }
}
