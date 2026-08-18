import type { ColorMixerValues } from './colorMixer';

export interface BlackWhiteMixAdjustments {
  enabled: boolean;
  luminance: ColorMixerValues;
}

export const createDefaultBlackWhiteMix = (): BlackWhiteMixAdjustments => ({
  enabled: false,
  luminance: [0, 0, 0, 0, 0, 0, 0, 0]
});

export const cloneBlackWhiteMix = (
  value: BlackWhiteMixAdjustments
): BlackWhiteMixAdjustments => ({
  enabled: value.enabled,
  luminance: [...value.luminance] as ColorMixerValues
});

