export interface VignetteSettings {
  enabled: boolean;
  amount: number;
  midpoint: number;
  roundness: number;
  feather: number;
  highlights: number;
}

export const DEFAULT_VIGNETTE_SETTINGS: Readonly<VignetteSettings> = {
  enabled: false,
  amount: 0,
  midpoint: 50,
  roundness: 0,
  feather: 50,
  highlights: 0
};

export const createDefaultVignetteSettings = (): VignetteSettings => ({
  ...DEFAULT_VIGNETTE_SETTINGS
});

export const cloneVignetteSettings = (
  settings: VignetteSettings
): VignetteSettings => ({ ...settings });

export const vignetteIsActive = (settings: VignetteSettings): boolean =>
  settings.enabled && Math.abs(settings.amount) > 0.00001;
