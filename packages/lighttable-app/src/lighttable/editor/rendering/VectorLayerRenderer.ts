import { multiplyMatrices, type VectorPath } from '@lighttable/vector-core';
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
    const surface = this.ensureSurface(backend, dimensions);
    const clear = encoder.beginRenderPass({
      label: `Clear vector layer: ${layer.name}`,
      colorAttachments: [{
        view: surface.colorView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    clear.end();

    const layerToDocument = multiplyMatrices(inheritedTransform, layer.transform);
    for (const path of layer.paths) {
      const renderPath: VectorPath = {
        ...path,
        transform: multiplyMatrices(layerToDocument, path.transform)
      };
      backend.encodeFill(
        encoder,
        renderPath,
        realizeVectorPath(path, DEFAULT_TOLERANCE_PX),
        {
          colorView: surface.colorView,
          stencilView: surface.stencilView,
          format: surface.format,
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
    // rgba16float plus a conservative 4 bytes/pixel stencil estimate.
    return this.surface.width * this.surface.height * 12;
  }

  destroy() {
    this.surface?.dispose();
    this.surface = null;
    this.backend?.dispose();
    this.backend = null;
  }

  private ensureSurface(
    backend: VectorFillBackend,
    dimensions: { width: number; height: number }
  ) {
    if (
      this.surface
      && this.surface.width === dimensions.width
      && this.surface.height === dimensions.height
    ) return this.surface;
    this.surface?.dispose();
    this.surface = backend.createSurface(dimensions.width, dimensions.height);
    return this.surface;
  }
}
