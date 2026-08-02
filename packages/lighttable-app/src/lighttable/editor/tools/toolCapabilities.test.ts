import { describe, expect, it } from 'vitest';
import {
  BRUSH_SIZE_STEPS,
  isPaintTool,
  isSelectionTool,
  selectionKindForTool,
  steppedBrushSize,
  usesBrushSize
} from './toolCapabilities';

describe('tool capabilities', () => {
  it('steps brush sizes through the shared editor scale', () => {
    expect(steppedBrushSize(10, 1)).toBe(15);
    expect(steppedBrushSize(15, -1)).toBe(10);
    expect(steppedBrushSize(12, 1)).toBe(15);
    expect(steppedBrushSize(12, -1)).toBe(10);
  });

  it('clamps brush stepping at both limits', () => {
    expect(steppedBrushSize(-10, -1)).toBe(BRUSH_SIZE_STEPS[0]);
    expect(steppedBrushSize(10_000, 1)).toBe(BRUSH_SIZE_STEPS.at(-1));
  });

  it('classifies paint and selection tools explicitly', () => {
    expect(isPaintTool('brush')).toBe(true);
    expect(isPaintTool('erase')).toBe(true);
    expect(isPaintTool('view')).toBe(false);
    expect(usesBrushSize('brush')).toBe(true);
    expect(usesBrushSize('erase')).toBe(true);
    expect(usesBrushSize('warp')).toBe(true);
    expect(usesBrushSize('view')).toBe(false);
    expect(isSelectionTool('select-rectangle')).toBe(true);
    expect(isSelectionTool('select-ellipse')).toBe(true);
    expect(isSelectionTool('select-horizontal')).toBe(true);
    expect(isSelectionTool('select-vertical')).toBe(true);
    expect(isSelectionTool('select-free')).toBe(true);
    expect(isSelectionTool('select-polygonal')).toBe(true);
    expect(isSelectionTool('transform')).toBe(false);
  });

  it('maps every selection tool to its document shape', () => {
    expect(selectionKindForTool('select-rectangle')).toBe('rectangle');
    expect(selectionKindForTool('select-ellipse')).toBe('ellipse');
    expect(selectionKindForTool('select-horizontal')).toBe('rectangle');
    expect(selectionKindForTool('select-vertical')).toBe('rectangle');
    expect(selectionKindForTool('select-free')).toBe('free');
    expect(selectionKindForTool('select-polygonal')).toBe('polygon');
  });
});
