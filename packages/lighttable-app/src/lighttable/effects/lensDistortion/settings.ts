export interface LensDistortionSettings {
  enabled: boolean;
  amount: number;
  midpoint: number;
  zoom: number;
}

export const DEFAULT_LENS_DISTORTION_SETTINGS: Readonly<LensDistortionSettings> = Object.freeze({
  enabled: false,
  amount: 18,
  midpoint: 50,
  zoom: 0
});

export const createDefaultLensDistortionSettings = (): LensDistortionSettings => ({
  ...DEFAULT_LENS_DISTORTION_SETTINGS
});

export const cloneLensDistortionSettings = (settings: LensDistortionSettings): LensDistortionSettings => ({ ...settings });

export const lensDistortionIsActive = (settings: LensDistortionSettings) => (
  settings.enabled && (Math.abs(settings.amount) > 0.00001 || settings.zoom > 0.00001)
);

export const mapLensDistortionUv = (
  x: number,
  y: number,
  width: number,
  height: number,
  settings: LensDistortionSettings
) => {
  if (!settings.enabled) return { x, y };
  const aspect = Math.max(1, width) / Math.max(1, height);
  const centeredX = (x - 0.5) * aspect;
  const centeredY = y - 0.5;
  const cornerRadius = Math.max(Math.hypot(0.5 * aspect, 0.5), 0.0001);
  const radius = Math.max(0, Math.min(1, Math.hypot(centeredX, centeredY) / cornerRadius));
  const strength = Math.max(-1, Math.min(1, settings.amount / 100)) * 0.58;
  const exponent = 1.35 + (3.8 - 1.35) * Math.max(0, Math.min(1, settings.midpoint / 100));
  const radial = radius ** exponent;
  const distortionScale = 1 + strength * radial + strength * 0.18 * radial * radial;
  const edgeSafeScale = 1 / Math.max(1, 1 + strength * 1.18);
  const userZoom = 1 / (1 + Math.max(0, Math.min(1, settings.zoom / 100)) * 0.45);
  return {
    x: Math.max(0, Math.min(1, centeredX * distortionScale * edgeSafeScale * userZoom / aspect + 0.5)),
    y: Math.max(0, Math.min(1, centeredY * distortionScale * edgeSafeScale * userZoom + 0.5))
  };
};
