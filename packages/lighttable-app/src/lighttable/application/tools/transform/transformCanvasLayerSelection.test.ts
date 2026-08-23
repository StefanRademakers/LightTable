import { describe, expect, it } from 'vitest';
import type { LayerId } from '../../../editor/document/documentTypes';
import { resolveTransformCanvasLayerSelection } from './transformCanvasLayerSelection';

const id = (value: string) => value as LayerId;

describe('transform canvas layer selection', () => {
  it('replaces the selection on an ordinary canvas click', () => {
    expect(resolveTransformCanvasLayerSelection([id('a'), id('b')], id('b'), id('c'), false))
      .toEqual({ selectedLayerIds: [id('c')], activeLayerId: id('c') });
  });

  it('adds a Shift-clicked layer and makes it active', () => {
    expect(resolveTransformCanvasLayerSelection([id('a')], id('a'), id('b'), true))
      .toEqual({ selectedLayerIds: [id('a'), id('b')], activeLayerId: id('b') });
  });

  it('toggles an existing member without losing the remaining active layer', () => {
    expect(resolveTransformCanvasLayerSelection([id('a'), id('b')], id('a'), id('b'), true))
      .toEqual({ selectedLayerIds: [id('a')], activeLayerId: id('a') });
  });

  it('chooses a remaining member when the active member is toggled off', () => {
    expect(resolveTransformCanvasLayerSelection([id('a'), id('b')], id('b'), id('b'), true))
      .toEqual({ selectedLayerIds: [id('a')], activeLayerId: id('a') });
  });

  it('does not create an empty canonical selection from a sole Shift-click', () => {
    expect(resolveTransformCanvasLayerSelection([id('a')], id('a'), id('a'), true))
      .toEqual({ selectedLayerIds: [id('a')], activeLayerId: id('a') });
  });

  it('extends from the canonical active layer when UI selection is not hydrated yet', () => {
    expect(resolveTransformCanvasLayerSelection([], id('a'), id('b'), true))
      .toEqual({ selectedLayerIds: [id('a'), id('b')], activeLayerId: id('b') });
  });
});
