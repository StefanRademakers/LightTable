import {
  IDENTITY_MATRIX_3,
  createTextLayoutCacheKey,
  type FontAssetRef,
  type RealizedTextLayout
} from '@lighttable/text-core';
import {
  planCoverageText,
  projectCurrentTextPaint,
  serializeCoverageAtlasGlyphKey
} from '@lighttable/text-rendering';
import type {
  CoverageAtlasBackend,
  CoverageAtlasDrawCommand,
  PreparedCoverageGlyph
} from '@lighttable/text-webgpu';
import type { DocumentFontAsset, ImageDocument, LayerId, TextLayer } from '../../editor/document/documentTypes';
import { walkLayerTree } from '../../editor/document/layerTree';
import { identityAffineMatrix, multiplyMatrices } from '../../editor/geometry/affine';
import type { AffineMatrix } from '../../editor/geometry/affine';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';
import type { TextEngineClient } from '../wasm/TextEngineClient';
import { TextLayerRenderer, textLayerSourceKey, tightCoverageBounds } from './TextLayerRenderer';
import { TextLayoutCache } from './TextLayoutCache';
import { TextSourceCostModel } from './TextSourceCostModel';
import { TextInputLatencyTracker } from './TextInputLatencyTracker';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';

export interface TextFontRuntimePort {
  readonly revision: number;
  readonly assets: readonly DocumentFontAsset[];
  bytes(assetId: string): Promise<Uint8Array | null>;
  subscribe(listener: () => void): () => void;
}

interface CoordinatorDependencies {
  readonly client: Pick<TextEngineClient,
    'registerFontDetailed' | 'realizeTextDetailed' | 'rasterizeGlyph' | 'releaseSession'>;
  readonly backend: CoverageAtlasBackend;
}

interface CoordinatorOptions {
  readonly device: GPUDevice;
  readonly renderer: TextLayerRenderer;
  readonly requestRender: () => void;
  readonly onChanged?: (snapshot: TextRenderPresentationSnapshot) => void;
  readonly onError?: (message: string) => void;
  readonly loadDependencies?: () => Promise<CoordinatorDependencies>;
}

const defaultDependencies = async (device: GPUDevice): Promise<CoordinatorDependencies> => {
  const [{ lightTableTextEngine }, { CoverageAtlasBackend }] = await Promise.all([
    import('../wasm/TextEngineClient'),
    import('@lighttable/text-webgpu')
  ]);
  return { client: lightTableTextEngine, backend: new CoverageAtlasBackend(device) };
};

const sourceScaleFor = (matrix: AffineMatrix) => {
  const sumSquares = matrix.a ** 2 + matrix.b ** 2 + matrix.c ** 2 + matrix.d ** 2;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const singular = Math.sqrt(Math.max(0,
    (sumSquares + Math.sqrt(Math.max(0, sumSquares ** 2 - 4 * determinant ** 2))) / 2
  ));
  return Math.max(1, Math.min(8, Math.ceil(singular)));
};

interface VisibleTextEntry {
  readonly layer: TextLayer;
  readonly transform: AffineMatrix;
}

export interface TextLayerEditingLayout {
  readonly layerId: LayerId;
  readonly preparationKey: string;
  readonly layout: RealizedTextLayout;
  readonly localToDocument: AffineMatrix;
}

const visibleTextLayers = (
  document: ImageDocument,
  nodes = document.layers,
  inherited = identityAffineMatrix(),
  visible = true
): VisibleTextEntry[] => nodes.flatMap((node) => {
  const nodeVisible = visible && node.visible && node.opacity > 0;
  if (node.type === 'group') {
    return visibleTextLayers(
      document,
      node.children,
      multiplyMatrices(inherited, node.transform),
      nodeVisible
    );
  }
  return node.type === 'text' && nodeVisible
    ? [{ layer: node, transform: multiplyMatrices(inherited, node.transform) }]
    : [];
});

let sessionSequence = 0;

