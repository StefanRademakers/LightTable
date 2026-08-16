import { describe, expect, it } from 'vitest';
import { isUiInspectionGesture } from './uiInspection';

describe('UI inspection gesture', () => {
  it('requires alt, shift and either platform command modifier', () => {
    expect(isUiInspectionGesture({ altKey: true, shiftKey: true, ctrlKey: true, metaKey: false })).toBe(true);
    expect(isUiInspectionGesture({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isUiInspectionGesture({ altKey: true, shiftKey: false, ctrlKey: true, metaKey: false })).toBe(false);
    expect(isUiInspectionGesture({ altKey: false, shiftKey: true, ctrlKey: true, metaKey: false })).toBe(false);
  });
});
