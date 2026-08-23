import {
  multiplyMatrices,
  realizeLiveShape,
  type VectorElement,
  type VectorPath
} from '@lighttable/vector-core';
import {
  compileVectorPaintSceneIslandMember,
  composeVectorPaintSceneIsland,
  compileVectorPaintScene,
  compileVectorPaintSceneIsland,
  type CompiledVectorPaintSceneIslandMember
} from '@lighttable/paint-scene-adapters';
import {
  quantizeDocumentTolerance,
  realizeVectorPath,
  RevisionedResourceCache,
  serializeVectorGeometryKey,
  type RealizedVectorGeometry
} from '@lighttable/vector-rendering';
import {
  VectorFillBackend,
  VectorMaskCompositeBackend,
  type VectorFillSurface,
  type VectorMaskCompositeSurface
} from '@lighttable/vector-webgpu';
import {
  VelloPaintSceneBackend,
  type VelloPaintSceneRenderMetrics,
  type VelloPaintSceneProfilePhase,
  type VelloPaintSceneSurface
} from '@lighttable/vector-vello';
import {
  createVectorLayer,
  type LayerId,
  type VectorClip,
  type VectorLayer
} from '../document/documentTypes';
import type { AffineMatrix } from './renderContract';
import { vectorRendererBackendSelection } from '../../gpu/vectorRendererBackendDiagnostics';
import type { RetainedRenderIsland } from './RetainedRenderIslandRegistry';

/** Maximum flattening error in physical presentation pixels. */
const DEFAULT_TOLERANCE_PX = 0.25;
const MAX_MULTISAMPLED_SURFACE_BYTES = 512 * 1024 * 1024;
const GEOMETRY_CACHE_BYTES = 32 * 1024 * 1024;
let vectorRendererResourceSequence = 0;

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
  renderedDependency: VelloLayerDependency | null;
  renderedIslandDependency: VelloIslandDependency | null;
  retainedIslandProjection: RetainedIslandProjection | null;
}

export interface RetainedIslandProjection {
  readonly members: ReadonlyMap<string, {
    readonly sourceRevision: string;
    readonly compiled: CompiledVectorPaintSceneIslandMember;
  }>;
  readonly islandClipRevision: string;
  readonly compiledIslandClip: ReturnType<typeof compileVectorPaintScene> | null;
}

interface VelloIslandDependency {
  readonly members: readonly {
    readonly elements: readonly VectorElement[];
    readonly layerToDocument: string;
    readonly clipElements: readonly VectorElement[] | null;
    readonly clipRevision: number;
    readonly participates: boolean;
  }[];
  readonly islandClipElements: readonly VectorElement[] | null;
  readonly islandClipRevision: string;
}

interface VelloLayerDependency {
  readonly elements: readonly VectorElement[];
  readonly layerToDocument: string;
  readonly clipElements: readonly VectorElement[] | null;
  readonly clipRevision: number;
  readonly clipEnabled: boolean;
  readonly clipInverted: boolean;
}

const velloLayerDependency = (
  layer: VectorLayer,
  layerToDocument: AffineMatrix
): VelloLayerDependency => ({
  elements: layer.elements,
  layerToDocument: matrixFingerprint(layerToDocument),
  clipElements: layer.vectorClip?.elements ?? null,
  clipRevision: layer.vectorClip?.revision ?? -1,
  clipEnabled: layer.vectorClip?.enabled ?? false,
  clipInverted: layer.vectorClip?.inverted ?? false
});

const sameVelloLayerDependency = (
  left: VelloLayerDependency | null,
  right: VelloLayerDependency
) => left !== null
  && left.elements === right.elements
  && left.layerToDocument === right.layerToDocument
  && left.clipElements === right.clipElements
  && left.clipRevision === right.clipRevision
  && left.clipEnabled === right.clipEnabled
  && left.clipInverted === right.clipInverted;

const velloIslandDependency = (island: RetainedRenderIsland): VelloIslandDependency => ({
  members: island.members.map(({ layer, layerToDocument, participates }) => ({
    elements: layer.elements,
    layerToDocument: matrixFingerprint(layerToDocument),
    clipElements: layer.vectorClip?.elements ?? null,
    clipRevision: layer.vectorClip?.revision ?? -1,
    participates
  })),
  islandClipElements: island.islandVectorClip?.elements ?? null,
  islandClipRevision: island.islandVectorClip?.revisionKey ?? ''
});

