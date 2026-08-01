import {
  type GroupLayer,
  type ImageDocument,
  type LayerId,
  type RasterMask,
  type VectorLayer
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
  layerStyleDocumentBounds
} from '../styles/layerStyleRenderPlan';
import {
  analyzeDocumentComposite,
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

/**
 * Evaluates the document compositor plan into a GPU texture.
 *
 * This is the only service that knows how document ordering, groups,
 * clipping chains, masks, transforms, local adjustments and Layer Styles
 * become ordered render passes. Resource stores retain ownership of their
 * textures; the compositor only coordinates them.
 */
export class LayerCompositor {
  constructor(private readonly options: LayerCompositorOptions) {}

  encode(
    encoder: GPUCommandEncoder,
    document: ImageDocument,
    encodeAdjustment?: EncodeAdjustment
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
    this.options.syncDocument(document);
    const analysis = analyzeDocumentComposite(
      document.layers,
      (layerId) => Boolean(this.options.maskTextureFor(layerId))
    );
    const visibleLayers = analysis.visibleRasterLayers.filter(
      (layer) => layer.visible && layer.opacity > 0
    );
    if (!analysis.activeLayerStyles) {
      layerStyles.releaseTargets();
      layerStyles.releaseCache();
    }
    if (
      visibleLayers.length === 1
      && analysis.visibleLeafNodes.length === 1
      && document.layers.length === 1
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
        && !layer.adjustmentStack
        && isIdentityAffineMatrix(layer.transform)
        && layer.width === width
        && layer.height === height
      ) return runtime.texture;
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
      }
    ) => {
      const settingsBuffer = this.createCompositeSettingsBuffer(
        settings.label,
        settings.opacity,
        Boolean(settings.mask?.enabled && settings.maskTexture),
        blendModeGpuValue(settings.blendMode),
        Boolean(settings.clippingTexture),
        identityAffineMatrix(),
        { width, height },
        settings.mask ?? null
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
    };

    const renderNode = (
      entry: CompositorPlanEntry,
      background: GPUTexture,
      target: GPUTexture,
      clippingTexture: GPUTexture | null = null,
      inheritedTransform: AffineMatrix = identityAffineMatrix()
    ): [GPUTexture, GPUTexture] => {
      const { node } = entry;
      if (!node.visible || node.opacity <= 0) return [background, target];
      if (node.type === 'group') {
        return renderGroup(entry, background, target, clippingTexture, inheritedTransform);
      }
      if (node.type === 'adjustment') {
        if (!encodeAdjustment) return [background, target];
        const adjusted = encodeAdjustment(encoder, background, node);
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
            0,
            0
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

      if (node.type === 'vector') {
        return renderVectorLayer(
          node,
          background,
          target,
          clippingTexture,
          inheritedTransform
        );
      }

      const layer = node;
      const runtime = layerResources.raster(layer.id);
      if (!runtime) return [background, target];
      const activeTransform = transformSessions.current?.layerId === layer.id
        ? transformSessions.current
        : null;
      const ungradedForegroundTexture = activeTransform?.usesSelection
        ? activeTransform.previewTexture
        : runtime.texture;
      const foregroundTexture = layer.adjustmentStack && encodeAdjustment
        ? encodeAdjustment(encoder, ungradedForegroundTexture, layer)
        : ungradedForegroundTexture;
      const renderContract = rasterRenderContract(layer, foregroundTexture);
      const geometryPreview = geometryPreviews.resolve(
        layer.id,
        layer.geometryRevision
      );
      const sourceToDocument = activeTransform
        ? activeTransform.usesSelection
          ? identityAffineMatrix()
          : activeTransform.matrix
        : multiplyMatrices(
            inheritedTransform,
            geometryPreview ?? renderContract.transform
          );
      const inverse = invertMatrix(sourceToDocument);

      if (layerStyleStackIsActive(layer.styleStack) && inverse) {
        const styleBounds = layerStyleDocumentBounds(
          layer,
          { width, height },
          sourceToDocument
        );
        if (styleBounds.width <= 0 || styleBounds.height <= 0) {
          return [background, target];
        }
        const activePixelEdit = pixelEditSessions.current?.layerId === layer.id;
        const styleCacheKey = activeTransform || activePixelEdit
          ? null
          : layerStyleCacheKey(
              layer,
              sourceToDocument,
              layerStyles.cacheKeyQuality()
            );
        const styled = layerStyles.encode(
          encoder,
          layer,
          foregroundTexture,
          runtime.maskTexture,
          inverse,
          renderContract.dimensions,
          styleCacheKey
        );
        if (styled) {
          compositeTexture(background, styled, target, {
            label: `LightTable styled layer settings: ${layer.name}`,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            clippingTexture
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
        renderContract.dimensions,
        layer.mask
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
      inheritedTransform: AffineMatrix
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
            null
          )
        : null;
      compositeTexture(background, styled ?? foreground, target, {
        label: `LightTable vector layer settings: ${layer.name}`,
        // LayerStyleRenderer already applies fillOpacity to the source while
        // retaining effects. Without styles the vector source still needs the
        // ordinary content-opacity multiplier here.
        opacity: styled ? layer.opacity : layer.opacity * layer.fillOpacity,
        blendMode: layer.blendMode,
        maskTexture,
        mask: styled ? null : layer.mask,
        clippingTexture
      });
      return [target, background];
    };

    const renderNodes = (
      plan: CompositorPlan,
      initialBackground: GPUTexture,
      initialTarget: GPUTexture,
      inheritedTransform: AffineMatrix = identityAffineMatrix()
    ): [GPUTexture, GPUTexture] => {
      let background = initialBackground;
      let target = initialTarget;
      let clippingBase: GPUTexture | null = null;
      plan.entries.forEach((entry) => {
        if (entry.skipBecauseClippingBaseMissing) return;
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
      const maskTexture = this.options.maskTextureFor(group.id);
      const styledGroup = layerStyleStackIsActive(group.styleStack)
        ? layerStyles.encode(
            encoder,
            group,
            groupResult,
            maskTexture,
            identityAffineMatrix(),
            { width, height },
            null
          )
        : null;
      compositeTexture(parentBackground, styledGroup ?? groupResult, parentTarget, {
        label: `LightTable group settings: ${group.name}`,
        opacity: group.opacity,
        blendMode: group.blendMode,
        maskTexture,
        mask: styledGroup ? null : group.mask,
        clippingTexture
      });
      return [parentTarget, parentBackground];
    };

    const [background] = renderNodes(analysis.plan, compositeA, compositeB);
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
    mask: RasterMask | null
  ) {
    const { width, height } = this.options.dimensions();
    const settingsBuffer = this.options.device.createBuffer({
      label,
      size: 80,
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
        0,
        0
      ])
    );
    this.options.submittedResources.retainBuffer(settingsBuffer);
    return settingsBuffer;
  }
}
