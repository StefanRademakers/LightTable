import { describe, expect, it } from 'vitest';
import type { BezierPath } from 'ag-psd';
import { importPsdVectorShape } from './psdVectorShapeAdapter';

const knot = (x: number, y: number, linked = false) => ({
  linked,
  points: [x, y, x, y, x, y]
});

const path = (open = false, fillRule: BezierPath['fillRule'] = 'non-zero'): BezierPath => ({
  open,
  fillRule,
  operation: 'combine',
  knots: open
    ? [knot(2, 3), knot(12, 13)]
    : [knot(2, 3), knot(12, 3), knot(12, 13)]
});

const source = (paths: BezierPath[]) => ({
  name: 'Photoshop Shape',
  vectorFill: { type: 'color', color: { r: 255, g: 128, b: 0 } },
  vectorMask: { paths },
  vectorStroke: null
});

describe('importPsdVectorShape', () => {
  it('maps a solid Photoshop Bezier shape to editable linear-light vector geometry', () => {
    const result = importPsdVectorShape(source([path()]));

    expect(result.status).toBe('native');
    if (result.status !== 'native') throw new Error(result.reason);
    expect(result.elements).toHaveLength(1);
    const element = result.elements[0];
    expect(element.type).toBe('path');
    if (element.type !== 'path') throw new Error('Expected an editable vector path');
    expect(element.subpaths[0]).toMatchObject({ closed: true });
    expect(element.subpaths[0]?.anchors[0]?.position).toEqual({ x: 2, y: 3 });
    expect(element.style.fill).toMatchObject({
      type: 'solid',
      color: [1, expect.closeTo(0.21586, 4), 0, 1]
    });
  });

  it('keeps open stroke geometry separate from closed fill geometry', () => {
    const result = importPsdVectorShape({
      ...source([path(false), path(true)]),
      vectorStroke: {
        strokeEnabled: true,
        fillEnabled: true,
        lineWidth: { units: 'Pixels', value: 3 },
        lineAlignment: 'center',
        content: { type: 'color', color: { r: 0, g: 0, b: 255 } }
      }
    });

    expect(result.status).toBe('native');
    if (result.status !== 'native') throw new Error(result.reason);
    expect(result.elements).toHaveLength(2);
    const closed = result.elements.find((element) =>
      element.type === 'path' && element.subpaths[0]?.closed);
    const open = result.elements.find((element) =>
      element.type === 'path' && !element.subpaths[0]?.closed);
    expect(closed?.style.fill).not.toBeNull();
    expect(open?.style.fill).toBeNull();
    expect(open?.style.stroke?.width).toBe(3);
  });

  it('preserves normalized Photoshop stroke opacity', () => {
    const result = importPsdVectorShape({
      ...source([path()]),
      vectorStroke: {
        strokeEnabled: true,
        fillEnabled: false,
        lineWidth: { units: 'Pixels', value: 10 },
        lineAlignment: 'center',
        opacity: 1,
        content: { type: 'color', color: { r: 255, g: 0, b: 0 } }
      }
    });

    expect(result.status).toBe('native');
    if (result.status !== 'native') throw new Error(result.reason);
    expect(result.elements[0]?.style).toMatchObject({
      fill: null,
      opacity: 1,
      stroke: { width: 10 }
    });
  });

  it.each(['inside', 'center', 'outside'] as const)(
    'imports Photoshop %s stroke alignment as native vector semantics',
    (lineAlignment) => {
      const result = importPsdVectorShape({
        ...source([path()]),
        vectorStroke: {
          strokeEnabled: true,
          fillEnabled: false,
          lineWidth: { units: 'Pixels', value: 10 },
          lineAlignment,
          content: { type: 'color', color: { r: 255, g: 0, b: 0 } }
        }
      });

      expect(result.status).toBe('native');
      if (result.status !== 'native') throw new Error(result.reason);
      expect(result.elements[0]?.style.stroke?.alignment).toBe(lineAlignment);
    }
  );

  it('scopes editable identities to the Photoshop source layer', () => {
    const first = importPsdVectorShape({ ...source([path()]), sourceObjectId: 'layer-a' });
    const second = importPsdVectorShape({ ...source([path()]), sourceObjectId: 'layer-b' });
    expect(first.status).toBe('native');
    expect(second.status).toBe('native');
    if (first.status !== 'native' || second.status !== 'native') throw new Error('Expected vectors');
    expect(first.elements[0]?.id).toBe('layer-a-vector-0');
    expect(second.elements[0]?.id).toBe('layer-b-vector-0');
    expect(first.elements[0]?.id).not.toBe(second.elements[0]?.id);
  });

  it('routes unsupported Photoshop boolean and gradient semantics to fallback', () => {
    const subtract = path();
    subtract.operation = 'subtract';
    expect(importPsdVectorShape(source([subtract]))).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('Subtract')
    });
    expect(importPsdVectorShape({
      ...source([path()]),
      vectorFill: { type: 'solid', gradient: {} }
    })).toMatchObject({
      status: 'unsupported',
      reason: expect.stringContaining('Gradient')
    });
  });
});
