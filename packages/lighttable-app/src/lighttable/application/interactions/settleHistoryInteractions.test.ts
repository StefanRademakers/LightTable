import { describe, expect, it, vi } from 'vitest';
import { settleHistoryInteractions, type HistoryInteractionParticipants } from './settleHistoryInteractions';

const setup = () => {
  const order: string[] = [];
  const record = (name: string) => vi.fn(() => { order.push(name); });
  const participants: HistoryInteractionParticipants = {
    assertCurrent: record('scope'),
    settlePixels: vi.fn(async () => { order.push('pixels'); }),
    commitPointCreation: record('point'),
    commitParagraphCreation: record('paragraph'),
    finishTextEditing: record('text'),
    resetAdjustment: record('adjustment'),
    resetDocumentTransaction: vi.fn(async () => { order.push('document'); })
  };
  return { participants, order };
};

describe('history interaction prerequisites', () => {
  it('retains terminal order and checks scope at both async boundaries', async () => {
    const { participants, order } = setup();
    await settleHistoryInteractions(participants);
    expect(order).toEqual(['scope', 'pixels', 'scope', 'point', 'paragraph', 'text',
      'adjustment', 'document', 'scope']);
  });

  it('does not touch later domains after pixel settlement fails', async () => {
    const { participants, order } = setup();
    const failure = new Error('Pixel ownership failed');
    participants.settlePixels = vi.fn().mockRejectedValue(failure);
    await expect(settleHistoryInteractions(participants)).rejects.toBe(failure);
    expect(order).toEqual(['scope']);
  });

  it('does not resolve text or adjustment terminals in a retired scope', async () => {
    const { participants, order } = setup();
    let current = true;
    participants.assertCurrent = () => { if (!current) throw new Error('retired'); };
    participants.settlePixels = async () => { current = false; };
    await expect(settleHistoryInteractions(participants)).rejects.toThrow('retired');
    expect(order).toEqual([]);
  });

  it('does not report success if document retirement happens during the last wait', async () => {
    const { participants } = setup();
    let current = true;
    participants.assertCurrent = () => { if (!current) throw new Error('retired'); };
    participants.resetDocumentTransaction = async () => { current = false; };
    await expect(settleHistoryInteractions(participants)).rejects.toThrow('retired');
  });
});
