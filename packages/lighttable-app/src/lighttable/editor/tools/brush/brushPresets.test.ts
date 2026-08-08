import { describe, expect, it } from 'vitest';
import { BASIC_BRUSH_PRESETS, brushPresetChange, resolveBrushPreset } from './brushPresets';

describe('brush presets', () => {
  it('uses one unique, finite recipe for every Basic preset', () => {
    expect(new Set(BASIC_BRUSH_PRESETS.map(({ id }) => id)).size)
      .toBe(BASIC_BRUSH_PRESETS.length);
    for (const preset of BASIC_BRUSH_PRESETS) {
      expect(Object.values(preset.tip).every(Number.isFinite)).toBe(true);
      expect(Object.values(preset.defaults).every(Number.isFinite)).toBe(true);
    }
  });

  it('falls back to Round for unavailable persisted ids', () => {
    expect(resolveBrushPreset('missing').id).toBe('round');
  });

  it('applies preset defaults as one tool-state change', () => {
    expect(brushPresetChange('calligraphy')).toMatchObject({
      presetId: 'calligraphy', hardness: 0.9, smooth: 0.6
    });
  });

  it('preserves the user-controlled size for every preset', () => {
    for (const preset of BASIC_BRUSH_PRESETS) {
      const current = { size: 137, presetId: 'round' as const };
      const next = { ...current, ...brushPresetChange(preset.id) };

      expect(next.size).toBe(137);
      expect(next.presetId).toBe(preset.id);
    }
  });
});
