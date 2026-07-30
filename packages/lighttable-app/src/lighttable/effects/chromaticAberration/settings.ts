export interface ChromaticAberrationSettings {
  enabled: boolean;
  amount: number;
  falloff: number;
  balance: number;
}

export const DEFAULT_CHROMATIC_ABERRATION_SETTINGS: Readonly<ChromaticAberrationSettings> = Object.freeze({
  enabled: false,
  amount: 18,
  falloff: 70,
  balance: 0
});

export const createDefaultChromaticAberrationSettings = (): ChromaticAberrationSettings => ({
  ...DEFAULT_CHROMATIC_ABERRATION_SETTINGS
});
export const cloneChromaticAberrationSettings = (settings: ChromaticAberrationSettings): ChromaticAberrationSettings => ({ ...settings });
export const chromaticAberrationIsActive = (settings: ChromaticAberrationSettings) => (
  settings.enabled && settings.amount > 0.00001
);
