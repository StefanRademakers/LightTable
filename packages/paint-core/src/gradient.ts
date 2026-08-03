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
