import type {
  DocumentAssetId,
  GroupLayer,
  RasterLayer
} from '../document/documentTypes';
import {
  baseLayerStyleUniform,
  LAYER_STYLE_SETTINGS_BYTES,
  layerStyleUniform
} from '../styles/layerStyleGpu';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import type { PatternAssetStore } from './PatternAssetStore';
import type { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import { LayerStylePipelineProvider } from './LayerStylePipelineProvider';
import { LayerStyleTextureStore } from './LayerStyleTextureStore';

type StyledNode = RasterLayer | GroupLayer;
type StyleEffect = RasterLayer['styleStack']['effects'][number];

interface LayerStyleRendererOptions {
  device: GPUDevice;
  sampler: GPUSampler;
  fullscreenModule: GPUShaderModule;
  shapePipeline: GPURenderPipeline;
  patternAssets: PatternAssetStore;
  submittedResources: SubmittedResourceRetainer;
  dimensions: () => { width: number; height: number };
  createTexture: (label: string) => GPUTexture;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

const patternReference = (effect: StyleEffect) =>
  effect.kind === 'pattern-overlay'
    ? effect.pattern
    : effect.kind === 'stroke' && effect.fill.type === 'pattern'
      ? effect.fill.pattern
      : effect.kind === 'bevel-emboss' && effect.texture.enabled
        ? effect.texture.pattern
        : null;

const effectRequiresPattern = (effect: StyleEffect) =>
  effect.kind === 'pattern-overlay'
  || (effect.kind === 'stroke' && effect.fill.type === 'pattern')
  || (effect.kind === 'bevel-emboss' && effect.texture.enabled);

/**
 * Owns Layer Style GPU pipelines, work textures, cache and quality state.
 * The document compositor sees this as one optional styled-foreground encoder
 * instead of depending on each individual style pass.
 */
export class LayerStyleRenderer {
  private readonly pipelineProvider: LayerStylePipelineProvider;
  private readonly textures: LayerStyleTextureStore;
  private quality: 'interactive' | 'final' = 'final';

  constructor(private readonly options: LayerStyleRendererOptions) {
    this.pipelineProvider = new LayerStylePipelineProvider(
      options.device,
      options.fullscreenModule
    );
    this.textures = new LayerStyleTextureStore({
      createTexture: options.createTexture
    });
  }

  async initialize() {
    await this.pipelineProvider.initialize();
  }

  shaderErrors() {
    return this.pipelineProvider.shaderErrors();
  }

  setInteractionActive(active: boolean) {
    const quality = active ? 'interactive' : 'final';
    if (quality === this.quality) return false;
    this.quality = quality;
    this.releaseCache();
    return true;
  }

  cacheKeyQuality() {
    return this.quality;
  }

  estimatedTextureBytes(width: number, height: number) {
    return this.textures.estimatedTextureBytes(width, height);
  }

  invalidate(layerId: RasterLayer['id']) {
    this.textures.invalidate(layerId);
  }

  releaseTargets() {
    this.textures.releaseWorkTextures();
  }

  releaseCache() {
    this.textures.releaseCache();
  }

  encode(
    encoder: GPUCommandEncoder,
    layer: StyledNode,
    foregroundTexture: GPUTexture,
    maskTexture: GPUTexture | null,
    inverse: AffineMatrix,
    sourceSize: { width: number; height: number },
    cacheKey: string | null
  ) {
    const styleEffectPipeline = this.pipelineProvider.pipeline;
    if (!styleEffectPipeline) return null;
    const cached = this.textures.cached(layer.id, cacheKey);
    if (cached) return cached;
    const {
      device,
      sampler,
      shapePipeline,
      submittedResources,
      drawFullscreen
    } = this.options;
    const { width, height } = this.options.dimensions();
    const styleTextures = this.textures.ensureWorkTextures();

    const shapeSettings = device.createBuffer({
      label: `LightTable Layer Style shape: ${layer.name}`,
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(shapeSettings, 0, new Float32Array([
      layer.mask?.enabled && maskTexture ? 1 : 0,
      layer.mask?.density ?? 1,
      layer.mask?.feather ?? 0,
      0,
      inverse.a, inverse.c, inverse.tx, 0,
      inverse.b, inverse.d, inverse.ty, 0,
      sourceSize.width, sourceSize.height,
      width, height
    ]));
    submittedResources.retainBuffer(shapeSettings);
    const shapeBindGroup = device.createBindGroup({
      layout: shapePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: foregroundTexture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: shapeSettings } },
        { binding: 3, resource: (maskTexture ?? foregroundTexture).createView() }
      ]
    });
    drawFullscreen(
      encoder,
      shapePipeline,
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
      const settingsBuffer = device.createBuffer({
        label,
        size: LAYER_STYLE_SETTINGS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(settingsBuffer, 0, new Float32Array(values));
      submittedResources.retainBuffer(settingsBuffer);
      const bindGroup = device.createBindGroup({
        layout: styleEffectPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: styleTextures.shape.createView() },
          { binding: 2, resource: sampler },
          { binding: 3, resource: { buffer: settingsBuffer } },
          { binding: 4, resource: (patternTexture ?? styleTextures.shape).createView() }
        ]
      });
      drawFullscreen(
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
      baseLayerStyleUniform(layer.fillOpacity, width, height),
      `LightTable Layer Style Fill: ${layer.name}`
    );
    let current = styleTextures.first;
    let target = styleTextures.second;
    layer.styleStack.effects.forEach((effect) => {
      const reference = patternReference(effect);
      const patternTexture = reference?.assetId
        ? this.options.patternAssets.getTexture(reference.assetId as DocumentAssetId)
        : null;
      const values = layerStyleUniform(
        effect,
        layer.styleStack,
        width,
        height,
        !effectRequiresPattern(effect) || Boolean(patternTexture),
        this.quality
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
    this.textures.writeCache(
      encoder,
      layer.id,
      cacheKey,
      layer.name,
      current,
      [width, height]
    );
    return current;
  }

  destroy() {
    this.textures.destroy();
  }
}
