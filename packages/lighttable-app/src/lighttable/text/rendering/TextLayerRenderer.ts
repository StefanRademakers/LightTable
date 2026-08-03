import type { TextLayer } from '../../editor/document/documentTypes';
import {
  identityAffineMatrix,
  type LayerSourceRenderContract
} from '../../editor/rendering/renderContract';
import { multiplyMatrices } from '../../editor/tools/transform/affine';
import type { AffineMatrix } from '../../editor/tools/transform/transformTypes';
import type {
  CoverageAtlasBackend,
  CoverageAtlasDrawCommand
} from '@lighttable/text-webgpu';
import type { TextSourceCostSample } from './TextSourceCostModel';

export type TextLayerSourceMode = 'atlas' | 'cached';

export interface PublishedTextLayerSource<TTexture = GPUTexture> {
  readonly layerId: TextLayer['id'];
  readonly texture: TTexture;
  readonly width: number;
  readonly height: number;
  readonly localBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly sourceScale: number;
  readonly sourceKey: string;
  readonly authoredKey?: string;
  readonly mode: TextLayerSourceMode;
  readonly byteLength: number;
  readonly destroy?: () => void;
}

interface TextLayerRendererOptions<TTexture> {
  readonly createTexture: (label: string, width: number, height: number) => TTexture;
  readonly createView: (texture: TTexture) => GPUTextureView;
  readonly retireTexture: (texture: TTexture) => void;
  readonly maximumTextureDimension: number;
  readonly maximumSourceBytes?: number;
  readonly maximumCacheBytes?: number;
  readonly now?: () => number;
}

export interface TextLayerRendererSnapshot {
  readonly publicationRevision: number;
  readonly readyLayerCount: number;
  readonly textureBytes: number;
  readonly mode: 'placeholder' | TextLayerSourceMode;
  readonly rebuildingLayerCount: number;
  readonly cacheBudgetBytes: number;
  readonly cacheEvictions: number;
  readonly atlasLayerCount: number;
  readonly cachedLayerCount: number;
  readonly atlasEncodes: number;
  readonly sourceCacheHits: number;
  readonly sourceCacheMisses: number;
}

export interface PreparedTextLayerSource<TTexture = GPUTexture> {
  readonly contract: LayerSourceRenderContract<TTexture>;
  publish(): LayerSourceRenderContract<TTexture>;
  discard(): void;
}

interface PublishedAtlasTextSource {
  readonly layerId: TextLayer['id'];
  readonly backend: Pick<CoverageAtlasBackend, 'encode'>;
  readonly draws: readonly CoverageAtlasDrawCommand[];
  readonly sourceScale: number;
  readonly sourceKey: string;
  readonly authoredKey: string;
  readonly destroy: () => void;
}

export interface PreparedAtlasTextSource {
  publish(): void;
  discard(): void;
}

const translation = (x: number, y: number): AffineMatrix => ({
  ...identityAffineMatrix(),
  tx: x,
  ty: y
});

const scale = (value: number): AffineMatrix => ({
  ...identityAffineMatrix(),
  a: value,
  d: value
});

const mapClip = (
  clip: CoverageAtlasDrawCommand['clip'],
  map: (x: number, y: number) => readonly [number, number]
): CoverageAtlasDrawCommand['clip'] => clip ? Object.freeze(clip.flatMap((value, index) => (
  index % 2 === 0 ? map(value, clip[index + 1]!) : []
)) as unknown as [number, number, number, number, number, number, number, number]) : undefined;

/**
 * Document-scoped owner for immutable, tight text textures.
 *
 * Async layout/raster coordinators publish only completely prepared sources.
 * The synchronous compositor either receives an exact source or falls back;
 * it never observes a partially updated texture.
 */
