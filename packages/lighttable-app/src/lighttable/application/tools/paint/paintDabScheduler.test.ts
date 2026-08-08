import { describe, expect, it, vi } from 'vitest';
import type { PaintGestureUpdate } from '../../../editor/tools/paint/paintGestureController';
import type { LayerId } from '../../../editor/document/documentTypes';
import { identityMatrix } from '../../../editor/tools/transform/affine';
import { createPaintDabScheduler } from './paintDabScheduler';

const update = (x: number): PaintGestureUpdate => ({
  target: {
    layerId: 'layer' as LayerId,
    channel: 'pixels',
    erase: false,
    sourceToDocument: identityMatrix()
  },
  dabs: [{ x, y: 5, pressure: 1, size: 10, flowScale: 1 }]
});

describe('PaintDabScheduler', () => {
  it('keeps every dab while submitting one batch per frame', () => {
    let callback: (() => void) | null = null;
    const deliver = vi.fn();
    const scheduler = createPaintDabScheduler({
      request: (next) => {
        callback = next;
        return 9;
      },
      cancel: vi.fn()
    }, deliver);

    scheduler.schedule(update(1));
    scheduler.schedule(update(2));
    scheduler.schedule(update(3));
    expect(deliver).not.toHaveBeenCalled();

    (callback as (() => void) | null)?.();
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0]?.[0].dabs.map((dab: { x: number }) => dab.x))
      .toEqual([1, 2, 3]);
  });

  it('flushes before commit and can discard unapplied input', () => {
    const cancel = vi.fn();
    const deliver = vi.fn();
    const scheduler = createPaintDabScheduler({
      request: () => 4,
      cancel
    }, deliver);

    scheduler.schedule(update(1));
    scheduler.flush();
    expect(cancel).toHaveBeenCalledWith(4);
    expect(deliver).toHaveBeenCalledOnce();

    scheduler.schedule(update(2));
    scheduler.cancel();
    expect(deliver).toHaveBeenCalledOnce();
  });
});
