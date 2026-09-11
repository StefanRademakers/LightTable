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
    this.transaction = null;
    const textCommit = binding.commitTextProperties();
    return textCommit !== null ? textCommit : binding.mutations.commitActive();
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