export class TextLayerRenderer<TTexture = GPUTexture> {
  private readonly sources = new Map<TextLayer['id'], PublishedTextLayerSource<TTexture>>();
  private readonly atlasSources = new Map<TextLayer['id'], PublishedAtlasTextSource>();
  private readonly transparentKeys = new Map<TextLayer['id'], string>();
  private revision = 0;
  private clock = 0;
  private cacheEvictions = 0;
  private readonly touched = new Map<TextLayer['id'], number>();
  private visibleLayerIds = new Set<TextLayer['id']>();
  private atlasEncodes = 0;
  private sourceCacheHits = 0;
  private sourceCacheMisses = 0;
  private costObserver: ((sample: TextSourceCostSample) => void) | null = null;

  constructor(private readonly options?: TextLayerRendererOptions<TTexture>) {
    const budget = options?.maximumCacheBytes ?? 256 * 1024 * 1024;
    if (!Number.isSafeInteger(budget) || budget < 0) {
      throw new RangeError('Text source cache budget must be a non-negative safe integer.');
    }
  }

  setCostObserver(observer: ((sample: TextSourceCostSample) => void) | null) {
    this.costObserver = observer;
  }

  publish(source: PublishedTextLayerSource<TTexture>) {
    this.assertSource(source);
    const previous = this.sources.get(source.layerId);
    if (previous === source) return false;
    const budget = this.options?.maximumCacheBytes ?? 256 * 1024 * 1024;
    if (source.byteLength > budget) {
      throw new RangeError('Text source exceeds the document cache byte budget.');
    }
    let retainedBytes = this.sourceBytes() - (previous?.byteLength ?? 0);
    while (retainedBytes + source.byteLength > budget) {
      const victim = [...this.sources.values()]
        .filter((candidate) => candidate.layerId !== source.layerId)
        .sort((left, right) => {
          const leftVisible = this.visibleLayerIds.has(left.layerId) ? 1 : 0;
          const rightVisible = this.visibleLayerIds.has(right.layerId) ? 1 : 0;
          return leftVisible - rightVisible
            || (this.touched.get(left.layerId) ?? 0) - (this.touched.get(right.layerId) ?? 0);
        })[0];
      if (!victim) throw new RangeError('Text source cache has no evictable capacity.');
      retainedBytes -= victim.byteLength;
      this.cacheEvictions += 1;
      this.release(victim.layerId);
    }
    this.sources.set(source.layerId, Object.freeze({ ...source }));
    const previousAtlas = this.atlasSources.get(source.layerId);
    this.atlasSources.delete(source.layerId);
    previousAtlas?.destroy();
    this.touched.set(source.layerId, ++this.clock);
    this.transparentKeys.delete(source.layerId);
    if (previous?.texture !== source.texture) previous?.destroy?.();
    this.revision += 1;
    return true;
  }

  prepareAtlasSource(
    layer: TextLayer,
    backend: Pick<CoverageAtlasBackend, 'encode'>,
    draws: readonly CoverageAtlasDrawCommand[],
    sourceScale: number,
    sourceKey: string,
    release: () => void
  ): PreparedAtlasTextSource {
    if (!sourceKey || !Number.isFinite(sourceScale) || sourceScale <= 0) {
      release();
      throw new TypeError('Atlas text source identity and scale must be valid.');
    }
    const source = Object.freeze({
      layerId: layer.id,
      backend,
      draws: Object.freeze([...draws]),
      sourceScale,
      sourceKey,
      authoredKey: textLayerSourceKey(layer),
      destroy: release
    });
    let settled = false;
    return {
      publish: () => {
        if (settled) return;
        settled = true;
        const previous = this.atlasSources.get(layer.id);
        const cached = this.sources.get(layer.id);
        this.atlasSources.set(layer.id, source);
        this.sources.delete(layer.id);
        cached?.destroy?.();
        previous?.destroy();
        this.transparentKeys.delete(layer.id);
        this.touched.set(layer.id, ++this.clock);
        this.revision += 1;
      },
      discard: () => {
        if (settled) return;
        settled = true;
        release();
      }
    };
  }

