import type {
  DocumentAssetId,
  GroupLayer,
  LayerId,
  RasterLayer,
  Rect,
  TextLayer,
  VectorLayer
} from '../document/documentTypes';
import { semanticLayerDependencyKey } from '../document/documentTypes';
import { layerStyleCacheBounds } from '../styles/layerStyleRenderPlan';
import {
  baseLayerStyleUniform,
  bevelDistanceCapacity,
  bevelJumpFloodSteps,
  layerStyleGaussianBlurPlan,
  layerStyleUniform,
  smoothBevelGaussianPlan,
  smoothBevelLodPlan
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
  createFloatTextureSized: (label: string, width: number, height: number) => GPUTexture;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

const DEFAULT_UNIFORM_ARENA_BYTES = 16 * 1024;

/**
 * Packs the short-lived uniforms for one style evaluation into a small number
 * of submit-retained buffers. Slider previews used to create a separate GPU
 * buffer for the shape, base style, every effect and every blur pass, adding
 * CPU/driver resource churn without changing any rendered pixel.
 */
export class LayerStyleUniformArena {
  private readonly alignment: number;
  private chunks: Array<{ buffer: GPUBuffer; offset: number; size: number }> = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly submittedResources: SubmittedResourceRetainer,
    private readonly chunkBytes = DEFAULT_UNIFORM_ARENA_BYTES
  ) {
    this.alignment = Math.max(4, device.limits.minUniformBufferOffsetAlignment || 256);
  }

  write(values: Float32Array<ArrayBuffer>, label: string): GPUBufferBinding {
    const byteLength = values.byteLength;
    let chunk = this.chunks.at(-1);
    let offset = chunk ? this.align(chunk.offset) : 0;
    if (!chunk || offset + byteLength > chunk.size) {
      const size = this.align(Math.max(this.chunkBytes, byteLength));
      const buffer = this.submittedResources.retainBuffer(this.device.createBuffer({
        label,
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      }));
      chunk = { buffer, offset: 0, size };
      this.chunks.push(chunk);
      offset = 0;
    }
    this.device.queue.writeBuffer(chunk.buffer, offset, values);
    chunk.offset = offset + byteLength;
    return { buffer: chunk.buffer, offset, size: byteLength };
  }

  private align(value: number) {
    return Math.ceil(value / this.alignment) * this.alignment;
  }
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
 * Bevel geometry depends on the effective alpha matte and geometric controls,
 * not on lighting/color controls. Keeping this key separate from the complete
 * style revision lets Angle, Altitude, Depth and highlight/shadow edits reuse
 * the expensive height field and execute only the final lighting pass.
 */
const bevelGeometryCacheKey = (
  layer: StyledNode,
  effect: Extract<StyleEffect, { kind: 'bevel-emboss' }>,
  inverse: AffineMatrix,
  sourceSize: { width: number; height: number },
  bounds: Rect
) => {
  if (layer.type === 'group') return null;
  const sourceRevision = layer.type === 'raster'
    ? `raster:${layer.pixelRevision}:${layer.geometryRevision}`
    : semanticLayerDependencyKey(layer);
  if (!sourceRevision) return null;
  const mask = layer.mask?.enabled ? [
    layer.mask.id,
    layer.mask.pixelRevision,
    layer.mask.density,
    layer.mask.feather,
    layer.mask.transform.a,
    layer.mask.transform.b,
    layer.mask.transform.c,
    layer.mask.transform.d,
    layer.mask.transform.tx,
    layer.mask.transform.ty
  ].join(':') : 'mask-off';
  return [
    sourceRevision,
    mask,
    effect.technique,
    effect.technique === 'smooth' ? effect.size : 'retained-sdf',
    effect.technique === 'smooth' ? effect.soften : 'retained-sdf',
    layer.styleStack.scale,
    sourceSize.width,
    sourceSize.height,
    inverse.a,
    inverse.b,
    inverse.c,
    inverse.d,
    inverse.tx,
    inverse.ty,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height
  ].join(':');
};

/**
 * A shadow field is geometry, not presentation. Angle, distance, spread,
 * contour, noise, color, opacity and blend mode are applied by the cheap
 * final style pass and intentionally do not invalidate this key.
 */
const shadowFieldCacheKey = (
  layer: StyledNode,
  effect: Extract<StyleEffect, { kind: 'drop-shadow' }>,
  inverse: AffineMatrix,
  sourceSize: { width: number; height: number },
  plan: NonNullable<ReturnType<typeof layerStyleGaussianBlurPlan>>,
  bounds: Rect
) => {
  if (layer.type === 'group') return null;
  const sourceRevision = layer.type === 'raster'
    ? `raster:${layer.pixelRevision}:${layer.geometryRevision}`
    : semanticLayerDependencyKey(layer);
  if (!sourceRevision) return null;
  const mask = layer.mask?.enabled ? [
    layer.mask.id, layer.mask.pixelRevision, layer.mask.density, layer.mask.feather,
    layer.mask.transform.a, layer.mask.transform.b, layer.mask.transform.c,
    layer.mask.transform.d, layer.mask.transform.tx, layer.mask.transform.ty
  ].join(':') : 'mask-off';
  return [
    sourceRevision, mask, effect.size, layer.styleStack.scale,
    plan.scale, plan.workingWidth, plan.workingHeight, plan.workingRadius,
    bounds.x, bounds.y, bounds.width, bounds.height,
    sourceSize.width, sourceSize.height,
    inverse.a, inverse.b, inverse.c, inverse.d, inverse.tx, inverse.ty
  ].join(':');
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
      createTextureSized: options.createTextureSized,
      createFloatTextureSized: options.createFloatTextureSized,
      // A texture can still be referenced by the command encoder that caused
      // its LRU eviction. Destruction therefore belongs to the submit fence,
      // not to the cache policy itself.
      retireTexture: (texture) => options.submittedResources.retainTexture(texture)
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
    const denseBlurPipeline = this.pipelineProvider.denseBlurPipeline;
    const bevelBlurPipeline = this.pipelineProvider.bevelBlurPipeline;
    const bevelSeedPipeline = this.pipelineProvider.bevelSeedPipeline;
    const bevelFloodPipeline = this.pipelineProvider.bevelFloodPipeline;
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
    const uniforms = new LayerStyleUniformArena(device, submittedResources);

    const maskInverse = invertMatrix(layer.mask?.transform ?? identityAffineMatrix())
      ?? identityAffineMatrix();
    const shapeSettings = uniforms.write(new Float32Array([
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
    ]), `LightTable Layer Style uniforms: ${layer.name}`);
    const shapeBindGroup = device.createBindGroup({
      layout: shapePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: foregroundTexture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: shapeSettings },
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
      blurredShapeTexture: GPUTexture = styleTextures.shape,
      bevelFieldTexture: GPUTexture = styleTextures.shape,
      bevelHeightTexture: GPUTexture = styleTextures.shape,
      bevelHeightTextureSecondary: GPUTexture = bevelHeightTexture
    ) => {
      const settingsBuffer = uniforms.write(new Float32Array(values), label);
      const bindGroup = device.createBindGroup({
        layout: styleEffectPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: current.createView() },
          { binding: 1, resource: styleTextures.shape.createView() },
          { binding: 2, resource: sampler },
          { binding: 3, resource: settingsBuffer },
          { binding: 4, resource: (patternTexture ?? styleTextures.shape).createView() },
          { binding: 5, resource: blurredShapeTexture.createView() },
          { binding: 6, resource: bevelFieldTexture.createView() },
          { binding: 7, resource: bevelHeightTexture.createView() },
          { binding: 8, resource: bevelHeightTextureSecondary.createView() }
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
      outputSize: { width: number; height: number },
      sourceSize: { width: number; height: number },
      sourceOrigin: { x: number; y: number },
      radius: number,
      outputToSourceScale: number,
      label: string,
      pipeline: GPURenderPipeline = styleBlurPipeline!
    ) => {
      if (!pipeline) return;
      const settingsBuffer = uniforms.write(new Float32Array([
        outputSize.width, outputSize.height,
        sourceSize.width, sourceSize.height,
        sourceOrigin.x, sourceOrigin.y,
        direction[0], direction[1],
        radius, outputToSourceScale, 0, 0
      ]), `${label} settings`);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          ...(pipeline === styleBlurPipeline
            ? [{ binding: 1, resource: sampler }]
            : []),
          { binding: 2, resource: settingsBuffer }
        ]
      });
      drawFullscreen(
        encoder,
        pipeline,
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
    const tightBounds = layerStyleCacheBounds(styleBounds, { width, height });
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
      const blurPlan = (styleBlurPipeline || (effect.kind === 'drop-shadow' && denseBlurPipeline))
        ? layerStyleGaussianBlurPlan(
            effect,
            layer.styleStack,
            effect.kind === 'drop-shadow' ? tightBounds.width : width,
            effect.kind === 'drop-shadow' ? tightBounds.height : height,
            quality
          )
        : null;
      let blurredShape = styleTextures.shape;
      const shadowFieldKey = effect.kind === 'drop-shadow' && blurPlan
        ? shadowFieldCacheKey(layer, effect, inverse, sourceSize, blurPlan, tightBounds)
        : null;
      const retainedShadowField = effect.kind === 'drop-shadow' && shadowFieldKey
        ? this.textures.cachedEffectField(layer.id, effect.id, shadowFieldKey)
        : null;
      const chiselDistanceCapacity = effect.kind === 'bevel-emboss'
        && effect.technique !== 'smooth'
        ? bevelDistanceCapacity(
            (effect.size + effect.soften) * layer.styleStack.scale + 2
          )
        : 0;
      const geometryBounds = chiselDistanceCapacity > 0
        ? layerStyleCacheBounds({
            x: gradientGeometry.x - chiselDistanceCapacity,
            y: gradientGeometry.y - chiselDistanceCapacity,
            width: gradientGeometry.width + chiselDistanceCapacity * 2,
            height: gradientGeometry.height + chiselDistanceCapacity * 2
          }, { width, height })
        : tightBounds;
      const smoothLod = effect.kind === 'bevel-emboss' && effect.technique === 'smooth'
        ? smoothBevelLodPlan(
            effect.size * layer.styleStack.scale,
            tightBounds.width,
            tightBounds.height
          )
        : null;
      const geometryKey = effect.kind === 'bevel-emboss'
        ? bevelGeometryCacheKey(layer, effect, inverse, sourceSize, geometryBounds)
        : null;
      const primaryGeometryKey = geometryKey && smoothLod
        ? `${geometryKey}:lod:${smoothLod.primary.scale}`
        : geometryKey;
      const secondaryGeometryKey = geometryKey && smoothLod?.secondary
        ? `${geometryKey}:lod:${smoothLod.secondary.scale}`
        : null;
      const retainedGeometry = effect.kind === 'bevel-emboss' && primaryGeometryKey
        ? this.textures.cachedBevelGeometry(
            layer.id,
            smoothLod ? `${effect.id}:lod-primary` : effect.id,
            primaryGeometryKey
          )
        : null;
      const retainedSecondaryGeometry = secondaryGeometryKey
        ? this.textures.cachedBevelGeometry(
            layer.id,
            `${effect.id}:lod-secondary`,
            secondaryGeometryKey
          )
        : null;
      if (smoothLod && !smoothLod.secondary) {
        this.textures.releaseBevelGeometry(layer.id, `${effect.id}:lod-secondary`);
      }
      let secondaryBlurredShape = styleTextures.shape;
      if (blurPlan) {
        const smoothBevel = effect.kind === 'bevel-emboss' && effect.technique === 'smooth';
        if (smoothBevel && smoothLod) {
          const encodeSmoothHeight = (
            plan: typeof smoothLod.primary,
            retained: typeof retainedGeometry,
            cacheId: string,
            cacheKey: string | null
          ) => {
            if (retained) return retained.texture;
            const blurTextures = this.textures.ensureBevelHeightTextures(
              plan.workingWidth,
              plan.workingHeight
            );
            const gaussian = smoothBevelGaussianPlan(plan.workingRadius);
            for (let cycle = 0; cycle < gaussian.cycles; cycle += 1) {
              const firstCycle = cycle === 0;
              encodeBlurPass(
                firstCycle ? styleTextures.shape : blurTextures.vertical,
                blurTextures.horizontal,
                [1, 0],
                { width: plan.workingWidth, height: plan.workingHeight },
                firstCycle
                  ? { width, height }
                  : { width: plan.workingWidth, height: plan.workingHeight },
                firstCycle ? { x: tightBounds.x, y: tightBounds.y } : { x: 0, y: 0 },
                gaussian.radiusPerCycle,
                firstCycle ? plan.scale : 1,
                `LightTable Layer Style ${effect.name} LOD ${plan.scale} horizontal blur ${cycle + 1}: ${layer.name}`,
                bevelBlurPipeline!
              );
              encodeBlurPass(
                blurTextures.horizontal,
                blurTextures.vertical,
                [0, 1],
                { width: plan.workingWidth, height: plan.workingHeight },
                { width: plan.workingWidth, height: plan.workingHeight },
                { x: 0, y: 0 },
                gaussian.radiusPerCycle,
                1,
                `LightTable Layer Style ${effect.name} LOD ${plan.scale} vertical blur ${cycle + 1}: ${layer.name}`,
                bevelBlurPipeline!
              );
            }
            if (effect.soften > 0) {
              const soften = smoothBevelGaussianPlan(
                effect.soften * layer.styleStack.scale / plan.scale
              );
              for (let cycle = 0; cycle < soften.cycles; cycle += 1) {
                encodeBlurPass(
                  blurTextures.vertical, blurTextures.horizontal, [1, 0],
                  { width: plan.workingWidth, height: plan.workingHeight },
                  { width: plan.workingWidth, height: plan.workingHeight }, { x: 0, y: 0 },
                  soften.radiusPerCycle, 1,
                  `LightTable Layer Style ${effect.name} LOD ${plan.scale} soften horizontal ${cycle + 1}: ${layer.name}`,
                  bevelBlurPipeline!
                );
                encodeBlurPass(
                  blurTextures.horizontal, blurTextures.vertical, [0, 1],
                  { width: plan.workingWidth, height: plan.workingHeight },
                  { width: plan.workingWidth, height: plan.workingHeight }, { x: 0, y: 0 },
                  soften.radiusPerCycle, 1,
                  `LightTable Layer Style ${effect.name} LOD ${plan.scale} soften vertical ${cycle + 1}: ${layer.name}`,
                  bevelBlurPipeline!
                );
              }
            }
            if (!cacheKey) return blurTextures.vertical;
            return this.textures.writeBevelGeometry(
              encoder,
              layer.id,
              cacheId,
              cacheKey,
              blurTextures.vertical,
              { x: 0, y: 0, width: plan.workingWidth, height: plan.workingHeight },
              'float'
            ).texture;
          };
          blurredShape = encodeSmoothHeight(
            smoothLod.primary,
            retainedGeometry,
            `${effect.id}:lod-primary`,
            primaryGeometryKey
          );
          secondaryBlurredShape = smoothLod.secondary
            ? encodeSmoothHeight(
                smoothLod.secondary,
                retainedSecondaryGeometry,
                `${effect.id}:lod-secondary`,
                secondaryGeometryKey
              )
            : blurredShape;
        } else {
          if (retainedShadowField) {
            blurredShape = retainedShadowField.texture;
            values[23] = -1;
          } else {
            const blurTextures = this.textures.ensureBlurTextures(
              blurPlan.workingWidth,
              blurPlan.workingHeight
            );
            const gaussian = { cycles: 1, radiusPerCycle: blurPlan.workingRadius };
            for (let cycle = 0; cycle < gaussian.cycles; cycle += 1) {
              const firstCycle = cycle === 0;
              encodeBlurPass(
                firstCycle ? styleTextures.shape : blurTextures.vertical,
                blurTextures.horizontal,
                [1, 0],
                { width: blurPlan.workingWidth, height: blurPlan.workingHeight },
                firstCycle
                  ? { width, height }
                  : { width: blurPlan.workingWidth, height: blurPlan.workingHeight },
                firstCycle && effect.kind === 'drop-shadow'
                  ? { x: tightBounds.x, y: tightBounds.y }
                  : { x: 0, y: 0 },
                gaussian.radiusPerCycle,
                firstCycle ? blurPlan.scale : 1,
                `LightTable Layer Style ${effect.name} horizontal blur ${cycle + 1}: ${layer.name}`,
                effect.kind === 'drop-shadow' ? denseBlurPipeline! : styleBlurPipeline!
              );
              encodeBlurPass(
                blurTextures.horizontal,
                blurTextures.vertical,
                [0, 1],
                { width: blurPlan.workingWidth, height: blurPlan.workingHeight },
                { width: blurPlan.workingWidth, height: blurPlan.workingHeight },
                { x: 0, y: 0 },
                gaussian.radiusPerCycle,
                1,
                `LightTable Layer Style ${effect.name} vertical blur ${cycle + 1}: ${layer.name}`,
                effect.kind === 'drop-shadow' ? denseBlurPipeline! : styleBlurPipeline!
              );
            }
            blurredShape = blurTextures.vertical;
            if (shadowFieldKey) {
              blurredShape = this.textures.writeEffectField(
                encoder,
                layer.id,
                effect.id,
                shadowFieldKey,
                blurredShape,
                { x: 0, y: 0, width: blurPlan.workingWidth, height: blurPlan.workingHeight }
              ).texture;
            }
          }
        }
        values[23] = -1;
      }
      let bevelField = styleTextures.shape;
      if (
        effect.kind === 'bevel-emboss'
        && effect.technique !== 'smooth'
        && retainedGeometry
      ) {
        bevelField = retainedGeometry.texture;
      }
      if (effect.kind === 'bevel-emboss') {
        values.set([
          geometryBounds.x,
          geometryBounds.y,
          geometryBounds.width,
          geometryBounds.height
        ], 96);
        values[100] = smoothLod?.primary.scale ?? 1;
        values[101] = smoothLod?.secondary?.scale ?? values[100]!;
        values[102] = smoothLod?.blend ?? 0;
      }
      if (effect.kind === 'drop-shadow' && blurPlan) {
        values.set([
          tightBounds.x,
          tightBounds.y,
          blurPlan.workingWidth * blurPlan.scale,
          blurPlan.workingHeight * blurPlan.scale
        ], 96);
      }
      if (
        effect.kind === 'bevel-emboss'
        && effect.technique !== 'smooth'
        && !retainedGeometry
        && bevelSeedPipeline
        && bevelFloodPipeline
      ) {
        const maximumDistance = chiselDistanceCapacity;
        const fieldTextures = this.textures.ensureBevelFieldTextures(
          geometryBounds.width,
          geometryBounds.height
        );
        const seedSettings = uniforms.write(new Float32Array([
          width, height,
          geometryBounds.x, geometryBounds.y,
          geometryBounds.width, geometryBounds.height,
          maximumDistance, 0
        ]), `LightTable Bevel seed settings: ${layer.name}`);
        const seedBindGroup = device.createBindGroup({
          layout: bevelSeedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: styleTextures.shape.createView() },
            { binding: 1, resource: seedSettings }
          ]
        });
        drawFullscreen(
          encoder,
          bevelSeedPipeline,
          seedBindGroup,
          fieldTextures.first.createView(),
          { r: 0, g: 0, b: 0, a: 0 }
        );

        const floodSteps = bevelJumpFloodSteps(maximumDistance);
        const stride = 256;
        const floodSettings = device.createBuffer({
          label: `LightTable Bevel flood settings: ${layer.name}`,
          size: floodSteps.length * stride,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        submittedResources.retainBuffer(floodSettings);
        let fieldSource = fieldTextures.first;
        let fieldTarget = fieldTextures.second;
        floodSteps.forEach((step, index) => {
          device.queue.writeBuffer(
            floodSettings,
            index * stride,
            new Float32Array([
              geometryBounds.width, geometryBounds.height,
              step, maximumDistance,
              0, 0, 0, 0
            ])
          );
          const floodBindGroup = device.createBindGroup({
            layout: bevelFloodPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: fieldSource.createView() },
              {
                binding: 1,
                resource: { buffer: floodSettings, offset: index * stride, size: 32 }
              }
            ]
          });
          drawFullscreen(
            encoder,
            bevelFloodPipeline,
            floodBindGroup,
            fieldTarget.createView(),
            { r: 0, g: 0, b: 0, a: 0 }
          );
          [fieldSource, fieldTarget] = [fieldTarget, fieldSource];
        });
        bevelField = fieldSource;
        if (geometryKey) {
          this.textures.writeBevelGeometry(
            encoder,
            layer.id,
            effect.id,
            geometryKey,
            bevelField,
            { x: 0, y: 0, width: geometryBounds.width, height: geometryBounds.height },
            'half'
          );
        }
      }
      encodeStylePass(
        current,
        target,
        values,
        `LightTable Layer Style ${effect.name}: ${layer.name}`,
        patternTexture,
        effect.kind === 'bevel-emboss' && effect.technique === 'smooth'
          ? styleTextures.shape
          : blurredShape,
        bevelField,
        blurredShape,
        secondaryBlurredShape
      );
      [current, target] = [target, current];
    });
    if (!cacheKey) return { texture: current, bounds: { x: 0, y: 0, width, height } };
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
