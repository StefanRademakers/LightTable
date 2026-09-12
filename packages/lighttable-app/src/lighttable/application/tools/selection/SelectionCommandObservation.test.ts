import { expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../../documents/documentSession';
import type { LayerId } from '../../../editor/document/documentTypes';
import { createDefaultMagicWandOptions } from '../../../editor/selection/selectionTypes';
import { SelectionCommandObservation } from './SelectionCommandObservation';

it('records bounded replay payloads against the captured session, excluding renderer dabs', () => {
  const recordObservedCommand = vi.fn();
  const session = { id: 'opening-document' as DocumentSessionId };
  const binding = new SelectionCommandObservation(session, { recordObservedCommand }, () => true);
  const shape = { mode: 'replace' as const, shape: { kind: 'rectangle' as const,
    points: [{ x: 1, y: 2 }, { x: 20, y: 30 }] }, featherRadius: 2, antiAlias: true };
  binding.shape(shape);
  expect(recordObservedCommand).toHaveBeenLastCalledWith('selection.applyShape', session.id, shape, shape);
  const wand = { kind: 'magic-wand' as const, layerId: 'layer' as LayerId, mode: 'add' as const,
    point: { x: 10, y: 15 }, options: createDefaultMagicWandOptions() };
  binding.magicWand(wand);
  expect(recordObservedCommand).toHaveBeenLastCalledWith('selection.applyMagicWand', session.id, wand,
    { layerId: wand.layerId, mode: wand.mode, point: wand.point, options: wand.options });
  binding.paint({ kind: 'selection-paint', mode: 'subtract', size: 20, hardness: 0.5,
    opacity: 0.8, smooth: 0.2, dabs: [], samples: [{ x: 4, y: 5, pressure: 0.6 }] });
  expect(recordObservedCommand).toHaveBeenLastCalledWith('tool.commitGesture', session.id, {
    kind: 'selection-paint', parameters: { mode: 'subtract', size: 20, hardness: 0.5, opacity: 0.8, smooth: 0.2 },
    samples: [{ x: 4, y: 5, pressure: 0.6 }]
  }, { kind: 'selection-paint', sampleCount: 1 });
});

it('rejects late observations after same-ID session retirement rather than recording against its successor', () => {
  const opening = { id: 'same-id' as DocumentSessionId };
  let current = opening;
  const recordObservedCommand = vi.fn();
  const binding = new SelectionCommandObservation(opening, { recordObservedCommand }, () => current === opening);
  const completion = binding.shape;
  current = { id: opening.id };
  completion({ mode: 'replace', shape: { kind: 'rectangle', points: [] }, featherRadius: 0, antiAlias: false });
  expect(recordObservedCommand).not.toHaveBeenCalled();
});
