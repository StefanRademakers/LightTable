import type { DocumentBlendProfile } from '../document/documentTypes';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const srgbToLinearChannel = (value: number) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgbChannel = (value: number) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;
const ADOBE_RGB_GAMMA = 563 / 256;

export interface RgbTriplet { readonly r: number; readonly g: number; readonly b: number }

/**
 * One document-scoped matrix/TRC color transform contract shared by import,
 * semantic colors and the GPU compositor. Canonical storage stays linear sRGB;
 * Photoshop-compatible blend equations run in the declared encoded profile.
 */
export const documentBlendProfileFromIccName = (name: string | null): DocumentBlendProfile =>
  name && /adobe\s*rgb\s*(?:\(1998\))?/iu.test(name) ? 'adobe-rgb-1998' : 'srgb';

export const documentBlendProfileGpuValue = (profile: DocumentBlendProfile) =>
  profile === 'adobe-rgb-1998' ? 1 : 0;

export const encodedDocumentToLinearSrgb = (
  color: RgbTriplet,
  profile: DocumentBlendProfile
): RgbTriplet => {
  if (profile === 'srgb') return {
    r: srgbToLinearChannel(color.r),
    g: srgbToLinearChannel(color.g),
    b: srgbToLinearChannel(color.b)
  };
  const adobe = {
    r: Math.max(0, color.r) ** ADOBE_RGB_GAMMA,
    g: Math.max(0, color.g) ** ADOBE_RGB_GAMMA,
    b: Math.max(0, color.b) ** ADOBE_RGB_GAMMA
  };
  return {
    r: 1.39835574 * adobe.r - 0.39835574 * adobe.g,
    g: adobe.g,
    b: -0.0429288 * adobe.g + 1.0429288 * adobe.b
  };
};

export const linearSrgbToEncodedDocument = (
  color: RgbTriplet,
  profile: DocumentBlendProfile
): RgbTriplet => {
  if (profile === 'srgb') return {
    r: clamp01(linearToSrgbChannel(color.r)),
    g: clamp01(linearToSrgbChannel(color.g)),
    b: clamp01(linearToSrgbChannel(color.b))
  };
  const adobe = {
    r: 0.71516271 * color.r + 0.28483729 * color.g,
    g: color.g,
    b: 0.04117054 * color.g + 0.95882946 * color.b
  };
  return {
    r: clamp01(Math.max(0, adobe.r) ** (1 / ADOBE_RGB_GAMMA)),
    g: clamp01(Math.max(0, adobe.g) ** (1 / ADOBE_RGB_GAMMA)),
    b: clamp01(Math.max(0, adobe.b) ** (1 / ADOBE_RGB_GAMMA))
  };
};

export const convertEncodedDocumentColorToSrgb = (
  color: RgbTriplet,
  profile: DocumentBlendProfile
): RgbTriplet => {
  if (profile === 'srgb') return {
    r: clamp01(color.r), g: clamp01(color.g), b: clamp01(color.b)
  };
  const linear = encodedDocumentToLinearSrgb(color, profile);
  return {
    r: clamp01(linearToSrgbChannel(linear.r)),
    g: clamp01(linearToSrgbChannel(linear.g)),
    b: clamp01(linearToSrgbChannel(linear.b))
  };
};
