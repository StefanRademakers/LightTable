import { describe, expect, it } from 'vitest';
import { parseSemanticFaceWarpCommand } from './semanticFaceWarpCommandContract';

describe('semantic Face Warp command contract', () => {
  it('accepts bounded semantic and protection operations', () => {
    expect(parseSemanticFaceWarpCommand({
      layerId: 'portrait', operation: {
        kind: 'set-semantic', faceId: 'face-1', target: 'left',
        change: { eyeSize: 0.35, smile: -0.2 }
      }
    })).toMatchObject({ layerId: 'portrait', operation: { kind: 'set-semantic' } });
    expect(parseSemanticFaceWarpCommand({
      layerId: 'portrait', operation: {
        kind: 'set-protection', faceId: 'face-1', feature: 'eyes', locked: true
      }
    })).toMatchObject({ operation: { kind: 'set-protection', locked: true } });
  });

  it('rejects unknown, non-finite and out-of-range transport input', () => {
    for (const operation of [
      { kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { unknown: 0 } },
      { kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { smile: 2 } },
      { kind: 'set-semantic', faceId: 'face-1', target: 'both', change: { smile: Number.NaN } },
      { kind: 'set-protection', faceId: 'face-1', feature: 'hair', locked: true }
    ]) {
      expect(parseSemanticFaceWarpCommand({ layerId: 'portrait', operation })).toHaveProperty('message');
    }
  });
});