  encodeAtlasPresentation(
    encoder: GPUCommandEncoder,
    layer: TextLayer,
    inheritedTransform: AffineMatrix,
    target: { readonly texture: GPUTexture; readonly width: number; readonly height: number }
  ) {
    const source = this.atlasSources.get(layer.id);
    if (!source) return false;
    const combined = multiplyMatrices(inheritedTransform, layer.transform);
    const inverseScale = 1 / source.sourceScale;
    const draws = source.draws.map((draw) => {
      const basis = draw.transform ?? [1, 0, 0, 1];
      const x = draw.x * inverseScale;
      const y = draw.y * inverseScale;
      return {
        ...draw,
        x: combined.a * x + combined.c * y + combined.tx,
        y: combined.b * x + combined.d * y + combined.ty,
        transform: [
          (combined.a * basis[0] + combined.c * basis[1]) * inverseScale,
          (combined.b * basis[0] + combined.d * basis[1]) * inverseScale,
          (combined.a * basis[2] + combined.c * basis[3]) * inverseScale,
          (combined.b * basis[2] + combined.d * basis[3]) * inverseScale
        ] as const,
        ...(draw.clip ? { clip: mapClip(draw.clip, (clipX, clipY) => {
          const localX = clipX * inverseScale;
          const localY = clipY * inverseScale;
          return [
            combined.a * localX + combined.c * localY + combined.tx,
            combined.b * localX + combined.d * localY + combined.ty
          ];
        }) } : {})
      };
    });
    const startedAt = this.now();
    source.backend.encode(encoder, {
      view: target.texture.createView(),
      format: 'rgba16float',
      width: target.width,
      height: target.height,
      loadOp: 'load'
    }, draws);
    this.costObserver?.({
      phase: 'atlas-composite',
      durationMs: Math.max(0, this.now() - startedAt),
      glyphCount: Math.max(1, draws.length),
      pixelCount: Math.max(1, target.width * target.height)
    });
    this.atlasEncodes += 1;
    this.touched.set(layer.id, ++this.clock);
    return true;
  }

  hasExactSource(layer: TextLayer) {
    const atlas = this.atlasSources.get(layer.id);
    return Boolean(this.resolveExact(layer))
      || Boolean(atlas && atlas.authoredKey === textLayerSourceKey(layer));
  }

  isTransparent(layer: TextLayer) {
    return this.transparentKeys.get(layer.id) === textLayerSourceKey(layer);
  }

  markTransparent(layer: TextLayer) {
    const key = textLayerSourceKey(layer);
    const unchanged = this.transparentKeys.get(layer.id) === key && !this.sources.has(layer.id);
    if (unchanged) return false;
    const source = this.sources.get(layer.id);
    this.sources.delete(layer.id);
    source?.destroy?.();
    this.transparentKeys.set(layer.id, key);
    this.revision += 1;
    return true;
  }

  private contractFor(
    source: PublishedTextLayerSource<TTexture>,
    layer: TextLayer,
    inheritedTransform: AffineMatrix
  ): LayerSourceRenderContract<TTexture> {
    this.touched.set(source.layerId, ++this.clock);
    const localSourceToLayer = multiplyMatrices(
      translation(source.localBounds.x, source.localBounds.y),
      scale(1 / source.sourceScale)
    );
    return {
      layerId: layer.id,
      texture: source.texture,
      dimensions: { width: source.width, height: source.height },
      bounds: { ...source.localBounds },
      colorSpace: 'linear-srgb',
      alphaMode: 'premultiplied',
      sourceKey: source.sourceKey,
      transform: multiplyMatrices(
        multiplyMatrices(inheritedTransform, layer.transform),
        localSourceToLayer
      )
    };
  }

  resolveExact(
    layer: TextLayer,
    inheritedTransform: AffineMatrix = identityAffineMatrix()
  ): LayerSourceRenderContract<TTexture> | null {
    const source = this.sources.get(layer.id);
    if (!source || (source.authoredKey ?? source.sourceKey) !== textLayerSourceKey(layer)) return null;
    return this.contractFor(source, layer, inheritedTransform);
  }

