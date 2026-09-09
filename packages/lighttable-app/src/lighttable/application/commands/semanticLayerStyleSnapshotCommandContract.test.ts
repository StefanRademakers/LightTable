import { describe, expect, it } from 'vitest';
import { createDefaultLayerStyleStack } from '../../editor/styles/layerStyleDefaults';
import { layerStyleSnapshot } from '../styles/completeLayerStyleSnapshot';
import { parseSemanticLayerStyleSnapshotCommand } from './semanticLayerStyleSnapshotCommandContract';

describe('semantic Layer Style snapshot contract', () => {
  it('accepts only an exact complete stack', () => {
    const snapshot = layerStyleSnapshot(createDefaultLayerStyleStack());
    expect(parseSemanticLayerStyleSnapshotCommand({ layerId: 'layer', snapshot }))
      .toEqual({ layerId: 'layer', snapshot });
    expect(parseSemanticLayerStyleSnapshotCommand({ layerId: 'layer', snapshot, preview: true }))
      .toHaveProperty('message');
    expect(parseSemanticLayerStyleSnapshotCommand({
      layerId: 'layer', snapshot: { ...snapshot, revision: 1 }
    })).toHaveProperty('message');
  });
});
