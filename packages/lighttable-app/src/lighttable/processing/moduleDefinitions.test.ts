import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROCESSING_MODULES,
  type CurrentAdjustmentSettingsPath
} from './moduleDefinitions';

const EXPECTED_SETTINGS_PATHS = [
  'temperature',
  'tint',
  'exposureEV',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'lift',
  'texture',
  'clarity',
  'dehaze',
  'vibrance',
  'saturation',
  'colorMixer',
  'pointColor',
  'colorGrading',
  'curves',
  'gradientMap',
  'photoshopAdjustment',
  'effects.grain',
  'effects.halation',
  'effects.chromaticAberration',
  'effects.lensDistortion',
  'effects.lensBlur',
  'effects.vignette'
] as const satisfies readonly CurrentAdjustmentSettingsPath[];

describe('LightTable processing module inventory', () => {
  it('assigns every current adjustment setting to exactly one module', () => {
    const paths = CURRENT_PROCESSING_MODULES.flatMap((definition) => definition.settingsPaths);
    expect([...paths].sort()).toEqual([...EXPECTED_SETTINGS_PATHS].sort());
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('uses unique stable module type identifiers', () => {
    const types = CURRENT_PROCESSING_MODULES.map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('allows creative grade modules on layers and adjustment layers', () => {
    const creativeGrade = CURRENT_PROCESSING_MODULES.filter((definition) =>
      ['tone', 'color', 'spatial'].includes(definition.category)
    );
    creativeGrade.forEach((definition) => {
      expect(definition.allowedScopes).toContain('layer');
      expect(definition.allowedScopes).toContain('adjustment-layer');
    });
  });

  it('allows Lens Fx owners on layers and Adjustment Layers', () => {
    const lensFx = CURRENT_PROCESSING_MODULES.filter((definition) =>
      ['lens', 'output'].includes(definition.category)
      && definition.type !== 'lt.vignette'
    );
    lensFx.forEach((definition) => {
      expect(definition.allowedScopes).toContain('layer');
      expect(definition.allowedScopes).toContain('adjustment-layer');
    });
    const grain = CURRENT_PROCESSING_MODULES.find((definition) => definition.type === 'lt.grain');
    expect(grain?.inputDomain).toBe('display-referred');
    expect(grain?.allowedScopes).toContain('document-output');
    const vignette = CURRENT_PROCESSING_MODULES.find((definition) => definition.type === 'lt.vignette');
    expect(vignette?.category).toBe('output');
    expect(vignette?.allowedScopes).toEqual(['document-creative', 'document-output']);
  });
});
