import { describe, expect, it, vi } from 'vitest';
import { CanvasPickerController, type CanvasPickerPorts } from './CanvasPickerController';
import { createDefaultAdjustments } from '../../types';
import { MAX_POINT_COLOR_SAMPLES } from '../../pointColor';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createAdjustmentTransactionController } from './useAdjustmentTransactionController';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve: (value: T) => resolve(value) };
};
const setup = () => {
  let current = true;
  let target = 'grade-a';
  let tool = 'brush';
  let adjustments = createDefaultAdjustments();
  const runtime = { sampleDisplayColor: vi.fn(async () => [128, 64, 32, 255]),
    setScopeInteractionActive: vi.fn(), setLensBlurInteractionActive: vi.fn() };
  let document = createImageDocument('Picker', 100, 100, 'source');
  const entries: EditorHistoryEntry[] = [];
  const history = { reject: false };
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document, applySnapshot: next => { document = next; },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: vi.fn()
  }));
  const controller = createAdjustmentTransactionController(() => ({
    getDocumentId: () => document.id, getDocument: () => document,
    getDocumentAdjustments: () => adjustments, getCanonicalAdjustments: () => adjustments,
    getActiveTargetLayerId: () => null, getActiveTargetIdentity: () => target,
    getRenderer: () => runtime, getRendererGeneration: () => 1,
    documentMutations: mutations, previewDocumentProcessing: vi.fn(),
    commitDocumentProcessing: next => { adjustments = next; },
    stageEditorAdjustments: vi.fn(), restoreStagedSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushProcessingHistoryEntry: entry => {
      if (history.reject) throw new Error('History rejected');
      entries.push(entry);
    }
  }));
  const ports: CanvasPickerPorts = {
    captureScope: () => ({ isCurrent: () => current, assertCurrent: vi.fn() }),
    getTargetIdentity: () => target, getBrushIntent: () => tool, getRenderer: () => runtime,
    getFocusSource: () => ({ depth: { width: 3, height: 3, data: new Float32Array(9).fill(0.25), nearIsOne: true },
      width: 100, height: 100, distortion: adjustments.effects.lensDistortion }),
    finishAdjustment: vi.fn(), settleInteraction: vi.fn(async () => {}),
    change: vi.fn((recipe, domain) => controller.change(recipe, domain)),
    publishBrushColor: vi.fn()
  };
  return { ports, runtime, entries, history, picker: new CanvasPickerController(() => ports),
    read: () => adjustments, retire: () => { current = false; },
    switchTarget: () => { target = 'grade-b'; }, switchTool: () => { tool = 'fill'; } };
};

