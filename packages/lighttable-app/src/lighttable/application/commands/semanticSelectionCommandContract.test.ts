import { describe, expect, it } from 'vitest';
import { parseSemanticSelectionCommand } from './semanticSelectionCommandContract';

describe('semantic selection command contract', () => {
  it('parses a complete final selection shape', () => {
    expect(parseSemanticSelectionCommand({
      mode: 'add',
      shape: { kind: 'ellipse', points: [{ x: 10, y: 20 }, { x: 80, y: 90 }] },
      featherRadius: 4,
      antiAlias: true
    })).toEqual({
      kind: 'apply-shape',
      mode: 'add',
      shape: { kind: 'ellipse', points: [{ x: 10, y: 20 }, { x: 80, y: 90 }] },
      featherRadius: 4,
      antiAlias: true
    });
  });

  it('rejects incomplete and unbounded shapes', () => {
    expect(parseSemanticSelectionCommand({
      mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 0, y: 0 }] }
    })).toHaveProperty('message');
    expect(parseSemanticSelectionCommand({
      mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 20_000_000, y: 1 }] }
    })).toHaveProperty('message');
  });

  it('parses only the bounded discrete selection operations', () => {
    for (const operation of ['all', 'clear', 'invert'] as const) {
      expect(parseSemanticSelectionCommand({ kind: 'modify', operation }))
        .toEqual({ kind: 'modify', operation });
    }
    expect(parseSemanticSelectionCommand({ kind: 'modify', operation: 'grow' }))
      .toHaveProperty('message');
    expect(parseSemanticSelectionCommand({ kind: 'modify', operation: 'clear', radius: 4 }))
      .toHaveProperty('message');
  });
});
