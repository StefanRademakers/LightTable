/**
 * Serializable processing metadata for the current LightTable controls.
 *
 * This is deliberately independent from WebGPU resources and the present
 * document-wide renderer. The first extraction step uses it as the canonical
 * inventory; later steps attach parameter schemas and graph compilers.
 */
export type ProcessingScope =
  | 'source'
  | 'layer'
  | 'smart-filter'
  | 'adjustment-layer'
  | 'group'
  | 'document-creative'
  | 'document-output';

export type ProcessingDomain =
  | 'linear-rgb'
  | 'perceptual'
  | 'display-referred'
  | 'mask'
  | 'data';

export type ProcessingCoordinateSpace =
  | 'source'
  | 'layer'
  | 'group'
  | 'document';

export type ProcessingModuleCategory =
  | 'geometry'
  | 'tone'
  | 'color'
  | 'spatial'
  | 'lens'
  | 'output';

export type CurrentAdjustmentSettingsPath =
  | 'temperature'
  | 'tint'
  | 'exposureEV'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'lift'
  | 'texture'
  | 'clarity'
  | 'dehaze'
  | 'detail'
  | 'vibrance'
  | 'saturation'
  | 'colorMixer'
  | 'pointColor'
  | 'colorGrading'
  | 'blackWhiteMix'
  | 'gradeLook'
  | 'curves'
  | 'gradientMap'
  | 'photoshopAdjustment'
  | 'effects.grain'
  | 'effects.halation'
  | 'effects.chromaticAberration'
  | 'effects.lensDistortion'
  | 'effects.lensBlur'
  | 'effects.vignette';

export interface ProcessingModuleDefinition {
  type: string;
  label: string;
  category: ProcessingModuleCategory;
  settingsPaths: readonly CurrentAdjustmentSettingsPath[];
  allowedScopes: readonly ProcessingScope[];
  inputDomain: ProcessingDomain;
  outputDomain: ProcessingDomain;
  alphaBehavior: 'preserve' | 'generate' | 'modify' | 'consume-mask';
  coordinateSpace?: ProcessingCoordinateSpace;
  /** Photoshop semantic types that may get a verified adapter later. */
  psdCandidates?: readonly string[];
  notes?: string;
}

const CREATIVE_GRADE_SCOPES = [
  'layer',
  'adjustment-layer',
  'group',
  'document-creative'
] as const satisfies readonly ProcessingScope[];

