import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type Rect,
  type RasterLayer
} from '../document/documentTypes';
import {
  findRasterLayer,
  walkLayerTree,
  walkRasterLayers
} from '../document/layerTree';
import type { BrushDab } from '../tools/brush/strokeBuilder';
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
import { LayerCompositor } from './LayerCompositor';
import type { ReversiblePixelEdit } from '../history/ReversiblePixelEdit';
import { TransformRasterizer } from './TransformRasterizer';
import { PixelEditHistoryService } from './PixelEditHistoryService';

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
  private readonly compositor: LayerCompositor;
  private readonly compositeTargets: RenderTargetPair;
  private readonly selectionTextures: SelectionTextureStore;
  private readonly transformSessions = new TransformSessionStore();
  private readonly pixelEditSessions = new PixelEditSessionStore();
  private readonly documentAssets: LayerDocumentAssetService;
  private readonly textureCodec: LayerTextureCodec;
  private readonly selectionRasterizer: SelectionRasterizer;
  private readonly selectionContentAnalyzer: SelectionContentAnalyzer;
  private readonly selectionClipboard: SelectionClipboardService;
  private readonly transformRasterizer: TransformRasterizer;
  private readonly pixelEditHistory: PixelEditHistoryService;
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
    this.compositor = new LayerCompositor({
      device,
      sampler,
      compositePipeline: this.compositePipeline,
      adjustmentMixPipeline: this.adjustmentMixPipeline,
      layerResources: this.layerResources,
      targets: this.compositeTargets,
      submittedResources: this.submittedResources,
      transformSessions: this.transformSessions,
      pixelEditSessions: this.pixelEditSessions,
      geometryPreviews: this.geometryPreviews,
      layerStyles: this.layerStyleRenderer,
      dimensions: () => ({ width: this.width, height: this.height }),
      syncDocument: (document) => this.syncDocument(document),
      maskTextureFor: (layerId) => this.maskTextureFor(layerId),
      createTexture: (label) => this.createTexture(label),
      clearTexture: (encoder, texture) => this.clearTexture(encoder, texture),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.selectionTextures = new SelectionTextureStore({
      createSelectionTexture: (label) => this.createSelectionTexture(label),
      createClipboardTexture: (label) => this.createTexture(label)
    });
    this.transformRasterizer = new TransformRasterizer({
      device,
      sampler,
      layerResources: this.layerResources,
      selectionTextures: this.selectionTextures,
      sessions: this.transformSessions,
      dimensions: () => ({ width: this.width, height: this.height }),
      pipelines: () => {
        this.ensureToolPipelines();
        return this.toolPipelines!;
      },
      ensureSelectionTargets: () => this.ensureSelectionTargets(),
      createTexture: (label) => this.createTexture(label),
      createSelectionTexture: (label) => this.createSelectionTexture(label),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId),
      drawFullscreen: (encoder, pipeline, bindGroup, target, clearValue) =>
        this.drawFullscreen(encoder, pipeline, bindGroup, target, clearValue)
    });
    this.pixelEditHistory = new PixelEditHistoryService({
      device,
      layerResources: this.layerResources,
      sessions: this.pixelEditSessions,
      dimensions: () => ({ width: this.width, height: this.height }),
      createTexture: (label) => this.createTexture(label),
      maskTextureFor: (layerId) => this.maskTextureFor(layerId),
      invalidateLayer: (layerId) => this.invalidateStyledLayerCache(layerId)
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
    encodeAdjustment?: EncodeAdjustment
  ): GPUTexture {
    return this.compositor.encode(encoder, document, encodeAdjustment);
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
    return this.pixelEditHistory.begin(layerId, channel);
  }

  finishPixelEdit(): ReversiblePixelEdit | null {
    return this.pixelEditHistory.finish();
  }

  cancelPixelEdit() {
    return this.pixelEditHistory.cancel();
  }

  beginTransform(layer: RasterLayer, useSelection: boolean) {
    return this.transformRasterizer.begin(layer, useSelection);
  }

  updateTransform(matrix: AffineMatrix) {
    return this.transformRasterizer.update(matrix);
  }

  commitTransform(): ReversiblePixelEdit | null {
    return this.transformRasterizer.commit();
  }

  cancelTransform() {
    return this.transformRasterizer.cancel();
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
