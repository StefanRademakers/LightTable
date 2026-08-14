import { describe, expect, it } from 'vitest';
import {
  effectiveSelectionMode,
  selectionFeatherPlan,
  selectionFeatherScale,
  selectionShapeBuffers
} from './SelectionRasterizer';

describe('selectionShapeBuffers', () => {
  it('packs rectangle bounds into the GPU contract', () => {
    const result = selectionShapeBuffers({
      kind: 'rectangle',
      points: [{ x: 12, y: 18 }, { x: 90, y: 72 }]
    }, 1920, 1080);
    expect(Array.from(result!.points)).toEqual([12, 18, 90, 72]);
    expect(Array.from(result!.settings)).toEqual([
      1920, 1080, 0, 2, 12, 18, 90, 72, 0, 0, 0, 0
    ]);
  });

  it('enables geometric supersampling in the GPU contract', () => {
    const result = selectionShapeBuffers({
      kind: 'free',
      points: [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 4, y: 7 }]
    }, 10, 10, true);
    expect(Array.from(result!.settings).slice(8)).toEqual([1, 0, 0, 0]);
  });

  it('rejects incomplete polygon paths', () => {
    expect(selectionShapeBuffers({
      kind: 'polygon',
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    }, 100, 100)).toBeNull();
  });
});

describe('selectionFeatherScale', () => {
  it('keeps small feathers at full resolution', () => {
    expect(selectionFeatherScale(0)).toBe(1);
    expect(selectionFeatherScale(32)).toBe(1);
  });

  it('bounds wide-feather working resolution without exceeding an 8x scale', () => {
    expect(selectionFeatherScale(64)).toBe(2);
    expect(selectionFeatherScale(128)).toBe(4);
    expect(selectionFeatherScale(250)).toBe(8);
  });
});

describe('selectionFeatherPlan', () => {
  it('keeps both blur axes in the same full-resolution working space', () => {
    expect(selectionFeatherPlan(24, 1920, 1080)).toEqual({
      scale: 1,
      workingWidth: 1920,
      workingHeight: 1080,
      workingRadius: 24
    });
  });

  it('scales wide feathers before either blur axis is evaluated', () => {
    expect(selectionFeatherPlan(96, 1920, 1080)).toEqual({
      scale: 3,
      workingWidth: 640,
      workingHeight: 360,
      workingRadius: 32
    });
  });

  it('clamps extreme authoring values to the supported radius', () => {
    expect(selectionFeatherPlan(500, 101, 51)).toEqual({
      scale: 8,
      workingWidth: 13,
      workingHeight: 7,
      workingRadius: 31.25
    });
  });
});

describe('effectiveSelectionMode', () => {
  it('starts a new selection as replace', () => {
    expect(effectiveSelectionMode(false, 'add')).toBe('replace');
  });

  it('does not subtract without an active selection', () => {
    expect(effectiveSelectionMode(false, 'subtract')).toBeNull();
  });

  it('keeps the requested mode for an active selection', () => {
    expect(effectiveSelectionMode(true, 'intersect')).toBe('intersect');
  });
});