/** Lazily turns canonical document text into immutable tight GPU sources. */
export class TextLayerRenderCoordinator {
  private fontPort: TextFontRuntimePort | null = null;
  private configuredFontRevision = 0;
  private unsubscribeFonts: (() => void) | null = null;
  private document: ImageDocument | null = null;
  private dependencies: CoordinatorDependencies | null = null;
  private generation = 0;
  private sessionGeneration = 0;
  private sessionId = '';
  private pendingKey = '';
  private sessionKey = '';
  private work: Promise<void> = Promise.resolve();
  private readonly layoutCache = new TextLayoutCache();
  private readonly settledLayerKeys = new Map<LayerId, string>();
  private readonly expectedLayerKeys = new Map<LayerId, string>();
  private readonly retryCounts = new Map<string, number>();
  private readonly editingLayouts = new Map<LayerId, TextLayerEditingLayout>();
  private readonly interactingLayerScales = new Map<LayerId, number>();
  private readonly interactivelyPreparedLayers = new Set<LayerId>();
  private readonly forcedCachedLayers = new Set<LayerId>();
  private readonly sourceCostModel = new TextSourceCostModel();
  private readonly inputLatency = new TextInputLatencyTracker();
  private abortController: AbortController | null = null;
  private disposed = false;
  private active = true;
  private shapingOperations = 0;
  private latestShapingRoundTripMs = 0;
  private rasterizedGlyphs = 0;
  private latestRasterRoundTripMs = 0;
  private textCacheSubmissions = 0;

  constructor(private readonly options: CoordinatorOptions) {
    options.renderer.setCostObserver((sample) => this.sourceCostModel.observe(sample));
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return false;
    this.active = active;
    if (!active) {
      this.abortController?.abort();
      this.abortController = null;
      this.pendingKey = '';
      this.generation += 1;
    } else {
      this.schedule();
    }
    return true;
  }

  /** Freezes source resolution while the compositor applies a live editor gesture. */
  setLayerInteraction(layerId: LayerId, active: boolean) {
    if (this.disposed) return false;
    if (active) {
      if (this.interactingLayerScales.has(layerId)) return false;
      const entry = this.document
        ? visibleTextLayers(this.document).find(({ layer }) => layer.id === layerId)
        : undefined;
      this.interactingLayerScales.set(layerId, entry ? sourceScaleFor(entry.transform) : 1);
      return true;
    }
    if (!this.interactingLayerScales.delete(layerId)) return false;
    if (this.interactivelyPreparedLayers.delete(layerId)) {
      this.settledLayerKeys.delete(layerId);
    }
    this.pendingKey = '';
    this.schedule();
    return true;
  }

  beginTextInput(layerId: LayerId, startedAt: number) {
    if (this.disposed) return false;
    this.inputLatency.begin(layerId, startedAt);
    this.publishChanged();
    return true;
  }

  markFrameSubmitted(document: ImageDocument, submittedAt: number) {
    const exactSources = new Map<LayerId, string>();
    for (const { layer } of visibleTextLayers(document)) {
      if (this.options.renderer.hasExactSource(layer) || this.options.renderer.isTransparent(layer)) {
        exactSources.set(layer.id, textLayerSourceKey(layer));
      }
    }
    const submitted = this.inputLatency.markSubmitted(
      (layerId) => exactSources.get(layerId) ?? null,
      submittedAt
    );
    if (submitted.length > 0) this.publishChanged();
    return submitted;
  }

  markFrameGpuComplete(inputIds: readonly number[], completedAt: number) {
    const completed = this.inputLatency.markGpuComplete(inputIds, completedAt);
    if (completed > 0) this.publishChanged();
    return completed;
  }

  configureFonts(port: TextFontRuntimePort | null) {
    const revision = port?.revision ?? 0;
    if (this.fontPort === port && this.configuredFontRevision === revision) {
      this.schedule();
      return;
    }
    this.invalidateFontRuntime();
    this.unsubscribeFonts?.();
    this.fontPort = port;
    this.configuredFontRevision = revision;
    this.unsubscribeFonts = port?.subscribe(() => {
      if (this.fontPort !== port) return;
      const nextRevision = port.revision;
      if (this.configuredFontRevision === nextRevision) {
        this.schedule();
        return;
      }
      this.configuredFontRevision = nextRevision;
      this.invalidateFontRuntime();
      this.schedule();
    }) ?? null;
    this.schedule();
  }

