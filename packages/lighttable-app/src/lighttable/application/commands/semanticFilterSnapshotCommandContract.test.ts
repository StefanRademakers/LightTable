import { describe, expect, it } from 'vitest';
import { defaultFilterSettings } from '@lighttable/filter-core';
import { parseSemanticFilterSnapshotCommand } from './semanticFilterSnapshotCommandContract';

describe('semantic filter snapshot command', () => {
  it('accepts exact layer and attached targets', () => {
    const snapshot = {
      kind: 'gaussian-blur', enabled: true, settings: defaultFilterSettings('gaussian-blur')
    };
    expect(parseSemanticFilterSnapshotCommand({
      target: { kind: 'layer', layerId: 'layer' }, snapshot
    })).toMatchObject({ target: { kind: 'layer' }, snapshot });
    expect(parseSemanticFilterSnapshotCommand({
      target: { kind: 'attached', layerId: 'layer', adjustmentId: 'filter' }, snapshot
    })).toMatchObject({ target: { kind: 'attached' }, snapshot });
  });

  it('rejects mixed targets and partial snapshots', () => {
    expect(parseSemanticFilterSnapshotCommand({
      target: { kind: 'layer', layerId: 'layer', adjustmentId: 'filter' },
      snapshot: { kind: 'gaussian-blur', enabled: true, settings: { radius: 8 } }
    })).toHaveProperty('message');
    expect(parseSemanticFilterSnapshotCommand({
      target: { kind: 'layer', layerId: 'layer' },
      snapshot: { kind: 'motion-blur', enabled: true, settings: { distance: 10 } }
    })).toHaveProperty('message');
  });
});
