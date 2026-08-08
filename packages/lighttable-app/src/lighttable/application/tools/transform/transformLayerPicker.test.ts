import { describe, expect, it, vi } from 'vitest';
import {
  createAdjustmentLayer,
  createGroupLayer,
  createImageDocument,
  createVectorLayer,
  type LayerId
} from '../../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../../processing/adjustmentStack';
import {
  createAnchor,
  createSubpath,
  createVectorPath
} from '@lighttable/vector-core';
import { pickTransformLayer } from './transformLayerPicker';

describe('pickTransformLayer', () => {
  it('offers visible drawable layers to the renderer from top to bottom', async () => {
    const bottom = { ...createImageDocument('bottom', 32, 32, 'bottom').layers[0]!, name: 'bottom' };
    const hidden = { ...createImageDocument('hidden', 32, 32, 'hidden').layers[0]!, visible: false };
    const top = { ...createImageDocument('top', 32, 32, 'top').layers[0]!, name: 'top' };
    const document = { ...createImageDocument('test', 32, 32, 'test'), layers: [bottom, hidden, top] };
    const pickTopLayerAtPoint = vi.fn(async (ids: readonly LayerId[]) => ids[1] ?? null);

    await expect(pickTransformLayer(document, { x: 4, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: bottom.id });
    expect(pickTopLayerAtPoint).toHaveBeenCalledWith(
      [top.id, bottom.id], { x: 4, y: 5 }, new Set()
    );
  });

  it('ignores locked layers and continues with unlocked content below', async () => {
    const bottom = createImageDocument('bottom', 32, 32, 'bottom').layers[0]!;
    const locked = {
      ...createImageDocument('locked', 32, 32, 'locked').layers[0]!,
      locks: { transparency: false, pixels: false, position: true, all: false }
    };
    const document = {
      ...createImageDocument('test', 32, 32, 'test'),
      layers: [bottom, locked]
    };
    const pickTopLayerAtPoint = vi.fn(async (ids: readonly LayerId[]) => ids[0] ?? null);

    await expect(pickTransformLayer(document, { x: 4, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: bottom.id });
    expect(pickTopLayerAtPoint).toHaveBeenCalledWith(
      [bottom.id], { x: 4, y: 5 }, new Set()
    );
  });

  it('preserves visual order through nested groups and skips a locked subtree', async () => {
    const bottom = createImageDocument('bottom', 32, 32, 'bottom').layers[0]!;
    const childBottom = createImageDocument('child-bottom', 32, 32, 'child-bottom').layers[0]!;
    const childTop = createImageDocument('child-top', 32, 32, 'child-top').layers[0]!;
    const group = createGroupLayer('group');
    group.children = [childBottom, childTop];
    const top = createImageDocument('top', 32, 32, 'top').layers[0]!;
    const document = {
      ...createImageDocument('test', 32, 32, 'test'),
      layers: [bottom, group, top]
    };
    const pickTopLayerAtPoint = vi.fn(async () => childBottom.id);

    await expect(pickTransformLayer(document, { x: 4, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: childBottom.id });
    expect(pickTopLayerAtPoint).toHaveBeenLastCalledWith(
      [top.id, childTop.id, childBottom.id, bottom.id], { x: 4, y: 5 }, new Set()
    );

    group.locks.position = true;
    await pickTransformLayer(document, { x: 4, y: 5 }, { pickTopLayerAtPoint });
    expect(pickTopLayerAtPoint).toHaveBeenLastCalledWith(
      [top.id, bottom.id], { x: 4, y: 5 }, new Set()
    );
  });

  it('excludes non-painted and adjustment layers before asking the GPU', async () => {
    const bottom = createImageDocument('bottom', 32, 32, 'bottom').layers[0]!;
    const transparent = {
      ...createImageDocument('transparent', 32, 32, 'transparent').layers[0]!,
      opacity: 0
    };
    const emptyFill = {
      ...createImageDocument('empty-fill', 32, 32, 'empty-fill').layers[0]!,
      fillOpacity: 0
    };
    const adjustment = createAdjustmentLayer(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments())
    );
    const document = {
      ...createImageDocument('test', 32, 32, 'test'),
      layers: [bottom, transparent, emptyFill, adjustment]
    };
    const pickTopLayerAtPoint = vi.fn(async (ids: readonly LayerId[]) => ids[0] ?? null);

    await expect(pickTransformLayer(document, { x: 4, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: bottom.id });
    expect(pickTopLayerAtPoint).toHaveBeenCalledWith(
      [bottom.id], { x: 4, y: 5 }, new Set()
    );
  });

  it('publishes exact painted vector hits alongside retained layer candidates', async () => {
    const path = createVectorPath('shape', 'shape', [createSubpath('subpath', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 10, y: 0 }),
      createAnchor('c', { x: 10, y: 10 }),
      createAnchor('d', { x: 0, y: 10 })
    ], true)]);
    const vector = createVectorLayer([path], 'vector');
    const raster = createImageDocument('raster', 32, 32, 'raster').layers[0]!;
    const document = {
      ...createImageDocument('test', 32, 32, 'test'),
      layers: [raster, vector]
    };
    const pickTopLayerAtPoint = vi.fn(async (
      _ids: readonly LayerId[],
      _point: { x: number; y: number },
      knownOpaque: ReadonlySet<LayerId>
    ) => knownOpaque.has(vector.id) ? vector.id : null);

    await expect(pickTransformLayer(document, { x: 5, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: vector.id });
    expect(pickTopLayerAtPoint).toHaveBeenCalledWith(
      [vector.id, raster.id], { x: 5, y: 5 }, new Set([vector.id])
    );
  });
});
