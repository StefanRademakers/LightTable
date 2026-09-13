import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { layerStyleSnapshot } from '../styles/completeLayerStyleSnapshot';
import { executeSemanticLayerStyleCommand } from '../styles/semanticLayerStyleCommandExecutor';
import { executeSemanticLayerStyleSnapshot } from '../styles/executeSemanticLayerStyleSnapshot';
import { executeSemanticFilterSnapshot } from '../filters/executeSemanticFilterSnapshot';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';

type LayerProcessingCommandPorts = Pick<DocumentLightTableCommandPorts,
  'setLayerStyleEnabled' | 'setLayerEffectEnabled' | 'executeLayerStyleCommand'
  | 'executeLayerStyleSnapshot' | 'executeFilterSnapshot'>;

/** Adapts layer-processing commands to the single canonical document mutation owner. */
export const createLayerProcessingCommandPorts = ({
  getDocument,
  changeDocument
}: {
  readonly getDocument: () => ImageDocument | null;
  readonly changeDocument: (change: (document: ImageDocument) => ImageDocument) => boolean;
}): LayerProcessingCommandPorts => ({
  setLayerStyleEnabled: (layerId, enabled) => {
    const document = getDocument();
    const layer = document ? findDocumentLayer(document, layerId) : null;
    if (!layer) throw new Error('The Layer Style owner does not exist.');
    void executeSemanticLayerStyleSnapshot({
      layerId,
      snapshot: { ...layerStyleSnapshot(layer.styleStack), enabled }
    }, { changeDocument });
  },
  setLayerEffectEnabled: (layerId, effectId, enabled) => executeSemanticLayerStyleCommand(
    { kind: 'toggle', layerId, effectId, enabled },
    { changeDocument }
  ),
  executeLayerStyleCommand: command => executeSemanticLayerStyleCommand(command, { changeDocument }),
  executeLayerStyleSnapshot: command => executeSemanticLayerStyleSnapshot(command, { changeDocument }),
  executeFilterSnapshot: command => executeSemanticFilterSnapshot(command, { changeDocument })
});
