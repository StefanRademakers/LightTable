import {
  multiplyMatrices,
  realizeLiveShape,
  type VectorPath
} from '@lighttable/vector-core';
import { realizeVectorPath } from '@lighttable/vector-rendering';
import { VectorFillBackend, type VectorFillSurface } from '@lighttable/vector-webgpu';
import type { VectorLayer } from '../document/documentTypes';
import type { AffineMatrix } from './renderContract';

const DEFAULT_TOLERANCE_PX = 0.25;

/**
 * Document-scoped bridge between native vector layers and the WebGPU fill
 * backend. The backend and its full-document surface stay lazy so raster-only
 * documents do not allocate vector resources or compile vector pipelines.
 */
export class VectorLayerRenderer {
  private backend: VectorFillBackend | null = null;
  private surface: VectorFillSurface | null = null;

  constructor(private readonly device: GPUDevice) {}

  encode(
    encoder: GPUCommandEncoder,
    layer: VectorLayer,
    inheritedTransform: AffineMatrix,
    dimensions: { width: number; height: number }
  ): GPUTexture {
    const backend = this.backend ??= new VectorFillBackend(this.device);
    const surface = this.ensureSurface(backend, dimensions, layer.antiAlias);
    const clear = encoder.beginRenderPass({
      label: `Clear vector layer: ${layer.name}`,
      colorAttachments: [{
        view: surface.renderColorView,
        resolveTarget: surface.sampleCount > 1 ? surface.colorView : undefined,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    clear.end();

    const layerToDocument = multiplyMatrices(inheritedTransform, layer.transform);
    for (const element of layer.elements) {
      // Parametric shapes stay canonical in the document. Realization is a
      // renderer-local projection with the same id/style/transform/revisions.
      const path = element.type === 'path' ? element : realizeLiveShape(element);
      const realized = realizeVectorPath(path, DEFAULT_TOLERANCE_PX);
      const renderPath: VectorPath = {
        ...path,
        transform: multiplyMatrices(layerToDocument, path.transform)
      };
      backend.encodeFill(
        encoder,
        renderPath,
        realized,
        {
          colorView: surface.renderColorView,
          resolveView: surface.sampleCount > 1 ? surface.colorView : null,
          stencilView: surface.stencilView,
          format: surface.format,
          sampleCount: surface.sampleCount,
          origin: { x: 0, y: 0 },
          width: surface.width,
          height: surface.height
        }
      );
      backend.encodeStroke(
        encoder,
        renderPath,
        realized,
        {
          colorView: surface.renderColorView,
          resolveView: surface.sampleCount > 1 ? surface.colorView : null,
          stencilView: surface.stencilView,
          format: surface.format,
          sampleCount: surface.sampleCount,
          origin: { x: 0, y: 0 },
          width: surface.width,
          height: surface.height
        }
      );
    }
    return surface.color;
  }

  notifySubmitted() {
    return this.backend?.notifySubmitted() ?? Promise.resolve();
  }

  estimatedTextureBytes() {
    if (!this.surface) return 0;
    // Resolved rgba16float plus multisampled color and stencil attachments.
    return this.surface.width * this.surface.height
      * (8 + this.surface.sampleCount * 12);
  }

  destroy() {
    this.surface?.dispose();
    this.surface = null;
    this.backend?.dispose();
    this.backend = null;
  }

  private ensureSurface(
    backend: VectorFillBackend,
    dimensions: { width: number; height: number },
    antiAlias: boolean
  ) {
    if (
      this.surface
      && this.surface.width === dimensions.width
      && this.surface.height === dimensions.height
      && this.surface.sampleCount === (antiAlias ? 4 : 1)
    ) return this.surface;
    this.surface?.dispose();
    this.surface = backend.createSurface(dimensions.width, dimensions.height, 'rgba16float', antiAlias);
    return this.surface;
  }
}
