import { describe, expect, it } from 'vitest';
import { BRUSH_PRESETS, brushPresetChange, resolveBrushPreset } from './brushPresets';

describe('brush presets', () => {
  it('uses one unique, finite recipe for every preset', () => {
    expect(new Set(BRUSH_PRESETS.map(({ id }) => id)).size)
      .toBe(BRUSH_PRESETS.length);
    for (const preset of BRUSH_PRESETS) {
      expect(Object.values(preset.tip).every(Number.isFinite)).toBe(true);
      expect(Object.values(preset.defaults).every(Number.isFinite)).toBe(true);
    }
  });

  it('falls back to Round for unavailable persisted ids', () => {
    expect(resolveBrushPreset('missing').id).toBe('round');
  });

  it('routes Liquify through the existing non-destructive warp engine', () => {
    expect(resolveBrushPreset('liquify')).toMatchObject({
      category: 'Effects',
      engine: 'warp'
    });
  });

  it('keeps Blur on its dedicated raster scratch engine', () => {
    expect(resolveBrushPreset('blur')).toMatchObject({
      category: 'Effects',
      engine: 'blur'
    });
  });

  it('applies preset defaults as one tool-state change', () => {
    expect(brushPresetChange('calligraphy')).toMatchObject({
      presetId: 'calligraphy', hardness: 0.9, smooth: 0.6
    });
  });

  it('preserves the user-controlled size for every preset', () => {
    for (const preset of BRUSH_PRESETS) {
      const current = { size: 137, presetId: 'round' as const };
      const next = { ...current, ...brushPresetChange(preset.id) };

      expect(next.size).toBe(137);
      expect(next.presetId).toBe(preset.id);
    }
  });
});