  sync(document: ImageDocument) {
    this.document = document;
    const allText = walkLayerTree(document.layers)
      .map(({ node }) => node)
      .filter((node): node is TextLayer => node.type === 'text');
    const publicationRevision = this.options.renderer.snapshot().publicationRevision;
    this.options.renderer.sync(allText);
    if (this.options.renderer.snapshot().publicationRevision !== publicationRevision) {
      this.publishChanged();
    }
    const retained = new Set(allText.map((layer) => layer.id));
    const visibleEntries = visibleTextLayers(document);
    this.options.renderer.setVisibleLayerIds(new Set(visibleEntries.map(({ layer }) => layer.id)));
    for (const layerId of this.settledLayerKeys.keys()) {
      if (!retained.has(layerId)) this.settledLayerKeys.delete(layerId);
    }
    for (const layerId of this.editingLayouts.keys()) {
      if (!retained.has(layerId)) this.editingLayouts.delete(layerId);
    }
    for (const layerId of this.interactingLayerScales.keys()) {
      if (!retained.has(layerId)) this.interactingLayerScales.delete(layerId);
    }
    for (const layerId of this.interactivelyPreparedLayers) {
      if (!retained.has(layerId)) this.interactivelyPreparedLayers.delete(layerId);
    }
    for (const layerId of this.forcedCachedLayers) {
      if (!retained.has(layerId)) this.forcedCachedLayers.delete(layerId);
    }
    const visibleLayerIds = new Set(visibleEntries.map(({ layer }) => layer.id));
    this.inputLatency.retainLayers(visibleLayerIds);
    for (const { layer } of visibleEntries) {
      this.inputLatency.syncSource(layer.id, textLayerSourceKey(layer));
    }
    for (const { layer, transform } of visibleEntries) {
      const editing = this.editingLayouts.get(layer.id);
      if (!editing || !this.interactingLayerScales.has(layer.id)) continue;
      this.editingLayouts.set(layer.id, Object.freeze({
        ...editing,
        preparationKey: this.layerPreparationKey(document.id, layer, transform, this.fontPort?.revision ?? 0),
        localToDocument: Object.freeze({ ...transform })
      }));
    }
    this.schedule();
  }

  snapshot(): TextRenderPresentationSnapshot {
    const source = this.options.renderer.snapshot();
    const layouts = this.layoutCache.metrics();
    const atlas = this.dependencies?.backend.metrics();
    const cost = this.sourceCostModel.snapshot();
    const inputLatency = this.inputLatency.snapshot();
    return Object.freeze({
      ...source,
      layoutCacheBytes: layouts.byteLength,
      layoutCacheBudgetBytes: layouts.budgetBytes,
      layoutCacheHits: layouts.hits,
      layoutCacheMisses: layouts.misses,
      layoutCacheEvictions: layouts.evictions,
      atlasBytes: atlas?.allocatedBytes ?? 0,
      atlasHits: atlas?.hits ?? 0,
      atlasMisses: atlas?.misses ?? 0,
      atlasEvictions: atlas?.evictions ?? 0,
      sourceDecisionMeasurements: cost.measurementCount,
      lastSourceDecision: cost.lastDecision
        ? `${cost.lastDecision.mode}:${cost.lastDecision.reason}` : null,
      shapingOperations: this.shapingOperations,
      latestShapingRoundTripMs: this.latestShapingRoundTripMs,
      rasterizedGlyphs: this.rasterizedGlyphs,
      latestRasterRoundTripMs: this.latestRasterRoundTripMs,
      textCacheSubmissions: this.textCacheSubmissions,
      textInputLatencySamples: inputLatency.sampleCount,
      pendingTextInputs: inputLatency.pendingCount,
      supersededTextInputs: inputLatency.supersededCount,
      inputToSubmitP95Ms: inputLatency.inputToSubmitP95Ms,
      inputToSubmitMaxMs: inputLatency.inputToSubmitMaxMs,
      inputToGpuP95Ms: inputLatency.inputToGpuP95Ms,
      inputToGpuMaxMs: inputLatency.inputToGpuMaxMs
    });
  }

  estimatedTextureBytes() {
    return this.options.renderer.estimatedTextureBytes()
      + (this.dependencies?.backend.metrics().allocatedBytes ?? 0);
  }

  isSettledForCurrentGeneration(layer: TextLayer) {
    if (!this.fontPort || !this.document) return false;
    const expected = this.expectedLayerKeys.get(layer.id);
    return Boolean(expected)
      && this.settledLayerKeys.get(layer.id) === expected
      && (this.options.renderer.hasExactSource(layer) || this.options.renderer.isTransparent(layer));
  }

