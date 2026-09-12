import { expect, it, vi } from 'vitest';
import { WorkspaceDocumentIntents, type WorkspaceDocumentIntentPorts } from './WorkspaceDocumentIntents';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';

const makeSession = () => new DocumentSession({ id: 'A' as DocumentSessionId,
  source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
const fixture = (overrides: Partial<WorkspaceDocumentIntentPorts> = {}) => {
  let session = makeSession(), activeId = 'A', currentScope = {}, mounted = true;
  const order: string[] = [];
  const ports: WorkspaceDocumentIntentPorts = {
    isMounted: () => mounted, getActiveDocumentId: () => activeId, getSession: () => session,
    captureScope: () => { const opening = currentScope; return { isCurrent: () => currentScope === opening }; },
    text: { finishBeforeTransition: vi.fn(callback => { order.push('finish-text'); callback(); return true; }) },
    activateDocument: vi.fn(id => { order.push(`activate:${id}`); }),
    closeDocument: vi.fn(id => { order.push(`close:${id}`); }), closeEditor: vi.fn(), reportFailure: vi.fn(),
    ...overrides
  };
  return { ports, order, owner: new WorkspaceDocumentIntents(() => ports), session: () => session,
    retire: (kind: 'session' | 'scope' | 'active' | 'unmount') => {
      if (kind === 'session') session = makeSession();
      else if (kind === 'scope') currentScope = {};
      else if (kind === 'active') activeId = 'B';
      else mounted = false;
    } };
};
it('finishes text before requesting another tab but does nothing for the active tab', () => {
  const f = fixture(); f.owner.activate('A'); expect(f.order).toEqual([]);
  f.owner.activate('B'); expect(f.order).toEqual(['finish-text', 'activate:B']);
});
it('finishes active text before close and closes inactive tabs without touching current text', () => {
  const f = fixture(); f.owner.close('B'); f.owner.close('A');
  expect(f.order).toEqual(['close:B', 'finish-text', 'close:A']);
});
it('does not finish text for a missing activation capability or close an inactive tab through closeEditor', () => {
  const f = fixture({ activateDocument: undefined, closeDocument: undefined });
  f.owner.activate('B'); f.owner.close('B'); expect(f.order).toEqual([]); expect(f.ports.closeEditor).not.toHaveBeenCalled();
  f.owner.close('A'); expect(f.order).toEqual(['finish-text']); expect(f.ports.closeEditor).toHaveBeenCalledOnce();
});
it.each(['activate', 'close'] as const)('a rejected text terminal visibly blocks %s', action => {
  const f = fixture(); vi.mocked(f.ports.text.finishBeforeTransition).mockReturnValue(false);
  f.owner[action](action === 'activate' ? 'B' : 'A');
  expect(f.ports.activateDocument).not.toHaveBeenCalled(); expect(f.ports.closeDocument).not.toHaveBeenCalled();
  expect(f.ports.reportFailure).toHaveBeenCalledOnce();
  expect(vi.mocked(f.ports.reportFailure).mock.calls[0][0]).toContain('text edit could not be committed');
});
it('reports current thrown text/history failure without making the host request', () => {
  const f = fixture(); vi.mocked(f.ports.text.finishBeforeTransition).mockImplementation(() => { throw new Error('History commit failed'); });
  f.owner.close('A'); expect(f.ports.closeDocument).not.toHaveBeenCalled();
  expect(f.ports.reportFailure).toHaveBeenCalledWith('History commit failed');
});
it.each(['session', 'scope', 'active', 'unmount'] as const)('revalidates %s after a synchronous text publication before the host callback', kind => {
  const f = fixture(); vi.mocked(f.ports.text.finishBeforeTransition).mockImplementation(callback => {
    f.retire(kind); callback(); return true;
  });
  f.owner.activate('B'); expect(f.ports.activateDocument).not.toHaveBeenCalled(); expect(f.ports.reportFailure).not.toHaveBeenCalled();
});
it('does not report a retired text failure into its successor', () => {
  const f = fixture(); vi.mocked(f.ports.text.finishBeforeTransition).mockImplementation(() => {
    f.retire('session'); throw new Error('Old history failed');
  });
  f.owner.close('A'); expect(f.ports.reportFailure).not.toHaveBeenCalled(); expect(f.ports.closeDocument).not.toHaveBeenCalled();
});
it.each(['opening', 'failed'] as const)('permits closing an %s document without requiring an image or ready renderer', status => {
  const f = fixture(); if (status === 'failed') f.session().setFailed('Decode failed');
  f.owner.close('A'); expect(f.order).toEqual(['finish-text', 'close:A']);
});
it('does not execute retained UI callbacks after unmount', () => {
  const f = fixture(); f.retire('unmount'); f.owner.activate('B'); f.owner.close('A'); f.owner.close('B');
  expect(f.order).toEqual([]); expect(f.ports.reportFailure).not.toHaveBeenCalled();
});
it('allows the host to own asynchronous completion without adding a second transition queue', () => {
  const f = fixture(); f.owner.activate('B'); f.owner.activate('C');
  expect(f.order).toEqual(['finish-text', 'activate:B', 'finish-text', 'activate:C']);
});
