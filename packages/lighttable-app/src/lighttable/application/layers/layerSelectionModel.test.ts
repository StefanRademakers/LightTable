import { describe, expect, it } from 'vitest';
import { LayerNameRenameGestureController, resolveLayerSelectionGesture } from './layerSelectionModel';
import type { LayerId } from '../../editor/document/documentTypes';

const id = (value: string) => value as LayerId;
const ids = ['top', 'middle-a', 'middle-b', 'bottom'].map(id);

describe('resolveLayerSelectionGesture', () => {
  it('extends from the stable anchor through the clicked layer', () => {
    expect(resolveLayerSelectionGesture(ids, {
      selectedLayerIds: [id('top')], anchorLayerId: id('top'), activeLayerId: id('top')
    }, { targetLayerId: id('bottom'), extend: true, toggle: false })).toEqual({
      selectedLayerIds: ids,
      anchorLayerId: id('top'),
      activeLayerId: id('bottom')
    });
  });

  it('falls back to the active layer when a stale anchor is no longer visible', () => {
    expect(resolveLayerSelectionGesture(ids, {
      selectedLayerIds: [id('top')], anchorLayerId: id('collapsed-child'), activeLayerId: id('top')
    }, { targetLayerId: id('middle-b'), extend: true, toggle: false }).selectedLayerIds)
      .toEqual(ids.slice(0, 3));
  });

  it('toggles without losing the remaining active selection', () => {
    expect(resolveLayerSelectionGesture(ids, {
      selectedLayerIds: [id('top'), id('middle-a')], anchorLayerId: id('middle-a'), activeLayerId: id('top')
    }, { targetLayerId: id('middle-a'), extend: false, toggle: true })).toEqual({
      selectedLayerIds: [id('top')],
      anchorLayerId: id('middle-a'),
      activeLayerId: id('top')
    });
  });
});

describe('LayerNameRenameGestureController', () => {
  it('keeps the pre-selection eligibility across a panel remount boundary', () => {
    const controller = new LayerNameRenameGestureController();
    controller.begin(id('bottom'), id('top'), 100);
    controller.begin(id('bottom'), id('bottom'), 180);
    expect(controller.consume(id('bottom'), 185)).toBe(false);

    controller.begin(id('bottom'), id('bottom'), 1_000);
    controller.begin(id('bottom'), id('bottom'), 1_080);
    expect(controller.consume(id('bottom'), 1_085)).toBe(true);

    controller.begin(id('top'), id('bottom'), 2_000);
    controller.cancel();
    controller.begin(id('top'), id('top'), 2_100);
    controller.begin(id('top'), id('top'), 2_180);
    expect(controller.consume(id('top'), 2_185)).toBe(true);
  });

  it('requires two pointer downs inside the bounded double-click interval', () => {
    const controller = new LayerNameRenameGestureController();
    controller.begin(id('top'), id('top'), 100);
    expect(controller.consume(id('top'), 110)).toBe(false);

    controller.begin(id('top'), id('top'), 1_000);
    controller.begin(id('top'), id('top'), 1_700);
    expect(controller.consume(id('top'), 1_710)).toBe(false);

    controller.begin(id('top'), id('top'), 2_000);
    controller.begin(id('top'), id('top'), 2_300);
    expect(controller.consume(id('top'), 2_501)).toBe(false);

    controller.begin(id('top'), id('top'), 3_000);
    controller.begin(id('top'), id('top'), 3_300);
    expect(controller.consume(id('top'), 3_310)).toBe(true);
  });
});
