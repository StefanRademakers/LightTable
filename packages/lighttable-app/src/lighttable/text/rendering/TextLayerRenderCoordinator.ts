import {
  IDENTITY_MATRIX_3,
  createTextLayoutCacheKey,
  type FontAssetRef, type PathTextLayout,
  type RealizedTextLayout
} from '@lighttable/text-core';
import {
  planCoverageText,
  projectCurrentTextPaint,
  selectTextRealizationRoute,
  serializeCoverageAtlasGlyphKey
} from '@lighttable/text-rendering';
import type {
  CoverageAtlasBackend,
  CoverageAtlasDrawCommand,
  PreparedCoverageGlyph
} from '@lighttable/text-webgpu';
import {
  layerDerivedPreviewIsCurrent,
  type DocumentFontAsset,
  type ImageDocument,
  type LayerId,
  type TextLayer
} from '../../editor/document/documentTypes';
import { findDocumentLayer, walkLayerTree } from '../../editor/document/layerTree';
import { identityAffineMatrix, invertMatrix, multiplyMatrices } from '../../editor/geometry/affine';
import type { AffineMatrix } from '../../editor/geometry/affine';
import type { VectorPath } from '@lighttable/vector-core';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';
import type { TextEngineClient } from '../wasm/TextEngineClient';
import { TextLayerRenderer, textLayerSourceKey, tightCoverageBounds } from './TextLayerRenderer';
import { TextLayoutCache } from './TextLayoutCache';
import { TextSourceCostModel } from './TextSourceCostModel';
import { TextInputLatencyTracker } from './TextInputLatencyTracker';
import type { TextRenderPresentationSnapshot } from '../../application/rendering/rendererTypes';
import { resolveFlowFontSelections } from '../fonts/flowFontSelection';
import { TextGlyphOutlineRepository } from './TextGlyphOutlineRepository';
import { TextOutlineVectorBackend } from './TextOutlineVectorBackend';
import { prepareTextOutlineVectorDraws } from './prepareTextOutlineVectorDraws';
import { resolvePathTextDependency } from '../../editor/document/pathTextDependency';
import {
  PathArcLengthCache,
  type PathArcLengthTable,
  type PathTextAlignment
} from '@lighttable/vector-rendering';
import {
  projectRigidGlyphRunsToPath,
  type RigidPathGlyphProjection
} from './rigidPathGlyphProjection';

export interface TextFontRuntimePort {
  readonly revision: number;
  readonly assets: readonly DocumentFontAsset[];
  bytes(assetId: string): Promise<Uint8Array | null>;
  subscribe(listener: () => void): () => void;
}

interface CoordinatorDependencies {
  readonly client: Pick<TextEngineClient,
    'registerFontDetailed' | 'realizeTextDetailed' | 'rasterizeGlyph' | 'extractGlyphOutline' | 'releaseSession'>;
  readonly backend: CoverageAtlasBackend;
}

