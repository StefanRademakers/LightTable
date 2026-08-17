import {
  adjustmentStackForModuleTypes,
  adjustmentStackForOwner,
  adjustmentStackHasOwner,
  type AdjustmentStack
} from './adjustmentStack';
import type { PhotoshopAdjustmentKind } from '../photoshopAdjustments';

export type AdjustmentLayerKind =
  | 'grade'
  | 'lens-fx'
  | 'color-vibrance'
  | 'curves'
  | 'vibrance'
  | 'gradient-map'
  | 'clarity-dehaze'
  | 'grain'
  | PhotoshopAdjustmentKind;

export type AdjustmentPropertiesView = AdjustmentLayerKind;

export interface AdjustmentLayerDefinition {
  readonly id: AdjustmentLayerKind;
  readonly name: string;
  readonly menuLabel: string;
  readonly iconName: string;
  readonly family: 'lighttable' | 'photoshop';
  readonly moduleTypes?: readonly string[];
  readonly owner?: 'grade' | 'lens-fx';
  readonly photoshopKind?: PhotoshopAdjustmentKind;
  /** Retained editor identity that is no longer offered by the current UI. */
  readonly creationVisible?: boolean;
}

/**
 * Canonical creation and presentation order. New Photoshop-compatible
 * adjustments join this catalog only once their controls affect rendering.
 */
export const ADJUSTMENT_LAYER_DEFINITIONS: readonly AdjustmentLayerDefinition[] = [
  {
    id: 'grade',
    name: 'Grade',
    menuLabel: 'Grade',
    iconName: 'add_adjustment_layer.png',
    family: 'lighttable',
    owner: 'grade'
  },
  {
    id: 'lens-fx',
    name: 'Lens Fx',
    menuLabel: 'Lens Fx',
    iconName: 'lens_fx.png',
    family: 'lighttable',
    owner: 'lens-fx'
  },
  {
    id: 'color-vibrance',
    name: 'Color and Vibrance',
    menuLabel: 'Color and Vibrance',
    iconName: 'adjustment_vibrance.svg',
    family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'],
    photoshopKind: 'color-vibrance'
  },
  {
    id: 'brightness-contrast',
    name: 'Brightness / Contrast',
    menuLabel: 'Brightness / Contrast',
    iconName: 'adjustment_exposure.svg',
    family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'],
    photoshopKind: 'brightness-contrast'
  },
  {
    id: 'levels',
    name: 'Levels',
    menuLabel: 'Levels',
    iconName: 'layer_adjustment.png',
    family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'],
    photoshopKind: 'levels'
  },
  {
    id: 'curves',
    name: 'Curves',
    menuLabel: 'Curves',
    iconName: 'adjustment_curves.svg',
    family: 'photoshop',
    moduleTypes: ['lt.curves']
  },
  {
    id: 'exposure',
    name: 'Exposure',
    menuLabel: 'Exposure',
    iconName: 'adjustment_exposure.svg',
    family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'],
    photoshopKind: 'exposure'
  },
  {
    id: 'vibrance',
    name: 'Vibrance',
    menuLabel: 'Vibrance',
    iconName: 'adjustment_vibrance.svg',
    family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'],
    photoshopKind: 'vibrance',
    creationVisible: false
  },
  {
    id: 'hue-saturation', name: 'Hue / Saturation', menuLabel: 'Hue / Saturation',
    iconName: 'adjustment_vibrance.svg', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'hue-saturation'
  },
  {
    id: 'color-balance', name: 'Color Balance', menuLabel: 'Color Balance',
    iconName: 'adjustment_vibrance.svg', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'color-balance'
  },
  {
    id: 'black-white', name: 'Black & White', menuLabel: 'Black & White',
    iconName: 'layer_adjustment.png', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'black-white'
  },
  {
    id: 'photo-filter', name: 'Photo Filter', menuLabel: 'Photo Filter',
    iconName: 'layer_adjustment.png', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'photo-filter'
  },
  {
    id: 'channel-mixer', name: 'Channel Mixer', menuLabel: 'Channel Mixer',
    iconName: 'layer_adjustment.png', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'channel-mixer'
  },
  {
    id: 'color-lookup', name: 'Color Lookup', menuLabel: 'Color Lookup',
    iconName: 'layer_adjustment.png', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'color-lookup'
  },
  {
    id: 'selective-color', name: 'Selective Color', menuLabel: 'Selective Color',
    iconName: 'adjustment_vibrance.svg', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'selective-color'
  },
  {
    id: 'invert', name: 'Invert', menuLabel: 'Invert',
    iconName: 'adjustment_exposure.svg', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'invert'
  },
  {
    id: 'posterize', name: 'Posterize', menuLabel: 'Posterize',
    iconName: 'layer_adjustment.png', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'posterize'
  },
  {
    id: 'threshold', name: 'Threshold', menuLabel: 'Threshold',
    iconName: 'layer_adjustment.png', family: 'photoshop',
    moduleTypes: ['lt.photoshop-adjustment'], photoshopKind: 'threshold'
  },
  {
    id: 'gradient-map',
    name: 'Gradient Map',
    menuLabel: 'Gradient Map',
    iconName: 'adjustment_gradient_map.svg',
    family: 'photoshop',
    moduleTypes: ['lt.gradient-map']
  },
  {
    id: 'clarity-dehaze', name: 'Clarity and Dehaze', menuLabel: 'Clarity and Dehaze',
    iconName: 'layer_adjustment.png', family: 'photoshop', moduleTypes: ['lt.local-contrast']
  },
  {
    id: 'grain', name: 'Grain', menuLabel: 'Grain',
    iconName: 'layer_adjustment.png', family: 'photoshop', moduleTypes: ['lt.grain']
  }
] as const;

