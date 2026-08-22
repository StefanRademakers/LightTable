import { describe, expect, it } from 'vitest';
import { createPaintSceneCompileResult, PAINT_SCENE_SCHEMA_VERSION } from './index';
import type { PaintScene, PaintSceneCapabilityIssue } from './index';

const scene = (commandCount: number): PaintScene => ({
  schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
  sourceId: 'source',
  sourceRevision: '1',
  fragments: [{
    stableId: 'item',
    revisionKey: '1',
    commands: Array.from({ length: commandCount }, () => ({
      kind: 'fill-path' as const,
      path: [],
      transform: [1, 0, 0, 1, 0, 0],
      fillRule: 'nonzero' as const,
      color: [0, 0, 0, 1]
    }))
  }]
});

const issue: PaintSceneCapabilityIssue = {
  stableId: 'item', feature: 'gradient', reason: 'Not encoded.', fallback: 'current-backend'
};

describe('createPaintSceneCompileResult', () => {
  it('never labels a result with capability loss as ready', () => {
    expect(createPaintSceneCompileResult(scene(1), []).status).toBe('ready');
    expect(createPaintSceneCompileResult(scene(1), [issue]).status).toBe('partial');
    expect(createPaintSceneCompileResult(scene(0), [issue]).status).toBe('unsupported');
  });
});
