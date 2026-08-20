import { describe, expect, it } from 'vitest';
import { parseSemanticLayerCommand } from './semanticLayerCommandContract';

describe('semanticLayerCommandContract', () => {
  it('parses a bounded final affine transform', () => {
    expect(parseSemanticLayerCommand('set-transform', {
      layerId: 'layer-1',
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 24, ty: -8 }
    })).toEqual({
      kind: 'set-transform',
      layerId: 'layer-1',
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 24, ty: -8 }
    });
    expect(parseSemanticLayerCommand('set-transform', {
      layerId: 'layer-1',
      transform: { a: 1, b: 0, c: 0, d: 1, tx: Number.POSITIVE_INFINITY, ty: 0 }
    })).toHaveProperty('message');
  });

  it('parses bounded structural layer commands', () => {
    expect(parseSemanticLayerCommand('duplicate', { layerId: 'layer-a' })).toEqual({
      kind: 'duplicate', layerId: 'layer-a'
    });
    expect(parseSemanticLayerCommand('delete', { layerIds: ['a', 'a', 'b'] })).toEqual({
      kind: 'delete', layerIds: ['a', 'b']
    });
    expect(parseSemanticLayerCommand('move', { layerId: 'a', direction: 'up' })).toEqual({
      kind: 'move', layerId: 'a', direction: 'up'
    });
    expect(parseSemanticLayerCommand('set-blend-mode', {
      layerId: 'a', blendMode: 'multiply'
    })).toEqual({ kind: 'set-blend-mode', layerId: 'a', blendMode: 'multiply' });
    expect(parseSemanticLayerCommand('set-clipping', { layerId: 'a', clipping: true })).toEqual({
      kind: 'set-clipping', layerId: 'a', clipping: true
    });
    expect(parseSemanticLayerCommand('set-lock', {
      layerIds: ['a'], lock: 'position', locked: true
    })).toEqual({ kind: 'set-lock', layerIds: ['a'], lock: 'position', locked: true });
  });

  it('rejects unsupported values before they reach document owners', () => {
    expect(parseSemanticLayerCommand('set-blend-mode', {
      layerId: 'a', blendMode: 'mystery'
    })).toEqual({ message: 'Layer blend mode requires layerId and a supported blendMode.' });
    expect(parseSemanticLayerCommand('delete', { layerIds: [] })).toEqual({
      message: 'Layer delete requires 1-256 layerIds.'
    });
    expect(parseSemanticLayerCommand('set-lock', {
      layerIds: ['a'], lock: 'everything', locked: true
    })).toEqual({
      message: 'Layer lock requires 1-256 layerIds, a supported lock and boolean locked value.'
    });
  });
});