  hasTextLayer(layerId: LayerId) {
    return Boolean(this.document && walkLayerTree(this.document.layers).some(
      ({ node }) => node.id === layerId && node.type === 'text'
    ));
  }

  editingLayout(layerId: LayerId): TextLayerEditingLayout | null {
    return this.editingLayouts.get(layerId) ?? null;
  }

  async waitForSettledSource(layerId: LayerId) {
    if (!this.hasTextLayer(layerId)) return false;
    await this.work;
    let layer = this.document && walkLayerTree(this.document.layers)
      .map(({ node }) => node)
      .find((node): node is TextLayer => node.id === layerId && node.type === 'text');
    if (layer
      && this.options.renderer.hasExactSource(layer)
      && !this.options.renderer.thumbnailSource(layerId)
      && !this.options.renderer.isTransparent(layer)) {
      this.forcedCachedLayers.add(layerId);
      this.settledLayerKeys.delete(layerId);
      this.pendingKey = '';
      this.schedule();
      await this.work;
      layer = this.document && walkLayerTree(this.document.layers)
        .map(({ node }) => node)
        .find((node): node is TextLayer => node.id === layerId && node.type === 'text');
    }
    return Boolean(layer && this.options.renderer.hasExactSource(layer));
  }

  retireSubmittedResources() {
    void this.dependencies?.backend.retireSubmittedResources();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeFonts?.();
    this.unsubscribeFonts = null;
    this.fontPort = null;
    this.configuredFontRevision = 0;
    this.document = null;
    this.pendingKey = '';
    this.abortController?.abort();
    this.abortController = null;
    const dependencies = this.dependencies;
    const sessionId = this.sessionId;
    const sessionGeneration = this.sessionGeneration;
    this.dependencies = null;
    this.generation += 1;
    this.options.renderer.setCostObserver(null);
    this.options.renderer.dispose();
    this.layoutCache.clear();
    this.settledLayerKeys.clear();
    this.expectedLayerKeys.clear();
    this.retryCounts.clear();
    this.editingLayouts.clear();
    this.interactingLayerScales.clear();
    this.interactivelyPreparedLayers.clear();
    this.forcedCachedLayers.clear();
    this.inputLatency.reset();
    this.publishChanged();
    dependencies?.backend.dispose();
    if (dependencies && sessionId) {
      void dependencies.client.releaseSession(sessionId, sessionGeneration).catch(() => undefined);
    }
  }

  private schedule() {
    if (this.disposed || !this.active || !this.document || !this.fontPort) return;
    const layers = visibleTextLayers(this.document);
    if (layers.length === 0 || this.fontPort.assets.length === 0) {
      this.abortController?.abort();
      this.abortController = null;
      this.pendingKey = '';
      this.generation += 1;
      this.expectedLayerKeys.clear();
      this.editingLayouts.clear();
      return;
    }
    const expected = new Map(layers.map(({ layer, transform }) => [
      layer.id,
      this.layerPreparationKey(this.document!.id, layer, transform, this.fontPort!.revision)
    ]));
    this.expectedLayerKeys.clear();
    expected.forEach((value, layerId) => this.expectedLayerKeys.set(layerId, value));
    for (const [layerId, settled] of this.settledLayerKeys) {
      if (expected.get(layerId) !== settled) {
        this.settledLayerKeys.delete(layerId);
        this.editingLayouts.delete(layerId);
      }
    }
    const key = [
      this.document.id,
      this.fontPort.revision,
      ...layers.map(({ layer, transform }) => this.layerPreparationKey(
        this.document!.id, layer, transform, this.fontPort!.revision
      ))
    ].join('|');
    if (key === this.pendingKey) return;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.pendingKey = key;
    const generation = ++this.generation;
    this.work = this.work
      .then(() => this.prepare(generation, key, layers, abortController.signal))
      .catch((reason: unknown) => {
        if (!this.current(generation, key)) return;
        this.options.onError?.(
          reason instanceof Error ? reason.message : 'Text source preparation failed.'
        );
        this.pendingKey = '';
        const retries = this.retryCounts.get(key) ?? 0;
        if (retries >= 1) return;
        this.retryCounts.set(key, retries + 1);
        void Promise.resolve().then(() => this.schedule());
      })
      .finally(() => {
        if (this.abortController === abortController) this.abortController = null;
      });
  }

