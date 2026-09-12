import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createTextLayer, renameLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { TextToShapeIntent, type TextToShapeConfirmation, type TextToShapeIntentContext } from './TextToShapeIntent';
import { TextPropertyGestureController } from './TextPropertyGestureController';
import type { FlowTextEditingSessionController } from './flowTextEditingSession';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import type { DocumentSessionId } from '../documents/documentSession';
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const setup = () => {
  let document = createTextLayer(createImageDocument('Text', 100, 100, 'asset'), createDefaultTextLayerData(), 'Text');
  let identity = {}, mounted = true, request: TextToShapeConfirmation | null = null;
  const layerId = document.activeLayerId!, order: string[] = [];
  const text = { finishBeforeTransition: vi.fn(() => { order.push('text'); return true; }) };
  const creation = { cancelPoint: vi.fn(() => { order.push('point'); }), cancelParagraph: vi.fn(() => { order.push('paragraph'); }) };
  const execute = vi.fn(async (_layerId: typeof layerId): Promise<{ status: string; message?: string }> => ({ status: 'completed' }));
  const error = vi.fn(), status = vi.fn();
  const show = vi.fn((next: TextToShapeConfirmation) => { request = next; order.push('dialog'); });
  const owner = new TextToShapeIntent(() => ({ isMounted: () => mounted, error, status,
    dialogs: { requestTextToShape: show, closeTextToShape: current => { if (request === current) request = null; } },
    capture: (): TextToShapeIntentContext => { const opening = identity;
      return { isCurrent: () => mounted && identity === opening, getDocument: () => document,
        getRevision: () => document.revision, text, creation, execute }; }
  }));
  return { owner, layerId, text, creation, execute, error, status, show, order,
    request: () => request!, document: () => document,
    change: () => { document = renameLayer(document, layerId, 'Changed'); },
    setDocument: (next: typeof document) => { document = next; },
    retire: () => { identity = {}; }, unmount: () => { mounted = false; owner.cancel(); } };
};
describe('TextToShapeIntent', () => {
  it('finishes text truthfully before cancellation and confirmation; pins post-terminal target', async () => {
    const f = setup(); f.text.finishBeforeTransition.mockImplementation(() => { f.order.push('text'); f.change(); return true; });
    f.owner.request(f.layerId); expect(f.order).toEqual(['text', 'point', 'paragraph', 'dialog']);
    await f.request().confirm(); expect(f.execute).toHaveBeenCalledExactlyOnceWith(f.layerId, f.document().revision);
    expect(f.status).toHaveBeenLastCalledWith('Text converted to editable shapes.');
  });
  it.each(['false', 'throw'] as const)('does not cancel creation or open confirmation after text terminal %s', mode => {
    const f = setup(); f.text.finishBeforeTransition.mockImplementation(() => { if (mode === 'throw') throw new Error('Text failed'); return false; });
    f.owner.request(f.layerId); expect(f.show).not.toHaveBeenCalled(); expect(f.creation.cancelPoint).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledOnce(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('rejects retirement during a synchronous text terminal before touching successor creation', () => {
    const f = setup(); f.text.finishBeforeTransition.mockImplementation(() => { f.retire(); return true; });
    f.owner.request(f.layerId); expect(f.show).not.toHaveBeenCalled(); expect(f.creation.cancelPoint).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  });
  it('rejects changed target after confirmation opened', async () => {
    const f = setup(); f.owner.request(f.layerId); const request = f.request(); f.change();
    await request.confirm(); expect(f.execute).not.toHaveBeenCalled(); expect(f.error).toHaveBeenCalledOnce();
  });
  it('old cancel/confirm cannot close or execute a replacement confirmation', async () => {
    const f = setup(); f.owner.request(f.layerId); const old = f.request(); f.owner.request(f.layerId); const next = f.request();
    old.cancel(); await old.confirm(); expect(f.request()).toBe(next); expect(f.execute).not.toHaveBeenCalled();
    await next.confirm(); expect(f.execute).toHaveBeenCalledOnce();
  });
  it.each(['resolve', 'reject'] as const)('ignores retired asynchronous %s while preserving successor dialog', async terminal => {
    const f = setup(), wait = deferred<{ status: string }>(); f.execute.mockReturnValueOnce(wait.promise);
    f.owner.request(f.layerId); const old = f.request(), pending = old.confirm();
    f.retire(); f.owner.request(f.layerId); const next = f.request(); f.status.mockClear();
    if (terminal === 'resolve') wait.resolve({ status: 'completed' }); else wait.reject(new Error('Old failure'));
    await pending; expect(f.status).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled(); expect(f.request()).toBe(next);
  });
  it('reports genuine current rejection once and does not treat accepted as complete', async () => {
    const f = setup(); f.execute.mockResolvedValue({ status: 'rejected', message: 'Fonts unavailable' });
    f.owner.request(f.layerId); const request = f.request(); await request.confirm(); await request.confirm();
    expect(f.execute).toHaveBeenCalledOnce(); expect(f.error).toHaveBeenCalledExactlyOnceWith('Fonts unavailable');
  });
  it('retained callbacks after unmount neither dispatch nor report into another host', async () => {
    const f = setup(); f.owner.request(f.layerId); const request = f.request(); f.unmount();
    await request.confirm(); f.owner.request(f.layerId); expect(f.execute).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled();
  });
  it.each(['noop', 'blocked', 'failed'] as const)('uses real text-property/mutation terminal: %s', mode => {
    const f = setup(); let blocked = false;
    const mutations = createDocumentMutationController(() => ({ getDocument: f.document, applySnapshot: f.setDocument,
      previewSnapshot: vi.fn(), discardPreview: vi.fn(), isMutationBlocked: () => blocked,
      pushHistoryEntry: () => { if (mode === 'failed') throw new Error('Text history rejected'); } }));
    const text = new TextPropertyGestureController(() => ({ getDocument: f.document,
      getCommandDocumentId: () => 'session' as DocumentSessionId, documentMutations: mutations,
      textEditing: { getSnapshot: () => ({ status: 'idle' }) } as unknown as FlowTextEditingSessionController,
      recordObservedCommand: vi.fn(), reportError: vi.fn(), requestFrame: () => 1, cancelFrame: vi.fn() }));
    expect(text.begin(f.layerId)).toBe(true);
    if (mode !== 'noop') { text.queuePaint({ fontSize: 48 }); text.flushPaint(); }
    if (mode === 'blocked') blocked = true;
    f.text.finishBeforeTransition.mockImplementation(() => text.finishBeforeTransition(() => {}));
    f.owner.request(f.layerId); expect(f.show).toHaveBeenCalledTimes(mode === 'noop' ? 1 : 0);
    expect(f.error).toHaveBeenCalledTimes(mode === 'noop' ? 0 : 1);
  });
});
