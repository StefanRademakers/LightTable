import { describe, expect, it } from 'vitest';
import {
  P0_FILTER_DEFINITIONS,
  defaultP0FilterSettings,
  normalizeP0FilterSettings
} from './p0FilterCatalog';

describe('P0 filter catalog', () => {
  it('defines every P0 filter once with stable module identity', () => {
    expect(P0_FILTER_DEFINITIONS).toHaveLength(12);
    expect(new Set(P0_FILTER_DEFINITIONS.map(({ kind }) => kind)).size).toBe(12);
    expect(new Set(P0_FILTER_DEFINITIONS.map(({ moduleType }) => moduleType)).size).toBe(12);
    expect(P0_FILTER_DEFINITIONS.every(({ moduleType, kind }) => moduleType === `lt.${kind}`)).toBe(true);
  });

  it('normalizes hostile and non-finite serialized settings', () => {
    expect(normalizeP0FilterSettings('gaussian-blur', { radius: Infinity })).toEqual({ radius: 8 });
    expect(normalizeP0FilterSettings('motion-blur', { angle: 900, distance: -5 }))
      .toEqual({ angle: 180, distance: 0 });
    expect(normalizeP0FilterSettings('displace', { edgeMode: 'network', mapAssetId: '' }))
      .toMatchObject({ edgeMode: 'clamp', mapAssetId: null });
    expect(normalizeP0FilterSettings('maximum', { radius: 2.7, shape: 'circle' }))
      .toEqual({ radius: 3, shape: 'round' });
  });

  it('returns independent normalized defaults', () => {
    const first = defaultP0FilterSettings('reduce-noise');
    const second = defaultP0FilterSettings('reduce-noise');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