  private async prepare(
    generation: number,
    key: string,
    layers: readonly VisibleTextEntry[],
    signal: AbortSignal
  ) {
    const port = this.fontPort;
    const document = this.document;
    if (!port || !document) return;
    const dependencies = this.dependencies ?? await (
      this.options.loadDependencies?.() ?? defaultDependencies(this.options.device)
    );
    if (!this.current(generation, key)) {
      if (!this.dependencies) dependencies.backend.dispose();
      return;
    }
    this.dependencies = dependencies;
    if (!await this.beginSession(dependencies, document.id, port, generation, key, signal)) return;
    if (!this.current(generation, key)) return;
    for (const entry of layers) {
      if (!this.current(generation, key)) return;
      const expected = this.layerPreparationKey(
        document.id, entry.layer, entry.transform, port.revision
      );
      if (this.settledLayerKeys.get(entry.layer.id) === expected
        && (this.options.renderer.hasExactSource(entry.layer)
          || this.options.renderer.isTransparent(entry.layer))) {
        continue;
      }
      await this.prepareLayer(
        dependencies, entry.layer, entry.transform, port.revision, generation, key, signal
      );
    }
    this.retryCounts.delete(key);
  }

  private async beginSession(
    dependencies: CoordinatorDependencies,
    documentId: string,
    port: TextFontRuntimePort,
    generation: number,
    key: string,
    signal: AbortSignal
  ) {
    const nextSessionKey = `${documentId}:${port.revision}`;
    if (this.sessionId && this.sessionKey === nextSessionKey) return true;
    const candidateSessionId = `document-text-${documentId}-${++sessionSequence}`;
    const candidateGeneration = sessionSequence;
    let snapshotRevision = 0;
    try {
      for (const asset of port.assets) {
        const bytes = await port.bytes(asset.assetId);
        if (!bytes) continue;
        await dependencies.client.registerFontDetailed({
          kind: 'register-font',
          documentSessionId: candidateSessionId,
          sessionGeneration: candidateGeneration,
          font: asset as FontAssetRef,
          fontSnapshotRevision: ++snapshotRevision,
          bytes,
          byteSource: 'transferred',
          transferOwnership: 'dedicated'
        }, signal);
      }
    } catch (error) {
      await dependencies.client.releaseSession(candidateSessionId, candidateGeneration).catch(() => undefined);
      throw error;
    }
    if (!this.current(generation, key) || this.fontPort !== port) {
      await dependencies.client.releaseSession(candidateSessionId, candidateGeneration).catch(() => undefined);
      return false;
    }
    if (this.sessionId) {
      await dependencies.client.releaseSession(this.sessionId, this.sessionGeneration).catch(() => undefined);
    }
    if (!this.current(generation, key) || this.fontPort !== port) {
      await dependencies.client.releaseSession(candidateSessionId, candidateGeneration).catch(() => undefined);
      return false;
    }
    this.sessionId = candidateSessionId;
    this.sessionGeneration = candidateGeneration;
    this.sessionKey = nextSessionKey;
    this.layoutCache.clear();
    this.sessionFontRevision = snapshotRevision;
    return true;
  }

  private sessionFontRevision = 0;

