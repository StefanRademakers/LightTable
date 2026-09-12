import type { DocumentSession } from '../documents/documentSession';
import type { DocumentHistoryController } from '../commands/useDocumentHistoryController';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { createDocumentProjectionBinding } from '../documents/documentProjectionBinding';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { BasicAdjustments } from '../../types';
import type { SemanticBasicAdjustmentCommand, BasicAdjustmentTarget } from '../commands/semanticBasicAdjustmentCommandContract';
import type { SemanticDetailAdjustmentCommand } from '../commands/semanticDetailAdjustmentCommandContract';
import type { SemanticAdjustmentSnapshotCommand } from '../commands/semanticAdjustmentSnapshotCommandContract';
import type { SemanticProcessingStructureCommand } from '../commands/semanticProcessingStructureCommandContract';
import type { SemanticGradePatchHistoryEntry } from './executeSemanticGradePatch';
import { executeSemanticGradePatch } from './executeSemanticGradePatch';
import { executeSemanticAdjustmentSnapshot } from './executeSemanticAdjustmentSnapshot';
import { executeSemanticProcessingStructure } from './executeSemanticProcessingStructure';
import { resolveBasicAdjustmentTarget } from './basicAdjustmentTarget';
import { projectBasicAdjustmentValues } from './basicAdjustmentQuery';
import { projectAdjustmentQuery, type AdjustmentQueryTarget } from './adjustmentQuery';

interface Ports {
  readonly session: DocumentSession | undefined;
  readonly renderer: object | null;
  readonly registration: { isCurrent(): boolean };
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  isRendererReady(): boolean;
  readonly adjustments: { finish(): void };
  readonly structure: { commit(): unknown };
  readonly mutations: Pick<DocumentMutationController, 'change'>;
  readonly history: Pick<DocumentHistoryController, 'record'>;
  readonly projection: Pick<ReturnType<typeof createDocumentProjectionBinding>, 'presentDocumentProcessing'>;
}

/** Mounted command mapping only. Canonical processing/history remain session-owned. */
export const createMountedAdjustmentCommandBinding = (ports: Ports) => {
  const session = ports.session;
  const read = () => {
    const state = session?.getSnapshot();
    if (!session || !state?.document || state.lifecycle !== 'ready'
      || ports.getSession() !== session || !ports.renderer || ports.getRenderer() !== ports.renderer
      || !ports.registration.isCurrent() || !ports.isRendererReady()
      || ports.getProjectedDocument()?.id !== state.document.id) {
      throw new Error('The adjustment command belongs to a retired document renderer.');
    }
    return { ...state, document: state.document };
  };
  const begin = (structure = false) => {
    read(); ports.adjustments.finish(); read();
    if (structure) { ports.structure.commit(); read(); }
    return read();
  };
  const assertMutationAllowed = () => {
    read();
    if (!session!.isAcceptingMutations()) throw new Error('Document mutations are blocked while other document work is active.');
  };
  // These closures retain the canonical session, never the opening renderer lease.
  const publish = (adjustments: BasicAdjustments) => {
    session!.publishProcessing({ adjustments });
    const state = session!.getSnapshot();
    if (ports.getSession() === session && state.document && ports.getRenderer() && ports.isRendererReady()
      && ports.getProjectedDocument()?.id === state.document.id) {
      ports.projection.presentDocumentProcessing(state.document, state.processing.adjustments);
    }
  };
  const record = (entry: SemanticGradePatchHistoryEntry) => {
    read(); ports.history.record(entry);
  };
  const options = () => {
    const state = begin();
    return { document: state.document, documentAdjustments: state.processing.adjustments,
      assertMutationAllowed, changeDocument: ports.mutations.change,
      publishDocumentProcessing: publish, pushProcessingHistoryEntry: record };
  };
  return {
    executeBasicAdjustmentCommand: (command: SemanticBasicAdjustmentCommand) => executeSemanticGradePatch({
      ...options(), target: command.target, values: command.values,
      historyType: 'adjustment.basic', historyLabel: 'Set Basic Grade',
      mutate: (snapshot, values) => Object.assign(snapshot, values)
    }),
    executeDetailAdjustmentCommand: (command: SemanticDetailAdjustmentCommand) => executeSemanticGradePatch({
      ...options(), target: command.target, values: command.values,
      historyType: 'adjustment.detail', historyLabel: 'Set Detail',
      mutate: (snapshot, values) => Object.assign(snapshot.detail, values)
    }),
    executeAdjustmentSnapshot: (command: SemanticAdjustmentSnapshotCommand) => executeSemanticAdjustmentSnapshot({
      ...options(), target: command.target, snapshot: command.snapshot
    }),
    executeProcessingStructure: (command: SemanticProcessingStructureCommand) => {
      begin(true); return executeSemanticProcessingStructure(command, { changeDocument: ports.mutations.change });
    },
    queryBasicAdjustments: (target: BasicAdjustmentTarget) => {
      const state = read();
      const resolved = resolveBasicAdjustmentTarget(state.document, state.processing.adjustments, target, { allowLocked: true });
      if ('message' in resolved) throw new Error(resolved.message);
      const layer = resolved.targetLayerId ? findDocumentLayer(state.document, resolved.targetLayerId) : null;
      return { target, documentRevision: state.documentRevision,
        targetRevision: layer?.revision ?? state.documentRevision,
        values: projectBasicAdjustmentValues(resolved.adjustments) };
    },
    queryAdjustments: (target: AdjustmentQueryTarget) => {
      const state = read();
      return projectAdjustmentQuery(session!.id, state.document, state.processing.adjustments, state.documentRevision, target);
    }
  };
};
