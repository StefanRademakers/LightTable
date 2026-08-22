import {
  multiplyMatrices,
  realizeLiveShape,
  type VectorElement,
  type VectorPath
} from '@lighttable/vector-core';
import {
  quantizeDocumentTolerance,
  realizeVectorPath,
  RevisionedResourceCache,
  serializeVectorGeometryKey,
  type RealizedVectorGeometry
} from '@lighttable/vector-rendering';
import { VectorFillBackend, type VectorFillSurface } from '@lighttable/vector-webgpu';
import type { VectorLayer } from '../document/documentTypes';
import type { AffineMatrix } from './renderContract';

/** Maximum flattening error in physical presentation pixels. */
const DEFAULT_TOLERANCE_PX = 0.25;
const MAX_MULTISAMPLED_SURFACE_BYTES = 512 * 1024 * 1024;
const GEOMETRY_CACHE_BYTES = 32 * 1024 * 1024;

export const vectorSurfaceBytes = (width: number, height: number, sampleCount: 1 | 4) => (
  width * height * (sampleCount === 4 ? 8 + 4 * 12 : 8 + 4)
);

export const vectorSurfaceSampleCount = (
  width: number,
  height: number,
  antiAlias: boolean,
  maximumMultisampledBytes = MAX_MULTISAMPLED_SURFACE_BYTES
): 1 | 4 => antiAlias
  && vectorSurfaceBytes(width, height, 4) <= maximumMultisampledBytes ? 4 : 1;

/** Largest scale applied by the linear part of an affine transform. */
export const maximumAffineScale = ({ a, b, c, d }: AffineMatrix) => {
  const trace = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  const discriminant = Math.max(0, trace * trace - 4 * determinant * determinant);
  return Math.sqrt(Math.max(0, (trace + Math.sqrt(discriminant)) / 2));
};

/**
 * Curves are flattened for the document-sized vector surface. Viewport zoom
 * transforms that retained surface and therefore cannot reveal detail from a
 * denser mesh; only authored geometry transforms affect document-pixel error.
 */
export const vectorGeometryTolerance = (elementToDocument: AffineMatrix) => (
  DEFAULT_TOLERANCE_PX / Math.max(1e-6, maximumAffineScale(elementToDocument))
);

interface CachedVectorGeometry {
  readonly path: VectorPath;
  readonly realized: RealizedVectorGeometry;
}

/**
 * Bounded CPU-side projection cache. Geometry revisions, rather than object
 * identity, are authoritative so transforms and paint changes reuse the same
 * flattened curves without retaining whole document snapshots.
 */
export class VectorGeometryRealizationCache {
  private readonly cache = new RevisionedResourceCache<CachedVectorGeometry>(GEOMETRY_CACHE_BYTES);

  realize(element: VectorElement, requestedTolerance: number): CachedVectorGeometry {
    const toleranceBucket = quantizeDocumentTolerance(requestedTolerance);
    const pathId = element.type === 'path' ? element.id : `${element.id}:realized`;
    const key = serializeVectorGeometryKey({
      pathId,
      geometryRevision: element.geometryRevision,
      toleranceBucket
    });
    const cached = this.cache.get(key);
    if (cached) {
      return {
        path: element.type === 'path' ? element : {
          ...cached.path,
          name: element.name,
          transform: element.transform,
          style: element.style,
          transformRevision: element.transformRevision,
          styleRevision: element.styleRevision
        },
        realized: cached.realized
      };
    }
    const path = element.type === 'path' ? element : realizeLiveShape(element);
    const realized = realizeVectorPath(path, toleranceBucket);
    return this.cache.set(key, { path, realized }, realized.estimatedBytes);
  }

  clear() {
    this.cache.clear();
  }

  metrics() {
    return this.cache.metrics();
  }
}

/**
 * Document-scoped bridge between native vector layers and the WebGPU fill
 * backend. The backend and its full-document surface stay lazy so raster-only
 * documents do not allocate vector resources or compile vector pipelines.
 */
export class VectorLayerRenderer {
  private backend: VectorFillBackend | null = null;
  private surface: VectorFillSurface | null = null;
  private readonly geometryCache = new VectorGeometryRealizationCache();

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
      const elementToDocument = multiplyMatrices(layerToDocument, element.transform);
      const localTolerance = vectorGeometryTolerance(elementToDocument);
      // Parametric shapes stay canonical in the document. Realization is a
      // renderer-local projection with the same id/style/transform/revisions.
      const { path, realized } = this.geometryCache.realize(element, localTolerance);
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
    return vectorSurfaceBytes(
      this.surface.width,
      this.surface.height,
      this.surface.sampleCount === 4 ? 4 : 1
    );
  }

  destroy() {
    this.surface?.dispose();
    this.surface = null;
    this.backend?.dispose();
    this.backend = null;
    this.geometryCache.clear();
  }

  private ensureSurface(
    backend: VectorFillBackend,
    dimensions: { width: number; height: number },
    antiAlias: boolean
  ) {
    const sampleCount = vectorSurfaceSampleCount(
      dimensions.width,
      dimensions.height,
      antiAlias
    );
    if (
      this.surface
      && this.surface.width === dimensions.width
      && this.surface.height === dimensions.height
      && this.surface.sampleCount === sampleCount
    ) return this.surface;
    this.surface?.dispose();
    this.surface = backend.createSurface(
      dimensions.width,
      dimensions.height,
      'rgba16float',
      sampleCount === 4
    );
    return this.surface;
  }
}
