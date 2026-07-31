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
  findLayerNode,
  findRasterLayer,
  walkLayerTree,
  walkRasterLayers
} from '../document/layerTree';
import type { BrushDab } from '../tools/brush/strokeBuilder';
import {
  ADJUSTMENT_LAYER_MIX_WGSL,
  BRUSH_DAB_WGSL,
  LAYER_COMPOSITE_WGSL,
  LAYER_EXPORT_WGSL,
  LAYER_FILL_COLOR_WGSL,
  LAYER_INVERT_COLORS_WGSL,
  LAYER_MASK_DECODE_WGSL,
  LAYER_SOURCE_DECODE_WGSL,
  LAYER_STYLE_SHAPE_WGSL,
  LAYER_STYLE_EFFECT_WGSL,
  SELECTION_COMBINE_WGSL,
  SELECTION_CONTENT_COVERAGE_WGSL,
  SELECTION_COPY_WGSL,
  SELECTION_DISPLAY_COPY_WGSL,
  SELECTION_FEATHER_WGSL,
  SELECTION_SHAPE_WGSL
} from './layerShaders';
import { FULLSCREEN_VERTEX_WGSL } from '../../gpu/shaders';
import { blendModeGpuValue, type BlendMode } from '../document/blendModes';
import type { PaintChannel } from '../session/editorSession';
import type { SelectionMode, SelectionShape } from '../selection/selectionTypes';
import { selectionCoverageBounds, type SelectionCoverageBounds } from '../selection/selectionCoverage';
import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import type {
  DocumentAssetBlob,
  PatternAssetBlob
} from '../persistence/layeredDocumentFormat';
import type { DocumentAssetId } from '../document/documentTypes';
import { invertMatrix } from '../tools/transform/affine';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { LAYER_TRANSFORM_WGSL, SELECTION_TRANSFORM_WGSL } from './transformShaders';
import {
  identityAffineMatrix,
  isIdentityAffineMatrix,
  rasterRenderContract,
  type RasterRenderContract
} from './renderContract';
import { layerStyleStackIsActive } from '../styles/layerStyleDefaults';
import {
  baseLayerStyleUniform,
  LAYER_STYLE_SETTINGS_BYTES,
  layerStyleUniform
} from '../styles/layerStyleGpu';
import {
  layerStyleCacheKey,
  layerStyleDocumentBounds
} from '../styles/layerStyleRenderPlan';
import {
  analyzeDocumentComposite,
  type CompositorPlan,
  type CompositorPlanEntry
} from './compositorGraph';
import {
  encodeRgba8Png,
  readRgba8Texture
} from '../../gpu/gpuReadback';
import { LayerRuntimeStore } from './LayerRuntimeStore';
import { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import { LayerStyleTextureStore } from './LayerStyleTextureStore';
import { RenderTargetPair } from './RenderTargetPair';
import { SelectionTextureStore } from './SelectionTextureStore';
import { TransformSessionStore } from './TransformSessionStore';
import { PixelEditSessionStore } from './PixelEditSessionStore';

interface GeometryPreview {
  matrix: AffineMatrix;
  sourceGeometryRevision: number;
}

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
const selectionModeValue: Record<SelectionMode, number> = {
  replace: 0,
  add: 1,
  subtract: 2,
  intersect: 3,
  invert: 4,
  feather: 5
};
const LAYER_EXPORT_SETTINGS_FLOATS = 4;
interface DocumentPipelineBundle {
  decode: GPURenderPipeline;
  maskDecode: GPURenderPipeline;
  exportLayer: GPURenderPipeline;
  composite: GPURenderPipeline;
  adjustmentMix: GPURenderPipeline;
  fullscreenModule: GPUShaderModule;
  styleShape: GPURenderPipeline;
}
const documentPipelineCache = new WeakMap<GPUDevice, DocumentPipelineBundle>();
interface StyleEffectPipelineEntry {
  module: GPUShaderModule;
  pipeline: Promise<GPURenderPipeline>;
}
const styleEffectPipelineCache = new WeakMap<GPUDevice, StyleEffectPipelineEntry>();

const documentPipelines = (device: GPUDevice) => {
  const cached = documentPipelineCache.get(device);
  if (cached) return cached;
  const fullscreenModule = device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
  const create = (label: string, code: string, format: GPUTextureFormat) => device.createRenderPipeline({
    label,
    layout: 'auto',
    vertex: { module: fullscreenModule, entryPoint: 'fullscreenVertex' },
    fragment: {
      module: device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${code}` }),
      entryPoint: 'main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list' }
  });
  const bundle: DocumentPipelineBundle = {
    decode: create('LightTable layer source decode', LAYER_SOURCE_DECODE_WGSL, 'rgba16float'),
    maskDecode: create('LightTable mask source decode', LAYER_MASK_DECODE_WGSL, 'rgba16float'),
    exportLayer: create('LightTable raster layer export', LAYER_EXPORT_WGSL, 'rgba8unorm'),
    composite: create('LightTable layer compositor', LAYER_COMPOSITE_WGSL, 'rgba16float'),
    adjustmentMix: create('LightTable adjustment layer mix', ADJUSTMENT_LAYER_MIX_WGSL, 'rgba16float'),
    styleShape: create('LightTable Layer Style shape', LAYER_STYLE_SHAPE_WGSL, 'rgba16float'),
    fullscreenModule
  };
  documentPipelineCache.set(device, bundle);
  return bundle;
};

export class LayerDocumentRenderer {
  private readonly layerResources: LayerRuntimeStore;
  private readonly patternTextures = new Map<DocumentAssetId, GPUTexture>();
  private readonly patternSources = new Map<DocumentAssetId, Blob>();
  private readonly decodePipeline: GPURenderPipeline;
  private readonly maskDecodePipeline: GPURenderPipeline;
  private readonly exportPipeline: GPURenderPipeline;
  private readonly compositePipeline: GPURenderPipeline;
  private readonly adjustmentMixPipeline: GPURenderPipeline;
  private styleEffectPipeline: GPURenderPipeline | null = null;
  private styleEffectModule: GPUShaderModule | null = null;
  private readonly fullscreenModule: GPUShaderModule;
  private readonly styleShapePipeline: GPURenderPipeline;
  private brushPipeline!: GPURenderPipeline;
  private erasePipeline!: GPURenderPipeline;
  private fillColorPipeline!: GPURenderPipeline;
  private invertColorsPipeline!: GPURenderPipeline;
  private selectionShapePipeline!: GPURenderPipeline;
  private selectionCombinePipeline!: GPURenderPipeline;
  private selectionContentCoveragePipeline!: GPURenderPipeline;
  private selectionFeatherPipeline!: GPURenderPipeline;
  private selectionCopyPipeline!: GPURenderPipeline;
  private selectionDisplayCopyPipeline!: GPURenderPipeline;
  private transformPipeline!: GPURenderPipeline;
  private selectionTransformPipeline!: GPURenderPipeline;
  private toolPipelinesReady = false;
  private readonly brushCanvasBuffer: GPUBuffer;
  private readonly submittedResources: SubmittedResourceRetainer;
  private readonly layerStyleTextures: LayerStyleTextureStore;
  private readonly compositeTargets: RenderTargetPair;
  private readonly selectionTextures: SelectionTextureStore;
  private readonly transformSessions = new TransformSessionStore();
  private readonly pixelEditSessions = new PixelEditSessionStore();
  private width = 0;
  private height = 0;
  private resourceGeneration = 0;
  private readonly geometryPreviews = new Map<LayerId, GeometryPreview>();
  private styleQuality: 'interactive' | 'final' = 'final';

  private readonly device: GPUDevice;
  private readonly sampler: GPUSampler;

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device;
    this.sampler = sampler;
    const pipelines = documentPipelines(device);
    this.decodePipeline = pipelines.decode;
    this.maskDecodePipeline = pipelines.maskDecode;
    this.exportPipeline = pipelines.exportLayer;
    this.compositePipeline = pipelines.composite;
    this.adjustmentMixPipeline = pipelines.adjustmentMix;
    this.fullscreenModule = pipelines.fullscreenModule;
    this.styleShapePipeline = pipelines.styleShape;
    this.layerResources = new LayerRuntimeStore({
      createRasterTexture: (label) => this.createTexture(label),
      createMaskTexture: (label) => this.createMaskTexture(label)
    });
    this.submittedResources = new SubmittedResourceRetainer({
      onSubmittedWorkDone: () => this.device.queue.onSubmittedWorkDone()
    });
    this.layerStyleTextures = new LayerStyleTextureStore({
      createTexture: (label) => this.createTexture(label)
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
    // Tool-only pipelines are compiled on first use. The normal image-open
    // path needs decode/composite, but not brush, selection or transform.
    this.brushCanvasBuffer = device.createBuffer({
      label: 'LightTable brush canvas settings',
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  async initializeLayerStylePipeline() {
    if (this.styleEffectPipeline) return;
    let entry = styleEffectPipelineCache.get(this.device);
    if (!entry) {
      const module = this.device.createShaderModule({
        label: 'LightTable Layer Style effect shader',
        code: `${FULLSCREEN_VERTEX_WGSL}\n${LAYER_STYLE_EFFECT_WGSL}`
      });
      const pipeline = this.device.createRenderPipelineAsync({
        label: 'LightTable Layer Style effect',
        layout: 'auto',
        vertex: { module: this.fullscreenModule, entryPoint: 'fullscreenVertex' },
        fragment: {
          module,
          entryPoint: 'main',
          targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list' }
      });
      entry = { module, pipeline };
      styleEffectPipelineCache.set(this.device, entry);
    }
    this.styleEffectModule = entry.module;
    try {
      this.styleEffectPipeline = await entry.pipeline;
    } catch (reason) {
      // A rejected pipeline promise must not poison future editor instances.
      styleEffectPipelineCache.delete(this.device);
      throw reason;
    }
  }

  async layerStyleShaderErrors() {
    if (!this.styleEffectModule) return [];
    const compilation = await this.styleEffectModule.getCompilationInfo();
    return compilation.messages
      .filter((message) => message.type === 'error')
      .map((message) => {
        const location = message.lineNum
          ? `:${message.lineNum}:${message.linePos ?? 0}`
          : '';
        return `${location} ${message.message}`.trim();
      });
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
      this.layerStyleTextures.invalidate(id);
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
    this.patternTextures.forEach((texture) => {
      bytes += Math.max(1, texture.width) * Math.max(1, texture.height) * 8;
    });
    bytes += this.layerStyleTextures.estimatedTextureBytes(this.width, this.height);
    bytes += this.compositeTargets.estimatedTextureBytes(this.width, this.height, 8);
    bytes += this.selectionTextures.estimatedTextureBytes(this.width, this.height);
    bytes += this.pixelEditSessions.estimatedTextureBytes(rgba16Bytes);
    bytes += this.transformSessions.estimatedTextureBytes(rgba16Bytes, r8Bytes);
    return bytes;
  }

  setGeometryPreview(layer: RasterLayer, matrix: AffineMatrix | null) {
    if (!matrix) {
      return this.geometryPreviews.delete(layer.id);
    }
    this.geometryPreviews.set(layer.id, {
      matrix: { ...matrix },
      sourceGeometryRevision: layer.geometryRevision
    });
    return true;
  }

  clearGeometryPreviews() {
    const changed = this.geometryPreviews.size > 0;
    this.geometryPreviews.clear();
    return changed;
  }

  setLayerStyleInteractionActive(active: boolean) {
    const quality = active ? 'interactive' : 'final';
    if (quality === this.styleQuality) return false;
    this.styleQuality = quality;
    this.releaseStyledLayerCache();
    return true;
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
      const geometryPreview = this.geometryPreviews.get(layer.id);
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
      const geometryPreview = this.geometryPreviews.get(layer.id);
      const validGeometryPreview = geometryPreview?.sourceGeometryRevision === layer.geometryRevision
        ? geometryPreview
        : null;
      if (geometryPreview && !validGeometryPreview) this.geometryPreviews.delete(layer.id);
      // A selection preview is already rasterized in document space. A whole
      // layer preview remains source pixels plus a temporary geometry override,
      // so the layer mask follows the exact same transform.
      const sourceToDocument = activeTransform
        ? activeTransform.usesSelection
          ? identityAffineMatrix()
          : activeTransform.matrix
        : validGeometryPreview?.matrix ?? renderContract.transform;
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
          : layerStyleCacheKey(layer, sourceToDocument, this.styleQuality);
        const styled = this.encodeStyledLayer(
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
        ? this.encodeStyledLayer(
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

  private encodeStyledLayer(
    encoder: GPUCommandEncoder,
    layer: RasterLayer | GroupLayer,
    foregroundTexture: GPUTexture,
    maskTexture: GPUTexture | null,
    inverse: AffineMatrix,
    sourceSize: { width: number; height: number },
    cacheKey: string | null
  ) {
    const styleEffectPipeline = this.styleEffectPipeline;
    if (!styleEffectPipeline) return null;
    const cached = this.layerStyleTextures.cached(layer.id, cacheKey);
    if (cached) return cached;
    const styleTextures = this.layerStyleTextures.ensureWorkTextures();

    // Materialize transformed/masked source once. This pass intentionally
    // does not use the regular layer compositor: styles operate on a shape,
    // never on a blend against a synthetic transparent background.
    const shapeSettings = this.device.createBuffer({
      label: `LightTable Layer Style shape: ${layer.name}`,
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(shapeSettings, 0, new Float32Array([
      layer.mask?.enabled && maskTexture ? 1 : 0,
      layer.mask?.density ?? 1,
      layer.mask?.feather ?? 0,
      0,
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      sourceSize.width, sourceSize.height,
      this.width, this.height
    ]));
    this.submittedResources.retainBuffer(shapeSettings);
    const shapeBindGroup = this.device.createBindGroup({
      layout: this.styleShapePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: foregroundTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: shapeSettings } },
        { binding: 3, resource: (maskTexture ?? foregroundTexture).createView() }
      ]
    });
    this.drawFullscreen(
      encoder,
      this.styleShapePipeline,
      shapeBindGroup,
      styleTextures.shape.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );

    const encodeStylePass = (
      current: GPUTexture,
      target: GPUTexture,
      values: Float32Array,
      label: string,
      patternTexture: GPUTexture | null = null
    ) => {
      const settingsBuffer = this.device.createBuffer({
        label,
        size: LAYER_STYLE_SETTINGS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array(values));
      this.submittedResources.retainBuffer(settingsBuffer);
      const bindGroup = this.device.createBindGroup({
        layout: styleEffectPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: styleTextures.shape.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (patternTexture ?? styleTextures.shape).createView() }
        ]
      });
      this.drawFullscreen(
        encoder,
        styleEffectPipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
    };

    encodeStylePass(
      styleTextures.shape,
      styleTextures.first,
      baseLayerStyleUniform(layer.fillOpacity, this.width, this.height),
      `LightTable Layer Style Fill: ${layer.name}`,
      null
    );
    let current = styleTextures.first;
    let target = styleTextures.second;
    layer.styleStack.effects.forEach((effect) => {
      const patternTexture = this.patternTextureForEffect(effect);
      const values = layerStyleUniform(
        effect,
        layer.styleStack,
        this.width,
        this.height,
        !this.effectRequiresPattern(effect) || Boolean(patternTexture),
        this.styleQuality
      );
      if (!values) return;
      encodeStylePass(
        current,
        target,
        values,
        `LightTable Layer Style ${effect.name}: ${layer.name}`,
        patternTexture
      );
      [current, target] = [target, current];
    });
    if (!cacheKey) return current;
    this.layerStyleTextures.writeCache(
      encoder,
      layer.id,
      cacheKey,
      layer.name,
      current,
      [this.width, this.height]
    );
    // Finish this frame from the already-rendered work texture. The cache
    // becomes readable on a later render. Besides avoiding an unnecessary
    // transition back from COPY_DST in the same command buffer, this keeps
    // first-use style rendering reliable on stricter WebGPU implementations.
    return current;
  }

  private releaseStyleTargets() {
    this.layerStyleTextures.releaseWorkTextures();
  }

  private releaseStyledLayerCache() {
    this.layerStyleTextures.releaseCache();
  }

  private invalidateStyledLayerCache(layerId: LayerId) {
    this.layerStyleTextures.invalidate(layerId);
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
    const source = this.layerResources.raster(sourceId);
    const destination = this.layerResources.raster(destinationId);
    if (!source || !destination) return;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable duplicate raster layer' });
    encoder.copyTextureToTexture({ texture: source.texture }, { texture: destination.texture }, [this.width, this.height]);
    if (source.maskTexture && destination.maskTexture) {
      encoder.copyTextureToTexture({ texture: source.maskTexture }, { texture: destination.maskTexture }, [this.width, this.height]);
    }
    this.device.queue.submit([encoder.finish()]);
    // Detached runtimes can survive undo/redo. Never let pixels copied into a
    // reused destination inherit an older styled result with the same ids and
    // revisions.
    this.invalidateStyledLayerCache(destinationId);
  }

  async exportDocumentAssets(document: ImageDocument): Promise<DocumentAssetBlob[]> {
    const assets: DocumentAssetBlob[] = [];
    for (const { layer } of walkRasterLayers(document.layers)) {
      const runtime = this.layerResources.raster(layer.id);
      if (!runtime) throw new Error(`Layer ${layer.name} is not available for saving.`);
      assets.push({
        layerId: layer.id,
        pixels: await this.encodeTextureAsPng(runtime.texture, false),
        mask: layer.mask && runtime.maskTexture ? await this.encodeTextureAsPng(runtime.maskTexture, true) : null
      });
    }
    for (const { node } of walkLayerTree(document.layers)) {
      if (node.type === 'raster' || !node.mask) continue;
      const maskTexture = this.maskTextureFor(node.id);
      if (!maskTexture) throw new Error(`Mask ${node.name} is not available for saving.`);
      assets.push({
        layerId: node.id,
        pixels: new Blob(),
        mask: await this.encodeTextureAsPng(maskTexture, true)
      });
    }
    document.assets.patterns.forEach((pattern) => {
      const source = this.patternSources.get(pattern.id);
      if (!source) throw new Error(`Pattern ${pattern.name} is not available for saving.`);
      assets.push({ patternId: pattern.id, source });
    });
    return assets;
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
    const blob = await this.withValidationScope(
      maskChannel
        ? 'LightTable mask thumbnail validation failed'
        : 'LightTable layer thumbnail validation failed',
      () => this.encodeTextureAsPngUnchecked(source, maskChannel, width, height)
    );
    return { blob, width, height };
  }

  async loadDocumentAssets(assets: DocumentAssetBlob[]) {
    for (const asset of assets) {
      if ('sourceId' in asset) continue;
      if ('patternId' in asset) {
        await this.loadPatternAsset(asset);
        continue;
      }
      const runtime = this.layerResources.raster(asset.layerId);
      this.invalidateStyledLayerCache(asset.layerId);
      if (asset.pixels.size > 0) {
        if (!runtime) throw new Error(`Layer ${asset.layerId} is not available while opening the document.`);
        await this.decodeBlobIntoTexture(asset.pixels, runtime.texture, false);
      }
      if (asset.mask) {
        const maskTexture = this.maskTextureFor(asset.layerId);
        if (!maskTexture) throw new Error(`Mask ${asset.layerId} is not available while opening the document.`);
        await this.decodeBlobIntoTexture(asset.mask, maskTexture, true);
      }
    }
  }

  private patternTextureForEffect(effect: RasterLayer['styleStack']['effects'][number]) {
    const reference = effect.kind === 'pattern-overlay'
      ? effect.pattern
      : effect.kind === 'stroke' && effect.fill.type === 'pattern'
        ? effect.fill.pattern
        : effect.kind === 'bevel-emboss' && effect.texture.enabled
          ? effect.texture.pattern
          : null;
    return reference?.assetId
      ? this.patternTextures.get(reference.assetId as DocumentAssetId) ?? null
      : null;
  }

  private effectRequiresPattern(effect: RasterLayer['styleStack']['effects'][number]) {
    return effect.kind === 'pattern-overlay'
      || (effect.kind === 'stroke' && effect.fill.type === 'pattern')
      || (effect.kind === 'bevel-emboss' && effect.texture.enabled);
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
      this.patternTextures.get(asset.patternId)?.destroy();
      this.patternTextures.set(asset.patternId, target);
      this.patternSources.set(asset.patternId, asset.source);
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
    encodeAdjustment?: (
      encoder: GPUCommandEncoder,
      source: GPUTexture,
      layer: AdjustmentLayer | RasterLayer
    ) => GPUTexture
  ) {
    return this.mergeLayers(document, [bottomId, topId], bottomId, encodeAdjustment);
  }

  mergeLayers(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    destinationId: LayerId,
    encodeAdjustment?: (
      encoder: GPUCommandEncoder,
      source: GPUTexture,
      layer: AdjustmentLayer | RasterLayer
    ) => GPUTexture
  ) {
    const destination = this.layerResources.raster(destinationId);
    const layers = layerIds.map((layerId) => findLayerNode(document.layers, layerId)?.node ?? null);
    if (
      !destination
      || layers.length < 2
      || layers.some((layer) => !layer)
      || layers.some((layer) => layer?.type === 'group')
      || layers.some((layer) => layer?.type === 'raster' && !this.layerResources.raster(layer.id))
    ) return false;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable merge selected layers' });
    const mergedTexture = this.encodeComposite(encoder, {
      ...document,
      layers: layers as Array<RasterLayer | AdjustmentLayer>
    }, encodeAdjustment);
    encoder.copyTextureToTexture({ texture: mergedTexture }, { texture: destination.texture }, [this.width, this.height]);
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return true;
  }

  flattenGroup(
    document: ImageDocument,
    groupId: LayerId,
    destinationId: LayerId,
    encodeAdjustment?: (
      encoder: GPUCommandEncoder,
      source: GPUTexture,
      layer: AdjustmentLayer | RasterLayer
    ) => GPUTexture
  ) {
    const group = findLayerNode(document.layers, groupId)?.node;
    const destination = this.layerResources.raster(destinationId);
    if (!group || group.type !== 'group' || !destination) return false;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable flatten group' });
    const flattenedTexture = this.encodeComposite(encoder, {
      ...document,
      layers: [{ ...group, visible: true }]
    }, encodeAdjustment);
    encoder.copyTextureToTexture(
      { texture: flattenedTexture },
      { texture: destination.texture },
      [this.width, this.height]
    );
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return true;
  }

  flattenImage(
    document: ImageDocument,
    destinationId: LayerId,
    encodeAdjustment?: (
      encoder: GPUCommandEncoder,
      source: GPUTexture,
      layer: AdjustmentLayer | RasterLayer
    ) => GPUTexture
  ) {
    const destination = this.layerResources.raster(destinationId);
    if (!destination) return false;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable flatten image' });
    const flattenedTexture = this.encodeComposite(encoder, document, encodeAdjustment);
    encoder.copyTextureToTexture(
      { texture: flattenedTexture },
      { texture: destination.texture },
      [this.width, this.height]
    );
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return true;
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
      layout: this.transformPipeline.getBindGroupLayout(0),
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
      this.transformPipeline,
      transformBindGroup,
      session.previewTexture.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    if (session.selectionTexture && session.selectionPreview) {
      const selectionBindGroup = this.device.createBindGroup({
        layout: this.selectionTransformPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: session.selectionTexture.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: session.settingsBuffer } }
        ]
      });
      this.drawFullscreen(
        encoder,
        this.selectionTransformPipeline,
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
      layout: (erase ? this.erasePipeline : this.brushPipeline).getBindGroupLayout(0),
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
    pass.setPipeline(erase ? this.erasePipeline : this.brushPipeline);
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
      layout: this.fillColorPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: target.createView() },
        { binding: 1, resource: this.selectionTextures.mask.createView() },
        { binding: 2, resource: { buffer: settingsBuffer } }
      ]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable fill layer color' });
    this.drawFullscreen(
      encoder,
      this.fillColorPipeline,
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
      layout: this.invertColorsPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: target.createView() }]
    });
    const encoder = this.device.createCommandEncoder({ label: 'LightTable invert layer colors' });
    this.drawFullscreen(
      encoder,
      this.invertColorsPipeline,
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
    this.ensureToolPipelines();
    this.ensureSelectionTargets();
    if (!this.selectionTextures.mask || !this.selectionTextures.result || !this.selectionTextures.shape) return false;
    if (
      (shape.kind === 'free' || shape.kind === 'polygon')
      && shape.points.length < 3
    ) return false;
    if (
      shape.kind !== 'free'
      && shape.kind !== 'polygon'
      && shape.points.length < 2
    ) return false;
    if (!this.selectionTextures.active && requestedMode === 'subtract') return false;
    const mode = this.selectionTextures.active ? requestedMode : 'replace';
    const points = shape.points.length ? shape.points : [{ x: 0, y: 0 }];
    const pointValues = new Float32Array(points.length * 2);
    points.forEach((point, index) => pointValues.set([point.x, point.y], index * 2));
    const pointBuffer = this.device.createBuffer({
      label: 'LightTable selection points',
      size: Math.max(8, pointValues.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(pointBuffer, 0, pointValues);
    const first = points[0];
    const last = points[points.length - 1];
    const shapeSettings = new Float32Array([
      this.width, this.height,
      shape.kind === 'rectangle' ? 0 : shape.kind === 'ellipse' ? 1 : 2,
      points.length,
      first.x, first.y, last.x, last.y
    ]);
    const shapeBuffer = this.device.createBuffer({
      label: 'LightTable selection shape settings',
      size: shapeSettings.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(shapeBuffer, 0, shapeSettings);
    const combineBuffer = this.device.createBuffer({
      label: 'LightTable selection combine settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(combineBuffer, 0, new Float32Array([selectionModeValue[mode], 0, 0, 0]));
    const shapeBindGroup = this.device.createBindGroup({
      layout: this.selectionShapePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: shapeBuffer } },
        { binding: 1, resource: { buffer: pointBuffer } }
      ]
    });
    const combineBindGroup = this.device.createBindGroup({
      layout: this.selectionCombinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.selectionTextures.mask.createView() },
        { binding: 1, resource: this.selectionTextures.shape.createView() },
        { binding: 2, resource: { buffer: combineBuffer } }
      ]
    });
    // Separate submissions make the attachment-to-sampled transition explicit
    // and keep backend diagnostics tied to the pass that caused them.
    const shapeEncoder = this.device.createCommandEncoder({ label: 'LightTable rasterize selection shape' });
    this.drawFullscreen(shapeEncoder, this.selectionShapePipeline, shapeBindGroup, this.selectionTextures.shape.createView(), { r: 0, g: 0, b: 0, a: 1 });
    this.device.queue.submit([shapeEncoder.finish()]);
    const combineEncoder = this.device.createCommandEncoder({ label: 'LightTable combine selection mask' });
    this.drawFullscreen(combineEncoder, this.selectionCombinePipeline, combineBindGroup, this.selectionTextures.result.createView(), { r: 0, g: 0, b: 0, a: 1 });
    this.device.queue.submit([combineEncoder.finish()]);
    this.selectionTextures.swapMaskAndResult();
    this.selectionTextures.active = true;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      pointBuffer.destroy();
      shapeBuffer.destroy();
      combineBuffer.destroy();
    });
    return true;
  }

  featherSelection(radius: number) {
    this.ensureToolPipelines();
    if (!this.selectionTextures.active || !this.selectionTextures.mask || !this.selectionTextures.result) return false;
    const clampedRadius = Math.max(0, Math.min(250, radius));
    if (clampedRadius <= 0) return true;
    const settingsBuffer = this.device.createBuffer({
      label: 'LightTable selection feather settings',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    // Queue writes are visible to later submissions, so use a separate immutable
    // settings buffer per direction to avoid both passes observing the final write.
    const horizontalBuffer = settingsBuffer;
    this.device.queue.writeBuffer(horizontalBuffer, 0, new Float32Array([
      this.width, this.height, 1, 0, clampedRadius, 0, 0, 0
    ]));
    const horizontalBindGroup = this.device.createBindGroup({
      layout: this.selectionFeatherPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.selectionTextures.mask.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: horizontalBuffer } }
      ]
    });
    const horizontalEncoder = this.device.createCommandEncoder({ label: 'LightTable feather selection horizontal' });
    this.drawFullscreen(
      horizontalEncoder,
      this.selectionFeatherPipeline,
      horizontalBindGroup,
      this.selectionTextures.result.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    this.device.queue.submit([horizontalEncoder.finish()]);

    const verticalBuffer = this.device.createBuffer({
      label: 'LightTable selection feather vertical settings',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(verticalBuffer, 0, new Float32Array([
      this.width, this.height, 0, 1, clampedRadius, 0, 0, 0
    ]));
    const verticalBindGroup = this.device.createBindGroup({
      layout: this.selectionFeatherPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.selectionTextures.result.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: verticalBuffer } }
      ]
    });
    const verticalEncoder = this.device.createCommandEncoder({ label: 'LightTable feather selection vertical' });
    this.drawFullscreen(
      verticalEncoder,
      this.selectionFeatherPipeline,
      verticalBindGroup,
      this.selectionTextures.mask.createView(),
      { r: 0, g: 0, b: 0, a: 1 }
    );
    this.device.queue.submit([verticalEncoder.finish()]);
    void this.device.queue.onSubmittedWorkDone().then(() => {
      horizontalBuffer.destroy();
      verticalBuffer.destroy();
    });
    return true;
  }

  copySelectedLayerContent(document: ImageDocument, layerId: LayerId) {
    this.ensureToolPipelines();
    if (!this.selectionTextures.active || !this.selectionTextures.mask) return false;
    const layer = findRasterLayer(document, layerId);
    if (!layer || !layer.visible) return false;
    const selectionClipboard = this.selectionTextures.replaceClipboard();
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
    const bindGroup = this.device.createBindGroup({
      layout: this.selectionCopyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: isolatedLayerTexture.createView() },
        { binding: 1, resource: this.selectionTextures.mask.createView() }
      ]
    });
    this.drawFullscreen(
      encoder,
      this.selectionCopyPipeline,
      bindGroup,
      selectionClipboard.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    this.device.queue.submit([encoder.finish()]);
    this.releaseSubmittedResources();
    return true;
  }

  async exportSelectionClipboard(bounds: Rect) {
    if (!this.selectionTextures.clipboard) {
      throw new Error('No copied LightTable pixels are available.');
    }
    const crop = this.clipboardCrop(bounds);
    const croppedTexture = this.device.createTexture({
      label: 'LightTable cropped selection clipboard',
      size: [crop.width, crop.height],
      format: 'rgba16float',
      usage: textureUsage
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable crop selected layer clipboard'
      });
      encoder.copyTextureToTexture(
        {
          texture: this.selectionTextures.clipboard,
          origin: { x: crop.x, y: crop.y }
        },
        { texture: croppedTexture },
        [crop.width, crop.height]
      );
      this.device.queue.submit([encoder.finish()]);
      return await this.encodeTextureAsPngUnchecked(
        croppedTexture,
        false,
        crop.width,
        crop.height
      );
    } finally {
      croppedTexture.destroy();
    }
  }

  async exportDisplaySelection(
    displayTexture: GPUTexture,
    bounds: Rect
  ) {
    this.ensureToolPipelines();
    if (!this.selectionTextures.active || !this.selectionTextures.mask) {
      throw new Error('A selection is required for Copy Merged.');
    }
    const crop = this.clipboardCrop(bounds);
    const selectedDisplay = this.device.createTexture({
      label: 'LightTable selected display clipboard',
      size: [this.width, this.height],
      format: 'rgba8unorm',
      usage: textureUsage
    });
    const croppedTexture = this.device.createTexture({
      label: 'LightTable cropped selected display clipboard',
      size: [crop.width, crop.height],
      format: 'rgba8unorm',
      usage: textureUsage
    });
    try {
      const bindGroup = this.device.createBindGroup({
        layout: this.selectionDisplayCopyPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: displayTexture.createView() },
          { binding: 1, resource: this.selectionTextures.mask.createView() }
        ]
      });
      const encoder = this.device.createCommandEncoder({
        label: 'LightTable Copy Merged selection'
      });
      this.drawFullscreen(
        encoder,
        this.selectionDisplayCopyPipeline,
        bindGroup,
        selectedDisplay.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      encoder.copyTextureToTexture(
        {
          texture: selectedDisplay,
          origin: { x: crop.x, y: crop.y }
        },
        { texture: croppedTexture },
        [crop.width, crop.height]
      );
      this.device.queue.submit([encoder.finish()]);
      const pixels = await readRgba8Texture(
        this.device,
        croppedTexture,
        crop.width,
        crop.height,
        'LightTable Copy Merged readback'
      );
      return await encodeRgba8Png(pixels, crop.width, crop.height);
    } finally {
      selectedDisplay.destroy();
      croppedTexture.destroy();
    }
  }

  async pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    requestedPosition: { x: number; y: number } | null
  ) {
    const destination = this.layerResources.raster(layerId);
    if (!destination) return false;
    const decoded = await decodeNativeImage(blob);
    try {
      const x = requestedPosition
        ? Math.round(requestedPosition.x)
        : Math.round((this.width - decoded.descriptor.width) / 2);
      const y = requestedPosition
        ? Math.round(requestedPosition.y)
        : Math.round((this.height - decoded.descriptor.height) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Clipboard image placement could not be created.');
      context.clearRect(0, 0, this.width, this.height);
      context.drawImage(decoded.bitmap, x, y);
      const normalized = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => result
            ? resolve(result)
            : reject(new Error('Clipboard image placement could not be encoded.')),
          'image/png'
        );
      });
      await this.decodeBlobIntoTexture(normalized, destination.texture, false);
      this.invalidateStyledLayerCache(layerId);
      return true;
    } finally {
      decoded.close();
    }
  }

  private clipboardCrop(bounds: Rect) {
    const x = Math.max(0, Math.floor(bounds.x));
    const y = Math.max(0, Math.floor(bounds.y));
    const right = Math.min(this.width, Math.ceil(bounds.x + bounds.width));
    const bottom = Math.min(this.height, Math.ceil(bounds.y + bounds.height));
    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y)
    };
  }

  private async measureLayerCoverage(
    layer: RasterLayer,
    selectionEnabled: boolean
  ): Promise<SelectionCoverageBounds | null> {
    this.ensureToolPipelines();
    this.ensureSelectionTargets();
    if (selectionEnabled && !this.selectionTextures.active) return null;
    if (!this.selectionTextures.mask) return null;
    const runtime = this.layerResources.raster(layer.id);
    if (!runtime) return null;
    const generation = this.resourceGeneration;
    const coverageTexture = this.createSelectionTexture(
      selectionEnabled
        ? 'LightTable selected content coverage'
        : 'LightTable layer content coverage'
    );
    const bytesPerRow = Math.ceil(this.width / 256) * 256;
    const readBuffer = this.device.createBuffer({
      label: selectionEnabled
        ? 'LightTable selected content bounds readback'
        : 'LightTable layer content bounds readback',
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const settingsBuffer = this.device.createBuffer({
      label: selectionEnabled
        ? 'LightTable selected content settings'
        : 'LightTable layer content settings',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
      layer.opacity,
      layer.mask?.enabled && runtime.maskTexture ? 1 : 0,
      selectionEnabled ? 1 : 0,
      0
    ]));
    const bindGroup = this.device.createBindGroup({
      layout: this.selectionContentCoveragePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: runtime.texture.createView() },
        { binding: 1, resource: this.selectionTextures.mask.createView() },
        { binding: 2, resource: (runtime.maskTexture ?? runtime.texture).createView() },
        { binding: 3, resource: { buffer: settingsBuffer } }
      ]
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: selectionEnabled
          ? 'LightTable measure selected content'
          : 'LightTable measure layer content'
      });
      this.drawFullscreen(
        encoder,
        this.selectionContentCoveragePipeline,
        bindGroup,
        coverageTexture.createView(),
        { r: 0, g: 0, b: 0, a: 1 }
      );
      encoder.copyTextureToBuffer(
        { texture: coverageTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: this.height },
        [this.width, this.height]
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      if (generation !== this.resourceGeneration) return null;
      const bytes = new Uint8Array(readBuffer.getMappedRange());
      return selectionCoverageBounds(bytes, this.width, this.height, bytesPerRow);
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
      settingsBuffer.destroy();
      coverageTexture.destroy();
    }
  }

  async measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.measureLayerCoverage(layer, true);
  }

  async measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null> {
    return this.measureLayerCoverage(layer, false);
  }

  pasteSelectionClipboard(layerId: LayerId) {
    const destination = this.layerResources.raster(layerId);
    if (!destination || !this.selectionTextures.clipboard) return false;
    const encoder = this.device.createCommandEncoder({ label: 'LightTable paste selected pixels' });
    encoder.copyTextureToTexture(
      { texture: this.selectionTextures.clipboard },
      { texture: destination.texture },
      [this.width, this.height]
    );
    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  hasSelectionClipboard() {
    return Boolean(this.selectionTextures.clipboard);
  }

  clearSelection() {
    if (!this.selectionTextures.mask || !this.selectionTextures.result) return false;
    const encoder = this.device.createCommandEncoder({ label: 'Clear LightTable selection' });
    this.clearTexture(encoder, this.selectionTextures.mask, { r: 1, g: 0, b: 0, a: 1 });
    this.clearTexture(encoder, this.selectionTextures.result, { r: 1, g: 0, b: 0, a: 1 });
    this.device.queue.submit([encoder.finish()]);
    const changed = this.selectionTextures.active;
    this.selectionTextures.active = false;
    return changed;
  }

  private ensureToolPipelines() {
    if (this.toolPipelinesReady) return;
    const fullscreenModule = this.device.createShaderModule({ code: FULLSCREEN_VERTEX_WGSL });
    const fullscreenPipeline = (
      label: string,
      code: string,
      format: GPUTextureFormat = 'rgba16float'
    ) => this.device.createRenderPipeline({
      label,
      layout: 'auto',
      vertex: { module: fullscreenModule, entryPoint: 'fullscreenVertex' },
      fragment: {
        module: this.device.createShaderModule({ code: `${FULLSCREEN_VERTEX_WGSL}\n${code}` }),
        entryPoint: 'main',
        targets: [{ format }]
      },
      primitive: { topology: 'triangle-list' }
    });
    const brushModule = this.device.createShaderModule({ code: BRUSH_DAB_WGSL });
    const brushPipeline = (
      label: string,
      color: GPUBlendComponent,
      alpha: GPUBlendComponent
    ) => this.device.createRenderPipeline({
      label,
      layout: 'auto',
      vertex: { module: brushModule, entryPoint: 'brushVertex' },
      fragment: {
        module: brushModule,
        entryPoint: 'brushFragment',
        targets: [{
          format: 'rgba16float',
          blend: { color, alpha }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.brushPipeline = brushPipeline(
      'LightTable round brush',
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    );
    this.erasePipeline = brushPipeline(
      'LightTable round eraser',
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    );
    this.fillColorPipeline = fullscreenPipeline(
      'LightTable fill layer color',
      LAYER_FILL_COLOR_WGSL
    );
    this.invertColorsPipeline = fullscreenPipeline(
      'LightTable invert layer colors',
      LAYER_INVERT_COLORS_WGSL
    );
    this.selectionShapePipeline = fullscreenPipeline(
      'LightTable selection shape rasterizer',
      SELECTION_SHAPE_WGSL,
      'r8unorm'
    );
    this.selectionCombinePipeline = fullscreenPipeline(
      'LightTable selection boolean compositor',
      SELECTION_COMBINE_WGSL,
      'r8unorm'
    );
    this.selectionContentCoveragePipeline = fullscreenPipeline(
      'LightTable selected content coverage',
      SELECTION_CONTENT_COVERAGE_WGSL,
      'r8unorm'
    );
    this.selectionFeatherPipeline = fullscreenPipeline(
      'LightTable selection feather',
      SELECTION_FEATHER_WGSL,
      'r8unorm'
    );
    this.selectionCopyPipeline = fullscreenPipeline(
      'LightTable selected pixel copy',
      SELECTION_COPY_WGSL
    );
    this.selectionDisplayCopyPipeline = fullscreenPipeline(
      'LightTable selected display copy',
      SELECTION_DISPLAY_COPY_WGSL,
      'rgba8unorm'
    );
    this.transformPipeline = fullscreenPipeline(
      'LightTable layer transform preview',
      LAYER_TRANSFORM_WGSL
    );
    this.selectionTransformPipeline = fullscreenPipeline(
      'LightTable selection transform preview',
      SELECTION_TRANSFORM_WGSL,
      'r8unorm'
    );
    this.toolPipelinesReady = true;
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

  private async decodeBlobIntoTexture(blob: Blob, destination: GPUTexture, maskChannel: boolean) {
    const generation = this.resourceGeneration;
    const decoded = await decodeNativeImage(blob);
    const { bitmap } = decoded;
    let encodedTexture: GPUTexture | null = null;
    try {
      if (generation !== this.resourceGeneration) throw new Error('LightTable was closed while restoring its layers.');
      if (bitmap.width !== this.width || bitmap.height !== this.height) {
        throw new Error('A saved layer does not match the LightTable document dimensions.');
      }
      encodedTexture = this.device.createTexture({
        label: 'LightTable persisted layer source',
        size: [this.width, this.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: encodedTexture }, [this.width, this.height]);
      const pipeline = maskChannel ? this.maskDecodePipeline : this.decodePipeline;
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: encodedTexture.createView() },
          { binding: 1, resource: this.sampler }
        ]
      });
      const encoder = this.device.createCommandEncoder({ label: 'Restore LightTable layer pixels' });
      this.drawFullscreen(encoder, pipeline, bindGroup, destination.createView(), { r: 0, g: 0, b: 0, a: 0 });
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
    } finally {
      encodedTexture?.destroy();
      decoded.close();
    }
  }

  private async withValidationScope<T>(label: string, operation: () => Promise<T>) {
    this.device.pushErrorScope('validation');
    let scopeOpen = true;
    try {
      const result = await operation();
      const validationError = await this.device.popErrorScope();
      scopeOpen = false;
      if (validationError) throw new Error(`${label}: ${validationError.message}`);
      return result;
    } finally {
      if (scopeOpen) await this.device.popErrorScope();
    }
  }

  private encodeTextureAsPng(source: GPUTexture, maskChannel: boolean) {
    return this.withValidationScope(
      maskChannel ? 'LightTable mask export validation failed' : 'LightTable layer export validation failed',
      () => this.encodeTextureAsPngUnchecked(source, maskChannel)
    );
  }

  private async encodeTextureAsPngUnchecked(
    source: GPUTexture,
    maskChannel: boolean,
    width = this.width,
    height = this.height
  ) {
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const outputTexture = this.device.createTexture({
      label: 'LightTable persisted layer PNG source',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
    const settingsBuffer = this.device.createBuffer({
      label: 'LightTable layer export settings',
      size: LAYER_EXPORT_SETTINGS_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(
      settingsBuffer,
      0,
      new Float32Array([maskChannel ? 1 : 0, 0, 0, 0])
    );
    const bindGroup = this.device.createBindGroup({
      layout: this.exportPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: settingsBuffer } }
      ]
    });
    const readBuffer = this.device.createBuffer({
      label: 'LightTable persisted layer readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const pixels = new Uint8ClampedArray(width * height * 4);
    try {
      const encoder = this.device.createCommandEncoder({ label: 'Encode LightTable layer PNG' });
      this.drawFullscreen(encoder, this.exportPipeline, bindGroup, outputTexture.createView(), { r: 0, g: 0, b: 0, a: 0 });
      encoder.copyTextureToBuffer(
        { texture: outputTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
        [width, height]
      );
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuffer.getMappedRange());
      for (let row = 0; row < height; row += 1) {
        pixels.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
      }
      readBuffer.unmap();
    } finally {
      if (readBuffer.mapState === 'mapped') readBuffer.unmap();
      readBuffer.destroy();
      outputTexture.destroy();
      settingsBuffer.destroy();
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Layer PNG encoder could not be created.');
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Layer PNG encoding failed.')), 'image/png');
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
    this.patternTextures.forEach((texture) => texture.destroy());
    this.patternTextures.clear();
    this.patternSources.clear();
    this.layerStyleTextures.destroy();
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
