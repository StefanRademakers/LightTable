import { createDefaultFlowTextSource, type RealizedTextLayout } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { projectCurrentTextPaint } from './currentTextPaint';

describe('current text paint projection', () => {
  it('rebinds flow paint while sharing realized geometry', () => {
    const source = createDefaultFlowTextSource('x');
    const geometry = new Float32Array([0, 0, 10, 0]);
    const layout = {
      key: 'layout',
      glyphRuns: [{
        fontResolution: { kind: 'flow-exact', sourceRunIndex: 0 },
        paint: { fill: source.styleRuns[0].fill },
        renderingMode: 'fill',
        glyphIds: new Uint32Array([1]),
        clusters: new Uint32Array([0]),
        geometry
      }]
    } as unknown as RealizedTextLayout;
    const fill = { kind: 'solid' as const, color: {
      colorSpace: 'srgb' as const, r: 1, g: 0.25, b: 0, a: 0.5
    } };
    const projected = projectCurrentTextPaint(layout, {
      ...source,
      styleRuns: [{ ...source.styleRuns[0], fill }]
    });
    expect(projected).not.toBe(layout);
    expect(projected.glyphRuns[0].paint.fill).toBe(fill);
    expect(projected.glyphRuns[0].geometry.buffer).toBe(geometry.buffer);
    expect(projected.key).toBe(layout.key);
  });

  it('splits cached geometry by current paint ranges without reshaping or copying buffers', () => {
    const source = createDefaultFlowTextSource('abc');
    const geometry = new Float32Array([
      0, 0, 10, 0, 10, 0, 10, 0, 20, 0, 10, 0
    ]);
    const glyphIds = new Uint32Array([1, 2, 3]);
    const clusters = new Uint32Array([0, 1, 2]);
    const layout = { key: 'layout', glyphRuns: [{
      fontResolution: { kind: 'flow-exact', sourceRunIndex: 0 },
      paint: { fill: source.styleRuns[0].fill }, renderingMode: 'fill',
      glyphIds, clusters, geometry
    }] } as unknown as RealizedTextLayout;
    const red = { kind: 'solid' as const, color: {
      colorSpace: 'srgb' as const, r: 1, g: 0, b: 0, a: 1
    } };
    const projected = projectCurrentTextPaint(layout, {
      ...source,
      styleRuns: [
        { ...source.styleRuns[0], start: 0, end: 1 },
        { ...source.styleRuns[0], start: 1, end: 2, fill: red },
        { ...source.styleRuns[0], start: 2, end: 3 }
      ]
    });
    expect(projected.glyphRuns).toHaveLength(3);
    expect(projected.glyphRuns[1].paint.fill).toBe(red);
    expect(projected.glyphRuns[1].glyphIds[0]).toBe(2);
    expect(projected.glyphRuns[1].geometry.buffer).toBe(geometry.buffer);
    expect(projected.glyphRuns[0].glyphIds.buffer).toBe(glyphIds.buffer);
  });

  it('projects semantic no-fill as stroke-only or invisible without reshaping', () => {
    const source = createDefaultFlowTextSource('x');
    const geometry = new Float32Array([0, 0, 10, 0]);
    const layout = { key: 'layout', glyphRuns: [{
      fontResolution: { kind: 'flow-exact', sourceRunIndex: 0 },
      paint: { fill: source.styleRuns[0].fill }, renderingMode: 'fill',
      glyphIds: new Uint32Array([1]), clusters: new Uint32Array([0]), geometry
    }] } as unknown as RealizedTextLayout;
    const { fill: _fill, ...withoutFill } = source.styleRuns[0];
    const stroke = {
      paint: source.styleRuns[0].fill!, width: 2,
      cap: 'butt' as const, join: 'miter' as const, miterLimit: 4
    };
    const stroked = projectCurrentTextPaint(layout, {
      ...source, styleRuns: [{ ...withoutFill, stroke }]
    });
    expect(stroked.glyphRuns[0]).toMatchObject({
      renderingMode: 'stroke', paint: { stroke }
    });
    expect(stroked.glyphRuns[0].paint.fill).toBeUndefined();
    expect(stroked.glyphRuns[0].geometry.buffer).toBe(geometry.buffer);
    const invisible = projectCurrentTextPaint(layout, {
      ...source, styleRuns: [withoutFill]
    });
    expect(invisible.glyphRuns[0]).toMatchObject({ renderingMode: 'invisible', paint: {} });
  });
});
