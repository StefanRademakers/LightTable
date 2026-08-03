import { describe, expect, it } from 'vitest';
import {
  importPdfPageScene,
  multiplyPdfMatrices,
  type PdfPageDisplayList,
  type PdfPositionedTextRun
} from './index';

const glyphRun: PdfPositionedTextRun = {
  fontResourceId: 'font:1', fontSize: 18, textMatrix: [1, 0, 0, 1, 0, 0],
  characterSpacing: 0, wordSpacing: 0, horizontalScale: 100, rise: 0,
  renderingMode: 6,
  glyphs: [{
    sourceCode: [65], cid: 65, glyphId: 36, unicode: 'A', unicodeConfidence: 'to-unicode',
    origin: { x: 12, y: 30 }, advance: { x: 10, y: 0 },
    glyphMatrix: [18, 0, 0, 18, 12, 30]
  }]
};

const page: PdfPageDisplayList = {
  pageIndex: 0,
  sourceObjectId: '3 0 R',
  mediaBox: { x: 0, y: 0, width: 200, height: 100 },
  cropBox: { x: 0, y: 0, width: 200, height: 100 },
  rotation: 0,
  userUnit: 1,
  operations: [
    { kind: 'save-state' },
    { kind: 'concat-transform', matrix: [2, 0, 0, 2, 10, 20] },
    { kind: 'set-fill-paint', paint: { kind: 'device-rgb', r: 1, g: 0, b: 0 } },
    { kind: 'set-stroke-paint', paint: { kind: 'device-cmyk', c: 1, m: 0, y: 0, k: 0 } },
    { kind: 'set-alpha', fill: 0.75, stroke: 0.5 },
    { kind: 'set-blend-mode', blendMode: 'multiply' },
    { kind: 'set-stroke-state', stroke: {
      width: 3, cap: 'round', join: 'bevel', miterLimit: 4, dash: [2, 1], dashPhase: 0.5
    } },
    { kind: 'clip-path', fillRule: 'evenodd', path: { commands: [
      { kind: 'move', point: { x: 0, y: 0 } }, { kind: 'line', point: { x: 20, y: 0 } },
      { kind: 'line', point: { x: 20, y: 20 } }, { kind: 'close' }
    ] } },
    { kind: 'draw-path', paint: 'fill-stroke', fillRule: 'nonzero', sourceObjectId: '4 0 R', path: { commands: [
      { kind: 'move', point: { x: 1, y: 2 } }, { kind: 'line', point: { x: 5, y: 8 } }
    ] } },
    { kind: 'draw-image', imageResourceId: 'image:1', matrix: [4, 0, 0, 5, 3, 6], sourceObjectId: '5 0 R' },
    { kind: 'draw-text', runs: [glyphRun], sourceObjectId: '6 0 R' },
    { kind: 'restore-state' },
    { kind: 'draw-path', paint: 'stroke', fillRule: 'nonzero', path: { commands: [
      { kind: 'move', point: { x: 0, y: 0 } }, { kind: 'line', point: { x: 1, y: 1 } }
    ] } },
    { kind: 'preserved-unsupported', operator: 'sh', reason: 'Shading awaits Slice 20.' }
  ]
};

describe('PDF page semantic import', () => {
  it('imports paths, images, clips and positioned glyphs with graphics-state snapshots', () => {
    const scene = importPdfPageScene(page);

    expect(scene.items.map(item => item.kind)).toEqual(['path', 'image', 'positioned-text', 'path']);
    const [path, image, text, restoredPath] = scene.items;
    expect(path.kind).toBe('path');
    if (path.kind !== 'path' || image.kind !== 'image' || text.kind !== 'positioned-text') return;
    expect(path.localToPage).toEqual([2, 0, 0, 2, 10, 20]);
    expect(path.paintState).toMatchObject({
      fillPaint: { kind: 'device-rgb', r: 1, g: 0, b: 0 },
      strokePaint: { kind: 'device-cmyk', c: 1, m: 0, y: 0, k: 0 },
      fillAlpha: 0.75, strokeAlpha: 0.5, blendMode: 'multiply',
      stroke: { width: 3, cap: 'round', join: 'bevel' }
    });
    expect(path.paintState.clips).toHaveLength(1);
    expect(path.paintState.clips[0]).toMatchObject({ fillRule: 'evenodd', localToPage: [2, 0, 0, 2, 10, 20] });
    expect(image.localToPage).toEqual([8, 0, 0, 10, 16, 32]);
    expect(text.runs[0].renderingMode).toBe(6);
    expect(text.runs[0].glyphs[0]).toMatchObject({ sourceCode: [65], cid: 65, glyphId: 36 });
    expect(restoredPath.paintState.clips).toEqual([]);
    expect(restoredPath.paintState.blendMode).toBe('normal');
    expect(scene.preservedUnsupported).toEqual([
      { kind: 'preserved-unsupported', operator: 'sh', reason: 'Shading awaits Slice 20.' }
    ]);
  });

  it('composes nested transforms without viewport or renderer state', () => {
    expect(multiplyPdfMatrices(
      [2, 0, 0, 3, 10, 20],
      [0, 1, -1, 0, 4, 5]
    )).toEqual([0, 3, -2, 0, 18, 35]);
  });
});
