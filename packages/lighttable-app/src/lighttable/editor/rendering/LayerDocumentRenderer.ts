import {
  layerIsLocked,
  type AdjustmentLayer,
  type GroupLayer,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer,
  type RasterMask
} from '../document/documentTypes';
import {
  findRasterLayer,
  walkLayerTree,
  walkRasterLayers
} from '../document/layerTree';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import { blendModeGpuValue, type BlendMode } from '../document/blendModes';
import type { PaintChannel } from '../session/editorSession';
import type { SelectionMode, SelectionShape } from '../selection/selectionTypes';
import type { SelectionCoverageBounds } from '../selection/selectionCoverage';
import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import type {
  DocumentAssetBlob,
  PatternAssetBlob
} from '../persistence/layeredDocumentFormat';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import {
  identityAffineMatrix,
  isIdentityAffineMatrix,
  rasterRenderContract,
  type RasterRenderContract
} from './renderContract';
import { layerStyleStackIsActive } from '../styles/layerStyleDefaults';
import {
  layerStyleCacheKey,
  layerStyleDocumentBounds
} from '../styles/layerStyleRenderPlan';
import {
  analyzeDocumentComposite,
  type CompositorPlan,
  type CompositorPlanEntry
} from './compositorGraph';
import { LayerRuntimeStore } from './LayerRuntimeStore';
import { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import { RenderTargetPair } from './RenderTargetPair';
import { SelectionTextureStore } from './SelectionTextureStore';
import { TransformSessionStore } from './TransformSessionStore';
import { PixelEditSessionStore } from './PixelEditSessionStore';
import { PatternAssetStore } from './PatternAssetStore';
import {
  toolPipelinesFor,
  type ToolPipelineBundle
} from './ToolPipelineBundle';
import { GeometryPreviewStore } from './GeometryPreviewStore';
import { documentPipelinesFor } from './DocumentPipelineBundle';
import { LayerDocumentAssetService } from './LayerDocumentAssetService';
import { LayerTextureCodec } from './LayerTextureCodec';
import { SelectionRasterizer } from './SelectionRasterizer';
import { SelectionContentAnalyzer } from './SelectionContentAnalyzer';
import { SelectionClipboardService } from './SelectionClipboardService';
import {
  RasterDocumentOperations,
  type EncodeAdjustment
} from './RasterDocumentOperations';
import { LayerStyleRenderer } from './LayerStyleRenderer';

export interface ReversiblePixelEdit {
  byteSize: number;
  undo: () => boolean;
  redo: () => boolean;
  destroy: () => void;
}

export interface LayerThumbnailBlob {
  blob: Blob;
  width: number;
  height: number;
}

const textureUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
export class LayerDocumentRenderer {
  private readonly layerResources: LayerRuntimeStore;
  private readonly patternAssets = new PatternAssetStore();
  private readonly decodePipeline: GPURenderPipeline;
  private readonly compositePipeline: GPURenderPipeline;
  private readonly adjustmentMixPipeline: GPURenderPipeline;
  private readonly fullscreenModule: GPUShaderModule;
  private toolPipelines: ToolPipelineBundle | null = null;
  private readonly brushCanvasBuffer: GPUBuffer;
  private readonly submittedResources: SubmittedResourceRetainer;
  private readonly layerStyleRenderer: LayerStyleRenderer;
  private readonly compositeTargets: RenderTargetPair;
  private readonly selectionTextures: SelectionTextureStore;
  private readonly transformSessions = new TransformSessionStore();
  private readonly pixelEditSessions = new PixelEditSessionStore();
  private readonly documentAssets: LayerDocumentAssetService;
  private readonly textureCodec: LayerTextureCodec;
  private readonly selectionRasterizer: SelectionRasterizer;
  private readonly selectionContentAnalyzer: SelectionContentAnalyzer;
  private readonly selectionClipboard: SelectionClipboardService;
  private readonly rasterDocumentOperations: RasterDocumentOperations;
  private width = 0;
  private height = 0;
  private resourceGeneration = 0;
  private readonly geometryPreviews = new GeometryPreviewStore();

  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device;
    this.sampler = sampler;
    const pipelines = documentPipelinesFor(device);
    this.decodePipeline = pipelines.decode;
    this.compositePipeline = pipelines.composite;
    this.adjustmentMixPipeline = pipelines.adjustmentMix;
    this.fullscreenModule = pipelines.fullscreenModule;
    this.textureCodec = new LayerTextureCodec(device, sampler, {
      decode: pipelines.decode,
      maskDecode: pipelines.maskDecode,
      exportLayer: pipelines.exportLayer
    });
    this.layerResources = new LayerRuntimeStore({
      createRasterTexture: (label) => this.createTexture(label),
      createMaskTexture: (label) => this.createMaskTexture(label)
    });
    this.submittedResources = new SubmittedResourceRetainer({
      onSubmittedWorkDone: () => this.device.queue.onSubmittedWorkDone()
    });
    this.layerStyleRenderer = new LayerStyleRenderer({
      device,
      sampler,
      fullscreenModule: this.fullscreenModule,
      shapePipeline: pipelines.styleShape,
      patternAssets: this.patternAssets,
      submittedResources: this.submittedResources,
      dimensions: () => ({ width: this.width, height: this.height }),
      createTexture: (label) => this.createTexture(label),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.compositeTargets = new RenderTargetPair({
      createTexture: (label) => this.createTexture(label),
      firstLabel: 'LightTable layer composite A',
      secondLabel: 'LightTable layer composite B'
    });
    this.selectionTextures = new SelectionTextureStore({
      createSelectionTexture: (label) => this.createSelectionTexture(label),
      createClipboardTexture: (label) => this.createTexture(label)
    });
    this.selectionRasterizer = new SelectionRasterizer({
      device,
      sampler,
      textures: this.selectionTextures,
      dimensions: () => ({ width: this.width, height: this.height }),
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureTargets: () => this.ensureSelectionTargets(),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue),
      clearTexture: (encoder, texture, clearValue) =>
        this.clearTexture(encoder, texture, clearValue)
    });
    this.selectionContentAnalyzer = new SelectionContentAnalyzer({
      device,
      textures: this.selectionTextures,
      dimensions: () => ({ width: this.width, height: this.height }),
      generation: () => this.resourceGeneration,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureTargets: () => this.ensureSelectionTargets(),
      rasterRuntime: (layerId) => this.layerResources.raster(layerId),
      createCoverageTexture: (label) => this.createSelectionTexture(label),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.selectionClipboard = new SelectionClipboardService({
      device,
      textures: this.selectionTextures,
      layerResources: this.layerResources,
      textureCodec: this.textureCodec,
      dimensions: () => ({ width: this.width, height: this.height }),
      generation: () => this.resourceGeneration,
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.rasterDocumentOperations = new RasterDocumentOperations({
      device,
      layerResources: this.layerResources,
      dimensions: () => ({ width: this.width, height: this.height }),
      encodeComposite: (encoder, document, encodeAdjustment) =>
        this.encodeComposite(encoder, document, encodeAdjustment),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      releaseSubmittedResources: () => this.releaseSubmittedResources()
    });
    this.documentAssets = new LayerDocumentAssetService({
      rasterTexture: (layerId) => this.layerResources.raster(layerId)?.texture ?? null,
      maskTexture: (layerId) => this.maskTextureFor(layerId),
      encodeTexture: (texture, maskChannel) =>
        this.textureCodec.encode(texture, maskChannel, this.width, this.height),
      decodeTexture: async (blob, texture, maskChannel) => {
        const generation = this.resourceGeneration;
        await this.textureCodec.decode(
          blob,
          texture,
          maskChannel,
          this.width,
          this.height,
          () => generation === this.resourceGeneration
        );
      },
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      patternSource: (patternId) => this.patternAssets.getSource(patternId),
      loadPattern: (asset) => this.loadPatternAsset(asset)
    });
    // Tool-only pipelines are compiled on first use. The normal image-open
    // path needs decode/composite, but not brush, selection or transform.
    this.brushCanvasBuffer = device.createBuffer({
      label: 'LightTable brush canvas settings',
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  async initializeLayerStylePipeline() {
    await this.layerStyleRenderer.initialize();
  }

  async layerStyleShaderErrors() {
    return this.layerStyleRenderer.shaderErrors();
  }

  initialize(document: ImageDocument, sourceTexture: GPUTexture) {
    this.destroyImageResources();
    this.width = document.width;
    this.height = document.height;
    this.selectionTextures.active = false;
    this.device.queue.writeBuffer(this.brushCanvasBuffer, 0, new Float32Array([
      this.width, this.height, 0, 0,
      1, 0, 0, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 1, 0, 0
    ]));
    this.syncDocument(document);
    const imported = walkRasterLayers(document.layers)
      .map(({ layer }) => layer)
      .find((layer) => layer.pixelSource.kind === 'imported-image');
    // Persisted layered documents contain runtime raster layers only. They are
    // populated immediately afterwards by loadDocumentAssets().
    if (!imported) return;
    const runtime = this.layerResources.raster(imported.id);
    if (!runtime) throw new Error('The imported LightTable layer could not be initialized.');
    const bindGroup = this.device.createBindGroup({
      layout: this.decodePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: this.sampler }
      ]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable initialize layer document' });
    this.drawFullscreen(encoder, this.decodePipeline, bindGroup, runtime.texture.createView(), { r: 0, g: 0, b: 0, a: 0 });
    this.device.queue.submit([encoder.finish()]);
  }

  syncDocument(document: ImageDocument) {
    // Keep detached runtimes alive for the bounded editor history. This makes
    // delete/create/duplicate undo lossless without a synchronous GPU readback.
    // All cached runtimes are released when the image/editor is destroyed.
    this.layerResources.sync(document.layers);
  }

  pruneDetachedRuntimes(keepLayerIds: ReadonlySet<LayerId>) {
    this.layerResources.pruneDetached(keepLayerIds).forEach((id) => {
      this.layerStyleRenderer.invalidate(id);
    });
  }

  private maskTextureFor(layerId: LayerId) {
    return this.layerResources.maskTexture(layerId);
  }

  resolveRasterRenderContract(layer: RasterLayer): RasterRenderContract | null {
    const runtime = this.layerResources.raster(layer.id);
    return runtime ? rasterRenderContract(layer, runtime.texture) : null;
  }

  /**
   * WebGPU deliberately exposes no driver VRAM counter. Keep this estimate
   * tied to the textures this renderer actually owns, including detached
   * raster runtimes retained for lossless undo.
   */
  estimatedTextureBytes() {
    const pixels = Math.max(1, this.width) * Math.max(1, this.height);
    const rgba16Bytes = pixels * 8;
    const r8Bytes = pixels;
    let bytes = 0;
    bytes += this.layerResources.estimatedTextureBytes(this.width, this.height);
    bytes += this.patternAssets.estimatedTextureBytes();
    bytes += this.layerStyleRenderer.estimatedTextureBytes(this.width, this.height);
    bytes += this.compositeTargets.estimatedTextureBytes(this.width, this.height, 8);
    bytes += this.selectionTextures.estimatedTextureBytes(this.width, this.height);
    bytes += this.pixelEditSessions.estimatedTextureBytes(rgba16Bytes);
    bytes += this.transformSessions.estimatedTextureBytes(rgba16Bytes, r8Bytes);
    return bytes;
  }

  setGeometryPreview(layer: RasterLayer, matrix: AffineMatrix | null) {
    return this.geometryPreviews.set(layer.id, layer.geometryRevision, matrix);
  }

  clearGeometryPreviews() {
    return this.geometryPreviews.clear();
  }

  setLayerStyleInteractionActive(active: boolean) {
    return this.layerStyleRenderer.setInteractionActive(active);
  }

  encodeComposite(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: (
      encoder: GPUCommandEncoder,
      source: GPUTexture,
      layer: AdjustmentLayer | RasterLayer
    ) => GPUTexture
  ): GPUTexture {
    this.syncDocument(document);
    const analysis = analyzeDocumentComposite(
      document.layers,
      (layerId) => Boolean(this.maskTextureFor(layerId))
    );
    const visibleLayers = analysis.visibleRasterLayers.filter(
      (layer) => layer.visible && layer.opacity > 0
    );
    const stylesActive = analysis.activeLayerStyles;
    if (!stylesActive) {
      this.releaseStyleTargets();
      this.releaseStyledLayerCache();
    }
    if (visibleLayers.length === 1 && analysis.visibleLeafNodes.length === 1 && document.layers.length === 1) {
      const layer = visibleLayers[0];
      const runtime = this.layerResources.raster(layer.id);
      const geometryPreview = this.geometryPreviews.resolve(layer.id, layer.geometryRevision);
      if (runtime && layer.opacity >= 0.99999 && layer.fillOpacity >= 0.99999 && layer.blendMode === 'normal' &&
        !layer.mask?.enabled && !this.transformSessions.current && !geometryPreview &&
        !layerStyleStackIsActive(layer.styleStack) && !layer.adjustmentStack &&
        isIdentityAffineMatrix(layer.transform) && layer.width === this.width && layer.height === this.height) {
        return runtime.texture;
      }
    }
    const [compositeA, compositeB] = this.compositeTargets.ensure();
    this.clearTexture(encoder, compositeA);
    const compositeTexture = (
      background: GPUTexture,
      foreground: GPUTexture,
      target: GPUTexture,
      options: {
        label: string;
        opacity: number;
        blendMode: BlendMode;
        maskTexture?: GPUTexture | null;
        mask?: RasterMask | null;
        clippingTexture?: GPUTexture | null;
      }
    ) => {
      const settingsBuffer = this.createLayerCompositeSettingsBuffer(
        options.label,
        options.opacity,
        Boolean(options.mask?.enabled && options.maskTexture),
        blendModeGpuValue(options.blendMode),
        Boolean(options.clippingTexture),
        identityAffineMatrix(),
        { width: this.width, height: this.height },
        options.mask ?? null
      );
      const bindGroup = this.device.createBindGroup({
        layout: this.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: background.createView() },
          { binding: 1, resource: foreground.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (options.maskTexture ?? foreground).createView() },
          { binding: 5, resource: (options.clippingTexture ?? foreground).createView() }
        ]
      });
      this.drawFullscreen(
        encoder,
        this.compositePipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
    };
    const renderNode = (
      entry: CompositorPlanEntry,
      background: GPUTexture,
      target: GPUTexture,
      clippingTexture: GPUTexture | null = null
    ): [GPUTexture, GPUTexture] => {
      const { node } = entry;
      if (!node.visible || node.opacity <= 0) return [background, target];
      if (node.type === 'group') {
        return renderGroup(entry, background, target, clippingTexture);
      }
      if (node.type === 'adjustment') {
        if (!encodeAdjustment) return [background, target];
        const adjusted = encodeAdjustment(encoder, background, node);
        const maskTexture = this.maskTextureFor(node.id);
        const settingsBuffer = this.device.createBuffer({
          label: `LightTable adjustment mix settings: ${node.name}`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
          node.opacity,
          node.mask?.enabled && maskTexture ? 1 : 0,
          clippingTexture ? 1 : 0,
          blendModeGpuValue(node.blendMode),
          node.mask?.density ?? 1,
          node.mask?.feather ?? 0,
          0,
          0
        ]));
        this.submittedResources.retainBuffer(settingsBuffer);
        const bindGroup = this.device.createBindGroup({
          layout: this.adjustmentMixPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: background.createView() },
            { binding: 1, resource: adjusted.createView() },
            { binding: 2, resource: this.sampler },
            { binding: 3, resource: { buffer: settingsBuffer } },
            { binding: 4, resource: (maskTexture ?? background).createView() },
            { binding: 5, resource: (clippingTexture ?? background).createView() }
          ]
        });
        this.drawFullscreen(
          encoder,
          this.adjustmentMixPipeline,
          bindGroup,
          target.createView(),
          { r: 0, g: 0, b: 0, a: 0 }
        );
        return [target, background];
      }
      const layer = node;
      const runtime = this.layerResources.raster(layer.id);
      if (!runtime) return [background, target];
      const activeTransform = this.transformSessions.current?.layerId === layer.id
        ? this.transformSessions.current
        : null;
      const ungradedForegroundTexture = activeTransform?.usesSelection
        ? activeTransform.previewTexture
        : runtime.texture;
      const foregroundTexture = layer.adjustmentStack && encodeAdjustment
        ? encodeAdjustment(encoder, ungradedForegroundTexture, layer)
        : ungradedForegroundTexture;
      const renderContract = rasterRenderContract(layer, foregroundTexture);
      const geometryPreview = this.geometryPreviews.resolve(layer.id, layer.geometryRevision);
      // A selection preview is already rasterized in document space. A whole
      // layer preview remains source pixels plus a temporary geometry override,
      // so the layer mask follows the exact same transform.
      const sourceToDocument = activeTransform
        ? activeTransform.usesSelection
          ? identityAffineMatrix()
          : activeTransform.matrix
        : geometryPreview ?? renderContract.transform;
      const inverse = invertMatrix(sourceToDocument);
      const styleActive = layerStyleStackIsActive(layer.styleStack);
      if (styleActive && inverse) {
        const styleBounds = layerStyleDocumentBounds(
          layer,
          { width: this.width, height: this.height },
          sourceToDocument
        );
        if (styleBounds.width <= 0 || styleBounds.height <= 0) return [background, target];
        // Transform previews and in-progress pixel edits change continuously
        // and deliberately bypass the persistent cache. Committed pixels,
        // masks, geometry, styles and quality are represented by
        // layerStyleCacheKey.
        const activePixelEdit = this.pixelEditSessions.current?.layerId === layer.id;
        const styleCacheKey = activeTransform || activePixelEdit
          ? null
          : layerStyleCacheKey(
              layer,
              sourceToDocument,
              this.layerStyleRenderer.cacheKeyQuality()
            );
        const styled = this.layerStyleRenderer.encode(
          encoder,
          layer,
          foregroundTexture,
          runtime.maskTexture,
          inverse,
          renderContract.dimensions,
          styleCacheKey
        );
        if (styled) {
          const settingsBuffer = this.createLayerCompositeSettingsBuffer(
            `LightTable styled layer settings: ${layer.name}`,
            layer.opacity,
            false,
            blendModeGpuValue(layer.blendMode),
            Boolean(clippingTexture),
            identityAffineMatrix(),
            { width: this.width, height: this.height },
            null
          );
          const bindGroup = this.device.createBindGroup({
            layout: this.compositePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: background.createView() },
              { binding: 1, resource: styled.createView() },
              { binding: 2, resource: this.sampler },
              { binding: 3, resource: { buffer: settingsBuffer } },
              { binding: 4, resource: styled.createView() },
              { binding: 5, resource: (clippingTexture ?? styled).createView() }
            ]
          });
          this.drawFullscreen(
            encoder,
            this.compositePipeline,
            bindGroup,
            target.createView(),
            { r: 0, g: 0, b: 0, a: 0 }
          );
          return [target, background];
        }
      }
      // Each pass gets its own immutable uniform. Queue writes are not encoder
      // commands; reusing one buffer would make every pass see the final layer's opacity.
      const settingsBuffer = this.createLayerCompositeSettingsBuffer(
        `LightTable layer settings: ${layer.name}`,
        inverse ? layer.opacity * layer.fillOpacity : 0,
        Boolean(layer.mask?.enabled && runtime.maskTexture),
        blendModeGpuValue(layer.blendMode),
        Boolean(clippingTexture),
        inverse ?? identityAffineMatrix(),
        renderContract.dimensions,
        layer.mask
      );
      const bindGroup = this.device.createBindGroup({
        layout: this.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: background.createView() },
          { binding: 1, resource: foregroundTexture.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (runtime.maskTexture ?? runtime.texture).createView() },
          { binding: 5, resource: (clippingTexture ?? foregroundTexture).createView() }
        ]
      });
      this.drawFullscreen(encoder, this.compositePipeline, bindGroup, target.createView(), { r: 0, g: 0, b: 0, a: 0 });
      return [target, background];
    };
    const renderNodes = (
      plan: CompositorPlan,
      initialBackground: GPUTexture,
      initialTarget: GPUTexture
    ): [GPUTexture, GPUTexture] => {
      let background = initialBackground;
      let target = initialTarget;
      let clippingBase: GPUTexture | null = null;
      plan.entries.forEach((entry) => {
        const { node } = entry;
        // A clipped layer without a preceding, visible base has no shape to
        // inherit. Treat malformed/imported chains as transparent instead of
        // leaking the complete layer into the document.
        if (entry.skipBecauseClippingBaseMissing) return;
        [background, target] = renderNode(
          entry,
          background,
          target,
          entry.usesClippingBase ? clippingBase : null
        );
        if (!entry.usesClippingBase) {
          clippingBase = null;
          if (entry.captureClippingBase) {
            const baseA = this.createTexture(`LightTable clipping base A: ${node.name}`);
            const baseB = this.createTexture(`LightTable clipping base B: ${node.name}`);
            this.submittedResources.retainTexture(baseA);
            this.submittedResources.retainTexture(baseB);
            this.clearTexture(encoder, baseA);
            [clippingBase] = renderNode(entry, baseA, baseB);
          }
        }
      });
      return [background, target];
    };
    const renderGroup = (
      entry: CompositorPlanEntry,
      parentBackground: GPUTexture,
      parentTarget: GPUTexture,
      clippingTexture: GPUTexture | null = null
    ): [GPUTexture, GPUTexture] => {
      const group = entry.node as GroupLayer;
      const childPlan = entry.children;
      if (!childPlan) return [parentBackground, parentTarget];
      // Photoshop pass-through groups without an envelope participate in the
      // parent's stack directly. This preserves adjustment-layer interaction
      // with content below the group.
      if (!entry.groupNeedsEnvelope) {
        return renderNodes(childPlan, parentBackground, parentTarget);
      }
      const groupA = this.createTexture(`LightTable isolated group A: ${group.name}`);
      const groupB = this.createTexture(`LightTable isolated group B: ${group.name}`);
      this.submittedResources.retainTexture(groupA);
      this.submittedResources.retainTexture(groupB);
      this.clearTexture(encoder, groupA);
      const [groupResult] = renderNodes(childPlan, groupA, groupB);
      const maskTexture = this.maskTextureFor(group.id);
      const styledGroup = layerStyleStackIsActive(group.styleStack)
        ? this.layerStyleRenderer.encode(
            encoder,
            group,
            groupResult,
            maskTexture,
            identityAffineMatrix(),
            { width: this.width, height: this.height },
            null
          )
        : null;
      compositeTexture(parentBackground, styledGroup ?? groupResult, parentTarget, {
        label: `LightTable group settings: ${group.name}`,
        opacity: group.opacity,
        blendMode: group.blendMode,
        maskTexture,
        // The Layer Style shape pass already applies the group mask so its
        // effects follow the same silhouette. Do not multiply it a second
        // time during parent composition.
        mask: styledGroup ? null : group.mask,
        clippingTexture
      });
      return [parentTarget, parentBackground];
    };
    const [background] = renderNodes(analysis.plan, compositeA, compositeB);
    return background;
  }

  private createLayerCompositeSettingsBuffer(
    label: string,
    opacity: number,
    maskEnabled: boolean,
    blendMode: number,
    clippingEnabled: boolean,
    inverse: AffineMatrix,
    sourceSize: { width: number; height: number },
    mask: RasterMask | null
  ) {
    const settingsBuffer = this.device.createBuffer({
      label,
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
      opacity,
      maskEnabled ? 1 : 0,
      blendMode,
      clippingEnabled ? 1 : 0,
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      sourceSize.width, sourceSize.height,
      this.width, this.height,
      mask?.density ?? 1,
      mask?.feather ?? 0,
      0,
      0
    ]));
    this.submittedResources.retainBuffer(settingsBuffer);
    return settingsBuffer;
  }

  private releaseStyleTargets() {
    this.layerStyleRenderer.releaseTargets();
  }

  private releaseStyledLayerCache() {
    this.layerStyleRenderer.releaseCache();
  }

  private invalidateStyledLayerCache(layerId: LayerId) {
    this.layerStyleRenderer.invalidate(layerId);
  }

  private ensureSelectionTargets() {
    if (!this.selectionTextures.ensureTargets()) return;
    const encoder = this.device.createCommandEncoder({ label: 'Initialize LightTable selection' });
    this.clearTexture(encoder, this.selectionTextures.mask!, { r: 1, g: 0, b: 0, a: 1 });
    this.clearTexture(encoder, this.selectionTextures.result!, { r: 1, g: 0, b: 0, a: 1 });
    this.clearTexture(encoder, this.selectionTextures.shape!);
    this.device.queue.submit([encoder.finish()]);
  }

  releaseSubmittedResources() {
    this.submittedResources.releaseAfterSubmittedWork();
  }

  duplicateLayer(sourceId: LayerId, destinationId: LayerId) {
    return this.rasterDocumentOperations.duplicate(sourceId, destinationId);
  }

  async exportDocumentAssets(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    return this.documentAssets.export(document);
  }

  async exportLayerThumbnail(
    layerId: LayerId,
    maskChannel = false,
    maximumWidth = 80,
    maximumHeight = 80
  ): Promise<LayerThumbnailBlob | null> {
    const runtime = this.layerResources.raster(layerId);
    const source = maskChannel
      ? this.maskTextureFor(layerId)
      : runtime?.texture ?? null;
    if (!source || this.width < 1 || this.height < 1) return null;

    const scale = Math.min(
      Math.max(1, maximumWidth) / this.width,
      Math.max(1, maximumHeight) / this.height,
      1
    );
    const width = Math.max(1, Math.round(this.width * scale));
    const height = Math.max(1, Math.round(this.height * scale));
    const blob = await this.textureCodec.encode(
      source,
      maskChannel,
      width,
      height
    );
    return { blob, width, height };
  }

  async loadDocumentAssets(assets: DocumentAssetBlob[]) {
    await this.documentAssets.load(assets);
  }

  private async loadPatternAsset(asset: PatternAssetBlob) {
    // Pattern pixels are immutable document assets, but restoring/replacing an
    // asset with the same stable id must invalidate every styled-layer result
    // that may have sampled its previous GPU texture.
    this.releaseStyledLayerCache();
    const generation = this.resourceGeneration;
    const decoded = await decodeNativeImage(asset.source);
    const { bitmap } = decoded;
    let encodedTexture: GPUTexture | null = null;
    let target: GPUTexture | null = null;
    try {
      if (generation !== this.resourceGeneration) {
        throw new Error('LightTable was closed while restoring its patterns.');
      }
      encodedTexture = this.device.createTexture({
        label: 'LightTable persisted pattern source',
        size: [bitmap.width, bitmap.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      target = this.device.createTexture({
        label: `LightTable pattern: ${asset.patternId}`,
        size: [bitmap.width, bitmap.height],
        format: 'rgba16float',
        usage: textureUsage
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: encodedTexture },
        [bitmap.width, bitmap.height]
      );
      const bindGroup = this.device.createBindGroup({
        layout: this.decodePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: encodedTexture.createView() },
          { binding: 1, resource: this.sampler }
        ]
      });
      const encoder = this.device.createCommandEncoder({ label: 'Restore LightTable pattern pixels' });
      this.drawFullscreen(
        encoder,
        this.decodePipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      this.patternAssets.set(asset.patternId, asset.source, target);
      target = null;
    } finally {
      encodedTexture?.destroy();
      target?.destroy();
      decoded.close();
    }
  }

  mergeLayerDown(
    document: ImageDocument,
    topId: LayerId,
    bottomId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.mergeLayers(document, [bottomId, topId], bottomId, encodeAdjustment);
  }

  mergeLayers(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.rasterDocumentOperations.merge(
      document,
      layerIds,
      destinationId,
      encodeAdjustment
    );
  }

  flattenGroup(
    document: ImageDocument,
    groupId: LayerId,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.rasterDocumentOperations.flattenGroup(
      document,
      groupId,
      destinationId,
      encodeAdjustment
    );
  }

  flattenImage(
    document: ImageDocument,
    destinationId: LayerId,
    encodeAdjustment?: EncodeAdjustment
  ) {
    return this.rasterDocumentOperations.flattenImage(
      document,
      destinationId,
      encodeAdjustment
    );
  }

  beginStroke(layer: LayerNode, channel: PaintChannel) {
    if (layerIsLocked(layer, 'pixels') || !layer.visible) throw new Error('Select a visible, unlocked layer before painting.');
    if (channel === 'pixels' && layer.type !== 'raster') {
      throw new Error('Only raster layers have editable pixels.');
    }
    if (channel === 'pixels' && layer.type === 'raster' && !isIdentityAffineMatrix(layer.transform)) {
      throw new Error('Rasterize the transformed layer before painting on it.');
    }
    if (channel === 'mask' && !layer.mask) throw new Error('Add a layer mask before painting the mask channel.');
    this.beginPixelEdit(layer.id, channel);
  }

  beginPixelEdit(layerId: LayerId, channel: PaintChannel) {
    const runtime = this.layerResources.raster(layerId);
    if (channel === 'pixels' && !runtime) throw new Error('The active raster layer is not available on the GPU.');
    const texture = this.createTexture('LightTable brush undo snapshot');
    const encoder = this.device.createCommandEncoder({ label: 'LightTable begin brush stroke' });
    const target = channel === 'mask' ? this.maskTextureFor(layerId) : runtime?.texture;
    if (!target) throw new Error('The active paint channel is not available on the GPU.');
    // Invalidate at edit start rather than waiting for React document state to
    // publish its revision. This also covers cancelled/replayed GPU edits.
    this.invalidateStyledLayerCache(layerId);
    encoder.copyTextureToTexture({ texture: target }, { texture }, [this.width, this.height]);
    this.device.queue.submit([encoder.finish()]);
    this.pixelEditSessions.begin({ layerId, channel, texture });
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    const before = this.pixelEditSessions.complete();
    if (!before) return null;
    let undoTexture: GPUTexture | null = before.texture;
    let redoTexture: GPUTexture | null = null;
    let applied = true;
    const swap = (direction: 'undo' | 'redo') => {
      const source = direction === 'undo' ? undoTexture : redoTexture;
      if (!source || applied !== (direction === 'undo')) return false;
      const runtime = this.layerResources.raster(before.layerId);
      const target = before.channel === 'mask' ? this.maskTextureFor(before.layerId) : runtime?.texture;
      if (!target) return false;
      const inverse = this.createTexture(`LightTable ${direction} pixel history`);
      const encoder = this.device.createCommandEncoder({ label: `LightTable ${direction} pixel edit` });
      encoder.copyTextureToTexture({ texture: target }, { texture: inverse }, [this.width, this.height]);
      encoder.copyTextureToTexture({ texture: source }, { texture: target }, [this.width, this.height]);
      this.device.queue.submit([encoder.finish()]);
      this.invalidateStyledLayerCache(before.layerId);
      source.destroy();
      if (direction === 'undo') {
        undoTexture = null;
        redoTexture = inverse;
        applied = false;
      } else {
        redoTexture = null;
        undoTexture = inverse;
        applied = true;
      }
      return true;
    };
    return {
      byteSize: this.width * this.height * 8,
      undo: () => swap('undo'),
      redo: () => swap('redo'),
      destroy: () => {
        undoTexture?.destroy();
        redoTexture?.destroy();
        undoTexture = null;
        redoTexture = null;
      }
    };
  }

  cancelPixelEdit() {
    this.pixelEditSessions.cancel();
  }

  beginTransform(layer: RasterLayer, useSelection: boolean) {
    this.ensureToolPipelines();
    if (useSelection) this.ensureSelectionTargets();
    if (this.transformSessions.current) throw new Error('Finish or cancel the active transform first.');
    if (layerIsLocked(layer, 'position') || !layer.visible) throw new Error('Select a visible, unlocked raster layer before transforming.');
    const runtime = this.layerResources.raster(layer.id);
    if (!runtime) throw new Error('The active raster layer is not available on the GPU.');
    if (useSelection && (!this.selectionTextures.active || !this.selectionTextures.mask)) {
      throw new Error('The active selection is not available on the GPU.');
    }
    const sourceTexture = this.createTexture('LightTable transform source snapshot');
    const selectionTexture = useSelection ? this.createSelectionTexture('LightTable transform selection snapshot') : null;
    const previewTexture = this.createTexture('LightTable transform preview');
    const selectionPreview = useSelection ? this.createSelectionTexture('LightTable transformed selection preview') : null;
    const settingsBuffer = this.device.createBuffer({
      label: 'LightTable transform settings',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable begin transform' });
    encoder.copyTextureToTexture({ texture: runtime.texture }, { texture: sourceTexture }, [this.width, this.height]);
    if (selectionTexture && this.selectionTextures.mask) {
      encoder.copyTextureToTexture({ texture: this.selectionTextures.mask }, { texture: selectionTexture }, [this.width, this.height]);
    }
    this.device.queue.submit([encoder.finish()]);
    this.transformSessions.begin({
      layerId: layer.id,
      matrix: identityAffineMatrix(),
      sourceTexture,
      selectionTexture,
      previewTexture,
      selectionPreview,
      settingsBuffer,
      usesSelection: useSelection
    });
  }

  updateTransform(matrix: AffineMatrix) {
    const session = this.transformSessions.current;
    if (!session) return false;
    const inverse = invertMatrix(matrix);
    if (!inverse) return false;
    session.matrix = matrix;
    // Whole-layer preview is a compositor geometry override. It deliberately
    // leaves source pixels and the layer mask untouched and avoids resampling.
    if (!session.usesSelection) return true;
    this.device.queue.writeBuffer(session.settingsBuffer, 0, new Float32Array([
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      this.width, this.height, session.usesSelection ? 1 : 0, 0
    ]));
    const selectionSource = session.selectionTexture ?? this.selectionTextures.mask;
    if (!selectionSource) return false;
    const transformBindGroup = this.device.createBindGroup({
      layout: this.toolPipelines!.transform.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: session.sourceTexture.createView() },
        { binding: 1, resource: selectionSource.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: session.settingsBuffer } }
      ]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable update transform preview' });
    this.drawFullscreen(
      encoder,
      this.toolPipelines!.transform,
      transformBindGroup,
      session.previewTexture.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    if (session.selectionTexture && session.selectionPreview) {
      const selectionBindGroup = this.device.createBindGroup({
        layout: this.toolPipelines!.selectionTransform.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: session.selectionTexture.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: session.settingsBuffer } }
        ]
      });
      this.drawFullscreen(
        encoder,
        this.toolPipelines!.selectionTransform,
        selectionBindGroup,
        session.selectionPreview.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
    }
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  commitTransform(): ReversiblePixelEdit | null {
    const session = this.transformSessions.current;
    if (!session) return null;
    const runtime = this.layerResources.raster(session.layerId);
    if (!runtime) {
      this.cancelTransform();
      return null;
    }
    const encoder = this.device.createCommandEncoder({ label: 'LightTable commit transform' });
    encoder.copyTextureToTexture({ texture: session.previewTexture }, { texture: runtime.texture }, [this.width, this.height]);
    if (session.selectionPreview && this.selectionTextures.mask && this.selectionTextures.result) {
      encoder.copyTextureToTexture({ texture: session.selectionPreview }, { texture: this.selectionTextures.mask }, [this.width, this.height]);
      encoder.copyTextureToTexture({ texture: session.selectionPreview }, { texture: this.selectionTextures.result }, [this.width, this.height]);
      this.selectionTextures.active = true;
    }
    this.device.queue.submit([encoder.finish()]);
    const historySeed = this.transformSessions.complete();
    if (!historySeed) return null;
    let undoPixels: GPUTexture | null = historySeed.sourceTexture;
    let undoSelection: GPUTexture | null = historySeed.selectionTexture;
    let redoPixels: GPUTexture | null = null;
    let redoSelection: GPUTexture | null = null;
    let applied = true;
    const usesSelection = historySeed.usesSelection;
    const layerId = historySeed.layerId;

    const swap = (direction: 'undo' | 'redo') => {
      const sourcePixels = direction === 'undo' ? undoPixels : redoPixels;
      const sourceSelection = direction === 'undo' ? undoSelection : redoSelection;
      if (!sourcePixels || applied !== (direction === 'undo')) return false;
      const targetRuntime = this.layerResources.raster(layerId);
      if (!targetRuntime) return false;
      const inversePixels = this.createTexture(`LightTable ${direction} transform history`);
      const inverseSelection = usesSelection
        ? this.createSelectionTexture(`LightTable ${direction} selection transform history`)
        : null;
      const historyEncoder = this.device.createCommandEncoder({ label: `LightTable ${direction} transform` });
      historyEncoder.copyTextureToTexture({ texture: targetRuntime.texture }, { texture: inversePixels }, [this.width, this.height]);
      historyEncoder.copyTextureToTexture({ texture: sourcePixels }, { texture: targetRuntime.texture }, [this.width, this.height]);
      if (usesSelection && sourceSelection && inverseSelection && this.selectionTextures.mask && this.selectionTextures.result) {
        historyEncoder.copyTextureToTexture({ texture: this.selectionTextures.mask }, { texture: inverseSelection }, [this.width, this.height]);
        historyEncoder.copyTextureToTexture({ texture: sourceSelection }, { texture: this.selectionTextures.mask }, [this.width, this.height]);
        historyEncoder.copyTextureToTexture({ texture: sourceSelection }, { texture: this.selectionTextures.result }, [this.width, this.height]);
      }
      this.device.queue.submit([historyEncoder.finish()]);
      sourcePixels.destroy();
      sourceSelection?.destroy();
      if (direction === 'undo') {
        undoPixels = null;
        undoSelection = null;
        redoPixels = inversePixels;
        redoSelection = inverseSelection;
        applied = false;
      } else {
        redoPixels = null;
        redoSelection = null;
        undoPixels = inversePixels;
        undoSelection = inverseSelection;
        applied = true;
      }
      return true;
    };

    return {
      byteSize: this.width * this.height * 8 * (usesSelection ? 2 : 1),
      undo: () => swap('undo'),
      redo: () => swap('redo'),
      destroy: () => {
        undoPixels?.destroy();
        undoSelection?.destroy();
        redoPixels?.destroy();
        redoSelection?.destroy();
        undoPixels = null;
        undoSelection = null;
        redoPixels = null;
        redoSelection = null;
      }
    };
  }

  cancelTransform() {
    return this.transformSessions.cancel();
  }

  paintDabs(
    layerId: LayerId,
    channel: PaintChannel,
    dabs: BrushDab[],
    color: [number, number, number],
    hardness: number,
    opacity: number,
    flow: number,
    erase = false,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    if (!dabs.length) return;
    this.ensureToolPipelines();
    this.ensureSelectionTargets();
    const runtime = this.layerResources.raster(layerId);
    if (channel === 'pixels' && !runtime) throw new Error('The active raster layer is not available on the GPU.');
    const target = channel === 'mask' ? this.maskTextureFor(layerId) : runtime?.texture;
    if (!target) throw new Error('The active paint channel is not available on the GPU.');
    if (!this.selectionTextures.mask) throw new Error('The LightTable selection mask is not initialized.');
    const inverse = invertMatrix(transform);
    if (!inverse) throw new Error('The active layer transform cannot be inverted for painting.');
    this.device.queue.writeBuffer(this.brushCanvasBuffer, 0, new Float32Array([
      this.width, this.height, 0, 0,
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      transform.a, transform.c, transform.tx, 0,
      transform.b, transform.d, transform.ty, 0
    ]));
    const paintColor: [number, number, number] = channel === 'mask'
      ? [color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722, color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722, color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722]
      : color;
    const values = new Float32Array(dabs.length * 8);
    dabs.forEach((dab, index) => {
      const pressure = Math.min(1, Math.max(0.05, dab.pressure || 1));
      values.set([
        dab.x, dab.y, dab.size * (0.2 + pressure * 0.8), hardness,
        paintColor[0], paintColor[1], paintColor[2], opacity * flow * pressure
      ], index * 8);
    });
    const dabBuffer = this.device.createBuffer({
      label: 'LightTable brush dab batch',
      size: values.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(dabBuffer, 0, values);
    const bindGroup = this.device.createBindGroup({
      layout: (erase ? this.toolPipelines!.erase : this.toolPipelines!.brush).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dabBuffer } },
        { binding: 1, resource: { buffer: this.brushCanvasBuffer } },
        { binding: 2, resource: this.selectionTextures.mask.createView() }
      ]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable brush dabs' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
        loadOp: 'load',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(erase ? this.toolPipelines!.erase : this.toolPipelines!.brush);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, dabs.length);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    void this.device.queue.onSubmittedWorkDone().then(() => dabBuffer.destroy());
  }

  fillLayerColor(
    layerId: LayerId,
    channel: PaintChannel,
    color: [number, number, number],
    preserveTransparency: boolean,
    transform: AffineMatrix = identityAffineMatrix()
  ) {
    this.ensureToolPipelines();
    this.ensureSelectionTargets();
    const runtime = this.layerResources.raster(layerId);
    const target = channel === 'mask' ? this.maskTextureFor(layerId) : runtime?.texture;
    if (!target || !this.selectionTextures.mask) return false;

    const result = this.createTexture('LightTable filled layer color');
    const settingsBuffer = this.device.createBuffer({
      label: 'LightTable fill color settings',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
      color[0], color[1], color[2], 1,
      preserveTransparency ? 1 : 0,
      channel === 'mask' ? 1 : 0,
      0, 0,
      transform.a, transform.c, transform.tx, 0,
      transform.b, transform.d, transform.ty, 0
    ]));
    const bindGroup = this.device.createBindGroup({
      layout: this.toolPipelines!.fillColor.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: target.createView() },
        { binding: 1, resource: this.selectionTextures.mask.createView() },
        { binding: 2, resource: { buffer: settingsBuffer } }
      ]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable fill layer color' });
    this.drawFullscreen(
      encoder,
      this.toolPipelines!.fillColor,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture({ texture: result }, { texture: target }, [this.width, this.height]);
    this.device.queue.submit([encoder.finish()]);
    this.invalidateStyledLayerCache(layerId);
    this.releaseSubmittedResources();
    void this.device.queue.onSubmittedWorkDone().then(() => {
      result.destroy();
      settingsBuffer.destroy();
    });
    return true;
  }

  invertLayerColors(layerId: LayerId, channel: PaintChannel = 'pixels') {
    this.ensureToolPipelines();
    const runtime = this.layerResources.raster(layerId);
    const target = channel === 'mask' ? this.maskTextureFor(layerId) : runtime?.texture;
    if (!target) return false;
    const result = this.createTexture('LightTable inverted layer colors');
    const bindGroup = this.device.createBindGroup({
      layout: this.toolPipelines!.invertColors.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: target.createView() }]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable invert layer colors' });
    this.drawFullscreen(
      encoder,
      this.toolPipelines!.invertColors,
      bindGroup,
      result.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    encoder.copyTextureToTexture({ texture: result }, { texture: target }, [this.width, this.height]);
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    void this.device.queue.onSubmittedWorkDone().then(() => result.destroy());
    return true;
  }

  setSelection(shape: SelectionShape, requestedMode: SelectionMode) {
    return this.selectionRasterizer.set(shape, requestedMode);
  }

  featherSelection(radius: number) {
    return this.selectionRasterizer.feather(radius);
  }

  copySelectedLayerContent(document: ImageDocument, layerId: LayerId) {
    this.ensureToolPipelines();
    if (!this.selectionTextures.active || !this.selectionTextures.mask) return false;
    const layer = findRasterLayer(document, layerId);
    if (!layer || !layer.visible) return false;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable copy selected layer pixels' });
    // Blend modes describe the relationship with lower layers. Copying one
    // active layer must preserve its own pixels/mask/opacity, not blend it
    // against a synthetic transparent background.
    const isolatedLayer = { ...layer, blendMode: 'normal' as const };
    const isolatedLayerTexture = this.encodeComposite(encoder, {
      ...document,
      layers: [isolatedLayer],
      activeLayerId: layer.id
    });
    if (!this.selectionClipboard.encodeLayerCopy(encoder, isolatedLayerTexture)) return false;
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return true;
  }

  async exportSelectionClipboard(bounds: Rect) {
    return this.selectionClipboard.exportLayerSelection(bounds);
  }

  async exportDisplaySelection(
    displayTexture: GPUTexture,
    bounds: Rect
  ) {
    return this.selectionClipboard.exportDisplaySelection(displayTexture, bounds);
  }

  async pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    requestedPosition: { x: number; y: number } | null
  ) {
    return this.selectionClipboard.pasteExternalImage(layerId, blob, requestedPosition);
  }

  async measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.selectionContentAnalyzer.measure(layer, true);
  }

  async measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.selectionContentAnalyzer.measure(layer, false);
  }

  pasteSelectionClipboard(layerId: LayerId) {
    return this.selectionClipboard.pasteInternal(layerId);
  }

  hasSelectionClipboard() {
    return this.selectionClipboard.hasInternalClipboard();
  }

  clearSelection() {
    return this.selectionRasterizer.clear();
  }

  private ensureToolPipelines() {
    this.toolPipelines ??= toolPipelinesFor(this.device);
  }

  private createTexture(label: string) {
    return this.device.createTexture({
      label,
      size: [Math.max(1, this.width), Math.max(1, this.height)],
      format: 'rgba16float',
      usage: textureUsage
    });
  }

  private createMaskTexture(label: string) {
    const texture = this.createTexture(label);
    const encoder = this.device.createCommandEncoder({ label: `Initialize ${label}` });
    this.clearTexture(encoder, texture, { r: 1, g: 1, b: 1, a: 1 });
    this.device.queue.submit([encoder.finish()]);
    return texture;
  }

  private createSelectionTexture(label: string) {
    return this.device.createTexture({
      label,
      size: [Math.max(1, this.width), Math.max(1, this.height)],
      format: 'r8unorm',
      usage: textureUsage
    });
  }

  private clearTexture(encoder: GPUCommandEncoder, texture: GPUTexture, clearValue: GPUColor = { r: 0, g: 0, b: 0, a: 0 }) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture.createView(), clearValue, loadOp: 'clear', storeOp: 'store' }]
    });
    pass.end();
  }

  private drawFullscreen(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, clearValue, loadOp: 'clear', storeOp: 'store' }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  destroyImageResources() {
    this.resourceGeneration += 1;
    this.layerResources.destroy();
    this.patternAssets.clear();
    this.layerStyleRenderer.destroy();
    this.compositeTargets.destroy();
    this.selectionTextures.destroy();
    this.geometryPreviews.clear();
    this.cancelTransform();
    this.pixelEditSessions.destroy();
  }

  destroy() {
    this.destroyImageResources();
    this.brushCanvasBuffer.destroy();
    this.submittedResources.destroyPending();
  }
}