  /** Exact-only compatibility alias used by export/rasterization readiness. */
  resolve(
    layer: TextLayer,
    inheritedTransform: AffineMatrix = identityAffineMatrix()
  ) {
    return this.resolveExact(layer, inheritedTransform);
  }

  /** Keeps the last valid same-layer pixels visible while an exact rebuild runs. */
  resolvePresentation(
    layer: TextLayer,
    inheritedTransform: AffineMatrix = identityAffineMatrix()
  ): LayerSourceRenderContract<TTexture> | null {
    const source = this.sources.get(layer.id);
    if (source) this.sourceCacheHits += 1;
    else this.sourceCacheMisses += 1;
    return source ? this.contractFor(source, layer, inheritedTransform) : null;
  }

  encodeTightSource(
    encoder: GPUCommandEncoder,
    layer: TextLayer,
    backend: Pick<CoverageAtlasBackend, 'encode'>,
    draws: readonly CoverageAtlasDrawCommand[],
    sourceScale = 1,
    sourceKey = `${textLayerSourceKey(layer)}@${sourceScale}`
  ) {
    const prepared = this.prepareTightSource(
      encoder, layer, backend, draws, sourceScale, sourceKey
    );
    return prepared?.publish() ?? null;
  }

  prepareTightSource(
    encoder: GPUCommandEncoder,
    layer: TextLayer,
    backend: Pick<CoverageAtlasBackend, 'encode'>,
    draws: readonly CoverageAtlasDrawCommand[],
    sourceScale = 1,
    sourceKey = `${textLayerSourceKey(layer)}@${sourceScale}`
  ): PreparedTextLayerSource<TTexture> | null {
    if (!this.options) throw new Error('TextLayerRenderer has no GPU texture allocator.');
    const bounds = tightCoverageBounds(draws, 2);
    if (!bounds) return null;
    const width = Math.ceil(bounds.width);
    const height = Math.ceil(bounds.height);
    const byteLength = width * height * 8;
    const maximumBytes = this.options.maximumSourceBytes ?? 64 * 1024 * 1024;
    if (width > this.options.maximumTextureDimension
      || height > this.options.maximumTextureDimension
      || byteLength > maximumBytes) {
      throw new RangeError('Tight text source exceeds the bounded GPU texture budget.');
    }
    const texture = this.options.createTexture(
      `LightTable tight text source: ${layer.name}`,
      width,
      height
    );
    const shifted = draws.map((draw) => ({
      ...draw,
      x: draw.x - bounds.x,
      y: draw.y - bounds.y,
      ...(draw.clip ? { clip: mapClip(draw.clip, (x, y) => [x - bounds.x, y - bounds.y]) } : {})
    }));
    try {
      const startedAt = this.now();
      backend.encode(encoder, {
        view: this.options.createView(texture),
        format: 'rgba16float',
        width,
        height,
        loadOp: 'clear'
      }, shifted);
      this.costObserver?.({
        phase: 'cache-build',
        durationMs: Math.max(0, this.now() - startedAt),
        glyphCount: Math.max(1, draws.length),
        pixelCount: Math.max(1, width * height)
      });
      const publishedSource: PublishedTextLayerSource<TTexture> = {
        layerId: layer.id,
        texture,
        width,
        height,
        localBounds: {
          x: bounds.x / sourceScale,
          y: bounds.y / sourceScale,
          width: bounds.width / sourceScale,
          height: bounds.height / sourceScale
        },
        sourceScale,
        sourceKey,
        authoredKey: textLayerSourceKey(layer),
        mode: 'cached',
        byteLength,
        destroy: () => this.options?.retireTexture(texture)
      };
      let settled = false;
      const contract = {
        layerId: layer.id,
        texture,
        dimensions: { width, height },
        bounds: { ...publishedSource.localBounds },
        colorSpace: 'linear-srgb' as const,
        alphaMode: 'premultiplied' as const,
        sourceKey,
        transform: multiplyMatrices(
          layer.transform,
          multiplyMatrices(
            translation(publishedSource.localBounds.x, publishedSource.localBounds.y),
            scale(1 / sourceScale)
          )
        )
      };
      return {
        contract,
        publish: () => {
          if (!settled) {
            settled = true;
            this.publish(publishedSource);
          }
          return this.resolveExact(layer)!;
        },
        discard: () => {
          if (settled) return;
          settled = true;
          this.options?.retireTexture(texture);
        }
      };
    } catch (error) {
      this.options.retireTexture(texture);
      throw error;
    }
  }