/** Shared presentation groups for every adjustment creation surface. */
export const ADJUSTMENT_LAYER_MENU_GROUPS: readonly (readonly AdjustmentLayerKind[])[] = [
  ['grade', 'lens-fx'],
  ['brightness-contrast', 'levels', 'curves', 'exposure'],
  [
    'color-vibrance', 'hue-saturation', 'color-balance', 'black-white',
    'photo-filter', 'channel-mixer', 'color-lookup'
  ],
  ['invert', 'posterize', 'threshold', 'gradient-map', 'selective-color'],
  ['clarity-dehaze', 'grain']
] as const;

export const adjustmentLayerDefinition = (kind: AdjustmentLayerKind) =>
  ADJUSTMENT_LAYER_DEFINITIONS.find((definition) => definition.id === kind)!;

export const adjustmentLayerMenuDefinitionGroups = () =>
  ADJUSTMENT_LAYER_MENU_GROUPS.map((group) => group.map(adjustmentLayerDefinition)
    .filter(({ creationVisible }) => creationVisible !== false));

export const isAdjustmentLayerKind = (value: unknown): value is AdjustmentLayerKind =>
  typeof value === 'string'
  && ADJUSTMENT_LAYER_DEFINITIONS.some((definition) => definition.id === value);

export const selectAdjustmentLayerModules = (
  stack: AdjustmentStack,
  kind: AdjustmentLayerKind
): AdjustmentStack => {
  const definition = adjustmentLayerDefinition(kind);
  if (definition.owner) return adjustmentStackForOwner(stack, definition.owner);
  return adjustmentStackForModuleTypes(stack, definition.moduleTypes ?? []);
};

export const adjustmentPropertiesViewForStack = (
  stack: AdjustmentStack
): AdjustmentPropertiesView => {
  const types = new Set(stack.modules.map((module) => module.type));
  // Legacy/imported focused nodes predate adjustmentKind.
  if (types.size === 1 && types.has('lt.light')) return 'exposure';
  if (types.size === 1 && types.has('lt.global-color')) return 'vibrance';
  const specialized = ADJUSTMENT_LAYER_DEFINITIONS.find((definition) => (
    definition.moduleTypes?.length === types.size
    && definition.moduleTypes.every((type) => types.has(type))
  ));
  if (specialized) return specialized.id;
  return adjustmentStackHasOwner(stack, 'lens-fx') ? 'lens-fx' : 'grade';
};
