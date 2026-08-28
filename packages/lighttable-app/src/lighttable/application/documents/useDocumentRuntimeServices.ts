import { useEffect, useMemo, useRef } from 'react';
import { DocumentCommandHistory } from '../commands/documentCommandHistory';
import { DocumentRendererLifecycle } from '../rendering/documentRendererLifecycle';
import { DocumentTaskRegistry } from '../tasks/documentTaskRegistry';
import type { DocumentSessionId } from './documentSession';

const HISTORY_LIMIT = 100;
const GPU_HISTORY_BYTE_LIMIT = 512 * 1024 * 1024;

export class OwnedDocumentRuntimeServices {
  readonly history: DocumentCommandHistory;
  readonly tasks: DocumentTaskRegistry;
  readonly rendererLifecycle: DocumentRendererLifecycle;

  constructor(documentId: DocumentSessionId) {
    this.history = new DocumentCommandHistory(documentId, {
      maxEntries: HISTORY_LIMIT,
      maxBytes: GPU_HISTORY_BYTE_LIMIT
    });
    this.tasks = new DocumentTaskRegistry(documentId);
    this.rendererLifecycle = new DocumentRendererLifecycle();
  }

  dispose(): void {
    this.history.dispose();
    this.tasks.dispose();
    this.rendererLifecycle.dispose();
  }
}

interface DocumentRuntimeServiceOptions {
  readonly documentId: DocumentSessionId;
  readonly active: boolean;
  readonly history?: DocumentCommandHistory;
  readonly tasks?: DocumentTaskRegistry;
  readonly rendererLifecycle?: DocumentRendererLifecycle;
  readonly onLocalDirtyChange?: (dirty: boolean) => void;
}

export interface DocumentRuntimeServices {
  readonly history: DocumentCommandHistory;
  readonly tasks: DocumentTaskRegistry;
  readonly rendererLifecycle: DocumentRendererLifecycle;
}

/**
 * Resolves runtime services for embedded and application-owned editor hosts.
 *
 * Standalone supplies document-owned history/tasks plus the one persistent
 * application renderer lifecycle. Embedded callers get an owned bundle
 * disposed with their view.
 */
export const useDocumentRuntimeServices = ({
  documentId,
  active,
  history,
  tasks,
  rendererLifecycle,
  onLocalDirtyChange
}: DocumentRuntimeServiceOptions): DocumentRuntimeServices => {
  const externallyOwned = Boolean(history && tasks && rendererLifecycle);
  const owned = useMemo(
    () => externallyOwned ? null : new OwnedDocumentRuntimeServices(documentId),
    [documentId, externallyOwned]
  );
  const onLocalDirtyChangeRef = useRef(onLocalDirtyChange);
  onLocalDirtyChangeRef.current = onLocalDirtyChange;

  const resolvedHistory = history ?? owned!.history;
  const resolvedTasks = tasks ?? owned!.tasks;
  const resolvedRendererLifecycle =
    rendererLifecycle ?? owned!.rendererLifecycle;

  useEffect(() => {
    if (history) return;
    return resolvedHistory.subscribe((snapshot) => {
      onLocalDirtyChangeRef.current?.(snapshot.dirty);
    });
  }, [history, resolvedHistory]);

  useEffect(() => () => owned?.dispose(), [owned]);

  useEffect(() => {
    resolvedRendererLifecycle.setActive(active);
  }, [active, resolvedRendererLifecycle]);

  return {
    history: resolvedHistory,
    tasks: resolvedTasks,
    rendererLifecycle: resolvedRendererLifecycle
  };
};
