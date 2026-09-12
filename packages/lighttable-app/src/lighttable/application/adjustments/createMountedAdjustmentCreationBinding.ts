import type { DocumentSession } from '../documents/documentSession';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { SemanticAdjustmentCreationCommand } from '../commands/semanticAdjustmentCreationCommandContract';
import type { LayerPanelController } from '../layers/useLayerPanelController';
import type { PropertiesInspectorPresentation } from '../properties/PropertiesInspectorPresentation';
import type { ProcessingCreationFeedback } from '../layers/layerProcessingCreationCommands';

interface ScopePorts {
  readonly session: DocumentSession | undefined;
  readonly renderer: object | null;
  readonly registration: { isCurrent(): boolean };
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
}
interface Ports extends ScopePorts {
  readonly creation: Pick<LayerPanelController, 'createLocalProcessing' | 'createAttachedAdjustment' | 'createAdjustmentLayerOfKind'>;
  readonly properties: Pick<PropertiesInspectorPresentation, 'captureMutationIntent'>;
}

/** Registered command mapping: return committed identities; renderer retirement only suppresses presentation. */
const currentScope = (ports: ScopePorts) => {
  const session = ports.session;
  return () => Boolean(session && ports.renderer) && ports.getSession() === session
    && ports.getRenderer() === ports.renderer && ports.registration.isCurrent()
    && session?.getSnapshot().lifecycle === 'ready' && Boolean(session.getSnapshot().document)
    && ports.getProjectedDocument()?.id === session.getSnapshot().document?.id;
};

export const captureAdjustmentCreationFeedback = (ports: ScopePorts,
  feedback: Omit<ProcessingCreationFeedback, 'isCurrent' | 'setActiveChannel'> & {
    setActiveChannel(channel: Parameters<ProcessingCreationFeedback['setActiveChannel']>[0], isCurrent: () => boolean): void;
  }): ProcessingCreationFeedback => {
  const isCurrent = currentScope(ports);
  return { ...feedback, isCurrent, setActiveChannel: channel => feedback.setActiveChannel(channel, isCurrent) };
};

export const createMountedAdjustmentCreationBinding = (ports: Ports) => (command: SemanticAdjustmentCreationCommand) => {
  const isCurrent = currentScope(ports);
  if (!isCurrent()) throw new Error('The adjustment creation belongs to a retired document renderer.');
  const presentation = ports.properties.captureMutationIntent();
  if (command.placement === 'local') {
    if (!ports.creation.createLocalProcessing(command.layerId, command.kind)) return null;
    if (isCurrent()) presentation.show({ kind: 'processing', layerId: command.layerId, owner: command.kind });
    return { kind: command.kind, placement: command.placement, layerId: command.layerId };
  }
  if (command.placement === 'attached') {
    const adjustmentId = ports.creation.createAttachedAdjustment(command.layerId, command.kind, command.settings);
    if (!adjustmentId) return null;
    if (isCurrent()) presentation.show({ kind: 'attached-processing', layerId: command.layerId, adjustmentId });
    return { kind: command.kind, placement: command.placement, layerId: command.layerId, adjustmentId };
  }
  const layerId = ports.creation.createAdjustmentLayerOfKind(command.kind, command.aboveLayerId, command.settings);
  if (!layerId) return null;
  if (isCurrent()) presentation.show({ kind: 'layer', layerId });
  return { kind: command.kind, placement: command.placement, layerId };
};
