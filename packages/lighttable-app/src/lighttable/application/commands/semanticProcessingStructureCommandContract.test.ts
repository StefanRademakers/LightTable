import { describe, expect, it } from 'vitest';
import { parseSemanticProcessingStructureCommand } from './semanticProcessingStructureCommandContract';

describe('semantic processing structure command contract', () => {
  it('accepts exact local and attached processing targets', () => {
    expect(parseSemanticProcessingStructureCommand({
      operation: 'set-enabled',
      target: { kind: 'local', layerId: 'layer-a', owner: 'grade' },
      enabled: false
    })).toEqual({
      operation: 'set-enabled',
      target: { kind: 'local', layerId: 'layer-a', owner: 'grade' },
      enabled: false
    });
    expect(parseSemanticProcessingStructureCommand({
      operation: 'remove',
      target: { kind: 'attached', layerId: 'layer-a', adjustmentId: 'adjustment-a' }
    })).toEqual({
      operation: 'remove',
      target: { kind: 'attached', layerId: 'layer-a', adjustmentId: 'adjustment-a' }
    });
  });

  it('accepts exact grade-group targets and rejects ambiguous payloads', () => {
    expect(parseSemanticProcessingStructureCommand({
      operation: 'set-grade-group-enabled',
      target: { kind: 'layer', layerId: 'layer-a' },
      group: 'colorGrading',
      enabled: true
    })).toEqual({
      operation: 'set-grade-group-enabled',
      target: { kind: 'layer', layerId: 'layer-a' },
      group: 'colorGrading',
      enabled: true
    });
    expect(parseSemanticProcessingStructureCommand({
      operation: 'set-enabled',
      target: { kind: 'local', layerId: 'layer-a', owner: 'filter' },
      enabled: true
    })).toHaveProperty('message');
    expect(parseSemanticProcessingStructureCommand({
      operation: 'remove',
      target: { kind: 'local', layerId: 'layer-a', owner: 'grade', extra: true }
    })).toHaveProperty('message');
  });
});
