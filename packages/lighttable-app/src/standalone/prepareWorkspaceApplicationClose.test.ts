import { describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { LightTableRecoveryStore } from '../platform/LightTableRecoveryStore';
import type { StandaloneWorkspaceDocument } from './projectStandaloneDocumentWorkspace';
import { prepareWorkspaceApplicationClose } from './prepareWorkspaceApplicationClose';

const documentId = 'document-close' as DocumentSessionId;

const createDocument = () => {
  const session = new DocumentSession({
    id: documentId,
    source: { id: 'source', name: 'Dirty.png', mediaType: 'image/png' }
  });
  session.setReady();
  session.markChanged();
  return {
    session,
    document: {
      id: documentId,
      kind: 'image',
      title: 'Dirty.png',
      dirty: true,
      active: true,
      session,
      runtime: { recovery: null }
    } as unknown as StandaloneWorkspaceDocument
  };
};

describe('prepareWorkspaceApplicationClose', () => {
  it('retains command, transition, session, history and task admission through host handoff', async () => {
    const { session, document } = createDocument();
    const commandRelease = vi.fn();
    const transitionRelease = vi.fn();
    const recovery = { remove: vi.fn(async () => undefined) } as unknown as LightTableRecoveryStore;

    const release = await prepareWorkspaceApplicationClose({
      documents: [document],
      acquireCommandAdmission: () => ({ waitForIdle: async () => undefined, release: commandRelease }),
      acquireTransitionAdmission: async () => transitionRelease,
      getTransitionRevision: () => 4,
      getCanonicalImageIds: () => [documentId],
      getCanonicalSession: () => session,
      confirmDiscardChanges: async () => true,
      recovery,
      clearRecoveryAttempt: vi.fn(),
      reportError: vi.fn()
    });

    expect(release).toBeTypeOf('function');
    expect(recovery.remove).toHaveBeenCalledWith(documentId, 1);
    expect(session.isAcceptingMutations()).toBe(false);
    await expect(session.tasks.run('save', 'Late save', async () => true)).resolves.toMatchObject({
      status: 'failed'
    });
    expect(commandRelease).not.toHaveBeenCalled();
    release?.();
    expect(commandRelease).toHaveBeenCalledOnce();
    expect(transitionRelease).toHaveBeenCalledOnce();
    expect(session.isAcceptingMutations()).toBe(true);
    session.dispose();
  });

  it('fails closed and releases every admission when recovery cleanup fails', async () => {
    const { session, document } = createDocument();
    const commandRelease = vi.fn();
    const transitionRelease = vi.fn();
    const reportError = vi.fn();
    const recovery = {
      remove: vi.fn(async () => { throw new Error('disk unavailable'); })
    } as unknown as LightTableRecoveryStore;

    await expect(prepareWorkspaceApplicationClose({
      documents: [document],
      acquireCommandAdmission: () => ({ waitForIdle: async () => undefined, release: commandRelease }),
      acquireTransitionAdmission: async () => transitionRelease,
      getTransitionRevision: () => 4,
      getCanonicalImageIds: () => [documentId],
      getCanonicalSession: () => session,
      confirmDiscardChanges: async () => true,
      recovery,
      clearRecoveryAttempt: vi.fn(),
      reportError
    })).resolves.toBeNull();

    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('disk unavailable'), expect.any(Error));
    expect(commandRelease).toHaveBeenCalledOnce();
    expect(transitionRelease).toHaveBeenCalledOnce();
    expect(session.isAcceptingMutations()).toBe(true);
    session.dispose();
  });
});
