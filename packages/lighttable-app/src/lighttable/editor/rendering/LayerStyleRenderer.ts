import type {
  DocumentAssetId,
  GroupLayer,
  LayerId,
  RasterLayer,
  Rect,
  TextLayer,
  VectorLayer
} from '../document/documentTypes';
import { layerStyleCacheBounds } from '../styles/layerStyleRenderPlan';
import {
  baseLayerStyleUniform,
  LAYER_STYLE_SETTINGS_BYTES,
  layerStyleGaussianBlurPlan,
  layerStyleUniform
} from '../styles/layerStyleGpu';
import type { AffineMatrix } from '../tools/transform/transformTypes';
import { identityAffineMatrix, invertMatrix } from '../tools/transform/affine';
import type { PatternAssetStore } from './PatternAssetStore';
import type { SubmittedResourceRetainer } from './SubmittedResourceRetainer';
import { LayerStylePipelineProvider } from './LayerStylePipelineProvider';
import { LayerStyleTextureStore } from './LayerStyleTextureStore';

type StyledNode = RasterLayer | GroupLayer | VectorLayer | TextLayer;
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
  createTextureSized: (label: string, width: number, height: number) => GPUTexture;
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

const sourceDocumentBounds = (
  inverse: AffineMatrix,
  sourceSize: { width: number; height: number }
): Rect => {
  const determinant = inverse.a * inverse.d - inverse.b * inverse.c;
  if (Math.abs(determinant) < 1e-9) return { x: 0, y: 0, width: 1, height: 1 };
  const forward = {
    a: inverse.d / determinant,
    b: -inverse.b / determinant,
    c: -inverse.c / determinant,
    d: inverse.a / determinant,
    tx: (inverse.c * inverse.ty - inverse.d * inverse.tx) / determinant,
    ty: (inverse.b * inverse.tx - inverse.a * inverse.ty) / determinant
  };
  const points = [
    [0, 0], [sourceSize.width, 0], [0, sourceSize.height],
    [sourceSize.width, sourceSize.height]
  ].map(([x, y]) => ({
    x: forward.a * x! + forward.c * y! + forward.tx,
    y: forward.b * x! + forward.d * y! + forward.ty
  }));
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/**
 * Owns Layer Style GPU pipelines, work textures, cache and quality state.
 * The document compositor sees this as one optional styled-foreground encoder
 * instead of depending on each individual style pass.
 */
export class LayerStyleRenderer {
  private readonly pipelineProvider: LayerStylePipelineProvider;
  private readonly textures: LayerStyleTextureStore;
  private interactionLayerId: LayerId | null = null;
  private blendProfile = 0;
  private blendQuantization = 0;

  constructor(private readonly options: LayerStyleRendererOptions) {
    this.pipelineProvider = new LayerStylePipelineProvider(
      options.device,
      options.fullscreenModule
    );
    this.textures = new LayerStyleTextureStore({
      createTexture: options.createTexture,
      createTextureSized: options.createTextureSized
    });
  }

  async initialize() {
    await this.pipelineProvider.initialize();
  }

  shaderErrors() {
    return this.pipelineProvider.shaderErrors();
  }

  setInteractionLayer(layerId: LayerId | null) {
    if (layerId === this.interactionLayerId) return false;
    this.interactionLayerId = layerId;
    return true;
  }

  setBlendProfile(profile: number, quantization = 0) {
    if (profile === this.blendProfile && quantization === this.blendQuantization) return false;
    this.blendProfile = profile;
    this.blendQuantization = quantization;
    this.releaseCache();
    return true;
  }

  cacheKeyQuality(layerId: LayerId) {
    return layerId === this.interactionLayerId ? 'interactive' : 'final';
  }

  cachedPresentation(layerId: LayerId) {
    return this.textures.latest(layerId);
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
    styleBounds: Rect,
    cacheKey: string | null
  ) {
    const styleEffectPipeline = this.pipelineProvider.pipeline;
    const styleBlurPipeline = this.pipelineProvider.blurPipeline;
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
    const gradientGeometry = sourceDocumentBounds(inverse, sourceSize);
    const styleTextures = this.textures.ensureWorkTextures();

    const maskInverse = invertMatrix(layer.mask?.transform ?? identityAffineMatrix())
      ?? identityAffineMatrix();
    const shapeSettings = device.createBuffer({
      label: `LightTable Layer Style shape: ${layer.name}`,
      size: 96,
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
      width, height,
      maskInverse.a, maskInverse.c, maskInverse.tx, 0,
      maskInverse.b, maskInverse.d, maskInverse.ty, 0
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
      patternTexture: GPUTexture | null = null,
      blurredShapeTexture: GPUTexture = styleTextures.shape
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
          { binding: 4, resource: (patternTexture ?? styleTextures.shape).createView() },
          { binding: 5, resource: blurredShapeTexture.createView() }
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

    const encodeBlurPass = (
      source: GPUTexture,
      target: GPUTexture,
      direction: [number, number],
      blurWidth: number,
      blurHeight: number,
      radius: number,
      label: string
    ) => {
      if (!styleBlurPipeline) return;
      const settingsBuffer = device.createBuffer({
        label: `${label} settings`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(settingsBuffer, 0, new Float32Array([
        blurWidth, blurHeight, direction[0], direction[1], radius, 0, 0, 0
      ]));
      submittedResources.retainBuffer(settingsBuffer);
      const bindGroup = device.createBindGroup({
        layout: styleBlurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: settingsBuffer } }
        ]
      });
      drawFullscreen(
        encoder,
        styleBlurPipeline,
        bindGroup,
        target.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
    };

    encodeStylePass(
      styleTextures.shape,
      styleTextures.first,
      baseLayerStyleUniform(layer.fillOpacity, width, height, this.blendProfile, this.blendQuantization),
      `LightTable Layer Style Fill: ${layer.name}`
    );
    let current = styleTextures.first;
    let target = styleTextures.second;
    layer.styleStack.effects.forEach((effect) => {
      const reference = patternReference(effect);
      const patternTexture = reference?.assetId
        ? this.options.patternAssets.getTexture(reference.assetId as DocumentAssetId)
        : null;
      const quality = this.cacheKeyQuality(layer.id);
      const values = layerStyleUniform(
        effect,
        layer.styleStack,
        width,
        height,
        !effectRequiresPattern(effect) || Boolean(patternTexture),
        quality,
        gradientGeometry,
        this.blendProfile,
        this.blendQuantization
      );
      if (!values) return;
      const blurPlan = styleBlurPipeline
        ? layerStyleGaussianBlurPlan(effect, layer.styleStack, width, height, quality)
        : null;
      let blurredShape = styleTextures.shape;
      if (blurPlan) {
        const blurTextures = this.textures.ensureBlurTextures(
          blurPlan.workingWidth,
          blurPlan.workingHeight
        );
        encodeBlurPass(
          styleTextures.shape,
          blurTextures.horizontal,
          [1, 0],
          blurPlan.workingWidth,
          blurPlan.workingHeight,
          blurPlan.workingRadius,
          `LightTable Layer Style ${effect.name} horizontal blur: ${layer.name}`
        );
        encodeBlurPass(
          blurTextures.horizontal,
          blurTextures.vertical,
          [0, 1],
          blurPlan.workingWidth,
          blurPlan.workingHeight,
          blurPlan.workingRadius,
          `LightTable Layer Style ${effect.name} vertical blur: ${layer.name}`
        );
        values[23] = -1;
        blurredShape = blurTextures.vertical;
      }
      encodeStylePass(
        current,
        target,
        values,
        `LightTable Layer Style ${effect.name}: ${layer.name}`,
        patternTexture,
        blurredShape
      );
      [current, target] = [target, current];
    });
    if (!cacheKey) return { texture: current, bounds: { x: 0, y: 0, width, height } };
    const tightBounds = layerStyleCacheBounds(styleBounds, { width, height });
    this.textures.writeCache(
      encoder,
      layer.id,
      cacheKey,
      layer.name,
      current,
      tightBounds
    );
    return { texture: current, bounds: { x: 0, y: 0, width, height } };
  }

  destroy() {
    this.textures.destroy();
  }
}
