import {
  cloneGrainSettings,
  createDefaultGrainSettings,
  type GrainSettings
} from './grain/settings';
import {
  cloneHalationSettings,
  createDefaultHalationSettings,
  type HalationSettings
} from './halation/settings';
import {
  cloneChromaticAberrationSettings,
  createDefaultChromaticAberrationSettings,
  type ChromaticAberrationSettings
} from './chromaticAberration/settings';
import {
  cloneLensDistortionSettings,
  createDefaultLensDistortionSettings,
  type LensDistortionSettings
} from './lensDistortion/settings';
import {
  cloneLensBlurSettings,
  createDefaultLensBlurSettings,
  type LensBlurSettings
} from './lensBlur/settings';

export interface LightTableEffects {
  grain: GrainSettings;
  halation: HalationSettings;
  chromaticAberration: ChromaticAberrationSettings;
  lensDistortion: LensDistortionSettings;
  lensBlur: LensBlurSettings;
}

export const createDefaultEffects = (): LightTableEffects => ({
  grain: createDefaultGrainSettings(),
  halation: createDefaultHalationSettings(),
  chromaticAberration: createDefaultChromaticAberrationSettings(),
  lensDistortion: createDefaultLensDistortionSettings(),
  lensBlur: createDefaultLensBlurSettings()
});

export const cloneEffects = (effects: LightTableEffects): LightTableEffects => ({
  grain: cloneGrainSettings(effects.grain),
  halation: cloneHalationSettings(effects.halation),
  chromaticAberration: cloneChromaticAberrationSettings(effects.chromaticAberration),
  lensDistortion: cloneLensDistortionSettings(effects.lensDistortion),
  lensBlur: cloneLensBlurSettings(effects.lensBlur)
});

export type LightTableEffectStage = 'source-geometry' | 'linear-spatial' | 'display-post';

export interface LightTableEffectRuntimeCallbacks {
  requestRender?: () => void;
  reportError?: (featureId: string, message: string) => void;
}

export interface LightTableGpuEffect<Settings> {
  readonly id: string;
  readonly stage: LightTableEffectStage;
  setSettings(settings: Settings): void;
  resize(width: number, height: number): void;
  encode(encoder: GPUCommandEncoder, input: GPUTexture): GPUTexture;
  destroyImageResources(): void;
  destroy(): void;
}