interface CoordinatorOptions {
  readonly device: GPUDevice;
  readonly renderer: TextLayerRenderer;
  readonly requestRender: () => void;
  readonly onChanged?: (snapshot: TextRenderPresentationSnapshot) => void;
  readonly onError?: (message: string) => void;
  readonly loadDependencies?: () => Promise<CoordinatorDependencies>;
  readonly createOutlineRepository?: (client: CoordinatorDependencies['client']) => TextGlyphOutlineRepository;
  readonly createOutlineBackend?: (device: GPUDevice) => TextOutlineVectorBackend;
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

const referencedFontAssets = (
  layers: readonly VisibleTextEntry[],
  available: readonly DocumentFontAsset[]
) => {
  const assetIds = new Set<string>();
  for (const { layer } of layers) {
    const source = layer.text.source;
    if (source.kind === 'positioned') {
      source.runs.forEach((run) => assetIds.add(run.font.font.assetId));
      continue;
    }
    resolveFlowFontSelections(source, available).selections
      .forEach(({ font }) => assetIds.add(font.assetId));
  }
  return available.filter(({ assetId }) => assetIds.has(assetId));
};

export interface TextLayerEditingLayout {
  readonly layerId: LayerId;
  readonly preparationKey: string;
  readonly layout: RealizedTextLayout;
  readonly localToDocument: AffineMatrix;
  readonly path?: Readonly<{
    pathLayout: PathTextLayout;
    table: PathArcLengthTable;
    projection: RigidPathGlyphProjection;
  }>;
}

const PATH_METRIC_CACHE_BYTES = 16 * 1024 * 1024;

const pathAlignment = (
  source: Extract<TextLayer['text']['source'], { kind: 'flow' }>
): PathTextAlignment => {
  const alignment = (source.paragraphRuns[0] ?? source.insertionParagraph)?.alignment;
  return alignment === 'center' ? 'center' : alignment === 'end' ? 'end' : 'start';
};

const pathShapingData = (layer: TextLayer) => {
  const source = layer.text.source;
  if (source.kind !== 'flow' || source.layout.mode !== 'path') return layer.text;
  return {
    ...layer.text,
    source: {
      ...source,
      layout: {
        mode: 'point' as const,
        origin: { x: 0, y: 0 },
        writingMode: 'horizontal-tb' as const
      }
    }
  };
};

const maximumAffineScale = (matrix: AffineMatrix) => {
  const sum = matrix.a ** 2 + matrix.b ** 2 + matrix.c ** 2 + matrix.d ** 2;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return Math.sqrt(Math.max(0,
    (sum + Math.sqrt(Math.max(0, sum ** 2 - 4 * determinant ** 2))) / 2
  ));
};

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
  private outlineRepository: TextGlyphOutlineRepository | null = null;
  private outlineBackend: TextOutlineVectorBackend | null = null;
  private generation = 0;
  private sessionGeneration = 0;
  private sessionId = '';
  private pendingKey = '';
  private sessionKey = '';
  private work: Promise<void> = Promise.resolve();
  private readonly layoutCache = new TextLayoutCache();
  private readonly pathMetricCache = new PathArcLengthCache(PATH_METRIC_CACHE_BYTES);
  private pathMetricDocumentId: string | null = null;
  private readonly settledLayerKeys = new Map<LayerId, string>();
  private readonly expectedLayerKeys = new Map<LayerId, string>();
  private readonly retryCounts = new Map<string, number>();
  private readonly editingLayouts = new Map<LayerId, TextLayerEditingLayout>();
  private readonly interactingLayerScales = new Map<LayerId, number>();
  private readonly interactivelyPreparedLayers = new Set<LayerId>();
  private readonly forcedCachedLayers = new Set<LayerId>();
  private readonly forcedOutlineLayers = new Set<LayerId>();
  private readonly outlineLayerKeys = new Map<LayerId, string>();
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
  private visibleTextLayerCount = 0;
  private preparationStage: TextRenderPresentationSnapshot['preparationStage'] = 'waiting-document';
  private preparationLayerId: LayerId | null = null;
  private lastPreparationError: string | null = null;
  private traceRevision = 0;
  private traceMessage: string | null = null;
  private traceDetails: string | null = null;

  constructor(private readonly options: CoordinatorOptions) {
    options.renderer.setCostObserver((sample) => this.sourceCostModel.observe(sample));
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return false;
    this.active = active;
    this.setPreparationStage(active ? 'idle' : 'suspended');
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
    if (this.disposed) return;
    const revision = port?.revision ?? 0;
    if (this.fontPort === port && this.configuredFontRevision === revision) {
      this.schedule();
      return;
    }
    this.invalidateFontRuntime();
    this.unsubscribeFonts?.();
    this.fontPort = port;
    this.configuredFontRevision = revision;
    this.trace('Font runtime configured', `revision=${revision} faces=${port?.assets.length ?? 0}`);
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
    this.publishChanged();
    this.schedule();
  }

