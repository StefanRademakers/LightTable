import { describe, expect, it } from 'vitest';
import {
  createDefaultVignetteSettings,
  vignetteIsActive
} from './settings';

describe('post-crop Vignette settings', () => {
  it('is an exact bypass until both enabled and authored', () => {
    const settings = createDefaultVignetteSettings();
    expect(vignetteIsActive(settings)).toBe(false);
    settings.enabled = true;
    expect(vignetteIsActive(settings)).toBe(false);
    settings.amount = -1;
    expect(vignetteIsActive(settings)).toBe(true);
    settings.enabled = false;
    expect(vignetteIsActive(settings)).toBe(false);
  });
});
