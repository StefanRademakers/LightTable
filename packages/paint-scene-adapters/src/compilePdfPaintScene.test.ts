import { describe, expect, it } from 'vitest';
import { compilePdfPaintScene } from './compilePdfPaintScene';
import type { PdfPagePaintSnapshot, PdfPageScene } from '@lighttable/pdf-core';

const paintState = (): PdfPagePaintSnapshot => ({
  fillPaint: { kind: 'device-rgb', r: 1, g: 0.5, b: 0 },
  strokePaint: { kind: 'device-gray', gray: 0.25 },
  stroke: { width: 2, cap: 'round', join: 'bevel', miterLimit: 4, dash: [3, 2], dashPhase: 1 },
  fillAlpha: 0.75, strokeAlpha: 0.5, blendMode: 'normal', clips: [],
  softMaskResourceId: null, transparencyGroups: []
});

const page = (): PdfPageScene => ({
  pageIndex: 0, sourceObjectId: 'page-object',
  mediaBox: { x: 0, y: 0, width: 100, height: 100 },
  cropBox: { x: 0, y: 0, width: 100, height: 100 }, rotation: 0, userUnit: 1,
  preservedUnsupported: [],
  items: [{
    kind: 'path', sourceObjectId: 'path-object', paint: 'fill-stroke', fillRule: 'evenodd',
    localToPage: [1, 0, 0, 1, 4, 5], paintState: paintState(),
    path: { commands: [
      { kind: 'move', point: { x: 1, y: 2 } },
      { kind: 'cubic', control1: { x: 2, y: 3 }, control2: { x: 4, y: 5 }, point: { x: 6, y: 7 } },
      { kind: 'close' }
    ] }
  }]
});

describe('compilePdfPaintScene', () => {
  it('maps the exact device-color path subset without flattening curves', () => {
    const result = compilePdfPaintScene(page(), { sourceRevision: 'sha256' });
    expect(result.status).toBe('ready');
    expect(result.scene.fragments[0].commands).toEqual([
      expect.objectContaining({ kind: 'fill-path', paint: { kind: 'solid', color: [1, 0.5, 0, 0.75] }, transform: [1, 0, 0, 1, 4, 5] }),
      expect.objectContaining({ kind: 'stroke-path', paint: { kind: 'solid', color: [0.25, 0.25, 0.25, 0.5] }, stroke: expect.objectContaining({ dashOffset: 1 }) })
    ]);
    expect(result.scene.fragments[0].paths[0].commands[1]).toEqual({
      kind: 'cubic', control1X: 2, control1Y: 3, control2X: 4, control2Y: 5, x: 6, y: 7
    });
  });

  it('does not silently render unclipped or color-reduced PDF content', () => {
    const value = page();
    const item = value.items[0];
    if (item.kind !== 'path') throw new Error('fixture');
    const clippedPage: PdfPageScene = {
      ...value,
      items: [{
        ...item,
        paintState: {
          ...item.paintState,
          fillPaint: { kind: 'device-cmyk', c: 0, m: 1, y: 1, k: 0 },
          clips: [{
            kind: 'path', fillRule: 'nonzero', localToPage: [1, 0, 0, 1, 0, 0],
            path: { commands: [{ kind: 'move', point: { x: 0, y: 0 } }, { kind: 'close' }] }
          }]
        }
      }]
    };
    const result = compilePdfPaintScene(clippedPage, { sourceRevision: 'sha256' });
    expect(result.status).toBe('unsupported');
    expect(result.issues).toEqual([expect.objectContaining({ feature: 'clip' })]);
    expect(result.scene.fragments[0].commands).toHaveLength(0);
  });
});
