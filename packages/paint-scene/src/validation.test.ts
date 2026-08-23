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
  }],
  clips: [],
  composition: [{ kind: 'fragment', stableId: 'fragment' }]
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

  it('validates hierarchical clip composition without duplicating fragments', () => {
    const clipped: PaintScene = {
      ...scene([]),
      clips: [{
        stableId: 'group-mask', revisionKey: '1',
        path: { stableId: 'mask-path', revisionKey: '1', commands: [] },
        transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero'
      }],
      composition: [{
        kind: 'clip', stableId: 'group-mask',
        children: [{ kind: 'fragment', stableId: 'fragment' }]
      }]
    };
    expect(() => assertPaintSceneIsValid(clipped)).not.toThrow();
    expect(() => assertPaintSceneIsValid({
      ...clipped,
      composition: [
        { kind: 'fragment', stableId: 'fragment' },
        { kind: 'fragment', stableId: 'fragment' }
      ]
    })).toThrow('more than once');
    expect(() => assertPaintSceneIsValid({
      ...clipped,
      composition: [{ kind: 'clip', stableId: 'missing', children: clipped.composition }]
    })).toThrow('missing clip');
  });

  it('allows retained hidden fragments outside the active composition', () => {
    expect(() => assertPaintSceneIsValid({
      ...scene([]),
      composition: []
    })).not.toThrow();
  });

  it('validates nested isolated opacity composition', () => {
    expect(() => assertPaintSceneIsValid({
      ...scene([]),
      composition: [{
        kind: 'opacity-group', opacity: 0.5,
        children: [{ kind: 'fragment', stableId: 'fragment' }]
      }]
    })).not.toThrow();
    expect(() => assertPaintSceneIsValid({
      ...scene([]),
      composition: [{ kind: 'opacity-group', opacity: 2, children: [] }]
    })).toThrow('invalid opacity');
  });
});
