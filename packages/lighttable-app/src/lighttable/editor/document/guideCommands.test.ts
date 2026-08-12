import { describe, expect, it } from 'vitest';
import { createImageDocument } from './documentTypes';
import { addDocumentGuide, clearDocumentGuides, removeDocumentGuide, updateDocumentGuide } from './guideCommands';

describe('document guide commands', () => {
  it('adds, moves, flips and removes a persisted guide immutably', () => {
    const source = createImageDocument('Guides', 200, 100, 'asset');
    const added = addDocumentGuide(source, { id: 'g', orientation: 'vertical', position: 40 });
    expect(source.guides).toEqual([]);
    expect(added.guides).toEqual([{ id: 'g', orientation: 'vertical', position: 40 }]);
    const moved = updateDocumentGuide(added, 'g', { orientation: 'horizontal', position: 55 });
    expect(moved.guides[0]).toEqual({ id: 'g', orientation: 'horizontal', position: 55 });
    expect(removeDocumentGuide(moved, 'g').guides).toEqual([]);
  });

  it('clears all guides with one document revision', () => {
    const source = createImageDocument('Guides', 200, 100, 'asset');
    source.guides = [
      { id: 'a', orientation: 'vertical', position: 10 },
      { id: 'b', orientation: 'horizontal', position: 20 }
    ];
    const cleared = clearDocumentGuides(source);
    expect(cleared.guides).toEqual([]);
    expect(cleared.revision).toBe(source.revision + 1);
  });
});
