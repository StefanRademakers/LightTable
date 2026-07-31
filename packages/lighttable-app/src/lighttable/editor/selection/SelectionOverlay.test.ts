import { describe, expect, it } from 'vitest';
import { isDirectVectorSelection } from './SelectionOverlay';
import type { SelectionOperation } from './selectionTypes';

const rectangle: SelectionOperation = {
  mode: 'replace',
  shape: {
    kind: 'rectangle',
    points: [{ x: 10, y: 20 }, { x: 110, y: 120 }]
  }
};

describe('isDirectVectorSelection', () => {
  it('keeps a single committed shape on the cheap vector overlay path', () => {
    expect(isDirectVectorSelection([rectangle])).toBe(true);
  });

  it('keeps composite and feathered selections on the mask path', () => {
    expect(isDirectVectorSelection([
      rectangle,
      { ...rectangle, mode: 'add' }
    ])).toBe(false);
    expect(isDirectVectorSelection([{
      ...rectangle,
      mode: 'feather',
      amount: 8
    }])).toBe(false);
  });
});
