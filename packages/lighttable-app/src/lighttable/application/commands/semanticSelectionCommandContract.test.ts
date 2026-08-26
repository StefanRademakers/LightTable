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
    expect(parseSemanticSelectionCommand({ kind: 'modify', operation: 'feather', radius: 12 }))
      .toEqual({ kind: 'modify', operation: 'feather', radius: 12, applyAtCanvasBounds: false });
    expect(parseSemanticSelectionCommand({ kind: 'modify', operation: 'feather', radius: 251 }))
      .toHaveProperty('message');
    expect(parseSemanticSelectionCommand({ kind: 'modify', operation: 'grow' }))
      .toHaveProperty('message');
    expect(parseSemanticSelectionCommand({ kind: 'modify', operation: 'clear', radius: 4 }))
      .toHaveProperty('message');
  });

  it('parses a bounded Magic Wand recipe and rejects hidden runtime state', () => {
    const command = {
      kind: 'magic-wand', layerId: 'layer-photo', point: { x: 30.5, y: 42.25 },
      mode: 'replace', options: {
        sampleSize: 5, tolerance: 20, antiAlias: true,
        contiguous: true, sampleAllLayers: false
      }
    };
    expect(parseSemanticSelectionCommand(command)).toEqual(command);
    expect(parseSemanticSelectionCommand({
      ...command, documentRevision: 9
    })).toHaveProperty('message');
    expect(parseSemanticSelectionCommand({
      ...command, options: { ...command.options, sampleSize: 7 }
    })).toHaveProperty('message');
    expect(parseSemanticSelectionCommand({
      ...command, point: { x: Number.POSITIVE_INFINITY, y: 1 }
    })).toHaveProperty('message');
  });
});
