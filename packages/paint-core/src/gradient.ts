export interface DisplaySrgbColor {
  /** Unpremultiplied display-sRGB channels. */
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GradientColorStop {
  id: string;
  position: number;
  midpoint: number;
  color: DisplaySrgbColor;
}

export interface GradientOpacityStop {
  id: string;
  position: number;
  midpoint: number;
  opacity: number;
}

/** Reusable color function. Geometry deliberately belongs to the instance. */
export interface GradientAsset {
  id: string;
  name: string;
  type: 'solid' | 'noise';
  smoothness: number;
  colorStops: GradientColorStop[];
  opacityStops: GradientOpacityStop[];
  roughness: number;
  seed: number;
}

export interface PaintAffineTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export interface GradientPaintInstance {
  readonly kind: 'gradient';
  readonly asset: GradientAsset;
  readonly shape: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  readonly coordinateSpace: 'object-bounds' | 'layer' | 'document';
  /** Maps normalized gradient space into the selected coordinate space. */
  readonly transform: PaintAffineTransform;
  readonly reverse: boolean;
  readonly dither: boolean;
  readonly interpolation: 'perceptual' | 'linear' | 'classic' | 'smooth';
}

export const identityPaintTransform = (): PaintAffineTransform => ({
  a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0
});

export const cloneGradientAsset = (asset: GradientAsset): GradientAsset => ({
  ...asset,
  colorStops: asset.colorStops.map((stop) => ({ ...stop, color: { ...stop.color } })),
  opacityStops: asset.opacityStops.map((stop) => ({ ...stop }))
});

export const cloneGradientPaint = (paint: GradientPaintInstance): GradientPaintInstance => ({
  ...paint,
  asset: cloneGradientAsset(paint.asset),
  transform: { ...paint.transform }
});

export const gradientAssetIsValid = (asset: GradientAsset): boolean => {
  const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (!asset.id || !asset.name || !unit(asset.smoothness)) return false;
  if (asset.type !== 'solid' && asset.type !== 'noise') return false;
  if (!unit(asset.roughness) || !Number.isFinite(asset.seed)) return false;
  if (asset.colorStops.length === 0 || asset.opacityStops.length === 0) return false;
  return asset.colorStops.every((stop) =>
    Boolean(stop.id)
    && unit(stop.position)
    && unit(stop.midpoint)
    && unit(stop.color.r)
    && unit(stop.color.g)
    && unit(stop.color.b)
    && unit(stop.color.a)
  ) && asset.opacityStops.every((stop) =>
    Boolean(stop.id) && unit(stop.position) && unit(stop.midpoint) && unit(stop.opacity)
  );
};

export const gradientPaintIsValid = (paint: GradientPaintInstance): boolean => {
  const finiteTransform = Object.values(paint.transform).every(Number.isFinite);
  return paint.kind === 'gradient'
    && gradientAssetIsValid(paint.asset)
    && ['linear', 'radial', 'angle', 'reflected', 'diamond'].includes(paint.shape)
    && ['object-bounds', 'layer', 'document'].includes(paint.coordinateSpace)
    && ['perceptual', 'linear', 'classic', 'smooth'].includes(paint.interpolation)
    && typeof paint.reverse === 'boolean'
    && typeof paint.dither === 'boolean'
    && finiteTransform;
};

const midpointRatio = (ratio: number, midpoint: number) => {
  const safe = Math.min(0.99, Math.max(0.01, midpoint));
  return ratio <= safe
    ? 0.5 * ratio / safe
    : 0.5 + 0.5 * (ratio - safe) / (1 - safe);
};

const segmentAt = <T extends { position: number; midpoint: number }>(stops: readonly T[], position: number) => {
  const ordered = [...stops].sort((left, right) => left.position - right.position);
  if (position <= (ordered[0]?.position ?? 0)) return { left: ordered[0]!, right: ordered[0]!, ratio: 0 };
  const last = ordered.at(-1)!;
  if (position >= last.position) return { left: last, right: last, ratio: 0 };
  const upper = ordered.findIndex((stop) => stop.position >= position);
  const left = ordered[Math.max(0, upper - 1)]!;
  const right = ordered[upper]!;
  const span = Math.max(1e-7, right.position - left.position);
  return { left, right, ratio: midpointRatio((position - left.position) / span, left.midpoint) };
};

/** Samples the reusable gradient function; geometry remains owned by the paint instance. */
export const sampleGradientAsset = (asset: GradientAsset, position: number): DisplaySrgbColor => {
  const t = Math.min(1, Math.max(0, position));
  const colors = segmentAt(asset.colorStops, t);
  const opacity = segmentAt(asset.opacityStops, t);
  const mix = (left: number, right: number, ratio: number) => left + (right - left) * ratio;
  const colorAlpha = mix(colors.left.color.a, colors.right.color.a, colors.ratio);
  return {
    r: mix(colors.left.color.r, colors.right.color.r, colors.ratio),
    g: mix(colors.left.color.g, colors.right.color.g, colors.ratio),
    b: mix(colors.left.color.b, colors.right.color.b, colors.ratio),
    a: colorAlpha * mix(opacity.left.opacity, opacity.right.opacity, opacity.ratio)
  };
};
