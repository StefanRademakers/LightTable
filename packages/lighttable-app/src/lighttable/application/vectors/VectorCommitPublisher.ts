import type { DocumentSessionId } from '../documents/documentSession';
import type { LayerId } from '../../editor/document/documentTypes';
import type { LightTableCommandService } from '../commands/lightTableCommandService';
import type { VectorToolSessionOptions } from './VectorToolSessionController';
import { observedLiveShapeCreateCommand, observedLiveShapeUpdateCommand, observedVectorPathCreateCommand,
  observedVectorPathUpdateCommand } from './semanticVectorObservation';

/** Observes accepted payloads only. It never executes another edit or history entry. */
export class VectorCommitPublisher {
  constructor(private readonly ports: {
    documentId: DocumentSessionId;
    selectLayer(layerId: LayerId): void;
    record: LightTableCommandService['recordObservedCommand'];
  }) {}
  shape: NonNullable<VectorToolSessionOptions['onLiveShapeCommitted']> = ({ layerId, element, existingLayerId, layerName }) => {
    this.ports.selectLayer(layerId);
    const parameters = observedLiveShapeCreateCommand(element, existingLayerId, layerName);
    if (!parameters) return;
    this.ports.record(
      'vector.create',
      this.ports.documentId,
      parameters,
      { layerId, elementId: element.id }
    );
  };
  pen: NonNullable<VectorToolSessionOptions['onPenPathCommitted']> = ({ operation, layerId, layerName, path, existingLayerId }) => {
    if (operation === 'create') this.ports.selectLayer(layerId);
    const parameters = operation === 'create'
      ? observedVectorPathCreateCommand(path, existingLayerId, layerName)
      : observedVectorPathUpdateCommand(path, layerId);
    this.ports.record(
      operation === 'create' ? 'vector.create' : 'vector.update',
      this.ports.documentId,
      parameters,
      { layerId, elementId: path.id }
    );
  };
  path: NonNullable<VectorToolSessionOptions['onPathMutationCommitted']> = ({ layerId, pathId, path }) => {
    this.ports.record(
      path ? 'vector.update' : 'vector.remove',
      this.ports.documentId,
      path ? observedVectorPathUpdateCommand(path, layerId) : { layerId, elementId: pathId },
      { layerId, elementId: pathId }
    );
  };
  gradient: NonNullable<VectorToolSessionOptions['onGradientCommitted']> = ({ operation, layerId, layerName, layerRole, layerOpacity,
    layerBlendMode, element }) => {
    if (operation === 'create') this.ports.selectLayer(layerId);
    const parameters = operation === 'create'
      ? observedLiveShapeCreateCommand(element, undefined, layerName, {
          role: layerRole,
          opacity: layerOpacity,
          blendMode: layerBlendMode
        })
      : observedLiveShapeUpdateCommand(element, layerId);
    if (!parameters) return;
    this.ports.record(
      operation === 'create' ? 'vector.create' : 'vector.update',
      this.ports.documentId,
      parameters,
      { layerId, elementId: element.id }
    );
  };
}
