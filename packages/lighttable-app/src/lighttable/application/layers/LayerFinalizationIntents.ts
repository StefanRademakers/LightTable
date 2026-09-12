import type { DocumentSession, DocumentSessionId } from '../documents/documentSession';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { siblingLayers } from '../../editor/document/layerTree';
import type { MountedDocumentAdmission } from '../interactions/MountedDocumentAdmission';

type FinalizationCommand = 'layer.merge' | 'layer.flattenGroup' | 'document.flattenImage';
type Parameters = { layerIds: readonly LayerId[] } | { groupId: LayerId } | Record<string, never>;
export interface LayerFinalizationIntentPorts {
  isMounted(): boolean;
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  getSelectedLayerIds(): readonly LayerId[];
  readonly text: { finishBeforeTransition(transition: () => void): boolean };
  requestAdmission: MountedDocumentAdmission['request'];
  execute(documentId: DocumentSessionId, command: FinalizationCommand, parameters: Parameters): Promise<{ status: string; message?: string }>;
  reportFailure(message: string): void;
}

/** UI target interpretation only; semantic finalization owns source preparation, GPU publication and history. */
export class LayerFinalizationIntents {
  constructor(private readonly resolve: () => LayerFinalizationIntentPorts) {}
  private async run(resolveCommand: (document: ImageDocument, ports: LayerFinalizationIntentPorts) =>
    { command: FinalizationCommand; parameters: Parameters }): Promise<boolean> {
    const ports = this.resolve(), session = ports.getSession(), renderer = ports.getRenderer(), scope = ports.captureScope();
    const ownsContext = () => ports.isMounted() && ports.getSession() === session && ports.getRenderer() === renderer
      && session?.getSnapshot().lifecycle !== 'disposed' && scope.isCurrent();
    const isCurrent = () => ownsContext() && Boolean(session && renderer && session.getSnapshot().lifecycle === 'ready'
      && session.getSnapshot().document && ports.getProjectedDocument()?.id === session.getSnapshot().document?.id);
    try {
      if (!isCurrent()) {
        if (ownsContext()) ports.reportFailure('The document renderer is unavailable for layer finalization.');
        return false;
      }
      if (!ports.text.finishBeforeTransition(() => undefined)) {
        if (ownsContext()) ports.reportFailure('Layer finalization was stopped because the text edit could not be committed.');
        return false;
      }
      if (!isCurrent()) return false;
      // UI preparation happens before semantic execution reserves its own transaction.
      const admission = await ports.requestAdmission();
      if (admission.status !== 'admitted' || !isCurrent()) return false;
      const command = resolveCommand(session!.getSnapshot().document!, ports);
      const result = await ports.execute(session!.id, command.command, command.parameters);
      if (!isCurrent()) return false;
      if (result.status !== 'completed') {
        ports.reportFailure(result.message ?? 'The layer finalization command did not complete.'); return false;
      }
      return true;
    } catch (reason) {
      if (ownsContext()) ports.reportFailure(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }
  mergeDown = () => this.run((document, ports) => {
    // Read after settlement: a transform may have published a replacement layer.
    // The clicked row wins over one-render-late canonical active-layer preparation.
    const selected = ports.getSelectedLayerIds();
    if (selected.length > 1) return { command: 'layer.merge', parameters: { layerIds: [...selected] } };
    const active = selected[0] ?? document.activeLayerId;
    if (!active) throw new Error('Select a layer with a lower sibling to merge.');
    const siblings = siblingLayers(document, active), index = siblings.findIndex(layer => layer.id === active);
    if (index <= 0) throw new Error('The active layer has no layer below it to merge with.');
    return { command: 'layer.merge', parameters: { layerIds: [siblings[index - 1]!.id, active] } };
  });
  mergeSelected = (layerIds: readonly LayerId[]) => {
    const captured = [...layerIds]; return this.run(() => ({ command: 'layer.merge', parameters: { layerIds: captured } }));
  };
  flattenGroup = (groupId: LayerId) => this.run(() => ({ command: 'layer.flattenGroup', parameters: { groupId } }));
  flattenImage = () => this.run(() => ({ command: 'document.flattenImage', parameters: {} }));
}