  private async prepareLayer(
    dependencies: CoordinatorDependencies,
    layer: TextLayer,
    transform: AffineMatrix,
    fontPortRevision: number,
    generation: number,
    key: string,
    signal: AbortSignal
  ) {
    const sourceScale = this.sourceScaleForLayer(layer.id, transform);
    const options = { quality: 'final' as const, effectiveScale: sourceScale, maxGlyphCount: 100_000 };
    const identity = {
      documentSessionId: this.sessionId,
      sessionGeneration: this.sessionGeneration,
      layerId: layer.id,
      revisions: layer.text.revisions,
      fontSnapshotRevision: this.sessionFontRevision,
      pathDependencyRevision: 0,
      options
    };
    const layoutCacheKey = createTextLayoutCacheKey(identity);
    let layout = this.layoutCache.get(layoutCacheKey);
    if (!layout) {
      const report = await dependencies.client.realizeTextDetailed({
        kind: 'realize-text',
        ...identity,
        layer: layer.text,
        localToDocument: IDENTITY_MATRIX_3,
        cacheKey: layoutCacheKey
      }, signal);
      layout = report.layout;
      if (!this.current(generation, key)) return;
      this.shapingOperations += 1;
      this.latestShapingRoundTripMs = report.roundTripDurationMs;
      this.layoutCache.set(layoutCacheKey, layout);
    }
    if (!this.current(generation, key)) return;
    this.publishEditingLayout(layer, layout, transform, fontPortRevision);
    this.publishChanged();
    this.options.requestRender();
    const prepared = await this.prepareDraws(
      dependencies,
      projectCurrentTextPaint(layout, layer.text.source),
      sourceScale,
      generation,
      key,
      signal
    );
    if (!this.current(generation, key)) {
      prepared.release();
      return;
    }
    if (prepared.draws.length > 0) {
      const bounds = tightCoverageBounds(prepared.draws, 2)!;
      const pixelCount = Math.ceil(bounds.width) * Math.ceil(bounds.height);
      const snapshot = this.options.renderer.snapshot();
      const directEligible = layer.opacity === 1
        && layer.fillOpacity === 1
        && layer.blendMode === 'normal'
        && !layer.clipping
        && !layer.mask?.enabled
        && !layerStyleStackIsActive(layer.styleStack);
      const mode = this.forcedCachedLayers.has(layer.id)
        ? 'cached'
        : this.interactingLayerScales.has(layer.id) && directEligible
          ? 'atlas'
          : this.sourceCostModel.decide({
          glyphCount: prepared.draws.length,
          pixelCount,
          byteLength: pixelCount * 8,
          expectedRecompositions: 8,
          availableCacheBytes: Math.max(0, snapshot.cacheBudgetBytes - snapshot.textureBytes),
          directEligible
        }).mode;
      if (mode === 'atlas') {
        const candidate = this.options.renderer.prepareAtlasSource(
          layer,
          dependencies.backend,
          prepared.draws,
          sourceScale,
          `${layout.key}:${layer.text.revisions.paint}:${sourceScale}`,
          prepared.release
        );
        if (!this.current(generation, key)) {
          candidate.discard();
          return;
        }
        candidate.publish();
        this.settledLayerKeys.set(
          layer.id,
          this.layerPreparationKey(this.document!.id, layer, transform, fontPortRevision)
        );
        if (this.interactingLayerScales.has(layer.id)) {
          this.interactivelyPreparedLayers.add(layer.id);
        }
        this.publishChanged();
        this.options.requestRender();
        return;
      }
    }
    const encoder = this.options.device.createCommandEncoder({
      label: `LightTable tight text source: ${layer.name}`
    });
    let candidate;
    try {
      candidate = this.options.renderer.prepareTightSource(
        encoder,
        layer,
        dependencies.backend,
        prepared.draws,
        sourceScale,
        `${layout.key}:${layer.text.revisions.paint}:${sourceScale}`
      );
    } finally {
      prepared.release();
    }
    if (!candidate) {
      this.options.renderer.markTransparent(layer);
      this.forcedCachedLayers.delete(layer.id);
      this.settledLayerKeys.set(
        layer.id,
        this.layerPreparationKey(this.document!.id, layer, transform, fontPortRevision)
      );
      if (this.interactingLayerScales.has(layer.id)) {
        this.interactivelyPreparedLayers.add(layer.id);
      }
      this.publishChanged();
      this.options.requestRender();
      return;
    }
    try {
      this.options.device.queue.submit([encoder.finish()]);
      this.textCacheSubmissions += 1;
    } catch (error) {
      candidate.discard();
      throw error;
    }
    candidate.publish();
    this.forcedCachedLayers.delete(layer.id);
    this.settledLayerKeys.set(
      layer.id,
      this.layerPreparationKey(this.document!.id, layer, transform, fontPortRevision)
    );
    if (this.interactingLayerScales.has(layer.id)) {
      this.interactivelyPreparedLayers.add(layer.id);
    }
    void dependencies.backend.retireSubmittedResources();
    this.publishChanged();
    this.options.requestRender();
  }

