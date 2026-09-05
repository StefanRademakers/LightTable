import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createDefaultAdjustments } from '../../types';
import { executeSemanticGradePatch } from './executeSemanticGradePatch';

describe('semantic Grade patch executor', () => {
  it('publishes one reversible snapshot only when values change', () => {
    const document = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const documentAdjustments = createDefaultAdjustments();
    const publish = vi.fn();
    const pushHistoryEntry = vi.fn();
    const result = executeSemanticGradePatch({
      document, documentAdjustments, target: { kind: 'document' },
      values: { sharpeningAmount: 45 }, historyType: 'adjustment.detail',
      historyLabel: 'Set Detail',
      mutate: (snapshot, values) => { snapshot.detail.sharpeningAmount = values.sharpeningAmount; },
      publish, pushHistoryEntry
    });
    expect(result.changed).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ sharpeningAmount: 45 })
    }), null);
    const history = pushHistoryEntry.mock.calls[0]?.[0];
    history.undo(); history.redo();
    expect(publish).toHaveBeenCalledTimes(3);

    publish.mockClear(); pushHistoryEntry.mockClear();
    expect(executeSemanticGradePatch({
      document, documentAdjustments, target: { kind: 'document' },
      values: { sharpeningAmount: 0 }, historyType: 'adjustment.detail',
      historyLabel: 'Set Detail',
      mutate: (snapshot, values) => { snapshot.detail.sharpeningAmount = values.sharpeningAmount; },
      publish, pushHistoryEntry
    }).changed).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(pushHistoryEntry).not.toHaveBeenCalled();
  });

  it('restores the prior snapshot when history rejects the patch', () => {
    const document = createRasterLayer(createImageDocument('Fixture', 80, 60, 'source'));
    const documentAdjustments = createDefaultAdjustments();
    let published = documentAdjustments;

    expect(() => executeSemanticGradePatch({
      document, documentAdjustments, target: { kind: 'document' },
      values: { sharpeningAmount: 45 }, historyType: 'adjustment.detail',
      historyLabel: 'Set Detail',
      mutate: (snapshot, values) => { snapshot.detail.sharpeningAmount = values.sharpeningAmount; },
      publish: (snapshot) => { published = snapshot; },
      pushHistoryEntry: () => { throw new Error('History rejected the patch.'); }
    })).toThrow('History rejected the patch.');

    expect(published.detail.sharpeningAmount).toBe(0);
  });
});
