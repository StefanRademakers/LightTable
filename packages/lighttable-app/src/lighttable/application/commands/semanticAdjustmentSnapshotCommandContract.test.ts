import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { parseSemanticAdjustmentSnapshotCommand } from './semanticAdjustmentSnapshotCommandContract';

describe('semantic adjustment snapshot command contract', () => {
  it('accepts complete snapshots for every explicit owner kind', () => {
    const snapshot = createDefaultAdjustments();
    snapshot.photoshopAdjustment.kind = 'levels';
    snapshot.photoshopAdjustment.levels.rgb.input = [4, 1.2, 240];
    for (const target of [
      { kind: 'document', owner: 'grade' },
      { kind: 'document', owner: 'lens-fx' },
      { kind: 'layer', layerId: 'grade' },
      { kind: 'attached', layerId: 'photo', adjustmentId: 'levels' }
    ] as const) {
      expect(parseSemanticAdjustmentSnapshotCommand({ target, snapshot }))
        .toEqual({ target, snapshot });
    }
  });

  it('accepts Photoshop Natural curves as complete canonical state', () => {
    const snapshot = createDefaultAdjustments();
    snapshot.curves.interpolation = 'photoshop-natural';
    snapshot.curves.master = [{ x: 0, y: 0 }, { x: 0.4, y: 0.7 }, { x: 1, y: 1 }];
    expect(parseSemanticAdjustmentSnapshotCommand({
      target: { kind: 'layer', layerId: 'curves' }, snapshot
    })).toEqual({ target: { kind: 'layer', layerId: 'curves' }, snapshot });
  });

  it('rejects partial, unknown and invalid nested snapshots', () => {
    const valid = createDefaultAdjustments();
    for (const snapshot of [
      { exposureEV: 1 },
      { ...valid, privateState: true },
      { ...valid, exposureEV: Number.NaN },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment, kind: 'private-adjustment'
      } },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment, privateKernel: [1, 2, 3]
      } },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment,
        selectiveColorValues: Array.from({ length: 65 }, () => 0)
      } },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment, exposure: Number.POSITIVE_INFINITY
      } },
      { ...valid, exposureEV: 6 },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment, exposureGamma: -1
      } },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment, posterizeLevels: 2.5
      } },
      { ...valid, photoshopAdjustment: {
        ...valid.photoshopAdjustment, thresholdLevel: 999_999
      } },
      { ...valid, effects: {
        ...valid.effects,
        lensBlur: { ...valid.effects.lensBlur, apertureSize: -1 }
      } }
    ]) {
      expect(parseSemanticAdjustmentSnapshotCommand({
        target: { kind: 'document', owner: 'grade' }, snapshot
      })).toHaveProperty('message');
    }
  });
});
