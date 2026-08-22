import { describe, expect, it } from 'vitest';
import { assertPaintSceneIsValid, PAINT_SCENE_SCHEMA_VERSION, type PaintScene } from './index';

const scene = (commands: PaintScene['fragments'][number]['commands']): PaintScene => ({
  schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
  sourceId: 'clip-fixture',
  sourceRevision: '1',
  fragments: [{
    stableId: 'fragment', revisionKey: '1',
    paths: [{ stableId: 'clip', revisionKey: '1', commands: [] }],
    commands
  }]
});

describe('paint-scene validation', () => {
  it('accepts a balanced fragment-local clip stack', () => {
    expect(() => assertPaintSceneIsValid(scene([
      { kind: 'push-clip', pathId: 'clip', transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero' },
      { kind: 'pop-clip' }
    ]))).not.toThrow();
  });

  it('rejects missing paths and clip stacks crossing fragment boundaries', () => {
    expect(() => assertPaintSceneIsValid(scene([
      { kind: 'push-clip', pathId: 'missing', transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero' }
    ]))).toThrow('missing path');
    expect(() => assertPaintSceneIsValid(scene([
      { kind: 'push-clip', pathId: 'clip', transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero' }
    ]))).toThrow('unclosed');
  });
});

