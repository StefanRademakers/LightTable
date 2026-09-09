import type { DocumentSession, DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { LightTableRecoveryStore } from '../platform/LightTableRecoveryStore';
import type { StandaloneWorkspaceDocument } from './projectStandaloneDocumentWorkspace';
import { waitForRunningDocumentSave } from './requestWorkspaceDocumentClose';

interface CommandAdmission {
  waitForIdle(): Promise<void>;
  release(): void;
}

interface PrepareWorkspaceApplicationCloseOptions {
  readonly documents: readonly StandaloneWorkspaceDocument[];
  readonly acquireCommandAdmission: () => CommandAdmission;
  readonly acquireTransitionAdmission: () => Promise<() => void>;
  readonly getTransitionRevision: () => number;
  readonly getCanonicalImageIds: () => readonly DocumentSessionId[];
  readonly getCanonicalSession: (id: DocumentSessionId) => DocumentSession | null;
  readonly confirmDiscardChanges: (title: string) => Promise<boolean>;
  readonly recovery?: LightTableRecoveryStore;
  readonly clearRecoveryAttempt: (recoveryId: string) => void;
  readonly reportError: (message: string, reason?: unknown) => void;
}

/**
 * Acquires every application/document admission needed to hand the workspace
 * to the host close boundary. A successful result must remain held until the
 * host either closes or rejects the request.
 */
export const prepareWorkspaceApplicationClose = async ({
  documents,
  acquireCommandAdmission,
  acquireTransitionAdmission,
  getTransitionRevision,
  getCanonicalImageIds,
  getCanonicalSession,
  confirmDiscardChanges,
  recovery,
  clearRecoveryAttempt,
  reportError
}: PrepareWorkspaceApplicationCloseOptions): Promise<(() => void) | null> => {
  const commandAdmission = acquireCommandAdmission();
  const releaseTransitionAdmission = await acquireTransitionAdmission();
  const documentAdmissions = new Map<
    DocumentSessionId,
    ReturnType<DocumentSession['acquireMutationAdmission']>
  >();
  let retained = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    commandAdmission.release();
    releaseTransitionAdmission();
    for (const admission of documentAdmissions.values()) admission.release();
    documentAdmissions.clear();
  };

  try {
    await commandAdmission.waitForIdle();
    for (const document of documents) {
      if (document.kind !== 'image') continue;
      const saveStatus = await waitForRunningDocumentSave(document.session);
      if (saveStatus && saveStatus !== 'completed') return null;
      if (document.session.getSnapshot().tasks.activeTaskIds.length > 0) {
        reportError('Application close was stopped because a document task is still running.');
        return null;
      }
      documentAdmissions.set(
        document.id,
        document.session.acquireMutationAdmission('Application close is pending.')
      );
    }

    const plan = documents.map((document) => {
      const admission = documentAdmissions.get(document.id);
      return {
        document,
        dirty: admission?.dirty ?? document.dirty,
        revision: admission?.revision ?? 0
      };
    });
    const transitionRevision = getTransitionRevision();
    const plannedImageIds = plan.flatMap(({ document }) => document.kind === 'image'
      ? [document.id]
      : []);
    const canonicalImageIds = getCanonicalImageIds();
    if (plannedImageIds.length !== canonicalImageIds.length
      || plannedImageIds.some((id, index) => canonicalImageIds[index] !== id)) {
      reportError('Application close was stopped while the workspace was still settling.');
      return null;
    }

    for (const item of plan) {
      if (item.dirty && !await confirmDiscardChanges(item.document.title)) return null;
    }

    const planIsCurrent = () => {
      const currentImageIds = getCanonicalImageIds();
      return getTransitionRevision() === transitionRevision
        && currentImageIds.length === plannedImageIds.length
        && plannedImageIds.every((id, index) => currentImageIds[index] === id)
        && plan.every((item) => {
          if (item.document.kind !== 'image') return true;
          if (getCanonicalSession(item.document.id) !== item.document.session) return false;
          const state = item.document.session.getSnapshot();
          return state.documentRevision === item.revision
            && state.dirty === item.dirty
            && state.tasks.activeTaskIds.length === 0;
        });
    };
    if (!planIsCurrent()) {
      reportError('Application close was stopped because a document changed during confirmation.');
      return null;
    }

    for (const item of plan) {
      if (!item.dirty) continue;
      const recoveryId = item.document.kind === 'image'
        ? item.document.runtime.recovery?.recoveryId
        : undefined;
      if (recoveryId) await recovery?.removeRecord(recoveryId);
      else await recovery?.remove(item.document.id, item.revision);
      if (recoveryId) clearRecoveryAttempt(recoveryId);
    }
    if (!planIsCurrent()) {
      reportError('Application close was stopped because a document changed during recovery cleanup.');
      return null;
    }

    retained = true;
    return release;
  } catch (reason) {
    reportError(`Application close was stopped: ${
      reason instanceof Error ? reason.message : String(reason)
    }`, reason);
    return null;
  } finally {
    if (!retained) release();
  }
};
