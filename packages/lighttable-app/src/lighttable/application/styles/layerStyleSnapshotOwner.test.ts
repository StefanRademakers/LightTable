import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { addLayerStyleFixture } from '../../editor/styles/layerStyleTestFixtures';
import { applyLayerStyleSnapshot, projectLayerStylePreview } from './layerStyleSnapshotOwner';
import { layerStyleSnapshot } from './completeLayerStyleSnapshot';

const fixture = () => {
  let document = createRasterLayer(createImageDocument('Styles', 32, 32, 'source'));
  const layerId = document.activeLayerId!;
  document = addLayerStyleFixture(document, layerId, 'drop-shadow');
  return { document, layerId };
};

describe('Layer Style snapshot owner', () => {
  it('shares an immutable draft only with disposable preview and materializes canonical state once', () => {
    const { document, layerId } = fixture();
    const owner = findDocumentLayer(document, layerId)!;
    const draft = {
      ...owner.styleStack,
      effects: owner.styleStack.effects.map((effect) => ({ ...effect, opacity: 0.25 }))
    };

    const preview = projectLayerStylePreview(document, layerId, draft, 7);
    expect(findDocumentLayer(preview, layerId)!.styleStack.effects).toBe(draft.effects);
    expect(findDocumentLayer(document, layerId)!.styleStack).toBe(owner.styleStack);

    const committed = applyLayerStyleSnapshot(document, layerId, layerStyleSnapshot(draft));
    const committedStack = findDocumentLayer(committed, layerId)!.styleStack;
    expect(committedStack).not.toBe(draft);
    expect(committedStack.revision).toBe(owner.styleStack.revision + 1);
    expect(committedStack.effects[0]).toMatchObject({ opacity: 0.25 });
  });

  it('rejects malformed terminal snapshots instead of publishing them', () => {
    const { document, layerId } = fixture();
    expect(() => applyLayerStyleSnapshot(document, layerId, {
      ...layerStyleSnapshot(findDocumentLayer(document, layerId)!.styleStack),
      scale: Number.NaN
    })).toThrow(/canonical bounds/i);
  });
});
