import { describe, expect, it } from 'vitest';
import { PAINT_SCENE_SCHEMA_VERSION, type PaintScenePath } from '@lighttable/paint-scene';
import { PaintSceneWebGpuBackend, paintScenePathToVectorPath } from './PaintSceneWebGpuBackend';

const curvedClosedPath: PaintScenePath = {
  stableId: 'shape:path',
  revisionKey: '7',
  commands: [
    { kind: 'move', x: 0, y: 0 },
    { kind: 'cubic', control1X: 1, control1Y: 0, control2X: 3, control2Y: 0, x: 4, y: 0 },
    { kind: 'cubic', control1X: 4, control1Y: 1, control2X: 0, control2Y: 1, x: 0, y: 0 },
    { kind: 'close' }
  ]
};

describe('paintScenePathToVectorPath', () => {
  it('preserves a cubic closing segment without duplicating its first anchor', () => {
    const result = paintScenePathToVectorPath(curvedClosedPath, 'document:');
    expect(result.id).toBe('document:shape:path@7');
    expect(result.subpaths).toHaveLength(1);
    expect(result.subpaths[0]).toMatchObject({ closed: true });
    expect(result.subpaths[0].anchors).toHaveLength(2);
    expect(result.subpaths[0].anchors[0]).toMatchObject({
      position: { x: 0, y: 0 },
      handleOut: { x: 1, y: 0 },
      handleIn: { x: 0, y: 1 }
    });
    expect(result.subpaths[0].anchors[1]).toMatchObject({
      position: { x: 4, y: 0 },
      handleIn: { x: 3, y: 0 },
      handleOut: { x: 4, y: 1 }
    });
  });

  it('rejects malformed paths instead of inventing a starting point', () => {
    expect(() => paintScenePathToVectorPath({
      stableId: 'bad', revisionKey: '1', commands: [{ kind: 'line', x: 1, y: 2 }]
    })).toThrow('starts without move');
  });

  it('does not silently render through an unsupported persistent clip stack', () => {
    const backend = Object.create(PaintSceneWebGpuBackend.prototype) as PaintSceneWebGpuBackend;
    expect(() => backend.encode({} as GPUCommandEncoder, {
      schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
      sourceId: 'clip',
      sourceRevision: '1',
      fragments: [{
        stableId: 'clip-fragment', revisionKey: '1', paths: [{
          stableId: 'clip', revisionKey: '1', commands: []
        }],
        commands: [
          { kind: 'push-clip', pathId: 'clip', transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero' },
          { kind: 'pop-clip' }
        ]
      }],
      clips: [],
      composition: [{ kind: 'fragment', stableId: 'clip-fragment' }]
    }, {} as never)).toThrow('does not support persistent clip stacks');
  });

  it('does not flatten hierarchical clips into unclipped draw order', () => {
    const backend = Object.create(PaintSceneWebGpuBackend.prototype) as PaintSceneWebGpuBackend;
    expect(() => backend.encode({} as GPUCommandEncoder, {
      schemaVersion: PAINT_SCENE_SCHEMA_VERSION,
      sourceId: 'group-clip', sourceRevision: '1',
      fragments: [{ stableId: 'child', revisionKey: '1', paths: [], commands: [] }],
      clips: [{
        stableId: 'mask', revisionKey: '1',
        path: { stableId: 'mask:path', revisionKey: '1', commands: [] },
        transform: [1, 0, 0, 1, 0, 0], fillRule: 'nonzero'
      }],
      composition: [{
        kind: 'clip', stableId: 'mask', children: [{ kind: 'fragment', stableId: 'child' }]
      }]
    }, {} as never)).toThrow('does not support hierarchical composition');
  });
});