const sameVelloIslandDependency = (
  left: VelloIslandDependency | null,
  right: VelloIslandDependency
) => left !== null
  && left.members.length === right.members.length
  && left.islandClipElements === right.islandClipElements
  && left.islandClipRevision === right.islandClipRevision
  && left.members.every((member, index) => {
    const candidate = right.members[index];
    return candidate !== undefined
      && member.elements === candidate.elements
      && member.layerToDocument === candidate.layerToDocument
      && member.clipElements === candidate.clipElements
      && member.clipRevision === candidate.clipRevision
      && member.participates === candidate.participates;
  });

export interface VectorTimingAggregate {
  readonly executions: number;
  readonly totalMs: number;
  readonly lastMs: number;
  readonly maximumMs: number;
}

export type VectorDetailedProfilePhase = VelloPaintSceneProfilePhase
  | 'dependency-key'
  | 'paint-scene-compilation'
  | 'canonical-projection'
  | 'paint-scene-js-object-construction'
  | 'paint-scene-validation'
  | 'texture-surface-creation'
  | 'texture-surface-disposal'
  | 'rust-source-release'
  | 'gpu-queue-completion-wall';

const emptyVectorTiming = (): VectorTimingAggregate => ({
  executions: 0, totalMs: 0, lastMs: 0, maximumMs: 0
});

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
  String(layer.elements.length),
  matrixFingerprint(layerToDocument),
  ...layer.elements.flatMap(element => [
    element.id,
    String(element.geometryRevision),
    String(element.transformRevision),
    String(element.styleRevision)
  ]),
  ...(layer.vectorClip ? [
    layer.vectorClip.id,
    String(layer.vectorClip.enabled),
    String(layer.vectorClip.inverted),
    String(layer.vectorClip.revision),
    ...layer.vectorClip.elements.flatMap(element => [
      element.id, String(element.geometryRevision),
      String(element.transformRevision), String(element.styleRevision)
    ])
  ] : [])
]);

export const compileVelloVectorLayerScene = (
  layer: VectorLayer,
  inheritedTransform: AffineMatrix,
  profile?: (phase: VectorDetailedProfilePhase, durationMs: number) => void,
  dependency?: { readonly layerToDocument: AffineMatrix; readonly sourceRevision: string }
) => {
  const layerToDocument = dependency?.layerToDocument
    ?? multiplyMatrices(inheritedTransform, layer.transform);
  const sourceRevision = dependency?.sourceRevision
    ?? vectorLayerPaintSceneRevision(layer, layerToDocument);
  const compilationStartedAt = profile ? performance.now() : 0;
  const result = compileVectorPaintScene(layer.elements, {
    sourceId: layer.id,
    sourceRevision,
    parentTransform: layerToDocument,
    ...(layer.vectorClip?.enabled && !layer.vectorClip.inverted ? {
      clip: {
        stableId: layer.vectorClip.id,
        revisionKey: `${layer.vectorClip.revision}:${layer.vectorClip.elements.map(element => [
          element.id, element.geometryRevision, element.transformRevision
        ].join(':')).join('|')}`,
        elements: layer.vectorClip.elements
      }
    } : {}),
    ...(profile ? {
      now: () => performance.now(),
      profile: (phase, durationMs) => profile(
        phase === 'js-object-construction'
          ? 'paint-scene-js-object-construction'
          : phase === 'scene-validation'
            ? 'paint-scene-validation'
            : phase,
        durationMs
      )
    } : {})
  });
  profile?.('paint-scene-compilation', performance.now() - compilationStartedAt);
  return {
    ...result,
    sceneKey: `${layer.id}:${sourceRevision}`
  };
};

export const vectorIslandPaintSceneRevision = (island: RetainedRenderIsland) => fnv1a64([
  island.resourceId,
  island.role,
  island.isolationOwnerId ?? '',
  island.islandVectorClip?.revisionKey ?? '',
  ...island.members.flatMap(({ layer, layerToDocument, participates }) => [
    layer.id,
    vectorLayerPaintSceneRevision(layer, layerToDocument),
    String(participates)
  ])
]);