  thumbnailSource(layerId: TextLayer['id']) {
    const source = this.sources.get(layerId);
    return source ? {
      texture: source.texture,
      width: source.width,
      height: source.height,
      revisionKey: source.sourceKey
    } : null;
  }

  release(layerId: TextLayer['id']) {
    const source = this.sources.get(layerId);
    const atlas = this.atlasSources.get(layerId);
    const transparent = this.transparentKeys.delete(layerId);
    if (!source && !atlas && !transparent) return false;
    this.sources.delete(layerId);
    this.atlasSources.delete(layerId);
    this.touched.delete(layerId);
    source?.destroy?.();
    atlas?.destroy();
    this.revision += 1;
    return true;
  }

  sync(layers: readonly TextLayer[]) {
    const retained = new Set(layers.map((layer) => layer.id));
    for (const layerId of this.sources.keys()) {
      if (!retained.has(layerId)) this.release(layerId);
    }
    for (const layerId of this.atlasSources.keys()) {
      if (!retained.has(layerId)) this.release(layerId);
    }
    for (const layerId of this.transparentKeys.keys()) {
      if (!retained.has(layerId)) this.release(layerId);
    }
    this.currentLayers.clear();
    layers.forEach((layer) => this.currentLayers.set(layer.id, layer));
    this.visibleLayerIds = new Set(layers.filter((layer) => layer.visible && layer.opacity > 0).map((layer) => layer.id));
  }

  setVisibleLayerIds(layerIds: ReadonlySet<TextLayer['id']>) {
    this.visibleLayerIds = new Set(layerIds);
  }

  snapshot(): TextLayerRendererSnapshot {
    let textureBytes = 0;
    let rebuildingLayerCount = 0;
    let mode: TextLayerRendererSnapshot['mode'] = 'placeholder';
    for (const source of this.sources.values()) {
      textureBytes += source.byteLength;
      mode = source.mode;
    }
    if (this.atlasSources.size > 0) mode = this.sources.size > 0 ? mode : 'atlas';
    for (const [layerId, source] of this.sources) {
      const authored = this.currentLayers.get(layerId);
      if (authored && (source.authoredKey ?? source.sourceKey) !== textLayerSourceKey(authored)) {
        rebuildingLayerCount += 1;
      }
    }
    for (const [layerId, source] of this.atlasSources) {
      const authored = this.currentLayers.get(layerId);
      if (authored && source.authoredKey !== textLayerSourceKey(authored)) {
        rebuildingLayerCount += 1;
      }
    }
    return Object.freeze({
      publicationRevision: this.revision,
      readyLayerCount: this.sources.size + this.atlasSources.size + this.transparentKeys.size,
      textureBytes,
      mode: mode === 'placeholder' && this.transparentKeys.size > 0 ? 'cached' : mode,
      rebuildingLayerCount,
      cacheBudgetBytes: this.options?.maximumCacheBytes ?? 256 * 1024 * 1024,
      cacheEvictions: this.cacheEvictions,
      atlasLayerCount: this.atlasSources.size,
      cachedLayerCount: this.sources.size,
      atlasEncodes: this.atlasEncodes,
      sourceCacheHits: this.sourceCacheHits,
      sourceCacheMisses: this.sourceCacheMisses
    });
  }

  estimatedTextureBytes() {
    return this.snapshot().textureBytes;
  }

  observeCachedComposite(layer: TextLayer, durationMs: number) {
    const source = this.sources.get(layer.id);
    if (!source || !Number.isFinite(durationMs) || durationMs < 0) return false;
    this.costObserver?.({
      phase: 'cached-composite',
      durationMs,
      glyphCount: 1,
      pixelCount: Math.max(1, source.width * source.height)
    });
    return Boolean(this.costObserver);
  }

