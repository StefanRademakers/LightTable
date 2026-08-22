import {
  multiplyMatrices,
  realizeLiveShape,
  type VectorElement,
  type VectorPath
} from '@lighttable/vector-core';
import { compileVectorPaintScene } from '@lighttable/paint-scene-adapters';
import {
  quantizeDocumentTolerance,
  realizeVectorPath,
  RevisionedResourceCache,
  serializeVectorGeometryKey,
  type RealizedVectorGeometry
} from '@lighttable/vector-rendering';
import { VectorFillBackend, type VectorFillSurface } from '@lighttable/vector-webgpu';
import {
  VelloPaintSceneBackend,
  type VelloPaintSceneSurface
} from '@lighttable/vector-vello';
import type { VectorLayer } from '../document/documentTypes';
import type { AffineMatrix } from './renderContract';
import { vectorRendererBackendSelection } from '../../gpu/vectorRendererBackendDiagnostics';

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

interface VelloLayerSurface {
  readonly surface: VelloPaintSceneSurface;
  renderedSceneKey: string | null;
}

const matrixFingerprint = (matrix: AffineMatrix) =>
  [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    .map(value => Number.isFinite(value) ? value.toPrecision(15) : String(value))
    .join(',');

const fnv1a64 = (values: readonly string[]) => {
  let hash = 0xcbf29ce484222325n;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    hash ^= 0xffn;
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
};

export const vectorLayerPaintSceneRevision = (
  layer: VectorLayer,
  layerToDocument: AffineMatrix
) => fnv1a64([
  layer.id,
  String(layer.revision),
  String(layer.elements.length),
  matrixFingerprint(layerToDocument),
  ...layer.elements.flatMap(element => [
    element.id,
    String(element.geometryRevision),
    String(element.transformRevision),
    String(element.styleRevision)
  ])
]);

export const compileVelloVectorLayerScene = (
  layer: VectorLayer,
  inheritedTransform: AffineMatrix
) => {
  const layerToDocument = multiplyMatrices(inheritedTransform, layer.transform);
  const sourceRevision = vectorLayerPaintSceneRevision(layer, layerToDocument);
  const result = compileVectorPaintScene(layer.elements, {
    sourceId: layer.id,
    sourceRevision,
    parentTransform: layerToDocument
  });
  return {
    ...result,
    sceneKey: `${layer.id}:${sourceRevision}`
  };
};

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
  private vello: VelloPaintSceneBackend | null = null;
  private readonly velloSurfaces = new Map<string, VelloLayerSurface>();
  private velloFailure: string | null = null;
  private readonly geometryCache = new VectorGeometryRealizationCache();
  private readonly selectedBackend = vectorRendererBackendSelection();
  private currentLayerEncodes = 0;
  private velloLayerEncodes = 0;
  private velloSceneRenders = 0;
  private velloSceneCacheHits = 0;
  private velloUnsupportedLayerEncodes = 0;

  constructor(private readonly device: GPUDevice) {}

  encode(
    encoder: GPUCommandEncoder,
    layer: VectorLayer,
    inheritedTransform: AffineMatrix,
    dimensions: { width: number; height: number }
  ): GPUTexture {
    if (this.selectedBackend === 'vello' && !this.velloFailure) {
      const vello = this.encodeVello(layer, inheritedTransform, dimensions);
      if (vello) {
        this.velloLayerEncodes += 1;
        return vello;
      }
    }
    this.currentLayerEncodes += 1;
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

  retainLayerIds(layerIds: ReadonlySet<string>) {
    for (const [layerId, entry] of this.velloSurfaces) {
      if (layerIds.has(layerId)) continue;
      entry.surface.dispose();
      this.velloSurfaces.delete(layerId);
    }
  }

  backendDiagnostics() {
    const currentActive = this.backend !== null;
    const velloActive = this.velloSurfaces.size > 0;
    return {
      selected: this.selectedBackend,
      active: currentActive && velloActive
        ? 'mixed'
        : velloActive
          ? 'vello'
          : currentActive
            ? 'current'
            : 'unexercised',
      velloFailure: this.velloFailure,
      velloSurfaces: this.velloSurfaces.size,
      currentLayerEncodes: this.currentLayerEncodes,
      velloLayerEncodes: this.velloLayerEncodes,
      velloSceneRenders: this.velloSceneRenders,
      velloSceneCacheHits: this.velloSceneCacheHits,
      velloUnsupportedLayerEncodes: this.velloUnsupportedLayerEncodes,
      geometryCache: this.geometryCache.metrics()
    } as const;
  }

  resetBackendTelemetry() {
    this.currentLayerEncodes = 0;
    this.velloLayerEncodes = 0;
    this.velloSceneRenders = 0;
    this.velloSceneCacheHits = 0;
    this.velloUnsupportedLayerEncodes = 0;
  }

  notifySubmitted() {
    return this.backend?.notifySubmitted() ?? Promise.resolve();
  }

  estimatedTextureBytes() {
    const current = this.surface ? vectorSurfaceBytes(
      this.surface.width,
      this.surface.height,
      this.surface.sampleCount === 4 ? 4 : 1
    ) : 0;
    return current + [...this.velloSurfaces.values()]
      .reduce((bytes, entry) => bytes + entry.surface.estimatedBytes, 0);
  }

  destroy() {
    this.surface?.dispose();
    this.surface = null;
    this.backend?.dispose();
    this.backend = null;
    for (const entry of this.velloSurfaces.values()) entry.surface.dispose();
    this.velloSurfaces.clear();
    this.vello = null;
    this.velloFailure = null;
    this.geometryCache.clear();
  }

  private encodeVello(
    layer: VectorLayer,
    inheritedTransform: AffineMatrix,
    dimensions: { width: number; height: number }
  ): GPUTexture | null {
    const compiled = compileVelloVectorLayerScene(layer, inheritedTransform);
    if (compiled.status !== 'ready') {
      this.velloUnsupportedLayerEncodes += 1;
      this.velloSurfaces.get(layer.id)?.surface.dispose();
      this.velloSurfaces.delete(layer.id);
      return null;
    }
    try {
      const backend = this.vello ??= new VelloPaintSceneBackend(this.device);
      let entry = this.velloSurfaces.get(layer.id);
      if (
        !entry
        || entry.surface.width !== dimensions.width
        || entry.surface.height !== dimensions.height
      ) {
        entry?.surface.dispose();
        entry = {
          surface: backend.createSurface(
            dimensions.width,
            dimensions.height,
            `LightTable Vello layer: ${layer.name}`
          ),
          renderedSceneKey: null
        };
        this.velloSurfaces.set(layer.id, entry);
      }
      if (entry.renderedSceneKey !== compiled.sceneKey) {
        const metrics = backend.render(entry.surface, compiled.scene, compiled.sceneKey);
        this.velloSceneRenders += 1;
        if (metrics.sceneCacheHit) this.velloSceneCacheHits += 1;
        entry.renderedSceneKey = compiled.sceneKey;
      }
      return entry.surface.texture;
    } catch (reason) {
      this.velloFailure = reason instanceof Error ? reason.message : String(reason);
      console.error('[LightTable vector] Vello backend disabled; using current WebGPU renderer.', reason);
      for (const entry of this.velloSurfaces.values()) entry.surface.dispose();
      this.velloSurfaces.clear();
      this.vello = null;
      return null;
    }
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