  private async prepareDraws(
    dependencies: CoordinatorDependencies,
    layout: RealizedTextLayout,
    sourceScale: number,
    generation: number,
    key: string,
    signal: AbortSignal
  ): Promise<{ readonly draws: readonly CoverageAtlasDrawCommand[]; release(): void }> {
    const plan = planCoverageText(layout, [
      sourceScale, 0, 0,
      0, sourceScale, 0,
      0, 0, 1
    ], this.sessionFontRevision);
    const glyphs = new Map<string, PreparedCoverageGlyph>();
    const releases: Array<() => void> = [];
    try {
      for (const raster of new Map(plan.glyphs.map((draw) => [
        serializeCoverageAtlasGlyphKey(draw.raster.key), draw.raster
      ])).values()) {
        const serialized = serializeCoverageAtlasGlyphKey(raster.key);
        const resident = dependencies.backend.lookupGlyph(raster.key);
        let glyph = resident;
        if (!glyph) {
          const report = await dependencies.client.rasterizeGlyph({
          kind: 'rasterize-glyph',
          documentSessionId: this.sessionId,
          sessionGeneration: this.sessionGeneration,
          assetId: raster.assetId,
          faceIndex: raster.faceIndex,
          glyphId: raster.glyphId,
          ppem: raster.ppem,
          fontSnapshotRevision: raster.fontSnapshotRevision,
          variationCoordinates: raster.key.variationCoordinates,
          syntheticBold: raster.key.syntheticBold,
          syntheticItalic: raster.key.syntheticItalic,
          hinting: raster.key.hinting,
          renderMode: raster.key.renderMode
          }, signal);
          if (!this.current(generation, key)) {
            releases.forEach((release) => release());
            return { draws: [], release: () => undefined };
          }
          this.rasterizedGlyphs += 1;
          this.latestRasterRoundTripMs = report.roundTripDurationMs;
          glyph = dependencies.backend.prepareGlyph(raster.key, report.raster);
        }
        glyphs.set(serialized, glyph);
        releases.push(dependencies.backend.retainGlyphs([glyph]));
      }
      const draws = plan.glyphs.map((draw) => ({
        glyph: glyphs.get(serializeCoverageAtlasGlyphKey(draw.raster.key))!,
        x: draw.x,
        y: draw.y,
        transform: draw.transform,
        color: draw.color
      }));
      let released = false;
      return {
        draws,
        release: () => {
          if (released) return;
          released = true;
          releases.forEach((release) => release());
        }
      };
    } catch (error) {
      releases.forEach((release) => release());
      throw error;
    }
  }

  private current(generation: number, key: string) {
    return !this.disposed && this.active
      && generation === this.generation && key === this.pendingKey;
  }

  private publishEditingLayout(
    layer: TextLayer,
    layout: RealizedTextLayout,
    transform: AffineMatrix,
    fontPortRevision: number
  ) {
    this.editingLayouts.set(layer.id, Object.freeze({
      layerId: layer.id,
      preparationKey: this.layerPreparationKey(
        this.document!.id,
        layer,
        transform,
        fontPortRevision
      ),
      layout,
      localToDocument: Object.freeze({ ...transform })
    }));
  }

  private invalidateFontRuntime() {
    this.abortController?.abort();
    this.abortController = null;
    this.generation += 1;
    this.pendingKey = '';
    this.layoutCache.clear();
    this.settledLayerKeys.clear();
    this.expectedLayerKeys.clear();
    this.retryCounts.clear();
    this.editingLayouts.clear();
    this.options.renderer.dispose();
    this.publishChanged();
    const dependencies = this.dependencies;
    const sessionId = this.sessionId;
    const sessionGeneration = this.sessionGeneration;
    this.sessionId = '';
    this.sessionGeneration = 0;
    this.sessionKey = '';
    this.sessionFontRevision = 0;
    if (dependencies && sessionId) {
      void dependencies.client.releaseSession(sessionId, sessionGeneration).catch(() => undefined);
    }
  }

  private publishChanged() {
    this.options.onChanged?.(this.snapshot());
  }

  private layerPreparationKey(
    documentId: string,
    layer: TextLayer,
    transform: AffineMatrix,
    fontRevision: number
  ) {
    return `${documentId}:${layer.id}:${textLayerSourceKey(layer)}:${fontRevision}:${this.sourceScaleForLayer(layer.id, transform)}`;
  }

  private sourceScaleForLayer(layerId: LayerId, transform: AffineMatrix) {
    return this.interactingLayerScales.get(layerId) ?? sourceScaleFor(transform);
  }
}
