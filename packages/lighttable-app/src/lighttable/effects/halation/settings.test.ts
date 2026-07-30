import { describe, expect, it } from 'vitest';
import { createDefaultHalationSettings, halationIsActive } from './settings';

describe('Halation settings', () => {
  it('is disabled by default and requires amount', () => {
    const settings = createDefaultHalationSettings();
    expect(settings.enabled).toBe(false);
    expect(halationIsActive(settings)).toBe(false);
    settings.enabled = true;
    expect(halationIsActive(settings)).toBe(true);
    settings.amount = 0;
    expect(halationIsActive(settings)).toBe(false);
  });
});