describe('CanvasPickerController', () => {
  it('samples one Point Color and disarms only its own accepted request', async () => {
    const f = setup(); f.picker.setPointColorActive(true);
    expect(await f.picker.pickColor({ x: 0.5, y: 0.5 })).toBe(true);
    expect(f.read().pointColor.samples).toHaveLength(1);
    expect(f.picker.getSnapshot().pointColorActive).toBe(false);
    expect(f.ports.change).toHaveBeenCalledOnce();
    expect(f.entries).toHaveLength(1);
    await f.entries[0].undo(); expect(f.read().pointColor.samples).toHaveLength(0);
    await f.entries[0].redo(); expect(f.read().pointColor.samples).toHaveLength(1);
  });

  it.each(['retire', 'target', 'cancel', 'restart'] as const)('rejects %s during readback without changing another owner or disarming a newer picker', async kind => {
    const f = setup(); const readback = deferred<number[]>();
    f.runtime.sampleDisplayColor.mockReturnValue(readback.promise);
    f.picker.setPointColorActive(true);
    const pick = f.picker.pickColor({ x: 0.5, y: 0.5 });
    if (kind === 'retire') f.retire();
    if (kind === 'target') f.switchTarget();
    if (kind === 'cancel') f.picker.reset();
    if (kind === 'restart') { f.picker.setPointColorActive(false); f.picker.setPointColorActive(true); }
    readback.resolve([128, 64, 32, 255]);
    expect(await pick).toBe(false);
    expect(f.ports.change).not.toHaveBeenCalled();
    expect(f.ports.settleInteraction).not.toHaveBeenCalled();
    if (kind === 'restart') expect(f.picker.getSnapshot().pointColorActive).toBe(true);
  });

  it('guards the same point request through the second asynchronous admission boundary', async () => {
    const f = setup(); const admission = deferred<void>();
    vi.mocked(f.ports.settleInteraction).mockReturnValue(admission.promise);
    f.picker.setPointColorActive(true);
    const pick = f.picker.pickColor({ x: 0.5, y: 0.5 });
    await vi.waitFor(() => expect(f.ports.settleInteraction).toHaveBeenCalledOnce());
    f.picker.setPointColorActive(false); f.picker.setPointColorActive(true);
    admission.resolve();
    expect(await pick).toBe(false); expect(f.ports.change).not.toHaveBeenCalled();
    expect(f.picker.getSnapshot().pointColorActive).toBe(true);
  });

  it('keeps the newest ordinary brush sample when readbacks finish out of order', async () => {
    const f = setup(); const first = deferred<number[]>(); const second = deferred<number[]>();
    f.runtime.sampleDisplayColor.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = f.picker.pickColor({ x: 0, y: 0 }); const b = f.picker.pickColor({ x: 1, y: 1 });
    second.resolve([1, 2, 3, 255]); expect(await b).toBe(true);
    first.resolve([255, 0, 0, 255]); expect(await a).toBe(false);
    expect(f.ports.publishBrushColor).toHaveBeenCalledExactlyOnceWith('#010203');
    expect(f.ports.settleInteraction).not.toHaveBeenCalled();
  });

  it('does not apply an ordinary brush sample after switching tools', async () => {
    const f = setup(); const readback = deferred<number[]>();
    f.runtime.sampleDisplayColor.mockReturnValue(readback.promise);
    const pending = f.picker.pickColor({ x: 0, y: 0 }); f.switchTool();
    readback.resolve([128, 64, 32, 255]);
    expect(await pending).toBe(false); expect(f.ports.publishBrushColor).not.toHaveBeenCalled();
  });

  it.each(['retire', 'target'] as const)('does not publish focus after %s during admission', async kind => {
    const f = setup(); const admission = deferred<void>();
    vi.mocked(f.ports.settleInteraction).mockReturnValue(admission.promise);
    f.picker.setFocusActive(true);
    const pending = f.picker.pickFocus({ x: 0.5, y: 0.5 });
    if (kind === 'retire') f.retire(); else f.switchTarget();
    admission.resolve(); expect(await pending).toBe(false);
    expect(f.entries).toHaveLength(0);
  });

  it('retains opening ports and never publishes into replacement ports', async () => {
    const opening = setup(); const replacement = setup(); const readback = deferred<number[]>();
    let ports = opening.ports;
    const picker = new CanvasPickerController(() => ports);
    opening.runtime.sampleDisplayColor.mockReturnValue(readback.promise);
    picker.setPointColorActive(true);
    const pending = picker.pickColor({ x: 0, y: 0 });
    ports = replacement.ports; opening.retire(); readback.resolve([128, 64, 32, 255]);
    expect(await pending).toBe(false);
    expect(opening.entries).toHaveLength(0); expect(replacement.entries).toHaveLength(0);
  });

  it('returns a true no-op without extra history at maximum samples', async () => {
    const f = setup();
    for (let i = 0; i < MAX_POINT_COLOR_SAMPLES; i++) {
      f.picker.setPointColorActive(true); expect(await f.picker.pickColor({ x: 0, y: 0 })).toBe(true);
    }
    const before = f.read(); f.picker.setPointColorActive(true);
    expect(await f.picker.pickColor({ x: 0, y: 0 })).toBe(false);
    expect(f.entries).toHaveLength(MAX_POINT_COLOR_SAMPLES);
    expect(f.read()).toBe(before);
  });

  it('accepts focus through normal cursor disarming but rejects explicit cancellation during admission', async () => {
    const f = setup(); let admission = deferred<void>();
    vi.mocked(f.ports.settleInteraction).mockImplementation(() => admission.promise);
    f.picker.setFocusActive(true);
    const accepted = f.picker.pickFocus({ x: 0.5, y: 0.5 }); f.picker.disarmFocus();
    admission.resolve(); expect(await accepted).toBe(true);
    expect(f.read().effects.lensBlur.focusDistance).toBe(0.25);
    admission = deferred<void>(); f.picker.setFocusActive(true);
    const canceled = f.picker.pickFocus({ x: 0.5, y: 0.5 }); f.picker.reset();
    admission.resolve(); expect(await canceled).toBe(false);
    expect(f.ports.change).toHaveBeenCalledOnce();
  });

  it('leaves real sampling and admission failures observable', async () => {
    const f = setup();
    f.runtime.sampleDisplayColor.mockRejectedValueOnce(new Error('GPU readback failed'));
    await expect(f.picker.pickColor({ x: 0, y: 0 })).rejects.toThrow('GPU readback failed');
    f.picker.setPointColorActive(true);
    vi.mocked(f.ports.settleInteraction).mockRejectedValueOnce(new Error('Commit failed'));
    await expect(f.picker.pickColor({ x: 0, y: 0 })).rejects.toThrow('Commit failed');
    expect(f.ports.change).not.toHaveBeenCalled();
  });

  it('rolls back a rejected history publication and keeps failure observable', async () => {
    const f = setup(); f.history.reject = true; f.picker.setPointColorActive(true);
    await expect(f.picker.pickColor({ x: 0.5, y: 0.5 })).rejects.toThrow('History rejected');
    expect(f.read().pointColor.samples).toHaveLength(0);
    expect(f.entries).toHaveLength(0);
  });
});
