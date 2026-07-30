export interface GrainSettings {
  enabled: boolean;
  amount: number;
  size: number;
  softness: number;
  color: number;
  shadowResponse: number;
  blend: number;
  seed: number;
  redScale: number;
  greenScale: number;
  blueScale: number;
  redContrast: number;
  greenContrast: number;
  blueContrast: number;
}

export const DEFAULT_GRAIN_SETTINGS: Readonly<GrainSettings> = Object.freeze({
  enabled: false,
  amount: 1.55,
  size: 0.5,
  softness: 1.19,
  color: 75,
  shadowResponse: 3.24,
  blend: 16,
  seed: 23,
  redScale: 0.64,
  greenScale: 1.25,
  blueScale: 1.7,
  redContrast: 2.01,
  greenContrast: 1.43,
  blueContrast: 0.85
});

export const createDefaultGrainSettings = (): GrainSettings => ({ ...DEFAULT_GRAIN_SETTINGS });

export const cloneGrainSettings = (settings: GrainSettings): GrainSettings => ({ ...settings });

export const grainIsActive = (settings: GrainSettings) => settings.enabled && settings.amount > 0.00001;
