import type { ImageDocument, LayerId, Rect } from '../document/documentTypes';
import { findRasterLayer } from '../document/layerTree';
import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import {
  encodeRgba8Png,
  readR8Texture,
  selectionMaskToRgba8,
  type Rgba8ImageEncoding
} from '../../gpu/gpuReadback';
import { planDocumentRegionPreview } from '../geometry/documentRegionPreview';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { LayerTextureCodec } from './LayerTextureCodec';
import type { SelectionTextureStore } from './SelectionTextureStore';
import type { ToolPipelineBundle } from './ToolPipelineBundle';

const clipboardTextureUsage = () =>
  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

export interface ClipboardCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const selectionClipboardCrop = (
  bounds: Rect,
  canvasWidth: number,
  canvasHeight: number
): ClipboardCrop => {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(canvasWidth, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(canvasHeight, Math.ceil(bounds.y + bounds.height));
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

interface SelectionClipboardServiceOptions {
  device: GPUDevice;
  textures: SelectionTextureStore;
  layerResources: LayerRuntimeStore;
  textureCodec: LayerTextureCodec;
  dimensions: () => { width: number; height: number };
  generation: () => number;
  pipelines: () => ToolPipelineBundle;
  invalidateLayer: (layerId: LayerId) => void;
  drawFullscreen: (
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView,
    clearValue: GPUColor
  ) => void;
}

/**
 * Owns selection clipboard textures and conversion at the browser/OS boundary.
 * The compositor supplies source textures, but does not need to know how they
 * are cropped, encoded, decoded or retained for an internal paste.
 */
export class SelectionClipboardService {
  constructor(private readonly options: SelectionClipboardServiceOptions) {}

  copySelectedLayer(
    document: ImageDocument,
    layerId: LayerId,
    encodeComposite: (
      encoder: GPUCommandEncoder,
      document: ImageDocument
    ) => GPUTexture,
    releaseSubmittedResources: () => void
  ) {
    const { device, textures } = this.options;
    if (!textures.active || !textures.mask) return false;
    const layer = findRasterLayer(document, layerId);
    if (!layer || !layer.visible) return false;
    const encoder = device.createCommandEncoder({
      label: 'LightTable copy selected layer pixels'
    });
    // A layer blend mode describes its relationship with lower layers.
    // Isolated copy preserves the layer's pixels, mask and opacity without
    // blending it against an artificial transparent background.
    const isolatedLayer = { ...layer, blendMode: 'normal' as const };
    const isolatedLayerTexture = encodeComposite(encoder, {
      ...document,
      layers: [isolatedLayer],
      activeLayerId: layer.id
    });
    if (!this.encodeLayerCopy(encoder, isolatedLayerTexture)) return false;
    device.queue.submit([encoder.finish()]);
    releaseSubmittedResources();
    return true;
  }

  encodeLayerCopy(encoder: GPUCommandEncoder, sourceTexture: GPUTexture) {
    const { textures, device, drawFullscreen } = this.options;
    if (!textures.active || !textures.mask) return false;
    const clipboard = textures.replaceClipboard();
    const pipeline = this.options.pipelines().selectionCopy;
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceTexture.createView() },
        { binding: 1, resource: textures.mask.createView() }
      ]
    });
    drawFullscreen(
      encoder,
      pipeline,
      bindGroup,
      clipboard.createView(),
      { r: 0, g: 0, b: 0, a: 0 }
    );
    return true;
  }

  async exportLayerSelection(bounds: Rect) {
    const { device, textures, textureCodec } = this.options;
    if (!textures.clipboard) {
      throw new Error('No copied LightTable pixels are available.');
    }
    const { width, height } = this.options.dimensions();
    const crop = selectionClipboardCrop(bounds, width, height);
    const croppedTexture = device.createTexture({
      label: 'LightTable cropped selection clipboard',
      size: [crop.width, crop.height],
      format: 'rgba16float',
      usage: clipboardTextureUsage()
    });
    try {
      const encoder = device.createCommandEncoder({
        label: 'LightTable crop selected layer clipboard'
      });
      encoder.copyTextureToTexture(
        {
          texture: textures.clipboard,
          origin: { x: crop.x, y: crop.y }
        },
        { texture: croppedTexture },
        [crop.width, crop.height]
      );
      device.queue.submit([encoder.finish()]);
      return await textureCodec.encodeUnchecked(
        croppedTexture,
        false,
        crop.width,
        crop.height
      );
    } finally {
      croppedTexture.destroy();
    }
  }

  async exportDisplaySelection(displayTexture: GPUTexture, bounds: Rect) {
    const { device, textures, drawFullscreen } = this.options;
    if (!textures.active || !textures.mask) {
      throw new Error('A selection is required for Copy Merged.');
    }
    const { width, height } = this.options.dimensions();
    const crop = selectionClipboardCrop(bounds, width, height);
    const selectedDisplay = device.createTexture({
      label: 'LightTable selected display clipboard',
      size: [width, height],
      format: 'rgba8unorm',
      usage: clipboardTextureUsage()
    });
    try {
      const pipeline = this.options.pipelines().selectionDisplayCopy;
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: displayTexture.createView() },
          { binding: 1, resource: textures.mask.createView() }
        ]
      });
      const encoder = device.createCommandEncoder({
        label: 'LightTable Copy Merged selection'
      });
      drawFullscreen(
        encoder,
        pipeline,
        bindGroup,
        selectedDisplay.createView(),
        { r: 0, g: 0, b: 0, a: 0 }
      );
      device.queue.submit([encoder.finish()]);
      return await this.exportDisplayRegion(
        selectedDisplay, crop, Math.max(crop.width, crop.height)
      );
    } finally {
      selectedDisplay.destroy();
    }
  }

  async exportDisplayRegion(displayTexture: GPUTexture, bounds: Rect, maxEdge: number,
    encoding: Rgba8ImageEncoding = { format: 'png' }) {
    const { width, height } = this.options.dimensions();
    const plan = planDocumentRegionPreview(width, height, bounds, maxEdge);
    if (!plan) throw new Error('The display region must be finite, non-empty and inside the document.');
    const scaleX = plan.outputWidth / plan.region.width;
    const scaleY = plan.outputHeight / plan.region.height;
    return this.options.textureCodec.encodeUnchecked(
      displayTexture,
      false,
      plan.outputWidth,
      plan.outputHeight,
      { a: scaleX, b: 0, c: 0, d: scaleY,
        tx: -plan.region.x * scaleX, ty: -plan.region.y * scaleY },
      true,
      encoding
    );
  }

  /**
   * Exports the canonical selection at document dimensions. Inpainting needs
   * exact document-space registration, so this intentionally does not crop.
   */
  async exportSelectionMask() {
    const { device, textures } = this.options;
    if (!textures.active || !textures.mask) {
      throw new Error('A selection is required for mask export.');
    }
    const { width, height } = this.options.dimensions();
    const mask = await readR8Texture(
      device,
      textures.mask,
      width,
      height,
      'LightTable selection mask readback'
    );
    return encodeRgba8Png(selectionMaskToRgba8(mask), width, height);
  }

  async pasteExternalImage(
    layerId: LayerId,
    blob: Blob,
    requestedPosition: { x: number; y: number } | null
  ) {
    const {
      layerResources,
      textureCodec,
      invalidateLayer
    } = this.options;
    const destination = layerResources.raster(layerId);
    if (!destination) return false;
    const { width, height } = this.options.dimensions();
    const decoded = await decodeNativeImage(blob);
    try {
      const x = requestedPosition
        ? Math.round(requestedPosition.x)
        : Math.round((width - decoded.descriptor.width) / 2);
      const y = requestedPosition
        ? Math.round(requestedPosition.y)
        : Math.round((height - decoded.descriptor.height) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Clipboard image placement could not be created.');
      context.clearRect(0, 0, width, height);
      context.drawImage(decoded.bitmap, x, y);
      const normalized = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => result
            ? resolve(result)
            : reject(new Error('Clipboard image placement could not be encoded.')),
          'image/png'
        );
      });
      const generation = this.options.generation();
      await textureCodec.decode(
        normalized,
        destination.texture,
        false,
        width,
        height,
        () => generation === this.options.generation()
      );
      invalidateLayer(layerId);
      return true;
    } finally {
      decoded.close();
    }
  }

  pasteInternal(layerId: LayerId) {
    const { device, textures, layerResources } = this.options;
    const destination = layerResources.raster(layerId);
    if (!destination || !textures.clipboard) return false;
    const { width, height } = this.options.dimensions();
    const encoder = device.createCommandEncoder({
      label: 'LightTable paste selected pixels'
    });
    encoder.copyTextureToTexture(
      { texture: textures.clipboard },
      { texture: destination.texture },
      [width, height]
    );
    device.queue.submit([encoder.finish()]);
    this.options.invalidateLayer(layerId);
    return true;
  }

  hasInternalClipboard() {
    return Boolean(this.options.textures.clipboard);
  }
}
