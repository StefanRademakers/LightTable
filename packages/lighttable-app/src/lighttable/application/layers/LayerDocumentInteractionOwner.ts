import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentMutationController, DocumentMutationTransaction } from '../documents/useDocumentMutationController';

export interface LayerDocumentInteractionBinding {
  readonly mutations: DocumentMutationController;
  assertCurrent(): void;
  resetFaceWarp(): void;
  cancelTextProperties(): void;
  commitTextProperties(): boolean | null;
}

/** Retains only the layer-panel gesture; canonical/history remain with mutations. */
export class LayerDocumentInteractionOwner {
  private transaction: DocumentMutationTransaction | null = null;

  constructor(private readonly capture: () => LayerDocumentInteractionBinding) {}

  begin = (): boolean => {
    if (this.transaction?.active) return false;
    const binding = this.capture();
    binding.assertCurrent();
    this.transaction = binding.mutations.begin('layer-panel');
    return this.transaction !== null;
  };

  change = (change: (document: ImageDocument) => ImageDocument, recordHistory = true): boolean => {
    const binding = this.capture();
    binding.assertCurrent();
    return this.transaction?.active
      ? this.transaction.change(change)
      : binding.mutations.change(change, recordHistory);
  };

  commit = (): boolean => {
    const transaction = this.transaction;
    this.transaction = null;
    return transaction?.commit() ?? false;
  };

  cancel = (): boolean => {
    const transaction = this.transaction;
    this.transaction = null;
    return transaction?.cancel() ?? false;
  };

  commitActive = (): boolean => {
    const binding = this.capture();
    binding.assertCurrent();
    return this.commitBinding(binding);
  };

  private commitBinding(binding: LayerDocumentInteractionBinding): boolean {
    this.transaction = null;
    const textCommit = binding.commitTextProperties();
    return textCommit !== null ? textCommit : binding.mutations.commitActive();
  }

  /** Save/export waits for existing publication, then commits without history-reset cancellation. */
  finishForFile = async (): Promise<void> => {
    const binding = this.capture();
    binding.assertCurrent();
    const terminal = binding.mutations.observeActiveTerminal();
    if (!terminal) return;
    await terminal.waitForIdle();
    binding.assertCurrent();
    if (terminal.reason && terminal.reason !== 'commit') {
      if (terminal.error !== null) throw terminal.error;
      throw new Error(`The document gesture ended as ${terminal.reason} before the file operation.`);
    }
    if (!terminal.reason) this.commitBinding(binding);
    await terminal.waitForIdle();
    binding.assertCurrent();
    if (terminal.reason !== 'commit' || binding.mutations.active) {
      if (terminal.error !== null) throw terminal.error;
      throw new Error(`The document gesture did not finish before the file operation (${terminal.reason ?? 'pending'}).`);
    }
  };

  resetForHistory = async (): Promise<void> => {
    const binding = this.capture();
    binding.assertCurrent();
    await binding.mutations.waitForIdle();
    binding.assertCurrent();
    this.transaction = null;
    binding.resetFaceWarp();
    binding.cancelTextProperties();
    binding.mutations.cancelActive();
  };
}