  sync(document: ImageDocument) {
    if (this.disposed) return;
    if (this.pathMetricDocumentId !== document.id) {
      this.pathMetricCache.clear();
      this.pathMetricDocumentId = document.id;
    }
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
    const visibleLayerIds = new Set(visibleEntries.map(({ layer }) => layer.id));
    this.visibleTextLayerCount = visibleEntries.length;
    this.trace(
      'Document synchronized',
      `document=${document.id} textLayers=${allText.length} visible=${visibleEntries.length} fonts=${this.fontPort?.assets.length ?? 0} active=${this.active}`
    );
    // Queue canonical preparation before bookkeeping below. The Promise chain
    // starts in a microtask, so bookkeeping still completes first, while an
    // unrelated retention/diagnostic failure can no longer suppress shaping.
    this.schedule();
    this.trace('Preparation dispatch returned', `document=${document.id}`);
    this.options.renderer.setVisibleLayerIds(new Set(visibleEntries.map(({ layer }) => layer.id)));
    this.trace('Visible text set synchronized', `layers=${visibleEntries.length}`);
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
    for (const layerId of this.forcedOutlineLayers) {
      if (!visibleLayerIds.has(layerId)) this.forcedOutlineLayers.delete(layerId);
    }
    for (const layerId of this.outlineLayerKeys.keys()) {
      if (!retained.has(layerId)) this.outlineLayerKeys.delete(layerId);
    }
    this.inputLatency.retainLayers(visibleLayerIds);
    for (const { layer } of visibleEntries) {
      this.inputLatency.syncSource(layer.id, textLayerSourceKey(layer));
    }
    this.trace('Text input identities synchronized', `layers=${visibleEntries.length}`);
    for (const { layer, transform } of visibleEntries) {
      const editing = this.editingLayouts.get(layer.id);
      if (!editing || !this.interactingLayerScales.has(layer.id)) continue;
      this.editingLayouts.set(layer.id, Object.freeze({
        ...editing,
        preparationKey: this.layerPreparationKey(document.id, layer, transform, this.fontPort?.revision ?? 0),
        localToDocument: Object.freeze({ ...transform })
      }));
    }
    this.trace('Document text housekeeping complete', `document=${document.id}`);
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
      coordinatorActive: this.active,
      configuredFontCount: this.fontPort?.assets.length ?? 0,
      visibleTextLayerCount: this.visibleTextLayerCount,
      preparationStage: this.preparationStage,
      preparationLayerId: this.preparationLayerId,
      lastPreparationError: this.lastPreparationError,
      traceRevision: this.traceRevision,
      traceMessage: this.traceMessage,
      traceDetails: this.traceDetails,
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

  /** Resolves editable layer-local glyph paths without changing the document. */
  async vectorPathsForLayer(layerId: LayerId, signal?: AbortSignal): Promise<readonly VectorPath[] | null> {
    if (this.disposed || !this.hasTextLayer(layerId)) return null;
    await this.work;
    if (signal?.aborted) throw new DOMException('Text conversion was cancelled.', 'AbortError');
    const document = this.document;
    const dependencies = this.dependencies;
    const editing = this.editingLayouts.get(layerId);
    const layer = document && walkLayerTree(document.layers)
      .map(({ node }) => node)
      .find((node): node is TextLayer => node.id === layerId && node.type === 'text');
    if (!document || !dependencies || !editing || !layer) return null;
    const sourceIdentity = textLayerSourceKey(layer);
    const sessionGeneration = this.sessionGeneration;
    const repository = this.outlineRepository ??= this.options.createOutlineRepository?.(dependencies.client)
      ?? new TextGlyphOutlineRepository(dependencies.client);
    const prepared = await prepareTextOutlineVectorDraws(
      repository,
      projectCurrentTextPaint(editing.layout, layer.text.source),
      {
        documentSessionId: this.sessionId,
        sessionGeneration,
        fontSnapshotRevision: this.sessionFontRevision,
        sourceScale: 1
      },
      signal
    );
    const currentNode = this.document && findDocumentLayer(this.document, layerId);
    const current = currentNode?.type === 'text' ? currentNode : null;
    if (this.document !== document
      || this.sessionGeneration !== sessionGeneration
      || !current
      || textLayerSourceKey(current) !== sourceIdentity) return null;
    return Object.freeze(prepared.draws.map(({ path }, index) => {
      const id = `${layerId}:glyph:${index}`;
      return {
        ...path,
        id,
        name: `Glyph ${index + 1}`,
        subpaths: path.subpaths.map((subpath, subpathIndex) => ({
          ...subpath,
          id: `${id}:contour:${subpathIndex}`,
          anchors: subpath.anchors.map((anchor, anchorIndex) => ({
            ...anchor,
            id: `${id}:contour:${subpathIndex}:anchor:${anchorIndex}`,
            position: { ...anchor.position },
            handleIn: anchor.handleIn ? { ...anchor.handleIn } : null,
            handleOut: anchor.handleOut ? { ...anchor.handleOut } : null
          }))
        }))
      };
    }));
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

  /** Waits until every currently visible text layer has an exportable source. */
  async waitForAllSettledSources() {
    if (this.disposed) return false;
    await this.work;
    const openingDocument = this.document;
    if (!openingDocument) return true;
    for (const { layer } of visibleTextLayers(openingDocument)) {
      await this.waitForSettledSource(layer.id);
      if (this.document !== openingDocument) return false;
    }
    return visibleTextLayers(openingDocument).every(({ layer }) =>
      this.isSettledForCurrentGeneration(layer)
    );
  }

  /** Rebuilds visible text through scale-independent outlines before final readback. */
  async waitForFinalOutputSources() {
    if (this.disposed) return false;
    await this.work;
    const openingDocument = this.document;
    const fontRevision = this.fontPort?.revision;
    if (!openingDocument) return true;
    if (fontRevision === undefined) return visibleTextLayers(openingDocument).length === 0;
    const entries = visibleTextLayers(openingDocument);
    let rebuildRequired = false;
    for (const { layer, transform } of entries) {
      const expected = this.layerPreparationKey(
        openingDocument.id, layer, transform, fontRevision
      );
      if (this.outlineLayerKeys.get(layer.id) === expected
        && this.isSettledForCurrentGeneration(layer)) continue;
      this.forcedOutlineLayers.add(layer.id);
      this.settledLayerKeys.delete(layer.id);
      rebuildRequired = true;
    }
    if (rebuildRequired) {
      this.pendingKey = '';
      this.schedule();
      await this.work;
    }
    if (this.document !== openingDocument) return false;
    return visibleTextLayers(openingDocument).every(({ layer, transform }) => {
      const expected = this.layerPreparationKey(
        openingDocument.id, layer, transform, fontRevision
      );
      return this.outlineLayerKeys.get(layer.id) === expected
        && this.isSettledForCurrentGeneration(layer);
    });
  }

  retireSubmittedResources() {
    void this.dependencies?.backend.retireSubmittedResources();
  }

  /** Releases document-owned text state without permanently retiring the coordinator. */
  resetDocument() {
    if (this.disposed) return;
    this.document = null;
    this.visibleTextLayerCount = 0;
    this.invalidateFontRuntime();
    this.interactingLayerScales.clear();
    this.interactivelyPreparedLayers.clear();
    this.forcedCachedLayers.clear();
    this.forcedOutlineLayers.clear();
    this.outlineLayerKeys.clear();
    this.inputLatency.reset();
    this.setPreparationStage('waiting-document');
    this.trace('Document text resources reset');
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
    this.outlineRepository?.clear();
    this.outlineRepository = null;
    this.outlineBackend?.dispose();
    this.outlineBackend = null;
    this.layoutCache.clear();
    this.pathMetricCache.clear();
    this.pathMetricDocumentId = null;
    this.settledLayerKeys.clear();
    this.expectedLayerKeys.clear();
    this.retryCounts.clear();
    this.editingLayouts.clear();
    this.interactingLayerScales.clear();
    this.interactivelyPreparedLayers.clear();
    this.forcedCachedLayers.clear();
    this.forcedOutlineLayers.clear();
    this.outlineLayerKeys.clear();
    this.inputLatency.reset();
    this.publishChanged();
    dependencies?.backend.dispose();
    if (dependencies && sessionId) {
      void dependencies.client.releaseSession(sessionId, sessionGeneration).catch(() => undefined);
    }
  }

  private schedule() {
    try {
      this.scheduleUnsafe();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Text preparation scheduling failed.';
      this.setPreparationStage('failed', null, message);
      this.trace('Preparation scheduling failed', message);
      this.options.onError?.(message);
    }
  }

  private scheduleUnsafe() {
    if (this.disposed) return;
    if (!this.active) {
      this.setPreparationStage('suspended');
      return;
    }
    if (!this.document) {
      this.setPreparationStage('waiting-document');
      return;
    }
    if (!this.fontPort) {
      this.setPreparationStage('waiting-font-port');
      return;
    }
    const layers = visibleTextLayers(this.document);
    this.visibleTextLayerCount = layers.length;
    this.trace('Schedule guard passed', `document=${this.document.id} layers=${layers.length} fonts=${this.fontPort.assets.length}`);
    if (layers.length === 0 || this.fontPort.assets.length === 0) {
      this.abortController?.abort();
      this.abortController = null;
      this.pendingKey = '';
      this.generation += 1;
      this.expectedLayerKeys.clear();
      this.editingLayouts.clear();
      this.setPreparationStage(layers.length === 0 ? 'idle' : 'waiting-fonts');
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
        this.outlineLayerKeys.delete(layerId);
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
    this.trace('Preparation key built', `key=${key} pendingMatch=${key === this.pendingKey}`);
    if (key === this.pendingKey) return;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.pendingKey = key;
    const generation = ++this.generation;
    this.setPreparationStage('loading-runtime');
    this.trace('Preparation scheduled', `generation=${generation} document=${this.document.id} layers=${layers.length} fontRevision=${this.fontPort.revision}`);
    this.work = this.work
      .then(() => {
        // Continuous property gestures can publish several canonical snapshots
        // before the preceding GPU preparation yields. Never let those obsolete
        // snapshots turn into a serialized render backlog: only the newest
        // generation is allowed to enter the worker/GPU preparation path.
        if (abortController.signal.aborted || !this.current(generation, key)) return;
        return this.prepare(generation, key, layers, abortController.signal);
      })
      .catch((reason: unknown) => {
        if (!this.current(generation, key)) return;
        const message = reason instanceof Error ? reason.message : 'Text source preparation failed.';
        this.setPreparationStage('failed', null, message);
        this.options.onError?.(
          message
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
    this.trace('Runtime dependencies ready', `generation=${generation}`);
    this.setPreparationStage('registering-fonts');
    if (!await this.beginSession(
      dependencies, document.id, layers, port, generation, key, signal
    )) return;
    if (!this.current(generation, key)) return;
    const retainedFallbackErrors: string[] = [];
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
      try {
        await this.prepareLayer(
          dependencies, entry.layer, entry.transform, port.revision, generation, key, signal
        );
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (layerDerivedPreviewIsCurrent(entry.layer)) {
          const contextual = `Text layer ${entry.layer.name} (${entry.layer.id}) retained its derived preview: ${message}`;
          retainedFallbackErrors.push(contextual);
          this.trace('Text layer retained derived preview', contextual);
          continue;
        }
        throw reason instanceof Error ? reason : new Error(message);
      }
    }
    this.retryCounts.delete(key);
    if (this.current(generation, key)) {
      this.setPreparationStage('idle', null, retainedFallbackErrors[0] ?? null);
    }
  }

  private async beginSession(
    dependencies: CoordinatorDependencies,
    documentId: string,
    layers: readonly VisibleTextEntry[],
    port: TextFontRuntimePort,
    generation: number,
    key: string,
    signal: AbortSignal
  ) {
    const sessionAssets = referencedFontAssets(layers, port.assets);
    const nextSessionKey = `${documentId}:${sessionAssets.map((asset) =>
      `${asset.assetId}:${asset.faceIndex}:${asset.fingerprintSha256}`
    ).join('|')}`;
    if (this.sessionId && this.sessionKey === nextSessionKey) return true;
    const candidateSessionId = `document-text-${documentId}-${++sessionSequence}`;
    const candidateGeneration = sessionSequence;
    let snapshotRevision = 0;
    this.trace('Font session starting', `session=${candidateSessionId} faces=${sessionAssets.length}`);
    try {
      for (const asset of sessionAssets) {
        const bytes = await port.bytes(asset.assetId);
        this.trace('Font bytes resolved', `asset=${asset.assetId} bytes=${bytes?.byteLength ?? 0}`);
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
        this.trace('Font registered', `asset=${asset.assetId} snapshotRevision=${snapshotRevision}`);
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
    this.trace('Font session published', `session=${candidateSessionId} revision=${snapshotRevision}`);
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
    const source = layer.text.source;
    const authoredPathLayout = source.kind === 'flow' && source.layout.mode === 'path'
      ? source.layout : null;
    const pathDependency = authoredPathLayout && this.document
      ? resolvePathTextDependency(this.document, layer) : null;
    if (authoredPathLayout && pathDependency?.kind !== 'resolved') {
      throw new Error(`Path text ${layer.name} cannot resolve its contour (${pathDependency?.kind ?? 'missing-document'}).`);
    }
    const shapingData = pathShapingData(layer);
    const identity = {
      documentSessionId: this.sessionId,
      sessionGeneration: this.sessionGeneration,
      layerId: layer.id,
      revisions: shapingData.revisions,
      fontSnapshotRevision: this.sessionFontRevision,
      // Vector edits invalidate only the cheap projection below, never shaping.
      pathDependencyRevision: 0,
      options
    };
    const layoutCacheKey = createTextLayoutCacheKey(identity);
    const flowFontSelections = layer.text.source.kind === 'flow'
      ? resolveFlowFontSelections(layer.text.source, this.fontPort?.assets ?? [])
      : { selections: [], missingSourceRunIndices: [] };
    if (flowFontSelections.missingSourceRunIndices.length > 0) {
      throw new Error(
        `Text layer ${layer.name} has unresolved font runs: ${flowFontSelections.missingSourceRunIndices.join(', ')}.`
      );
    }
    this.setPreparationStage('shaping', layer.id);
    let layout = this.layoutCache.get(layoutCacheKey);
    if (!layout) {
      const report = await dependencies.client.realizeTextDetailed({
        kind: 'realize-text',
        ...identity,
        layer: shapingData,
        flowFontSelections: flowFontSelections.selections,
        localToDocument: IDENTITY_MATRIX_3,
        cacheKey: layoutCacheKey
      }, signal);
      layout = report.layout;
      if (!this.current(generation, key)) return;
      this.shapingOperations += 1;
      this.latestShapingRoundTripMs = report.roundTripDurationMs;
      this.layoutCache.set(layoutCacheKey, layout);
      const paragraphCache = report.metrics.paragraphCache;
      this.trace('Text shaped', [
        `layer=${layer.id}`,
        `glyphRuns=${layout.glyphRuns.length}`,
        `roundTripMs=${report.roundTripDurationMs.toFixed(2)}`,
        ...(paragraphCache ? [
          `paragraphHits=${paragraphCache.requestHitCount}`,
          `paragraphShapes=${paragraphCache.requestShapeCount}`,
          `paragraphCache=${paragraphCache.retainedEntryCount}/${paragraphCache.retainedByteLength}`
        ] : [])
      ].join(' '));
    }
    if (!this.current(generation, key)) return;
    let realizedLayout = layout;
    let pathEditing: TextLayerEditingLayout['path'];
    if (authoredPathLayout && source.kind === 'flow' && pathDependency?.kind === 'resolved') {
      const documentToText = invertMatrix(transform);
      if (!documentToText) {
        throw new Error(`Path text ${layer.name} has a singular layer transform.`);
      }
      const pathLayerToText = multiplyMatrices(documentToText, pathDependency.layerToDocument);
      const pathToDocument = multiplyMatrices(pathDependency.layerToDocument, pathDependency.path.transform);
      const documentScale = maximumAffineScale(pathToDocument);
      if (!(documentScale > 0) || !Number.isFinite(documentScale)) {
        throw new Error(`Path text ${layer.name} references a singular contour transform.`);
      }
      const table = this.pathMetricCache.realize(
        pathDependency.path,
        pathDependency.subpath.id,
        pathLayerToText,
        0.25 / documentScale
      );
      const projection = projectRigidGlyphRunsToPath(
        layout,
        authoredPathLayout,
        table,
        pathAlignment(source)
      );
      realizedLayout = Object.freeze({
        ...layout,
        key: [
          layout.key, 'path', pathDependency.revision, table.key,
          projection.range.start, projection.range.end, projection.range.origin,
          projection.range.direction, authoredPathLayout.side,
          authoredPathLayout.upright ? 1 : 0
        ].join(':'),
        glyphRuns: projection.glyphRuns
      });
      pathEditing = Object.freeze({
        pathLayout: authoredPathLayout,
        table,
        projection
      });
      this.trace(
        'Path text projected',
        `layer=${layer.id} length=${table.length.toFixed(2)} glyphRuns=${realizedLayout.glyphRuns.length}`
      );
    }
    this.publishEditingLayout(layer, realizedLayout, transform, fontPortRevision, pathEditing);
    this.publishChanged();
    this.options.requestRender();
    this.setPreparationStage('rasterizing', layer.id);
    const paintedLayout = projectCurrentTextPaint(realizedLayout, layer.text.source);
    const finalOutput = this.forcedOutlineLayers.has(layer.id);
    const realization = selectTextRealizationRoute(paintedLayout, {
      documentScale: sourceScale,
      purpose: finalOutput ? 'final-output' : 'interactive'
    });
    if (realization.route === 'outline-vector') {
      this.trace(
        'Outline fidelity selected',
        `layer=${layer.id} reason=${realization.reason} targetPpem=${realization.targetPpem.toFixed(2)}`
      );
      await this.prepareOutlineSource(
        dependencies, layer, transform, fontPortRevision, paintedLayout,
        sourceScale, generation, key, signal
      );
      return;
    }
    const prepared = await this.prepareDraws(
      dependencies,
      paintedLayout,
      sourceScale,
      generation,
      key,
      signal
    );
    this.outlineLayerKeys.delete(layer.id);
    this.trace('Glyph coverage ready', `layer=${layer.id} draws=${prepared.draws.length}`);
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
        this.setPreparationStage('publishing', layer.id);
        const candidate = this.options.renderer.prepareAtlasSource(
          layer,
          dependencies.backend,
          prepared.draws,
          sourceScale,
          `${realizedLayout.key}:${layer.text.revisions.paint}:${sourceScale}`,
          prepared.release
        );
        if (!this.current(generation, key)) {
          candidate.discard();
          return;
        }
        candidate.publish();
        this.trace('Atlas source published', `layer=${layer.id} draws=${prepared.draws.length}`);
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
    this.setPreparationStage('publishing', layer.id);
    try {
      candidate = this.options.renderer.prepareTightSource(
        encoder,
        layer,
        dependencies.backend,
        prepared.draws,
        sourceScale,
        `${realizedLayout.key}:${layer.text.revisions.paint}:${sourceScale}`
      );
    } finally {
      prepared.release();
    }
    if (!candidate) {
      this.options.renderer.markTransparent(layer);
      this.trace('Transparent text source published', `layer=${layer.id}`);
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
    this.trace('Cached text source published', `layer=${layer.id}`);
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

  private async prepareOutlineSource(
    dependencies: CoordinatorDependencies,
    layer: TextLayer,
    transform: AffineMatrix,
    fontPortRevision: number,
    layout: RealizedTextLayout,
    sourceScale: number,
    generation: number,
    key: string,
    signal: AbortSignal
  ) {
    const repository = this.outlineRepository ??= this.options.createOutlineRepository?.(dependencies.client)
      ?? new TextGlyphOutlineRepository(dependencies.client);
    const prepared = await prepareTextOutlineVectorDraws(repository, layout, {
      documentSessionId: this.sessionId,
      sessionGeneration: this.sessionGeneration,
      fontSnapshotRevision: this.sessionFontRevision,
      sourceScale
    }, signal);
    if (!this.current(generation, key)) return;
    this.trace(
      'Glyph outlines ready',
      `layer=${layer.id} draws=${prepared.draws.length} unique=${prepared.uniqueOutlineCount}`
    );
    if (prepared.draws.length === 0) {
      this.options.renderer.markTransparent(layer);
      this.finishLayerPreparation(layer, transform, fontPortRevision);
      this.trace('Transparent outline text source published', `layer=${layer.id}`);
      return;
    }
    const backend = this.outlineBackend ??= this.options.createOutlineBackend?.(this.options.device)
      ?? new TextOutlineVectorBackend(
        this.options.device,
        { maximumTextureDimension: this.options.device.limits?.maxTextureDimension2D ?? 8_192 }
      );
    const encoder = this.options.device.createCommandEncoder({
      label: `LightTable outline text source: ${layer.name}`
    });
    const surface = backend.encodeTight(encoder, prepared.draws);
    if (!surface) {
      this.options.renderer.markTransparent(layer);
      this.finishLayerPreparation(layer, transform, fontPortRevision);
      return;
    }
    this.setPreparationStage('publishing', layer.id);
    try {
      this.options.device.queue.submit([encoder.finish()]);
      this.textCacheSubmissions += 1;
    } catch (error) {
      surface.dispose();
      throw error;
    }
    try {
      this.options.renderer.publish({
        layerId: layer.id,
        texture: surface.texture,
        width: surface.width,
        height: surface.height,
        localBounds: {
          x: surface.sourceBounds.x / sourceScale,
          y: surface.sourceBounds.y / sourceScale,
          width: surface.sourceBounds.width / sourceScale,
          height: surface.sourceBounds.height / sourceScale
        },
        sourceScale,
        sourceKey: `${layout.key}:${layer.text.revisions.paint}:${sourceScale}:outline-v1`,
        authoredKey: textLayerSourceKey(layer),
        mode: 'cached',
        byteLength: surface.byteLength,
        destroy: surface.dispose
      });
    } catch (error) {
      surface.dispose();
      throw error;
    }
    this.trace('Outline text source published', `layer=${layer.id} draws=${prepared.draws.length}`);
    this.finishLayerPreparation(layer, transform, fontPortRevision);
    void backend.notifySubmitted();
  }

  private finishLayerPreparation(
    layer: TextLayer,
    transform: AffineMatrix,
    fontPortRevision: number
  ) {
    this.forcedCachedLayers.delete(layer.id);
    this.forcedOutlineLayers.delete(layer.id);
    this.outlineLayerKeys.set(
      layer.id,
      this.layerPreparationKey(this.document!.id, layer, transform, fontPortRevision)
    );
    this.settledLayerKeys.set(
      layer.id,
      this.layerPreparationKey(this.document!.id, layer, transform, fontPortRevision)
    );
    if (this.interactingLayerScales.has(layer.id)) {
      this.interactivelyPreparedLayers.add(layer.id);
    }
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
        color: draw.color,
        ...(draw.clip ? { clip: draw.clip } : {})
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
    fontPortRevision: number,
    path?: TextLayerEditingLayout['path']
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
      localToDocument: Object.freeze({ ...transform }),
      ...(path ? { path } : {})
    }));
  }

  private invalidateFontRuntime() {
    this.abortController?.abort();
    this.abortController = null;
    this.generation += 1;
    this.pendingKey = '';
    this.layoutCache.clear();
    this.outlineRepository?.clear();
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

  private trace(message: string, details: string | null = null) {
    this.traceRevision += 1;
    this.traceMessage = message;
    this.traceDetails = details;
    this.publishChanged();
  }

  private setPreparationStage(
    stage: TextRenderPresentationSnapshot['preparationStage'],
    layerId: LayerId | null = null,
    error: string | null = null
  ) {
    if (
      this.preparationStage === stage
      && this.preparationLayerId === layerId
      && this.lastPreparationError === error
    ) return;
    this.preparationStage = stage;
    this.preparationLayerId = layerId;
    this.lastPreparationError = error;
    this.publishChanged();
  }

  private layerPreparationKey(
    documentId: string,
    layer: TextLayer,
    transform: AffineMatrix,
    fontRevision: number
  ) {
    const pathTransform = layer.text.source.kind === 'flow'
      && layer.text.source.layout.mode === 'path'
      ? `:${transform.a},${transform.b},${transform.c},${transform.d},${transform.tx},${transform.ty}`
      : '';
    return `${documentId}:${layer.id}:${textLayerSourceKey(layer)}:${fontRevision}:${this.pathDependencyRevision(layer)}:${this.sourceScaleForLayer(layer.id, transform)}${pathTransform}`;
  }

  private pathDependencyRevision(layer: TextLayer) {
    return this.document ? resolvePathTextDependency(this.document, layer).revision : 0;
  }

  private sourceScaleForLayer(layerId: LayerId, transform: AffineMatrix) {
    return this.interactingLayerScales.get(layerId) ?? sourceScaleFor(transform);
  }
}