  dispose() {
    for (const source of this.sources.values()) source.destroy?.();
    for (const source of this.atlasSources.values()) source.destroy();
    if (this.sources.size > 0 || this.transparentKeys.size > 0) this.revision += 1;
    this.sources.clear();
    this.atlasSources.clear();
    this.transparentKeys.clear();
    this.currentLayers.clear();
    this.touched.clear();
    this.visibleLayerIds.clear();
  }

  private readonly currentLayers = new Map<TextLayer['id'], TextLayer>();

  private now() {
    return this.options?.now?.() ?? performance.now();
  }

  private sourceBytes() {
    let bytes = 0;
    for (const source of this.sources.values()) bytes += source.byteLength;
    return bytes;
  }

  private assertSource(source: PublishedTextLayerSource<TTexture>) {
    if (!source.sourceKey) throw new TypeError('Text source key must not be empty.');
    if (!Number.isInteger(source.width) || source.width <= 0
      || !Number.isInteger(source.height) || source.height <= 0) {
      throw new TypeError('Text source dimensions must be positive integers.');
    }
    if (!Number.isFinite(source.sourceScale) || source.sourceScale <= 0) {
      throw new TypeError('Text source scale must be finite and positive.');
    }
    if (!Number.isSafeInteger(source.byteLength) || source.byteLength < source.width * source.height * 8) {
      throw new TypeError('Text source byte length must cover its rgba16float texture.');
    }
    const bounds = source.localBounds;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      || bounds.width <= 0 || bounds.height <= 0) {
      throw new TypeError('Text source bounds must be finite and non-empty.');
    }
  }
}

export const tightCoverageBounds = (
  draws: readonly CoverageAtlasDrawCommand[],
  fringe = 2
) => {
  if (!Number.isFinite(fringe) || fringe < 0) throw new TypeError('Text source fringe must be finite and non-negative.');
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const draw of draws) {
    const placement = draw.glyph.placement;
    if (placement.empty) continue;
    const [a, b, c, d] = draw.transform ?? [1, 0, 0, 1];
    const originX = draw.x + a * draw.glyph.bearingX - c * draw.glyph.bearingY;
    const originY = draw.y + b * draw.glyph.bearingX - d * draw.glyph.bearingY;
    const corners = [
      [originX, originY],
      [originX + a * placement.width, originY + b * placement.width],
      [originX + c * placement.height, originY + d * placement.height],
      [originX + a * placement.width + c * placement.height,
        originY + b * placement.width + d * placement.height]
    ];
    for (const [x, y] of corners) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (!Number.isFinite(left)) return null;
  const clip = draws.find((draw) => draw.clip)?.clip;
  if (clip) {
    const clipXs = [clip[0], clip[2], clip[4], clip[6]];
    const clipYs = [clip[1], clip[3], clip[5], clip[7]];
    left = Math.max(left - fringe, Math.min(...clipXs));
    top = Math.max(top - fringe, Math.min(...clipYs));
    right = Math.min(right + fringe, Math.max(...clipXs));
    bottom = Math.min(bottom + fringe, Math.max(...clipYs));
    if (right <= left || bottom <= top) return null;
  } else {
    left -= fringe;
    top -= fringe;
    right += fringe;
    bottom += fringe;
  }
  const x = Math.floor(left);
  const y = Math.floor(top);
  return Object.freeze({
    x,
    y,
    width: Math.ceil(right) - x,
    height: Math.ceil(bottom) - y
  });
};

/** Canonical authored source identity; common transform and viewport are absent. */
export const textLayerSourceKey = (layer: TextLayer) => {
  const revisions = layer.text.revisions as unknown as Record<string, number>;
  return [
    revisions.content,
    revisions.font ?? revisions.style,
    revisions.layout,
    revisions.paint ?? revisions.style,
    revisions.path,
    revisions.geometry
  ].join(':');
};
