import {
  cloneAdjustments
} from '../../types';
import { createDefaultColorGrading } from '../../colorGrading';
import { createDefaultColorMixer } from '../../colorMixer';
import { createDefaultCurves } from '../../curves';
import type { BasicAdjustments } from '../../types';

export type NumericAdjustmentKey = Exclude<
  keyof BasicAdjustments,
  'colorMixer' | 'colorGrading' | 'curves' | 'gradientMap' | 'effects'
>;

export interface GroupVisibility {
  readonly light: boolean;
  readonly color: boolean;
  readonly colorMixer: boolean;
  readonly colorGrading: boolean;
  readonly curves: boolean;
  readonly effects: boolean;
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
  'dehaze',
  'vignette'
]);

export const createDefaultGroupVisibility = (): GroupVisibility => ({
  light: true,
  color: true,
  colorMixer: true,
  colorGrading: true,
  curves: true,
  effects: true
});

export const applyGroupVisibility = (
  adjustments: BasicAdjustments,
  visibility: GroupVisibility
): BasicAdjustments => {
  const next = cloneAdjustments(adjustments);
  const zero = (keys: ReadonlySet<NumericAdjustmentKey>) => {
    keys.forEach((key) => {
      next[key] = 0;
    });
  };

  if (!visibility.light) zero(LIGHT_SLIDER_KEYS);
  if (!visibility.color) zero(COLOR_SLIDER_KEYS);
  if (!visibility.colorMixer) next.colorMixer = createDefaultColorMixer();
  if (!visibility.colorGrading) next.colorGrading = createDefaultColorGrading();
  if (!visibility.curves) next.curves = createDefaultCurves();
  if (!visibility.effects) zero(EFFECTS_SLIDER_KEYS);
  return next;
};
