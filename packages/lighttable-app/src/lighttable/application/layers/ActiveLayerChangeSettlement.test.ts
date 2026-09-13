import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../../editor/document/documentTypes';
import { ActiveLayerChangeSettlement } from './ActiveLayerChangeSettlement';

const id = (value: string) => value as LayerId;

describe('ActiveLayerChangeSettlement', () => {
  it('settles transform, text and vector ownership in target-change order', async () => {
    const order: string[] = [];
    const settlement = new ActiveLayerChangeSettlement({
      hasPendingTransform: () => true,
      settleTransform: async () => { order.push('transform'); },
      getEditingTextLayerId: () => id('text-a'),
      finishTextEditing: () => { order.push('text'); },
      prepareVectorTarget: layerId => { order.push(`vector:${layerId}`); }
    });

    await settlement.prepare(id('layer-b'), () => true);

    expect(order).toEqual(['transform', 'text', 'vector:layer-b']);
  });

  it('does not touch the successor after asynchronous transform settlement retires it', async () => {
    let current = true;
    const finishTextEditing = vi.fn();
    const prepareVectorTarget = vi.fn();
    const settlement = new ActiveLayerChangeSettlement({
      hasPendingTransform: () => true,
      settleTransform: async () => { current = false; },
      getEditingTextLayerId: () => id('text-a'),
      finishTextEditing,
      prepareVectorTarget
    });

    await settlement.prepare(id('layer-b'), () => current);

    expect(finishTextEditing).not.toHaveBeenCalled();
    expect(prepareVectorTarget).not.toHaveBeenCalled();
  });

  it('preserves editing when the selected layer remains the text target', async () => {
    const finishTextEditing = vi.fn();
    const prepareVectorTarget = vi.fn();
    const settlement = new ActiveLayerChangeSettlement({
      hasPendingTransform: () => false,
      settleTransform: vi.fn(),
      getEditingTextLayerId: () => id('text-a'),
      finishTextEditing,
      prepareVectorTarget
    });

    await settlement.prepare(id('text-a'), () => true);

    expect(finishTextEditing).not.toHaveBeenCalled();
    expect(prepareVectorTarget).toHaveBeenCalledExactlyOnceWith(id('text-a'));
  });
});
