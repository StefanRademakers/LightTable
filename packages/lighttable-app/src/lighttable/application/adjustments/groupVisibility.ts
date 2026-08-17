import {
  cloneAdjustments
} from '../../types';
import { createDefaultColorGrading } from '../../colorGrading';
import { createDefaultColorMixer } from '../../colorMixer';
import { createDefaultPointColor } from '../../pointColor';
import { createDefaultCurves } from '../../curves';
import type { BasicAdjustments } from '../../types';
import { createDefaultAdjustments } from '../../types';

export type NumericAdjustmentKey = Exclude<
  keyof BasicAdjustments,
  'colorMixer' | 'pointColor' | 'colorGrading' | 'curves' | 'gradientMap' | 'photoshopAdjustment' | 'detail' | 'effects'
>;

export interface GroupVisibility {
  readonly globalGrade: boolean;
  readonly globalLensFx: boolean;
  readonly light: boolean;
  readonly color: boolean;
  readonly colorMixer: boolean;
  readonly colorGrading: boolean;
  readonly curves: boolean;
  readonly effects: boolean;
  readonly detail: boolean;
}

export const LIGHT_SLIDER_KEYS = new Set<NumericAdjustmentKey>([
  'exposureEV',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'lift'
]);

export const COLOR_SLIDER_KEYS = new Set<NumericAdjustmentKey>([
  'temperature',
  'tint',
  'vibrance',
  'saturation'
]);

export const EFFECTS_SLIDER_KEYS = new Set<NumericAdjustmentKey>([
  'texture',
  'clarity',
  'dehaze'
]);

export const createDefaultGroupVisibility = (): GroupVisibility => ({
  globalGrade: true,
  globalLensFx: true,
  light: true,
  color: true,
  colorMixer: true,
  colorGrading: true,
  curves: true,
  effects: true,
  detail: true
});

export const applyGroupVisibility = (
  adjustments: BasicAdjustments,
  visibility: GroupVisibility
): BasicAdjustments => {
  let next = cloneAdjustments(adjustments);
  const defaults = createDefaultAdjustments();
  if (!visibility.globalGrade) {
    const lensFx = next.effects;
    next = defaults;
    next.effects = lensFx;
  }
  if (!visibility.globalLensFx) next.effects = defaults.effects;
  const zero = (keys: ReadonlySet<NumericAdjustmentKey>) => {
    keys.forEach((key) => {
      next[key] = 0;
    });
  };

  if (!visibility.light) zero(LIGHT_SLIDER_KEYS);
  if (!visibility.color) zero(COLOR_SLIDER_KEYS);
  if (!visibility.colorMixer) {
    next.colorMixer = createDefaultColorMixer();
    next.pointColor = createDefaultPointColor();
  }
  if (!visibility.colorGrading) next.colorGrading = createDefaultColorGrading();
  if (!visibility.curves) next.curves = createDefaultCurves();
  if (!visibility.effects) zero(EFFECTS_SLIDER_KEYS);
  if (!visibility.detail) next.detail = createDefaultAdjustments().detail;
  return next;
};
