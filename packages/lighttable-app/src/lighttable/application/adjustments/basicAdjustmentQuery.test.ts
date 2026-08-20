import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { projectBasicAdjustmentValues } from './basicAdjustmentQuery';

describe('basic adjustment query projection', () => {
  it('returns only the 14 supported numeric controls', () => {
    const values = projectBasicAdjustmentValues({
      ...createDefaultAdjustments(), exposureEV: 0.5, temperature: -20, vibrance: 15
    });
    expect(values).toMatchObject({ exposureEV: 0.5, temperature: -20, vibrance: 15 });
    expect(Object.keys(values)).toHaveLength(14);
    expect(values).not.toHaveProperty('curves');
    expect(values).not.toHaveProperty('effects');
  });
});
