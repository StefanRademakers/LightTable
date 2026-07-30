import { describe, expect, it } from 'vitest';
import { chromaticAberrationIsActive, createDefaultChromaticAberrationSettings } from './settings';

describe('Chromatic Aberration settings', () => {
  it('has an exact opt-in bypass', () => {
    const settings = createDefaultChromaticAberrationSettings();
    expect(chromaticAberrationIsActive(settings)).toBe(false);
    settings.enabled = true;
    expect(chromaticAberrationIsActive(settings)).toBe(true);
    settings.amount = 0;
    expect(chromaticAberrationIsActive(settings)).toBe(false);
  });
});
