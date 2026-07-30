import { describe, expect, it } from 'vitest';
import { createDefaultGrainSettings, grainIsActive } from './settings';

describe('Grain settings', () => {
  it('is opt-in even though useful tuning defaults are preserved', () => {
    const settings = createDefaultGrainSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.amount).toBeGreaterThan(0);
    expect(grainIsActive(settings)).toBe(false);
  });

  it('bypasses at zero amount after being enabled', () => {
    const settings = createDefaultGrainSettings();
    settings.enabled = true;
    settings.amount = 0;
    expect(grainIsActive(settings)).toBe(false);
  });
});
