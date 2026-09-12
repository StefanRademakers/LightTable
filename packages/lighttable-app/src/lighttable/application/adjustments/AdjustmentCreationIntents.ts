import type { DocumentSession, DocumentSessionId } from '../documents/documentSession';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { AdjustmentLayerKind } from '../../processing/adjustmentLayerCatalog';
import { adjustmentStackHasLocalProcessing } from '../../processing/adjustmentStack';
import { resolveContextualAdjustmentCreation, type SemanticAdjustmentCreationCommand } from '../commands/semanticAdjustmentCreationCommandContract';
import type { PropertiesInspectorPresentation } from '../properties/PropertiesInspectorPresentation';

export interface AdjustmentCreationIntentPorts {
  isMounted(): boolean;
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  readonly properties: Pick<PropertiesInspectorPresentation, 'show'>;
  execute(documentId: DocumentSessionId, command: SemanticAdjustmentCreationCommand, expectedRevision: number): Promise<{ status: string; message?: string }>;
  reportFailure(message: string): void;
}

/** Contextual UI placement/reveal only. The semantic command owns admission and canonical creation. */
export class AdjustmentCreationIntents {
  constructor(private readonly resolve: () => AdjustmentCreationIntentPorts) {}
  private async run(kind: AdjustmentLayerKind, placement: 'contextual' | 'adjustment-layer' | 'attached'): Promise<boolean> {
    const ports = this.resolve(), session = ports.getSession(), renderer = ports.getRenderer(), scope = ports.captureScope();
    const isCurrent = () => ports.isMounted() && Boolean(session && renderer)
      && ports.getSession() === session && ports.getRenderer() === renderer && scope.isCurrent()
      && session?.getSnapshot().lifecycle === 'ready'
      && ports.getProjectedDocument()?.id === session.getSnapshot().document?.id;
    if (!isCurrent()) return false;
    const snapshot = session!.getSnapshot(), document = snapshot.document;
    if (!document) return false;
    try {
      const active = findDocumentLayer(document, document.activeLayerId);
      let command: SemanticAdjustmentCreationCommand;
      if (placement === 'contextual') {
        command = resolveContextualAdjustmentCreation(document, kind);
        if (command.placement === 'local' && active?.type === 'raster'
          && adjustmentStackHasLocalProcessing(active.adjustmentStack, command.kind)) {
          ports.properties.show({ kind: 'processing', layerId: command.layerId, owner: command.kind });
          return true;
        }
      } else if (placement === 'attached') {
        if (active?.type !== 'raster' || layerIsLocked(active, 'pixels')) return false;
        command = { kind, placement, layerId: active.id };
      } else command = { kind, placement, ...(active ? { aboveLayerId: active.id } : {}) };
      const result = await ports.execute(session!.id, command, snapshot.documentRevision);
      if (result.status === 'completed') return true;
      if (isCurrent()) ports.reportFailure(result.message ?? 'The adjustment could not be created.');
      return false;
    } catch (reason) {
      if (isCurrent()) ports.reportFailure(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }
  apply = (kind: AdjustmentLayerKind) => this.run(kind, 'contextual');
  curves = () => this.apply('curves');
  standalone = (kind: AdjustmentLayerKind) => this.run(kind, 'adjustment-layer');
  attach = (kind: AdjustmentLayerKind) => this.run(kind, 'attached');
}
