import { describe, expect, it } from 'vitest';
import { adjustmentTargetIsPresented } from './adjustmentTargetIsPresented';
import type { LayerId } from '../../editor/document/documentTypes';

describe('adjustment target presentation identity', () => {
  it('does not confuse a parent layer with any of its subtargets', () => {
    const photo = 'photo' as LayerId;
    const target = { kind: 'layer', layerId: photo } as const;
    expect(adjustmentTargetIsPresented(target, { kind: 'layer', layerId: photo })).toBe(true);
    expect(adjustmentTargetIsPresented(target, {
      kind: 'processing', layerId: photo, owner: 'grade'
    })).toBe(true);
    expect(adjustmentTargetIsPresented(target, {
      kind: 'attached-processing', layerId: photo, adjustmentId: 'levels'
    })).toBe(false);
    expect(adjustmentTargetIsPresented(target, { kind: 'mask', layerId: photo })).toBe(false);
    expect(adjustmentTargetIsPresented(target, { kind: 'style-stack', layerId: photo })).toBe(false);
  });

  it('matches document and attached owners by their complete canonical identity', () => {
    const photo = 'photo' as LayerId;
    expect(adjustmentTargetIsPresented(
      { kind: 'document', owner: 'grade' }, { kind: 'document-processing', owner: 'lens-fx' }
    )).toBe(false);
    expect(adjustmentTargetIsPresented(
      { kind: 'attached', layerId: photo, adjustmentId: 'levels' },
      { kind: 'attached-processing', layerId: photo, adjustmentId: 'exposure' }
    )).toBe(false);
  });
});
