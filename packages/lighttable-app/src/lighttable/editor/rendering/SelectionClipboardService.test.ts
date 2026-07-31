import { describe, expect, it } from 'vitest';
import { selectionClipboardCrop } from './SelectionClipboardService';

describe('selectionClipboardCrop', () => {
  it('rounds outward and clips a selection to the document', () => {
    expect(selectionClipboardCrop(
      { x: -2.4, y: 3.2, width: 12.6, height: 9.1 },
      10,
      10
    )).toEqual({ x: 0, y: 3, width: 10, height: 7 });
  });

  it('keeps an empty out-of-canvas crop valid for GPU allocation', () => {
    expect(selectionClipboardCrop(
      { x: 20, y: 20, width: 0, height: 0 },
      10,
      10
    )).toEqual({ x: 20, y: 20, width: 1, height: 1 });
  });
});
