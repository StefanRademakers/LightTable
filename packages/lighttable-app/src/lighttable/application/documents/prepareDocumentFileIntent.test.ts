import { describe, expect, it, vi } from 'vitest';
import { prepareDocumentFileIntent, type DocumentFilePreparationParticipants } from './prepareDocumentFileIntent';

const fixture = () => {
  let current = true;
  const calls: string[] = [];
  const participants: DocumentFilePreparationParticipants = {
    assertCurrent: () => { if (!current) throw new Error('Retired file target'); },
    settlePixels: vi.fn(async () => { calls.push('pixels'); }),
    finishTextCreation: vi.fn(async () => { calls.push('creation'); }),
    finishTextEditing: vi.fn(() => { calls.push('editing'); }),
    commitAdjustments: vi.fn(async () => { calls.push('adjustments'); }),
    commitLayerDocument: vi.fn(async () => { calls.push('layers'); })
  };
  return { participants, calls, retire: () => { current = false; } };
};

describe('file intent prerequisites', () => {
  it('awaits named commits in order without resetting any owner', async () => {
    const f = fixture();
    let complete!: () => void;
    f.participants.finishTextCreation = vi.fn(() => new Promise<void>(resolve => {
      f.calls.push('creation'); complete = resolve;
    }));
    const prepared = prepareDocumentFileIntent(f.participants);
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(f.calls).toEqual(['pixels', 'adjustments', 'editing', 'layers', 'creation']);
    complete(); await prepared;
    expect(f.calls).toEqual(['pixels', 'adjustments', 'editing', 'layers', 'creation']);
  });

  it.each(['settlePixels', 'finishTextCreation', 'commitAdjustments', 'commitLayerDocument'] as const)(
    'rejects retirement across %s before another participant can run', async stage => {
      const f = fixture();
      f.participants[stage] = vi.fn(async () => { f.retire(); });
      await expect(prepareDocumentFileIntent(f.participants)).rejects.toThrow('Retired file target');
      if (stage === 'settlePixels' || stage === 'commitAdjustments') {
        expect(f.participants.finishTextEditing).not.toHaveBeenCalled();
      }
    });

  it('stops on a failed text commit instead of letting an encoder read stale content', async () => {
    const f = fixture();
    f.participants.finishTextCreation = vi.fn(async () => { throw new Error('Font preparation failed'); });
    await expect(prepareDocumentFileIntent(f.participants)).rejects.toThrow('Font preparation failed');
    expect(f.participants.finishTextEditing).toHaveBeenCalledOnce();
    expect(f.participants.commitAdjustments).toHaveBeenCalledOnce();
  });

  it('does no work for an already retired target', async () => {
    const f = fixture(); f.retire();
    await expect(prepareDocumentFileIntent(f.participants)).rejects.toThrow('Retired file target');
    expect(f.calls).toEqual([]);
  });
});