export const compileVelloVectorIslandScene = (
  island: RetainedRenderIsland,
  profile?: (phase: VectorDetailedProfilePhase, durationMs: number) => void,
  sourceRevision = vectorIslandPaintSceneRevision(island)
) => {
  const compilationStartedAt = profile ? performance.now() : 0;
  const result = compileVectorPaintSceneIsland(
    island.resourceId,
    sourceRevision,
    island.members.map(({ layer, layerToDocument, participates }) => ({
      layerId: layer.id,
      sourceRevision: vectorLayerPaintSceneRevision(layer, layerToDocument),
      elements: layer.elements,
      parentTransform: layerToDocument,
      participates,
      ...(layer.vectorClip?.enabled && !layer.vectorClip.inverted ? {
        clip: {
          stableId: layer.vectorClip.id,
          revisionKey: `${layer.vectorClip.revision}:${layer.vectorClip.elements.map(element => [
            element.id, element.geometryRevision, element.transformRevision
          ].join(':')).join('|')}`,
          elements: layer.vectorClip.elements
        }
      } : {})
    })),
    {
      ...(island.islandVectorClip ? {
        clip: {
          stableId: island.islandVectorClip.stableId,
          revisionKey: island.islandVectorClip.revisionKey,
          elements: island.islandVectorClip.elements,
          parentTransform: island.islandVectorClip.parentTransform,
          stableIdNamespace: island.isolationOwnerId ?? island.resourceId
        }
      } : {}),
      ...(profile ? {
        now: () => performance.now(),
        profile: (phase, durationMs) => profile(
        phase === 'js-object-construction'
          ? 'paint-scene-js-object-construction'
          : phase === 'scene-validation'
            ? 'paint-scene-validation'
            : phase,
        durationMs
      )
      } : {})
    }
  );
  profile?.('paint-scene-compilation', performance.now() - compilationStartedAt);
  return { ...result, sceneKey: `${island.resourceId}:${sourceRevision}` };
};

