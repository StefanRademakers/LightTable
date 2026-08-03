import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FIXTURE_FONT_INSTANCE,
  DEFAULT_TEXT_COLOR,
  IDENTITY_MATRIX_3
} from './defaults';
import { analyzePositionedTextRecovery } from './positionedTextRecovery';
import type { PositionedTextRun, PositionedTextSource } from './types';
import { assertTextLayerData } from './validation';

const run = (
  text: string,
  options: Partial<PositionedTextRun> = {}
): PositionedTextRun => ({
  font: CONTRACT_FIXTURE_FONT_INSTANCE,
  glyphs: [...text].map((unicode, index) => ({
    glyphId: unicode.codePointAt(0)!, cluster: index, unicode,
    x: index * 0.6, y: 0, advanceX: 0.6, advanceY: 0
  })),
  textMatrix: [20, 0, 100, 0, 20, 60, 0, 0, 1],
  paint: { fill: { kind: 'solid', color: DEFAULT_TEXT_COLOR } },
  renderingMode: 'fill',
  ...options
});

const source = (
  runs: readonly PositionedTextRun[],
  options: Partial<PositionedTextSource> = {}
): PositionedTextSource => ({
  kind: 'positioned', runs,
  extractedText: runs.flatMap(entry => entry.glyphs.map(glyph => glyph.unicode ?? '')).join(''),
  logicalOrderConfidence: 1,
  editability: 'recoverable',
  ...options
});

describe('positioned text recovery analysis', () => {
  it('builds a high-confidence point-flow preview without mutating the source', () => {
    const positioned = source([run('Hello')]);
    const before = JSON.parse(JSON.stringify(positioned)) as PositionedTextSource;
    const result = analyzePositionedTextRecovery(positioned);

    expect(result.status).toBe('recommended');
    expect(result.confidence).toBe(1);
    expect(result.preview?.source).toMatchObject({
      kind: 'flow', text: 'Hello',
      layout: { mode: 'point', origin: { x: 100, y: 60 } }
    });
    expect(result.preview?.source.styleRuns[0]).toMatchObject({
      start: 0, end: 5, fontSize: 20, horizontalScale: 100,
      requestedFont: { postScriptName: 'ContractFixtureFont' }
    });
    assertTextLayerData({
      schemaVersion: 1,
      source: result.preview!.source,
      revisions: { content: 0, font: 0, layout: 0, paint: 0, path: 0, geometry: 0 }
    });
    expect(positioned).toEqual(before);
  });

  it('maps extracted whitespace and mixed paints to independent style ranges', () => {
    const red = { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 } as const;
    const positioned = source([
      run('Hello'),
      run('world', {
        textMatrix: [30, 0, 170, 0, 30, 60, 0, 0, 1],
        paint: { stroke: { paint: { kind: 'solid', color: red }, width: 2, cap: 'round', join: 'round', miterLimit: 4 } },
        renderingMode: 'stroke'
      })
    ], { extractedText: 'Hello world' });
    const result = analyzePositionedTextRecovery(positioned);

    expect(result.status).toBe('recommended');
    expect(result.preview?.source.styleRuns).toHaveLength(2);
    expect(result.preview?.source.styleRuns[0]).toMatchObject({ start: 0, end: 6, fontSize: 20 });
    expect(result.preview?.source.styleRuns[1]).toMatchObject({ start: 6, end: 11, fontSize: 30 });
    expect(result.preview?.source.styleRuns[1]?.fill).toBeUndefined();
    expect(result.preview?.source.styleRuns[1]?.stroke?.width).toBe(2);
    assertTextLayerData({
      schemaVersion: 1,
      source: result.preview!.source,
      revisions: { content: 0, font: 0, layout: 0, paint: 0, path: 0, geometry: 0 }
    });
  });

  it('factors a uniform rotation into the layer transform delta', () => {
    const result = analyzePositionedTextRecovery(source([run('Rotated', {
      textMatrix: [0, -24, 40, 24, 0, 50, 0, 0, 1]
    })]));

    expect(result.status).toBe('recommended');
    expect(result.preview?.source.layout).toMatchObject({ mode: 'point', origin: { x: 50, y: -40 } });
    expect(result.preview?.layerTransformDelta).toEqual([
      expect.closeTo(0), expect.closeTo(-1), 0,
      expect.closeTo(1), expect.closeTo(0), 0,
      0, 0, 1
    ]);
  });

  it('preserves a uniform reflection as an editable layer transform', () => {
    const result = analyzePositionedTextRecovery(source([run('Mirror', {
      textMatrix: [-20, 0, 80, 0, 20, 30, 0, 0, 1]
    })]));

    expect(result.status).toBe('recommended');
    expect(result.preview?.source.layout).toMatchObject({
      mode: 'point', origin: { x: expect.closeTo(-80), y: expect.closeTo(30) }
    });
    expect(result.preview?.layerTransformDelta).toEqual([
      expect.closeTo(-1), expect.closeTo(0), 0,
      expect.closeTo(0), expect.closeTo(1), 0,
      0, 0, 1
    ]);
    expect(result.evidence.map(entry => entry.code)).toContain('uniform-transform-preserved');
  });

  it('blocks incomplete semantics, text clipping and per-glyph transforms', () => {
    const incomplete = run('A', {
      glyphs: [{
        glyphId: 1, x: 0, y: 0, advanceX: 1, advanceY: 0,
        localTransform: [1, 0, 1, 0, 1, 0, 0, 0, 1]
      }],
      renderingMode: 'fill-clip'
    });
    const result = analyzePositionedTextRecovery(source([incomplete], {
      extractedText: undefined,
      logicalOrderConfidence: 0.4
    }));

    expect(result.status).toBe('blocked');
    expect(result.preview).toBeUndefined();
    expect(result.evidence.map(entry => entry.code)).toEqual(expect.arrayContaining([
      'semantic-text-partial',
      'unsupported-text-clipping',
      'unsupported-per-glyph-transform',
      'logical-order-uncertain'
    ]));
  });

  it('blocks outline-only sources and inconsistent rotations', () => {
    const result = analyzePositionedTextRecovery(source([
      run('A'),
      run('B', { textMatrix: [0, -20, 100, 20, 0, 60, 0, 0, 1] })
    ], { extractedText: 'AB', editability: 'outline-only' }));

    expect(result.status).toBe('blocked');
    expect(result.evidence.map(entry => entry.code)).toEqual(expect.arrayContaining([
      'source-outline-only', 'inconsistent-run-rotation'
    ]));
  });

  it('warns when legacy identity matrices require advance-based size estimation', () => {
    const result = analyzePositionedTextRecovery(source([run('AB', {
      textMatrix: IDENTITY_MATRIX_3,
      glyphs: [
        { glyphId: 1, unicode: 'A', x: 0, y: 0, advanceX: 12, advanceY: 0 },
        { glyphId: 2, unicode: 'B', x: 12, y: 0, advanceX: 12, advanceY: 0 }
      ]
    })]));

    expect(result.status).toBe('available');
    expect(result.preview?.source.styleRuns[0]?.fontSize).toBe(20);
    expect(result.evidence.map(entry => entry.code)).toContain('font-size-estimated');
  });
});
