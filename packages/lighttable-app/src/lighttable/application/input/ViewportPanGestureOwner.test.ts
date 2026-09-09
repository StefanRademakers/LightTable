import { describe, expect, it } from 'vitest';
import { ViewportPanGestureOwner } from './ViewportPanGestureOwner';

const begin = (owner: ViewportPanGestureOwner, patch: Partial<Parameters<typeof owner.begin>[0]> = {}) => owner.begin({
  pointerId: 7,
  button: 0,
  buttons: 1,
  initiator: 'view-tool',
  point: { x: 100, y: 80 },
  view: { panX: 12, panY: -4 },
  hasDocumentMetadata: true,
  competingGesture: false,
  owner: 'document-a',
  ...patch
});

describe('ViewportPanGestureOwner', () => {
  it('retains one pointer and its opening view across move frames', () => {
    const owner = new ViewportPanGestureOwner();
    expect(begin(owner)).toBe(true);
    expect(owner.move(7, { x: 125, y: 70 })).toEqual({
      owner: 'document-a',
      pan: { panX: 37, panY: -14 }
    });
    expect(owner.move(8, { x: 500, y: 500 })).toBeNull();
    expect(owner.finish(8)).toBe(false);
    expect(owner.finish(7)).toBe(true);
    expect(owner.active).toBe(false);
  });

  it('accepts middle-button pan independently from the selected tool modifiers', () => {
    const owner = new ViewportPanGestureOwner();
    expect(begin(owner, { button: 1, buttons: 4, initiator: 'middle-button' })).toBe(true);
    expect(owner.move(7, { x: 90, y: 100 })).toEqual({
      owner: 'document-a',
      pan: { panX: 2, panY: 16 }
    });
  });

  it('rejects mismatched buttons, absent metadata and competing gestures', () => {
    const owner = new ViewportPanGestureOwner();
    expect(begin(owner, { button: 1 })).toBe(false);
    expect(begin(owner, { initiator: 'middle-button' })).toBe(false);
    expect(begin(owner, { hasDocumentMetadata: false })).toBe(false);
    expect(begin(owner, { competingGesture: true })).toBe(false);
    expect(begin(owner, { button: 1, buttons: 5, initiator: 'middle-button' })).toBe(false);
    expect(begin(owner)).toBe(true);
    expect(begin(owner, { pointerId: 9 })).toBe(false);
  });

  it('cancels the retained gesture at a document or renderer boundary', () => {
    const owner = new ViewportPanGestureOwner();
    expect(begin(owner)).toBe(true);
    owner.cancel();
    expect(owner.move(7, { x: 120, y: 90 })).toBeNull();
  });

  it('returns the opening owner instead of adopting a later document owner', () => {
    const owner = new ViewportPanGestureOwner<string>();
    expect(begin(owner, { owner: 'document-a' })).toBe(true);
    expect(owner.move(7, { x: 110, y: 90 })?.owner).toBe('document-a');
  });
});