export const compileRetainedVelloVectorIslandScene = (
  island: RetainedRenderIsland,
  previous: RetainedIslandProjection | null,
  profile?: (phase: VectorDetailedProfilePhase, durationMs: number) => void,
  sourceRevision = vectorIslandPaintSceneRevision(island)
) => {
  const compilationStartedAt = profile ? performance.now() : 0;
  const adapterProfile = profile ? ((phase: 'canonical-projection'
    | 'js-object-construction' | 'scene-validation', durationMs: number) => profile(
    phase === 'js-object-construction'
      ? 'paint-scene-js-object-construction'
      : phase === 'scene-validation'
        ? 'paint-scene-validation'
        : phase,
    durationMs
  )) : undefined;
  const members = new Map<string, {
    sourceRevision: string;
    compiled: CompiledVectorPaintSceneIslandMember;
  }>();
  let compiledMemberCount = 0;
  const compiled = island.members.map(({ layer, layerToDocument, participates }) => {
    const memberRevision = vectorLayerPaintSceneRevision(layer, layerToDocument);
    const member = {
      layerId: layer.id,
      sourceRevision: memberRevision,
      elements: layer.elements,
      parentTransform: layerToDocument,
      participates,
      ...(layer.vectorClip?.enabled && !layer.vectorClip.inverted ? {
        clip: {
          stableId: layer.vectorClip.id,
          revisionKey: `${layer.vectorClip.revision}:${layer.vectorClip.elements.map(element => [
            element.id, element.geometryRevision, element.transformRevision
          ].join(':')).join('|')}`,
          elements: layer.vectorClip.elements
        }
      } : {})
    };
    const cached = previous?.members.get(layer.id);
    const result = cached?.sourceRevision === memberRevision
      ? { member, result: cached.compiled.result }
      : compileVectorPaintSceneIslandMember(island.resourceId, member, {
          ...(adapterProfile ? { profile: adapterProfile } : {}),
          ...(profile ? { now: () => performance.now() } : {})
        });
    if (cached?.sourceRevision !== memberRevision) compiledMemberCount += 1;
    members.set(layer.id, { sourceRevision: memberRevision, compiled: result });
    return result;
  });
  const islandClipRevision = island.islandVectorClip?.revisionKey ?? '';
  const compiledIslandClip = island.islandVectorClip
    ? previous?.islandClipRevision === islandClipRevision
      ? previous.compiledIslandClip
      : compileVectorPaintScene([], {
          sourceId: `${island.resourceId}:island-clip`,
          sourceRevision: islandClipRevision,
          parentTransform: island.islandVectorClip.parentTransform,
          stableIdNamespace: island.isolationOwnerId ?? island.resourceId,
          clip: {
            stableId: island.islandVectorClip.stableId,
            revisionKey: islandClipRevision,
            elements: island.islandVectorClip.elements
          },
          ...(adapterProfile ? { profile: adapterProfile } : {}),
          ...(profile ? { now: () => performance.now() } : {})
        })
    : null;
  const result = composeVectorPaintSceneIsland(
    island.resourceId, sourceRevision, compiled, compiledIslandClip
  );
  profile?.('paint-scene-compilation', performance.now() - compilationStartedAt);
  return {
    ...result,
    sceneKey: `${island.resourceId}:${sourceRevision}`,
    compiledMemberCount,
    projection: { members, islandClipRevision, compiledIslandClip } satisfies RetainedIslandProjection
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
  private readonly velloResourceNamespace = `vector-renderer-${++vectorRendererResourceSequence}`;
  private backend: VectorFillBackend | null = null;
  private surface: VectorFillSurface | null = null;
  private vectorMaskSurface: VectorFillSurface | null = null;
  private vectorMaskOutput: VectorMaskCompositeSurface | null = null;
  private vectorMaskComposite: VectorMaskCompositeBackend | null = null;
  private vello: VelloPaintSceneBackend | null = null;
  private readonly velloSurfaces = new Map<string, VelloLayerSurface>();
  private velloFailure: string | null = null;
  private readonly geometryCache = new VectorGeometryRealizationCache();
  private readonly selectedBackend = vectorRendererBackendSelection();
  private currentLayerEncodes = 0;
  private velloLayerEncodes = 0;
  private velloSceneRenders = 0;
  private velloSceneCacheHits = 0;
  private velloUploadedFragments = 0;
  private velloUploadedClips = 0;
  private velloUnsupportedLayerEncodes = 0;
  private velloFullCompilations = 0;
  private velloProjectedIslandMembers = 0;
  private velloUnchangedSceneReuses = 0;
  private velloSurfaceRecreations = 0;
  private velloReleasedSources = 0;
  private velloGpuRenderSamples = 0;
  private velloGpuRenderTotalMs = 0;
  private detailedProfilingEnabled = false;
  private readonly detailedPhases = new Map<VectorDetailedProfilePhase, VectorTimingAggregate>();

  constructor(private readonly device: GPUDevice) {}

  encode(
    encoder: GPUCommandEncoder,
    layer: VectorLayer,
    inheritedTransform: AffineMatrix,
    dimensions: { width: number; height: number }
  ): GPUTexture {
    if (layer.vectorClip?.enabled && layer.vectorClip.inverted) {
      throw new Error(`Inverted vector clip on “${layer.name}” is not supported yet.`);
    }
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
    const clip = layer.vectorClip?.enabled ? layer.vectorClip : null;
    if (!clip) return surface.color;
    if (clip.elements.length !== 1) {
      throw new Error(
        `Vector clip on “${layer.name}” requires an exact boolean union of multiple operands.`
      );
    }
    const maskSurface = this.ensureVectorMaskSurface(backend, dimensions, layer.antiAlias);
    const clearMask = encoder.beginRenderPass({
      label: `Clear vector clip: ${layer.name}`,
      colorAttachments: [{
        view: maskSurface.renderColorView,
        resolveTarget: maskSurface.sampleCount > 1 ? maskSurface.colorView : undefined,
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store'
      }]
    });
    clearMask.end();
    const clipElement = clip.elements[0]!;
    const clipToDocument = multiplyMatrices(layerToDocument, clipElement.transform);
    const { path: clipPath, realized: clipGeometry } = this.geometryCache.realize(
      clipElement,
      vectorGeometryTolerance(clipToDocument)
    );
    backend.encodeFill(encoder, {
      ...clipPath,
      transform: multiplyMatrices(layerToDocument, clipPath.transform),
      style: {
        fill: { type: 'solid', color: [1, 1, 1, 1] },
        stroke: null,
        opacity: 1
      }
    }, clipGeometry, {
      colorView: maskSurface.renderColorView,
      resolveView: maskSurface.sampleCount > 1 ? maskSurface.colorView : null,
      stencilView: maskSurface.stencilView,
      format: maskSurface.format,
      sampleCount: maskSurface.sampleCount,
      origin: { x: 0, y: 0 }, width: maskSurface.width, height: maskSurface.height
    });
    const output = this.ensureVectorMaskOutput(dimensions);
    (this.vectorMaskComposite ??= new VectorMaskCompositeBackend(this.device))
      .encode(encoder, surface.color, maskSurface.color, output);
    return output.texture;
  }

  encodeIsland(
    island: RetainedRenderIsland,
    dimensions: { width: number; height: number }
  ): GPUTexture | null {
    if (this.selectedBackend !== 'vello' || this.velloFailure) return null;
    if (!island.backendEligibility.vello) return null;
    const dependencyStartedAt = this.detailedProfilingEnabled ? performance.now() : 0;
    const dependency = velloIslandDependency(island);
    const existing = this.velloSurfaces.get(island.resourceId);
    if (
      existing
      && existing.surface.width === dimensions.width
      && existing.surface.height === dimensions.height
      && sameVelloIslandDependency(existing.renderedIslandDependency, dependency)
    ) {
      if (this.detailedProfilingEnabled) {
        this.recordDetailedPhase('dependency-key', performance.now() - dependencyStartedAt);
      }
      this.velloUnchangedSceneReuses += 1;
      this.velloLayerEncodes += 1;
      return existing.surface.texture;
    }
    const sourceRevision = vectorIslandPaintSceneRevision(island);
    if (
      existing
      && existing.surface.width === dimensions.width
      && existing.surface.height === dimensions.height
      && existing.renderedSceneKey === `${island.resourceId}:${sourceRevision}`
    ) {
      existing.renderedIslandDependency = dependency;
      if (this.detailedProfilingEnabled) {
        this.recordDetailedPhase('dependency-key', performance.now() - dependencyStartedAt);
      }
      this.velloUnchangedSceneReuses += 1;
      this.velloLayerEncodes += 1;
      return existing.surface.texture;
    }
    if (this.detailedProfilingEnabled) {
      this.recordDetailedPhase('dependency-key', performance.now() - dependencyStartedAt);
    }
    this.velloFullCompilations += 1;
    const compiled = compileRetainedVelloVectorIslandScene(
      island,
      existing?.retainedIslandProjection ?? null,
      this.detailedProfilingEnabled
        ? (phase, durationMs) => this.recordDetailedPhase(phase, durationMs)
        : undefined,
      sourceRevision
    );
    if (compiled.status !== 'ready') {
      this.velloUnsupportedLayerEncodes += 1;
      return null;
    }
    this.velloProjectedIslandMembers += compiled.compiledMemberCount;
    try {
      const backend = this.vello ??= new VelloPaintSceneBackend(this.device);
      let entry = this.velloSurfaces.get(island.resourceId);
      if (
        !entry
        || entry.surface.width !== dimensions.width
        || entry.surface.height !== dimensions.height
      ) {
        if (entry) {
          this.velloSurfaceRecreations += 1;
          this.disposeVelloSurface(entry.surface);
        }
        const surfaceStartedAt = this.detailedProfilingEnabled ? performance.now() : 0;
        entry = {
          surface: backend.createSurface(
            dimensions.width,
            dimensions.height,
            `LightTable Vello island: ${island.resourceId}`
          ),
          renderedSceneKey: null,
          renderedDependency: null,
          renderedIslandDependency: null,
          retainedIslandProjection: null
        };
        if (this.detailedProfilingEnabled) {
          this.recordDetailedPhase(
            'texture-surface-creation', performance.now() - surfaceStartedAt
          );
        }
        this.velloSurfaces.set(island.resourceId, entry);
      }
      if (entry.renderedSceneKey !== compiled.sceneKey) {
        const metrics = backend.render(
          entry.surface,
          compiled.scene,
          this.velloSourceKey(island.resourceId)
        );
        this.recordVelloRenderMetrics(metrics);
        entry.renderedSceneKey = compiled.sceneKey;
        entry.renderedIslandDependency = dependency;
        entry.retainedIslandProjection = compiled.projection;
      }
      this.velloLayerEncodes += 1;
      return entry.surface.texture;
    } catch (reason) {
      this.velloFailure = reason instanceof Error ? reason.message : String(reason);
      console.error('[LightTable vector] Vello island backend failed; using layer fallback.', reason);
      return null;
    }
  }

  canRenderIslands(islands: readonly RetainedRenderIsland[]) {
    if (this.selectedBackend !== 'vello' || this.velloFailure) return false;
    return islands.every(island => island.backendEligibility.vello
      && (island.role === 'direct-vector-run' || !island.boundaryReasons.some(reason => (
        ['clipping-chain', 'derived-preview', 'layer-effects'].includes(reason)
        || (reason === 'layer-mask' && !island.islandVectorClip)
      ))));
  }

  retainLayerIds(layerIds: ReadonlySet<string>) {
    for (const [layerId, entry] of this.velloSurfaces) {
      if (layerIds.has(layerId)) continue;
      this.disposeVelloSurface(entry.surface);
      this.velloSurfaces.delete(layerId);
      this.releaseVelloSource(layerId);
    }
  }

  /** Renders canonical clip geometry as white premultiplied coverage. */
  encodeMask(
    encoder: GPUCommandEncoder,
    clip: VectorClip,
    inheritedTransform: AffineMatrix,
    dimensions: { width: number; height: number },
    resourceId: LayerId
  ) {
    if (clip.inverted) throw new Error(`Inverted vector clip “${clip.name}” is not supported yet.`);
    const layer = createVectorLayer(clip.elements, clip.name);
    layer.id = resourceId;
    layer.elements = layer.elements.map(element => ({
      ...element,
      style: {
        fill: { type: 'solid', color: [1, 1, 1, 1] },
        stroke: null,
        opacity: 1
      },
      styleRevision: element.styleRevision + clip.revision + 1
    }));
    return this.encode(encoder, layer, inheritedTransform, dimensions);
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
      velloResourceIds: [...this.velloSurfaces.keys()],
      currentLayerEncodes: this.currentLayerEncodes,
      velloLayerEncodes: this.velloLayerEncodes,
      velloSceneRenders: this.velloSceneRenders,
      velloSceneCacheHits: this.velloSceneCacheHits,
      velloSceneEntries: this.vello?.sceneEntries() ?? 0,
      velloUploadedFragments: this.velloUploadedFragments,
      velloUploadedClips: this.velloUploadedClips,
      velloUnsupportedLayerEncodes: this.velloUnsupportedLayerEncodes,
      velloFullCompilations: this.velloFullCompilations,
      velloProjectedIslandMembers: this.velloProjectedIslandMembers,
      velloUnchangedSceneReuses: this.velloUnchangedSceneReuses,
      velloSurfaceRecreations: this.velloSurfaceRecreations,
      velloReleasedSources: this.velloReleasedSources,
      detailedProfile: {
        enabled: this.detailedProfilingEnabled,
        actualGpuTimingAvailable: this.velloGpuRenderSamples > 0,
        actualGpuRenderSamples: this.velloGpuRenderSamples,
        actualGpuRenderTotalMs: this.velloGpuRenderTotalMs,
        phases: Object.fromEntries(this.detailedPhases)
      },
      geometryCache: this.geometryCache.metrics()
    } as const;
  }

  resetBackendTelemetry() {
    this.currentLayerEncodes = 0;
    this.velloLayerEncodes = 0;
    this.velloSceneRenders = 0;
    this.velloSceneCacheHits = 0;
    this.velloUploadedFragments = 0;
    this.velloUploadedClips = 0;
    this.velloUnsupportedLayerEncodes = 0;
    this.velloFullCompilations = 0;
    this.velloProjectedIslandMembers = 0;
    this.velloUnchangedSceneReuses = 0;
    this.velloSurfaceRecreations = 0;
    this.velloReleasedSources = 0;
    this.velloGpuRenderSamples = 0;
    this.velloGpuRenderTotalMs = 0;
    this.detailedProfilingEnabled = true;
    this.detailedPhases.clear();
  }

  notifySubmitted() {
    const current = this.backend?.notifySubmitted() ?? Promise.resolve();
    if (!this.vello || !this.detailedProfilingEnabled) return current;
    const startedAt = performance.now();
    const velloQueue = this.device.queue.onSubmittedWorkDone().then(() => {
      this.recordDetailedPhase('gpu-queue-completion-wall', performance.now() - startedAt);
    });
    return Promise.all([current, velloQueue]).then(() => undefined);
  }

  estimatedTextureBytes() {
    const current = this.surface ? vectorSurfaceBytes(
      this.surface.width,
      this.surface.height,
      this.surface.sampleCount === 4 ? 4 : 1
    ) : 0;
    const currentClip = (this.vectorMaskSurface ? vectorSurfaceBytes(
      this.vectorMaskSurface.width,
      this.vectorMaskSurface.height,
      this.vectorMaskSurface.sampleCount === 4 ? 4 : 1
    ) : 0) + (this.vectorMaskOutput
      ? this.vectorMaskOutput.width * this.vectorMaskOutput.height * 8
      : 0);
    return current + currentClip + [...this.velloSurfaces.values()]
      .reduce((bytes, entry) => bytes + entry.surface.estimatedBytes, 0);
  }

  destroy() {
    this.surface?.dispose();
    this.surface = null;
    this.vectorMaskSurface?.dispose();
    this.vectorMaskSurface = null;
    this.vectorMaskOutput?.dispose();
    this.vectorMaskOutput = null;
    this.vectorMaskComposite?.dispose();
    this.vectorMaskComposite = null;
    this.backend?.dispose();
    this.backend = null;
    for (const [layerId, entry] of this.velloSurfaces) {
      this.disposeVelloSurface(entry.surface);
      this.releaseVelloSource(layerId);
    }
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
    const dependencyStartedAt = this.detailedProfilingEnabled ? performance.now() : 0;
    const layerToDocument = multiplyMatrices(inheritedTransform, layer.transform);
    const dependency = velloLayerDependency(layer, layerToDocument);
    const existing = this.velloSurfaces.get(layer.id);
    if (
      existing
      && existing.surface.width === dimensions.width
      && existing.surface.height === dimensions.height
      && sameVelloLayerDependency(existing.renderedDependency, dependency)
    ) {
      if (this.detailedProfilingEnabled) {
        this.recordDetailedPhase('dependency-key', performance.now() - dependencyStartedAt);
      }
      this.velloUnchangedSceneReuses += 1;
      return existing.surface.texture;
    }
    let sourceRevision: string | null = null;
    if (
      existing
      && existing.surface.width === dimensions.width
      && existing.surface.height === dimensions.height
    ) {
      sourceRevision = vectorLayerPaintSceneRevision(layer, layerToDocument);
      if (existing.renderedSceneKey === `${layer.id}:${sourceRevision}`) {
        existing.renderedDependency = dependency;
        if (this.detailedProfilingEnabled) {
          this.recordDetailedPhase('dependency-key', performance.now() - dependencyStartedAt);
        }
        this.velloUnchangedSceneReuses += 1;
        return existing.surface.texture;
      }
    }
    if (this.detailedProfilingEnabled) {
      this.recordDetailedPhase('dependency-key', performance.now() - dependencyStartedAt);
    }
    this.velloFullCompilations += 1;
    sourceRevision ??= vectorLayerPaintSceneRevision(layer, layerToDocument);
    const compiled = compileVelloVectorLayerScene(
      layer,
      inheritedTransform,
      this.detailedProfilingEnabled
        ? (phase, durationMs) => this.recordDetailedPhase(phase, durationMs)
        : undefined,
      { layerToDocument, sourceRevision }
    );
    if (compiled.status !== 'ready') {
      this.velloUnsupportedLayerEncodes += 1;
      const unsupported = this.velloSurfaces.get(layer.id);
      if (unsupported) this.disposeVelloSurface(unsupported.surface);
      this.velloSurfaces.delete(layer.id);
      this.releaseVelloSource(layer.id);
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
        if (entry) {
          this.velloSurfaceRecreations += 1;
          this.disposeVelloSurface(entry.surface);
        }
        const surfaceStartedAt = this.detailedProfilingEnabled ? performance.now() : 0;
        entry = {
          surface: backend.createSurface(
            dimensions.width,
            dimensions.height,
            `LightTable Vello layer: ${layer.name}`
          ),
          renderedSceneKey: null,
          renderedDependency: null,
          renderedIslandDependency: null,
          retainedIslandProjection: null
        };
        if (this.detailedProfilingEnabled) {
          this.recordDetailedPhase(
            'texture-surface-creation', performance.now() - surfaceStartedAt
          );
        }
        this.velloSurfaces.set(layer.id, entry);
      }
      if (entry.renderedSceneKey !== compiled.sceneKey) {
        const metrics = backend.render(
          entry.surface,
          compiled.scene,
          this.velloSourceKey(layer.id)
        );
        this.velloSceneRenders += 1;
        if (metrics.sceneCacheHit) this.velloSceneCacheHits += 1;
        this.velloUploadedFragments += metrics.uploadedFragments;
        this.velloUploadedClips += metrics.uploadedClips;
        for (const [phase, durationMs] of Object.entries(metrics.profile.phasesMs)) {
          if (durationMs !== undefined) {
            this.recordDetailedPhase(phase as VelloPaintSceneProfilePhase, durationMs);
          }
        }
        if (metrics.profile.actualGpuRenderMs !== null && metrics.profile.actualGpuRenderMs > 0) {
          this.velloGpuRenderSamples += 1;
          this.velloGpuRenderTotalMs += metrics.profile.actualGpuRenderMs;
        }
        entry.renderedSceneKey = compiled.sceneKey;
        entry.renderedDependency = dependency;
      }
      return entry.surface.texture;
    } catch (reason) {
      this.velloFailure = reason instanceof Error ? reason.message : String(reason);
      console.error('[LightTable vector] Vello backend disabled; using current WebGPU renderer.', reason);
      for (const [layerId, entry] of this.velloSurfaces) {
        this.disposeVelloSurface(entry.surface);
        this.releaseVelloSource(layerId);
      }
      this.velloSurfaces.clear();
      this.vello = null;
      return null;
    }
  }

  private recordDetailedPhase(phase: VectorDetailedProfilePhase, durationMs: number) {
    if (!this.detailedProfilingEnabled) return;
    const current = this.detailedPhases.get(phase) ?? emptyVectorTiming();
    this.detailedPhases.set(phase, {
      executions: current.executions + 1,
      totalMs: current.totalMs + durationMs,
      lastMs: durationMs,
      maximumMs: Math.max(current.maximumMs, durationMs)
    });
  }

  private recordVelloRenderMetrics(metrics: VelloPaintSceneRenderMetrics) {
    this.velloSceneRenders += 1;
    if (metrics.sceneCacheHit) this.velloSceneCacheHits += 1;
    this.velloUploadedFragments += metrics.uploadedFragments;
    this.velloUploadedClips += metrics.uploadedClips;
    for (const [phase, durationMs] of Object.entries(metrics.profile.phasesMs)) {
      if (durationMs !== undefined) {
        this.recordDetailedPhase(phase as VelloPaintSceneProfilePhase, durationMs);
      }
    }
    if (metrics.profile.actualGpuRenderMs !== null && metrics.profile.actualGpuRenderMs > 0) {
      this.velloGpuRenderSamples += 1;
      this.velloGpuRenderTotalMs += metrics.profile.actualGpuRenderMs;
    }
  }

  private disposeVelloSurface(surface: VelloPaintSceneSurface) {
    const startedAt = this.detailedProfilingEnabled ? performance.now() : 0;
    surface.dispose();
    if (this.detailedProfilingEnabled) {
      this.recordDetailedPhase('texture-surface-disposal', performance.now() - startedAt);
    }
  }

  private releaseVelloSource(layerId: string) {
    if (!this.vello) return;
    const startedAt = this.detailedProfilingEnabled ? performance.now() : 0;
    this.vello.releaseSource(this.velloSourceKey(layerId));
    this.velloReleasedSources += 1;
    if (this.detailedProfilingEnabled) {
      this.recordDetailedPhase('rust-source-release', performance.now() - startedAt);
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

  private ensureVectorMaskSurface(
    backend: VectorFillBackend,
    dimensions: { width: number; height: number },
    antiAlias: boolean
  ) {
    const sampleCount = vectorSurfaceSampleCount(
      dimensions.width, dimensions.height, antiAlias
    );
    if (
      this.vectorMaskSurface
      && this.vectorMaskSurface.width === dimensions.width
      && this.vectorMaskSurface.height === dimensions.height
      && this.vectorMaskSurface.sampleCount === sampleCount
    ) return this.vectorMaskSurface;
    this.vectorMaskSurface?.dispose();
    this.vectorMaskSurface = backend.createSurface(
      dimensions.width, dimensions.height, 'rgba16float', sampleCount === 4
    );
    return this.vectorMaskSurface;
  }

  private ensureVectorMaskOutput(dimensions: { width: number; height: number }) {
    if (
      this.vectorMaskOutput
      && this.vectorMaskOutput.width === dimensions.width
      && this.vectorMaskOutput.height === dimensions.height
    ) return this.vectorMaskOutput;
    this.vectorMaskOutput?.dispose();
    const backend = this.vectorMaskComposite ??= new VectorMaskCompositeBackend(this.device);
    this.vectorMaskOutput = backend.createSurface(dimensions.width, dimensions.height);
    return this.vectorMaskOutput;
  }

  private velloSourceKey(layerId: string) {
    return `${this.velloResourceNamespace}:${layerId}`;
  }
}
