import { describe, expect, it } from 'vitest';
import { measureRoundedElementSize } from './useEditorResizeController';

describe('measureRoundedElementSize', () => {
  it('rounds sub-pixel layout bounds to stable canvas dimensions', () => {
    expect(measureRoundedElementSize({ width: 250.49, height: 600.51 })).toEqual({
      width: 250,
      height: 601
    });
  });

  it('never publishes a zero-sized rendering surface', () => {
    expect(measureRoundedElementSize({ width: 0, height: -4 })).toEqual({
      width: 1,
      height: 1
    });
  });
});
