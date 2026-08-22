import { describe, expect, it } from 'vitest';
import { createSvgImportIdFactory } from './svgImportIds';

describe('SVG import IDs', () => {
  it('uses one import namespace with monotonic IDs across geometry kinds', () => {
    const createId = createSvgImportIdFactory('fixture');
    expect(createId('element')).toBe('svg-element-fixture-1');
    expect(createId('subpath')).toBe('svg-subpath-fixture-2');
    expect(createId('anchor')).toBe('svg-anchor-fixture-3');
  });

  it('keeps separate import namespaces collision-free', () => {
    const first = createSvgImportIdFactory('first');
    const second = createSvgImportIdFactory('second');
    expect(first('anchor')).not.toBe(second('anchor'));
  });
});
