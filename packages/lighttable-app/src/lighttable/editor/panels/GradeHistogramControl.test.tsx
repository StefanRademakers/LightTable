import { describe, expect, it } from 'vitest';
import {
  gradeHistogramControlForPosition,
  gradeHistogramDragValue
} from './GradeHistogramControl';

describe('GradeHistogramControl', () => {
  it('maps the tonal surface from blacks through whites', () => {
    expect(gradeHistogramControlForPosition(0)).toBe('blacks');
    expect(gradeHistogramControlForPosition(0.21)).toBe('shadows');
    expect(gradeHistogramControlForPosition(0.5)).toBe('exposureEV');
    expect(gradeHistogramControlForPosition(0.65)).toBe('highlights');
    expect(gradeHistogramControlForPosition(0.99)).toBe('whites');
  });

  it('uses photographic exposure scale and clamps all edits', () => {
    expect(gradeHistogramDragValue('exposureEV', 0, 0.2)).toBe(1);
    expect(gradeHistogramDragValue('exposureEV', 4.5, 1)).toBe(5);
    expect(gradeHistogramDragValue('shadows', 0, -0.25)).toBe(-50);
    expect(gradeHistogramDragValue('whites', 80, 0.5)).toBe(100);
  });
});