export const CURRENT_PROCESSING_MODULES = [
  {
    type: 'lt.face-warp',
    label: 'Face Warp',
    category: 'geometry',
    settingsPaths: [],
    allowedScopes: ['layer', 'smart-filter'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'source',
    notes: 'Semantic face parameters compiled into the shared GPU deformation field.'
  },
  {
    type: 'lt.warp',
    label: 'Warp',
    category: 'geometry',
    settingsPaths: [],
    allowedScopes: ['layer', 'smart-filter'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'source',
    notes: 'Persistent inverse source-coordinate deformation in layer-local pixels.'
  },
  {
    type: 'lt.white-balance',
    label: 'Temperature / Tint',
    category: 'color',
    settingsPaths: ['temperature', 'tint'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['photo-filter', 'color-balance'],
    notes: 'A PSD adapter requires proven parameter and rendering equivalence.'
  },
  {
    type: 'lt.light',
    label: 'Light',
    category: 'tone',
    settingsPaths: [
      'exposureEV',
      'contrast',
      'highlights',
      'shadows',
      'whites',
      'blacks',
      'lift'
    ],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['exposure', 'brightness-contrast', 'levels'],
    notes: 'The compound Light module is native LightTable semantics.'
  },
  {
    type: 'lt.global-color',
    label: 'Color',
    category: 'color',
    settingsPaths: ['vibrance', 'saturation'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'perceptual',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['vibrance', 'hue-saturation']
  },
  {
    type: 'lt.grade-look',
    label: 'Look',
    category: 'color',
    settingsPaths: ['gradeLook'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'perceptual',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    notes: 'Native Grade creative .cube look and strength; shares assets and GPU sampling with Color Lookup without sharing Photoshop semantics.'
  },
  {
    type: 'lt.color-mixer',
    label: 'Color Mixer',
    category: 'color',
    settingsPaths: ['colorMixer', 'pointColor'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'perceptual',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['hue-saturation'],
    notes: 'Never export as PSD Hue/Saturation without a verified adapter.'
  },
  {
    type: 'lt.color-grading',
    label: 'Color Grading',
    category: 'color',
    settingsPaths: ['colorGrading'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'perceptual',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['color-balance']
  },
  {
    type: 'lt.black-white-mix',
    label: 'Black & White Mix',
    category: 'color',
    settingsPaths: ['blackWhiteMix'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'perceptual',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    notes: 'Native eight-range photographic B&W mix; intentionally distinct from Photoshop six-channel Black & White.'
  },
  {
    type: 'lt.curves',
    label: 'Curves',
    category: 'tone',
    settingsPaths: ['curves'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['curves']
  },
  {
    type: 'lt.gradient-map',
    label: 'Gradient Map',
    category: 'color',
    settingsPaths: ['gradientMap'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'display-referred',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: ['gradient-map'],
    notes: 'Maps Photoshop document luminance through an editable shared gradient.'
  },
  {
    type: 'lt.photoshop-adjustment',
    label: 'Photoshop Adjustment',
    category: 'color',
    settingsPaths: ['photoshopAdjustment'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'perceptual',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    psdCandidates: [
      'brightness-contrast', 'levels', 'exposure', 'vibrance', 'hue-saturation',
      'color-balance', 'black-white', 'photo-filter', 'channel-mixer',
      'color-lookup', 'selective-color', 'invert', 'posterize', 'threshold'
    ],
    notes: 'Dedicated authored payload; evaluated according to its stable family kind.'
  },
  {
    type: 'lt.local-contrast',
    label: 'Texture / Clarity / Dehaze',
    category: 'spatial',
    settingsPaths: ['texture', 'clarity', 'dehaze'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'document',
    notes: 'Coordinate space becomes scope-relative when the evaluator is extracted.'
  },
  {
    type: 'lt.detail',
    label: 'Detail',
    category: 'spatial',
    settingsPaths: ['detail'],
    allowedScopes: CREATIVE_GRADE_SCOPES,
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'document',
    notes: 'Conditional four-scale a-trous wavelet shrinkage for luminance/color noise; fine-detail sharpening remains fused into creative grade.'
  },
  {
    type: 'lt.lens-distortion',
    label: 'Lens Distortion',
    category: 'lens',
    settingsPaths: ['effects.lensDistortion'],
    allowedScopes: ['layer', 'adjustment-layer', 'smart-filter', 'document-creative'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'source',
    psdCandidates: ['smart-filter:lens-correction']
  },
  {
    type: 'lt.chromatic-aberration',
    label: 'Chromatic Aberration',
    category: 'lens',
    settingsPaths: ['effects.chromaticAberration'],
    allowedScopes: ['layer', 'adjustment-layer', 'smart-filter', 'document-creative'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'source',
    psdCandidates: ['smart-filter:lens-correction']
  },
  {
    type: 'lt.lens-blur',
    label: 'Lens Blur',
    category: 'lens',
    settingsPaths: ['effects.lensBlur'],
    allowedScopes: ['layer', 'adjustment-layer', 'smart-filter', 'group', 'document-creative'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'layer',
    psdCandidates: ['smart-filter:lens-blur']
  },
  {
    type: 'lt.halation',
    label: 'Halation',
    category: 'lens',
    settingsPaths: ['effects.halation'],
    allowedScopes: ['layer', 'adjustment-layer', 'smart-filter', 'group', 'document-creative'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'layer'
  },
  {
    type: 'lt.vignette',
    label: 'Post-crop Vignette',
    category: 'output',
    settingsPaths: ['effects.vignette'],
    allowedScopes: ['layer', 'adjustment-layer', 'smart-filter', 'group', 'document-creative', 'document-output'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve',
    coordinateSpace: 'document',
    notes: 'Ordered layer-capable vignette before display-post Grain.'
  },
  {
    type: 'lt.grain',
    label: 'Grain',
    category: 'output',
    settingsPaths: ['effects.grain'],
    allowedScopes: ['layer', 'adjustment-layer', 'smart-filter', 'group', 'document-creative', 'document-output'],
    inputDomain: 'display-referred',
    outputDomain: 'display-referred',
    alphaBehavior: 'preserve',
    coordinateSpace: 'document',
    notes: 'Layer-owned grain is evaluated at the end of its owner stack before compositing.'
  }
] as const satisfies readonly ProcessingModuleDefinition[];

export type CurrentProcessingModuleType = typeof CURRENT_PROCESSING_MODULES[number]['type'];

export const processingModuleDefinition = (type: CurrentProcessingModuleType) =>
  CURRENT_PROCESSING_MODULES.find((definition) => definition.type === type);
