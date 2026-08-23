import {
  type GroupLayer,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type RasterMask,
  type Rect,
  type VectorLayer,
  type TextLayer,
  layerDerivedPreviewIsCurrent
} from '../document/documentTypes';
import { blendModeGpuValue, type BlendMode } from '../document/blendModes';
import { invertMatrix, multiplyMatrices } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import {
  identityAffineMatrix,
  isIdentityAffineMatrix,
  rasterRenderContract
} from './renderContract';
import { layerStyleStackIsActive } from '../styles/layerStyleDefaults';
import {
  layerStyleCacheKey,
  layerStyleDocumentBounds,
  layerSourceStyleCacheKey,
  layerSourceStyleDocumentBounds,
  persistentLayerStyleCacheKey
} from '../styles/layerStyleRenderPlan';
import {
  analyzeDocumentComposite,
  buildCompositorPlan,
  splitActiveProcessingCheckpoint,
  splitTopmostProcessingSuffix,
  type CompositorPlan,
  type CompositorPlanEntry
} from './compositorGraph';
import type { GeometryPreviewStore } from './GeometryPreviewStore';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { LayerStyleRenderer } from './LayerStyleRenderer';
import type { PixelEditSessionStore } from './PixelEditSessionStore';
import type { RenderTargetPair } from './RenderTargetPair';
import type { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import type { TransformSessionStore } from './TransformSessionStore';
import type { EncodeAdjustment } from './RasterDocumentOperations';
import type { VectorLayerRenderer } from './VectorLayerRenderer';
import { textPlaceholderVectorLayer } from './textPlaceholderPresentation';
import type { DevelopmentTextFixtureRenderer } from '../../text/rendering/DevelopmentTextFixtureRenderer';
import type { TextLayerRenderer } from '../../text/rendering/TextLayerRenderer';
import {
  documentBlendProfileGpuValue,
  documentBlendQuantization
} from '../color/documentColorTransform';
import { planRenderIslands, type RenderIslandPlan } from './RenderIslandPlanner';
import {
  RetainedRenderIslandRegistry,
  type RetainedRenderIsland
} from './RetainedRenderIslandRegistry';

interface LayerCompositorOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  compositePipeline: GPURenderPipeline;
  adjustmentMixPipeline: GPURenderPipeline;
  layerResources: LayerRuntimeStore;
  targets: RenderTargetPair;
  submittedResources: SubmittedResourceRetainer;
  transformSessions: TransformSessionStore;
  pixelEditSessions: PixelEditSessionStore;
  geometryPreviews: GeometryPreviewStore;
  layerStyles: LayerStyleRenderer;
  vectors: VectorLayerRenderer;
  texts?: TextLayerRenderer;
  developmentTextFixture?: DevelopmentTextFixtureRenderer;
  dimensions: () => { width: number; height: number };
  syncDocument: (document: ImageDocument) => void;
  maskTextureFor: (layerId: LayerId) => GPUTexture | null;
  createTexture: (label: string) => GPUTexture;
  clearTexture: (encoder: GPUCommandEncoder, texture: GPUTexture) => void;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

const rasterLayerHasEnabledProcessing = (
  layer: Extract<LayerNode, { type: 'raster' }>
) => Boolean(
  layer.adjustmentStack
  || layer.attachedAdjustments?.some(({ enabled }) => enabled)
);

/**
 * Evaluates the document compositor plan into a GPU texture.
 *
 * This is the only service that knows how document ordering, groups,
 * clipping chains, masks, transforms, local adjustments and Layer Styles
 * become ordered render passes. Resource stores retain ownership of their
 * textures; the compositor only coordinates them.
 */
export class LayerCompositor {
  private blendProfile = 0;
  private blendQuantization = 0;
  private topmostBaseTexture: GPUTexture | null = null;
  private topmostBaseDocumentId: string | null = null;
  private topmostBaseNodes: readonly ImageDocument['layers'][number][] = [];
  private topmostBaseContract = '';
  private topmostBaseHits = 0;
  private topmostBaseMisses = 0;
  private topmostSuffixCacheEnabled = true;
  private compositeProfilingEnabled = false;
  private compositeExecutions = 0;
  private compositeTotalMs = 0;
  private compositeLastMs = 0;
  private compositeMaximumMs = 0;
  private islandPlan: RenderIslandPlan | null = null;
  private islandPlanningExecutions = 0;
  private islandPlanningTotalMs = 0;
  private islandPlanningLastMs = 0;
  private islandPlanningMaximumMs = 0;
  private velloIslandCandidateKeys = new Set<string>();
  private readonly retainedIslands = new RetainedRenderIslandRegistry();

  constructor(private readonly options: LayerCompositorOptions) {}

  topmostSuffixCacheTelemetry() {
    const { width, height } = this.options.dimensions();
    return {
      hits: this.topmostBaseHits,
      misses: this.topmostBaseMisses,
      bytes: this.topmostBaseTexture ? width * height * 8 : 0
    };
  }

  resetCompositeTelemetry() {
    this.compositeProfilingEnabled = true;
    this.compositeExecutions = 0;
    this.compositeTotalMs = 0;
    this.compositeLastMs = 0;
    this.compositeMaximumMs = 0;
    this.islandPlan = null;
    this.islandPlanningExecutions = 0;
    this.islandPlanningTotalMs = 0;
    this.islandPlanningLastMs = 0;
    this.islandPlanningMaximumMs = 0;
    this.velloIslandCandidateKeys.clear();
  }

  compositeTelemetry() {
    return {
      executions: this.compositeExecutions,
      totalMs: this.compositeTotalMs,
      lastMs: this.compositeLastMs,
      maximumMs: this.compositeMaximumMs
    };
  }

  renderIslandTelemetry() {
    return {
      plan: this.islandPlan ? {
        canonicalVectorLayerCount: this.islandPlan.canonicalVectorLayerCount,
        projectedSurfaceCount: this.islandPlan.projectedSurfaceCount,
        directVectorRuns: this.islandPlan.islands.filter(
          ({ role }) => role === 'direct-vector-run'
        ).length,
        isolatedVectorGroups: this.islandPlan.islands.filter(
          ({ role }) => role === 'isolated-vector-group'
        ).length,
        velloEligibleIslands: this.islandPlan.islands.filter(
          ({ backendEligibility }) => backendEligibility.vello
        ).length,
        islands: this.islandPlan.islands.map(island => ({
          candidateKey: island.candidateKey,
          role: island.role,
          canonicalLayerIds: island.canonicalLayerIds,
          isolationOwnerId: island.isolationOwnerId,
          backendEligibility: island.backendEligibility,
          complexity: island.complexity,
          boundaryReasons: island.boundaryReasons,
          selectedBackend: this.velloIslandCandidateKeys.has(island.candidateKey)
            ? 'vello' as const
            : 'current' as const
        }))
      } : null,
      timing: {
        executions: this.islandPlanningExecutions,
        totalMs: this.islandPlanningTotalMs,
        lastMs: this.islandPlanningLastMs,
        maximumMs: this.islandPlanningMaximumMs
      }
    };
  }

  setTopmostSuffixCacheEnabled(enabled: boolean) {
    this.topmostSuffixCacheEnabled = enabled;
    if (!enabled) this.destroyCaches();
  }

  destroyCaches() {
    this.topmostBaseTexture?.destroy();
    this.topmostBaseTexture = null;
    this.topmostBaseDocumentId = null;
    this.topmostBaseNodes = [];
    this.topmostBaseContract = '';
  }

  encode(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment,
    includeDevelopmentTextFixture = false,
    excludedLayerIds: ReadonlySet<LayerId> = new Set()
  ): GPUTexture {
    const {
      layerResources,
      targets,
      transformSessions,
      pixelEditSessions,
      geometryPreviews,
      layerStyles,
      vectors
    } = this.options;
    const { width, height } = this.options.dimensions();
    this.blendProfile = documentBlendProfileGpuValue(document.colorSettings.blendProfile);
    this.blendQuantization = documentBlendQuantization(document.colorSettings.bitDepth);
    layerStyles.setBlendProfile?.(this.blendProfile, this.blendQuantization);
    this.options.syncDocument(document);
    const planningStartedAt = this.compositeProfilingEnabled ? performance.now() : 0;
    const canonicalIslandPlan = planRenderIslands(document.layers);
    const transientVectorBarriers = new Set<LayerId>();
    // A moving member of a direct vector run becomes a transient dynamic
    // layer. Split only that run around it; unchanged neighbours remain in
    // retained Vello islands instead of falling back to N per-layer surfaces.
    for (const island of canonicalIslandPlan.islands) {
      if (island.role !== 'direct-vector-run') continue;
      for (const { layer } of island.members) {
        if (geometryPreviews.resolve(layer.id, layer.geometryRevision)) {
          transientVectorBarriers.add(layer.id);
        }
      }
    }
    const plannedIslands = transientVectorBarriers.size > 0
      ? planRenderIslands(document.layers, { transientVectorBarriers })
      : canonicalIslandPlan;
    const retainedIslandPlan = this.retainedIslands.reconcile(plannedIslands);
    if (this.compositeProfilingEnabled) {
      this.islandPlan = plannedIslands;
      const durationMs = performance.now() - planningStartedAt;
      this.islandPlanningExecutions += 1;
      this.islandPlanningTotalMs += durationMs;
      this.islandPlanningLastMs = durationMs;
      this.islandPlanningMaximumMs = Math.max(this.islandPlanningMaximumMs, durationMs);
    }
    const islandTextures = new Map<string, GPUTexture>();
    this.velloIslandCandidateKeys.clear();
    const islandRenderingEnabled = excludedLayerIds.size === 0
      && typeof vectors.canRenderIsland === 'function';
    const renderableIslands = islandRenderingEnabled
      ? retainedIslandPlan.islands.filter(island => (
        vectors.canRenderIsland(island)
        && island.members.every(
        ({ layer }) => !geometryPreviews.resolve(layer.id, layer.geometryRevision)
        )
      ))
      : [];
    let islandRenderingActive = renderableIslands.length > 0;
    if (islandRenderingActive) {
      vectors.prepareIslandFrame(renderableIslands);
      for (const island of renderableIslands) {
        if (!island.members.some(member => member.participates)) continue;
        const texture = vectors.encodeIsland(island, { width, height });
        if (!texture) {
          islandRenderingActive = false;
          islandTextures.clear();
          this.velloIslandCandidateKeys.clear();
          break;
        }
        islandTextures.set(island.resourceId, texture);
        this.velloIslandCandidateKeys.add(island.candidateKey);
      }
    }
    const analysis = analyzeDocumentComposite(
      document.layers,
      (layerId) => Boolean(this.options.maskTextureFor(layerId))
    );
    const visibleLayers = analysis.visibleRasterLayers.filter(
      (layer) => layer.visible && layer.opacity > 0 && !excludedLayerIds.has(layer.id)
    );
    const visibleLeafNodes = analysis.visibleLeafNodes.filter(
      layer => !excludedLayerIds.has(layer.id)
    );
    const retainedIslandOwnerIds = new Set(
      renderableIslands.flatMap(island => (
        island.isolationOwnerId ? [island.isolationOwnerId] : []
      ))
    );
    const retainedIslandLayerIds = new Set(
      renderableIslands.flatMap(island => island.canonicalLayerIds)
    );
    const retainedVectorResources = new Set<string>();
    const retainDocumentVectorResources = (nodes: readonly LayerNode[]) => {
      for (const node of nodes) {
        if (
          node.type === 'text'
          || (node.type === 'vector' && !retainedIslandLayerIds.has(node.id))
        ) {
          retainedVectorResources.add(node.id);
        }
        if (node.type !== 'group') continue;
        if (
          node.vectorClip
          && (!islandRenderingActive || !retainedIslandOwnerIds.has(node.id))
        ) {
          retainedVectorResources.add(node.id);
        }
        retainDocumentVectorResources(node.children);
      }
    };
    retainDocumentVectorResources(document.layers);
    if (islandRenderingActive) {
      for (const island of renderableIslands) {
        retainedVectorResources.add(island.resourceId);
      }
    }
    vectors.retainLayerIds(retainedVectorResources);
    const retainedIslandByLayerId = new Map<LayerId, RetainedRenderIsland>();
    const retainedIslandByOwnerId = new Map<LayerId, RetainedRenderIsland>();
    for (const island of retainedIslandPlan.islands) {
      for (const layerId of island.canonicalLayerIds) {
        retainedIslandByLayerId.set(layerId, island);
      }
      if (island.isolationOwnerId) {
        retainedIslandByOwnerId.set(island.isolationOwnerId, island);
      }
    }
    const compositedIslandIds = new Set<string>();
    if (!analysis.activeLayerStyles) {
      layerStyles.releaseTargets();
      layerStyles.releaseCache();
    }
    if (
      visibleLayers.length === 1
      && visibleLeafNodes.length === 1
      && document.layers.length === 1
      && !(includeDevelopmentTextFixture && this.options.developmentTextFixture?.hasReadyPlan)
    ) {
      const layer = visibleLayers[0];
      const runtime = layerResources.raster(layer.id);
      const geometryPreview = geometryPreviews.resolve(
        layer.id,
        layer.geometryRevision
      );
      if (
        runtime
        && layer.opacity >= 0.99999
        && layer.fillOpacity >= 0.99999
        && layer.blendMode === 'normal'
        && !layer.mask?.enabled
        && !transformSessions.current
        && !geometryPreview
        && !layerStyleStackIsActive(layer.styleStack)
        && !rasterLayerHasEnabledProcessing(layer)
        && isIdentityAffineMatrix(layer.transform)
        && layer.width === width
        && layer.height === height
      ) {
        targets.destroy();
        return runtime.texture;
      }
    }

    if (
      visibleLeafNodes.length === 0
      && !(includeDevelopmentTextFixture && this.options.developmentTextFixture?.hasReadyPlan)
    ) {
      const transparentTarget = targets.ensureSingle();
      this.options.clearTexture(encoder, transparentTarget);
      return transparentTarget;
    }

    const [compositeA, compositeB] = targets.ensure();
    this.options.clearTexture(encoder, compositeA);

    const compositeTexture = (
      background: GPUTexture,
      foreground: GPUTexture,
      target: GPUTexture,
      settings: {
        label: string;
        opacity: number;
        blendMode: BlendMode;
        maskTexture?: GPUTexture | null;
        mask?: RasterMask | null;
        clippingTexture?: GPUTexture | null;
        sourceBounds?: Rect;
        /** Maps destination document pixels back into an already-rendered source. */
        sourceInverseTransform?: AffineMatrix;
      }
    ) => {
      const compositeStartedAt = this.compositeProfilingEnabled ? performance.now() : 0;
      const sourceBounds = settings.sourceBounds ?? { x: 0, y: 0, width, height };
      const settingsBuffer = this.createCompositeSettingsBuffer(
        settings.label,
        settings.opacity,
        Boolean(settings.mask?.enabled && settings.maskTexture),
        blendModeGpuValue(settings.blendMode),
        Boolean(settings.clippingTexture),
        settings.sourceInverseTransform
          ?? { a: 1, b: 0, c: 0, d: 1, tx: -sourceBounds.x, ty: -sourceBounds.y },
        { width: sourceBounds.width, height: sourceBounds.height },
        settings.mask ?? null,
        invertMatrix(settings.mask?.transform ?? identityAffineMatrix()) ?? identityAffineMatrix()
      );
      const bindGroup = this.options.device.createBindGroup({
        layout: this.options.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: background.createView() },
          { binding: 1, resource: foreground.createView() },
          { binding: 2, resource: this.options.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (settings.maskTexture ?? foreground).createView() },
          { binding: 5, resource: (settings.clippingTexture ?? foreground).createView() }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        this.options.compositePipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      if (this.compositeProfilingEnabled) {
        const durationMs = performance.now() - compositeStartedAt;
        this.compositeExecutions += 1;
        this.compositeTotalMs += durationMs;
        this.compositeLastMs = durationMs;
        this.compositeMaximumMs = Math.max(this.compositeMaximumMs, durationMs);
      }
    };

    const renderNode = (
      entry: CompositorPlanEntry,
      background: GPUTexture,
      target: GPUTexture,
      clippingTexture: GPUTexture | null = null,
      inheritedTransform: AffineMatrix = identityAffineMatrix()
    ): [GPUTexture, GPUTexture] => {
      const { node } = entry;
      if (excludedLayerIds.has(node.id)) return [background, target];
      if (!node.visible || node.opacity <= 0) return [background, target];
      if (islandRenderingActive && node.type === 'group') {
        const island = retainedIslandByOwnerId.get(node.id);
        const texture = island ? islandTextures.get(island.resourceId) : null;
        if (island && texture && !compositedIslandIds.has(island.resourceId)) {
          compositedIslandIds.add(island.resourceId);
          compositeTexture(background, texture, target, {
            label: `LightTable vector island group settings: ${node.name}`,
            opacity: node.opacity,
            blendMode: node.blendMode,
            clippingTexture
          });
          return [target, background];
        }
      }
      if (node.type === 'group') {
        return renderGroup(entry, background, target, clippingTexture, inheritedTransform);
      }
      if (node.type === 'adjustment') {
        if (!encodeAdjustment) return [background, target];
        const adjusted = encodeAdjustment(encoder, background, node);
        // A neutral/disabled processing owner returns its input by identity.
        // In that case mask, opacity and blend cannot change any pixel, so the
        // adjustment mix itself is an exact zero-work bypass as well.
        if (adjusted === background) return [background, target];
        const maskTexture = this.options.maskTextureFor(node.id);
        const settingsBuffer = this.options.device.createBuffer({
          label: `LightTable adjustment mix settings: ${node.name}`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.options.device.queue.writeBuffer(
          settingsBuffer,
          0,
          new Float32Array([
            node.opacity,
            node.mask?.enabled && maskTexture ? 1 : 0,
            clippingTexture ? 1 : 0,
            blendModeGpuValue(node.blendMode),
            node.mask?.density ?? 1,
            node.mask?.feather ?? 0,
            this.blendProfile,
            this.blendQuantization
          ])
        );
        this.options.submittedResources.retainBuffer(settingsBuffer);
        const bindGroup = this.options.device.createBindGroup({
          layout: this.options.adjustmentMixPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: background.createView() },
            { binding: 1, resource: adjusted.createView() },
            { binding: 2, resource: this.options.sampler },
            { binding: 3, resource: { buffer: settingsBuffer } },
            { binding: 4, resource: (maskTexture ?? background).createView() },
            { binding: 5, resource: (clippingTexture ?? background).createView() }
          ]
        });
        this.options.drawFullscreen(
          encoder,
          this.options.adjustmentMixPipeline,
          bindGroup,
          target.createView(),
          { r: 0, g: 0, b: 0, a: 0 }
        );
        return [target, background];
      }

      if ((node.type === 'text' || node.type === 'vector')
        && layerDerivedPreviewIsCurrent(node)
        && layerResources.derivedPreview(node.id)) {
        const geometryPreview = geometryPreviews.resolve(node.id, node.geometryRevision);
        return renderDerivedPreview(
          node,
          background,
          target,
          clippingTexture,
          inheritedTransform,
          geometryPreview
        );
      }

      if (node.type === 'vector') {
        if (islandRenderingActive) {
          const island = retainedIslandByLayerId.get(node.id);
          if (island) {
            if (compositedIslandIds.has(island.resourceId)) return [background, target];
            const texture = islandTextures.get(island.resourceId);
            if (texture) {
              compositedIslandIds.add(island.resourceId);
              compositeTexture(background, texture, target, {
                label: `LightTable vector island settings: ${island.resourceId}`,
                opacity: island.role === 'direct-vector-run'
                  ? 1
                  : node.opacity * node.fillOpacity,
                blendMode: island.role === 'direct-vector-run' ? 'normal' : node.blendMode,
                clippingTexture
              });
              return [target, background];
            }
          }
        }
        const geometryPreview = geometryPreviews.resolve(node.id, node.geometryRevision);
        if (
          geometryPreview
          && !node.mask?.enabled
          && !layerStyleStackIsActive(node.styleStack)
        ) {
          const sourceToDocument = multiplyMatrices(inheritedTransform, node.transform);
          const previewToDocument = multiplyMatrices(inheritedTransform, geometryPreview);
          const documentToSource = invertMatrix(sourceToDocument);
          const documentToPreview = invertMatrix(previewToDocument);
          const sourceToPreview = documentToSource
            ? multiplyMatrices(previewToDocument, documentToSource)
            : null;
          // Pure moves do not change vector coverage. Keep the canonical Vello
          // surface warm and move its pixels in the compositor instead of
          // rasterizing a document-sized vector surface on every pointer frame.
          if (
            sourceToPreview
            && documentToPreview
            && Math.abs(sourceToPreview.a - 1) <= 1e-6
            && Math.abs(sourceToPreview.b) <= 1e-6
            && Math.abs(sourceToPreview.c) <= 1e-6
            && Math.abs(sourceToPreview.d - 1) <= 1e-6
          ) {
            // Translate the already-painted canonical surface. SVG
            // user/document-space gradients then remain attached. Clipping is
            // still evaluated afterwards, in document space, by the compositor.
            return renderVectorLayer(
              node,
              background,
              target,
              clippingTexture,
              inheritedTransform,
              multiplyMatrices(sourceToDocument, documentToPreview)
            );
          }
        }
        return renderVectorLayer(
          geometryPreview ? { ...node, transform: geometryPreview } : node,
          background,
          target,
          clippingTexture,
          inheritedTransform
        );
      }

      if (node.type === 'text') {
        const geometryPreview = geometryPreviews.resolve(node.id, node.geometryRevision);
        const textNode = geometryPreview ? { ...node, transform: geometryPreview } : node;
        if (this.options.texts?.isTransparent?.(textNode)) return [background, target];
        const directEligible = textNode.opacity === 1
          && textNode.fillOpacity === 1
          && textNode.blendMode === 'normal'
          && !textNode.clipping
          && !textNode.mask?.enabled
          && !layerStyleStackIsActive(textNode.styleStack);
        if (directEligible && this.options.texts?.encodeAtlasPresentation?.(
          encoder,
          textNode,
          inheritedTransform,
          { texture: background, width, height }
        )) {
          return [background, target];
        }
        const source = this.options.texts?.resolvePresentation(textNode, inheritedTransform) ?? null;
        if (!source) {
          // A stale imported preview is still the safest visual fallback while an
          // explicitly replaced font is unavailable or its exact source rebuild
          // has not landed. Exact semantic text always wins as soon as it exists.
          if (textNode.derivedPreview && layerResources.derivedPreview(textNode.id)) {
            return renderDerivedPreview(
              textNode, background, target, clippingTexture, inheritedTransform,
              geometryPreview
            );
          }
          return renderVectorLayer(
            textPlaceholderVectorLayer(textNode),
            background,
            target,
            clippingTexture,
            inheritedTransform
          );
        }
        const inverse = invertMatrix(source.transform);
        const maskTexture = this.options.maskTextureFor(node.id);
        if (layerStyleStackIsActive(node.styleStack) && inverse) {
          const styleBounds = layerSourceStyleDocumentBounds(
            node,
            source,
            { width, height }
          );
          if (styleBounds.width <= 0 || styleBounds.height <= 0) {
            return [background, target];
          }
          const styleQuality = layerStyles.cacheKeyQuality(node.id);
          const styled = layerStyles.encode(
            encoder,
            node,
            source.texture,
            maskTexture,
            inverse,
            source.dimensions,
            styleBounds,
            persistentLayerStyleCacheKey(layerSourceStyleCacheKey(
              node,
              source,
              styleQuality
            ), styleQuality)
          );
          if (styled) {
            compositeTexture(background, styled.texture, target, {
              label: `LightTable styled text layer settings: ${node.name}`,
              opacity: node.opacity,
              blendMode: node.blendMode,
              clippingTexture,
              sourceBounds: styled.bounds
            });
            return [target, background];
          }
        }
        const compositeStartedAt = performance.now();
        const settingsBuffer = this.createCompositeSettingsBuffer(
          `LightTable text layer settings: ${node.name}`,
          inverse ? node.opacity * node.fillOpacity : 0,
          Boolean(node.mask?.enabled && maskTexture),
          blendModeGpuValue(node.blendMode),
          Boolean(clippingTexture),
          inverse ?? identityAffineMatrix(),
          source.dimensions,
          node.mask,
          invertMatrix(node.mask?.transform ?? identityAffineMatrix()) ?? identityAffineMatrix()
        );
        const bindGroup = this.options.device.createBindGroup({
          layout: this.options.compositePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: background.createView() },
            { binding: 1, resource: source.texture.createView() },
            { binding: 2, resource: this.options.sampler },
            { binding: 3, resource: { buffer: settingsBuffer } },
            { binding: 4, resource: (maskTexture ?? source.texture).createView() },
            { binding: 5, resource: (clippingTexture ?? source.texture).createView() }
          ]
        });
        this.options.drawFullscreen(
          encoder,
          this.options.compositePipeline,
          bindGroup,
          target.createView(),
          { r: 0, g: 0, b: 0, a: 0 }
        );
        this.options.texts?.observeCachedComposite?.(
          node,
          Math.max(0, performance.now() - compositeStartedAt)
        );
        return [target, background];
      }

      const layer = node;
      const runtime = layerResources.raster(layer.id);
      if (!runtime) return [background, target];
      const activeTransform = transformSessions.current?.layerId === layer.id
        ? transformSessions.current
        : null;
      const transformUsesPreview = Boolean(
        activeTransform && activeTransform.previewMode !== 'none'
      );
      const ungradedForegroundTexture = transformUsesPreview && activeTransform
        ? activeTransform.previewTexture ?? runtime.texture
        : runtime.texture;
      const foregroundTexture = rasterLayerHasEnabledProcessing(layer) && encodeAdjustment
        ? encodeAdjustment(encoder, ungradedForegroundTexture, layer)
        : ungradedForegroundTexture;
      const renderContract = rasterRenderContract(layer, foregroundTexture);
      // Transform previews are rendered into a document-sized texture. A tight
      // placed layer can have completely different source dimensions; feeding
      // those dimensions to the compositor remaps the correct projective image
      // into the old tight rectangle and visibly detaches it from its gizmo.
      const foregroundDimensions = transformUsesPreview
        ? { width, height }
        : { width: runtime.width, height: runtime.height };
      const geometryPreview = geometryPreviews.resolve(
        layer.id,
        layer.geometryRevision
      );
      const sourceToDocument = activeTransform
        ? transformUsesPreview
          ? identityAffineMatrix()
          : activeTransform.matrix
        : multiplyMatrices(
            inheritedTransform,
            geometryPreview ?? renderContract.transform
          );
      const inverse = invertMatrix(sourceToDocument);
      const maskToDocument = (() => {
        const authored = layer.mask?.transform ?? identityAffineMatrix();
        if (!layer.mask?.linked || !activeTransform || transformUsesPreview) return authored;
        const layerInverse = invertMatrix(layer.transform);
        return layerInverse
          ? multiplyMatrices(
              multiplyMatrices(activeTransform.matrix, layerInverse),
              authored
            )
          : authored;
      })();
      const maskInverse = invertMatrix(maskToDocument) ?? identityAffineMatrix();

      if (layerStyleStackIsActive(layer.styleStack) && inverse) {
        const styleBounds = transformUsesPreview
          ? { x: 0, y: 0, width, height }
          : layerStyleDocumentBounds(
              layer,
              { width, height },
              sourceToDocument
            );
        if (styleBounds.width <= 0 || styleBounds.height <= 0) {
          return [background, target];
        }
        const activePixelEdit = pixelEditSessions.current?.layerId === layer.id;
        const styleQuality = layerStyles.cacheKeyQuality(layer.id);
        const styleCacheKey = activeTransform || activePixelEdit
          ? null
          : persistentLayerStyleCacheKey(layerStyleCacheKey(
              layer,
              sourceToDocument,
              styleQuality
            ), styleQuality);
        const styled = layerStyles.encode(
          encoder,
          layer,
          foregroundTexture,
          runtime.maskTexture,
          inverse,
          foregroundDimensions,
          styleBounds,
          styleCacheKey
        );
        if (styled) {
          compositeTexture(background, styled.texture, target, {
            label: `LightTable styled layer settings: ${layer.name}`,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            clippingTexture,
            sourceBounds: styled.bounds
          });
          return [target, background];
        }
      }

      const settingsBuffer = this.createCompositeSettingsBuffer(
        `LightTable layer settings: ${layer.name}`,
        inverse ? layer.opacity * layer.fillOpacity : 0,
        Boolean(layer.mask?.enabled && runtime.maskTexture),
        blendModeGpuValue(layer.blendMode),
        Boolean(clippingTexture),
        inverse ?? identityAffineMatrix(),
        foregroundDimensions,
        layer.mask,
        maskInverse
      );
      const bindGroup = this.options.device.createBindGroup({
        layout: this.options.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: background.createView() },
          { binding: 1, resource: foregroundTexture.createView() },
          { binding: 2, resource: this.options.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (runtime.maskTexture ?? runtime.texture).createView() },
          { binding: 5, resource: (clippingTexture ?? foregroundTexture).createView() }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        this.options.compositePipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      return [target, background];
    };

    const renderVectorLayer = (
      layer: VectorLayer,
      background: GPUTexture,
      target: GPUTexture,
      clippingTexture: GPUTexture | null,
      inheritedTransform: AffineMatrix,
      sourceInverseTransform?: AffineMatrix
    ): [GPUTexture, GPUTexture] => {
      const foreground = vectors.encode(
        encoder,
        layer,
        inheritedTransform,
        { width, height }
      );
      const maskTexture = this.options.maskTextureFor(layer.id);
      const styled = layerStyleStackIsActive(layer.styleStack)
        ? layerStyles.encode(
            encoder,
            layer,
            foreground,
            maskTexture,
            identityAffineMatrix(),
            { width, height },
            { x: 0, y: 0, width, height },
            null
          )
        : null;
      compositeTexture(background, styled?.texture ?? foreground, target, {
        label: `LightTable vector layer settings: ${layer.name}`,
        // LayerStyleRenderer already applies fillOpacity to the source while
        // retaining effects. Without styles the vector source still needs the
        // ordinary content-opacity multiplier here.
        opacity: styled ? layer.opacity : layer.opacity * layer.fillOpacity,
        blendMode: layer.blendMode,
        maskTexture,
        mask: styled ? null : layer.mask,
        clippingTexture,
        sourceBounds: styled?.bounds,
        sourceInverseTransform
      });
      return [target, background];
    };

    const renderDerivedPreview = (
      layer: VectorLayer | TextLayer,
      background: GPUTexture,
      target: GPUTexture,
      clippingTexture: GPUTexture | null,
      inheritedTransform: AffineMatrix,
      geometryPreview: AffineMatrix | null = null
    ): [GPUTexture, GPUTexture] => {
      const preview = layer.derivedPreview;
      const runtime = layerResources.derivedPreview(layer.id);
      if (!preview || !runtime) return [background, target];
      const sourceToDocument = geometryPreview
        ? multiplyMatrices(
            inheritedTransform,
            multiplyMatrices(
              geometryPreview,
              multiplyMatrices(invertMatrix(layer.transform) ?? identityAffineMatrix(), preview.transform)
            )
          )
        : multiplyMatrices(inheritedTransform, preview.transform);
      const inverse = invertMatrix(sourceToDocument);
      if (!inverse) return [background, target];
      const dimensions = { width: runtime.width, height: runtime.height };
      const maskTexture = this.options.maskTextureFor(layer.id);
      if (layerStyleStackIsActive(layer.styleStack)) {
        const styleBounds = layerSourceStyleDocumentBounds(
          layer,
          { dimensions, transform: sourceToDocument },
          { width, height }
        );
        const styled = layerStyles.encode(
          encoder,
          layer,
          runtime.texture,
          maskTexture,
          inverse,
          dimensions,
          styleBounds,
          null
        );
        if (styled) {
          compositeTexture(background, styled.texture, target, {
            label: `LightTable derived-preview style settings: ${layer.name}`,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            clippingTexture,
            sourceBounds: styled.bounds
          });
          return [target, background];
        }
      }
      const settingsBuffer = this.createCompositeSettingsBuffer(
        `LightTable derived-preview settings: ${layer.name}`,
        layer.opacity * layer.fillOpacity,
        Boolean(layer.mask?.enabled && maskTexture),
        blendModeGpuValue(layer.blendMode),
        Boolean(clippingTexture),
        inverse,
        dimensions,
        layer.mask,
        invertMatrix(layer.mask?.transform ?? identityAffineMatrix()) ?? identityAffineMatrix()
      );
      const bindGroup = this.options.device.createBindGroup({
        layout: this.options.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: background.createView() },
          { binding: 1, resource: runtime.texture.createView() },
          { binding: 2, resource: this.options.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (maskTexture ?? runtime.texture).createView() },
          { binding: 5, resource: (clippingTexture ?? runtime.texture).createView() }
        ]
      });
      this.options.drawFullscreen(
        encoder,
        this.options.compositePipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      return [target, background];
    };

    const renderNodes = (
      plan: CompositorPlan,
      initialBackground: GPUTexture,
      initialTarget: GPUTexture,
      inheritedTransform: AffineMatrix = identityAffineMatrix(),
      protectedBackground: GPUTexture | null = null
    ): [GPUTexture, GPUTexture] => {
      let background = initialBackground;
      let target = initialTarget;
      let clippingBase: GPUTexture | null = null;
      plan.entries.forEach((entry) => {
        if (entry.skipBecauseClippingBaseMissing) return;
        if (target === protectedBackground) {
          target = background === compositeA ? compositeB : compositeA;
        }
        [background, target] = renderNode(
          entry,
          background,
          target,
          entry.usesClippingBase ? clippingBase : null,
          inheritedTransform
        );
        if (!entry.usesClippingBase) {
          clippingBase = null;
          if (entry.captureClippingBase) {
            const baseA = this.options.createTexture(
              `LightTable clipping base A: ${entry.node.name}`
            );
            const baseB = this.options.createTexture(
              `LightTable clipping base B: ${entry.node.name}`
            );
            this.options.submittedResources.retainTexture(baseA);
            this.options.submittedResources.retainTexture(baseB);
            this.options.clearTexture(encoder, baseA);
            [clippingBase] = renderNode(
              entry,
              baseA,
              baseB,
              null,
              inheritedTransform
            );
          }
        }
      });
      return [background, target];
    };

    const renderGroup = (
      entry: CompositorPlanEntry,
      parentBackground: GPUTexture,
      parentTarget: GPUTexture,
      clippingTexture: GPUTexture | null = null,
      inheritedTransform: AffineMatrix = identityAffineMatrix()
    ): [GPUTexture, GPUTexture] => {
      const group = entry.node as GroupLayer;
      const childPlan = entry.children;
      if (!childPlan) return [parentBackground, parentTarget];
      const groupTransform = multiplyMatrices(inheritedTransform, group.transform);
      if (!entry.groupNeedsEnvelope) {
        return renderNodes(childPlan, parentBackground, parentTarget, groupTransform);
      }
      const groupA = this.options.createTexture(
        `LightTable isolated group A: ${group.name}`
      );
      const groupB = this.options.createTexture(
        `LightTable isolated group B: ${group.name}`
      );
      this.options.submittedResources.retainTexture(groupA);
      this.options.submittedResources.retainTexture(groupB);
      this.options.clearTexture(encoder, groupA);
      const [groupResult] = renderNodes(childPlan, groupA, groupB, groupTransform);
      const rasterMaskTexture = this.options.maskTextureFor(group.id);
      if (group.vectorClip?.enabled && group.mask?.enabled && rasterMaskTexture) {
        throw new Error(
          `Group “${group.name}” combines raster and vector masks; exact mask multiplication is required.`
        );
      }
      const vectorMaskTexture = group.vectorClip?.enabled
        ? vectors.encodeMask(
            encoder,
            group.vectorClip,
            groupTransform,
            { width, height },
            group.id
          )
        : null;
      const maskTexture = vectorMaskTexture ?? rasterMaskTexture;
      const mask = vectorMaskTexture ? {
        id: group.vectorClip!.id,
        enabled: true,
        linked: false,
        transform: identityAffineMatrix(),
        density: 1,
        feather: 0,
        revision: group.vectorClip!.revision,
        pixelRevision: group.vectorClip!.revision,
        dirtyBounds: null
      } satisfies RasterMask : group.mask;
      if (vectorMaskTexture && layerStyleStackIsActive(group.styleStack)) {
        throw new Error(
          `Group “${group.name}” combines a vector clip with layer styles; exact style masking is required.`
        );
      }
      const styledGroup = layerStyleStackIsActive(group.styleStack)
        ? layerStyles.encode(
            encoder,
            group,
            groupResult,
            maskTexture,
            identityAffineMatrix(),
            { width, height },
            { x: 0, y: 0, width, height },
            null
          )
        : null;
      compositeTexture(parentBackground, styledGroup?.texture ?? groupResult, parentTarget, {
        label: `LightTable group settings: ${group.name}`,
        opacity: group.opacity,
        blendMode: group.blendMode,
        maskTexture,
        mask: styledGroup ? null : mask,
        clippingTexture,
        sourceBounds: styledGroup?.bounds
      });
      return [parentTarget, parentBackground];
    };

    const suffix = this.topmostSuffixCacheEnabled
      && encodeAdjustment
      && excludedLayerIds.size === 0
      ? splitTopmostProcessingSuffix(document.layers)
      : null;
    const activeCheckpoint = !suffix
      && this.topmostSuffixCacheEnabled
      && encodeAdjustment
      && excludedLayerIds.size === 0
      ? splitActiveProcessingCheckpoint(document.layers, document.activeLayerId)
      : null;
    const checkpoint = suffix
      ? { base: suffix.base, remainder: suffix.processing, label: 'topmost processing suffix' }
      : activeCheckpoint
        ? { ...activeCheckpoint, label: 'active processing layer' }
        : null;
    let background: GPUTexture;
    if (checkpoint) {
      const contract = `${document.width}x${document.height}:${JSON.stringify(document.colorSettings)}`;
      const cacheValid = Boolean(
        this.topmostBaseTexture
        && this.topmostBaseDocumentId === document.id
        && this.topmostBaseContract === contract
        && this.topmostBaseNodes.length === checkpoint.base.length
        && this.topmostBaseNodes.every((node, index) => node === checkpoint.base[index])
      );
      if (!cacheValid) {
        this.topmostBaseMisses += 1;
        this.topmostBaseTexture?.destroy();
        this.topmostBaseTexture = this.options.createTexture(
          `LightTable cached composite below ${checkpoint.label}`
        );
        const [baseResult] = renderNodes(
          buildCompositorPlan(checkpoint.base, (layerId) => Boolean(this.options.maskTextureFor(layerId))),
          compositeA,
          compositeB
        );
        encoder.copyTextureToTexture(
          { texture: baseResult },
          { texture: this.topmostBaseTexture },
          this.options.dimensions()
        );
        this.topmostBaseDocumentId = document.id;
        this.topmostBaseNodes = [...checkpoint.base];
        this.topmostBaseContract = contract;
      } else {
        this.topmostBaseHits += 1;
      }
      [background] = renderNodes(
        buildCompositorPlan(checkpoint.remainder, (layerId) => Boolean(this.options.maskTextureFor(layerId))),
        this.topmostBaseTexture!,
        compositeA,
        identityAffineMatrix(),
        this.topmostBaseTexture
      );
    } else {
      [background] = renderNodes(analysis.plan, compositeA, compositeB);
    }
    if (includeDevelopmentTextFixture) {
      this.options.developmentTextFixture?.encode(
        encoder,
        background,
        { width, height }
      );
    }
    return background;
  }

  private createCompositeSettingsBuffer(
    label: string,
    opacity: number,
    maskEnabled: boolean,
    blendMode: number,
    clippingEnabled: boolean,
    inverse: AffineMatrix,
    sourceSize: { width: number; height: number },
    mask: RasterMask | null,
    maskInverse: AffineMatrix
  ) {
    const { width, height } = this.options.dimensions();
    const settingsBuffer = this.options.device.createBuffer({
      label,
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.options.device.queue.writeBuffer(
      settingsBuffer,
      0,
      new Float32Array([
        opacity,
        maskEnabled ? 1 : 0,
        blendMode,
        clippingEnabled ? 1 : 0,
        inverse.a, inverse.c, inverse.tx, 0,
        inverse.b, inverse.d, inverse.ty, 0,
        sourceSize.width, sourceSize.height,
        width, height,
        mask?.density ?? 1,
        mask?.feather ?? 0,
        this.blendProfile,
        this.blendQuantization,
        maskInverse.a, maskInverse.c, maskInverse.tx, 0,
        maskInverse.b, maskInverse.d, maskInverse.ty, 0
      ])
    );
    this.options.submittedResources.retainBuffer(settingsBuffer);
    return settingsBuffer;
  }
}
