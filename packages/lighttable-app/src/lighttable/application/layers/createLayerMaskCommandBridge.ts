import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';

type MaskCommandParameters =
  | { readonly layerId: LayerId; readonly operation: 'add'; readonly source: 'reveal-all' | 'selection' }
  | { readonly layerId: LayerId; readonly operation: 'remove' }
  | { readonly layerId: LayerId; readonly operation: 'set-enabled'; readonly enabled: boolean }
  | { readonly layerId: LayerId; readonly operation: 'set-linked'; readonly linked: boolean };

interface LayerMaskCommandBridgeDependencies {
  getDocument(): ImageDocument | null;
  hasSelection(): boolean;
  execute(parameters: MaskCommandParameters): Promise<LightTableCommandResult> | null;
  setPaintTarget(channel: 'pixels' | 'mask', brushColor?: string): void;
  setError(message: string): void;
}

const unavailable = 'Layer mask commands are unavailable in this document.';

/**
 * Admits Layers-panel mask requests to the semantic command service and owns
 * only their document-bound presentation result. Canonical mask state and GPU
 * pixels remain behind the mounted layer-command port.
 */
export const createLayerMaskCommandBridge = (
  resolveDependencies: () => LayerMaskCommandBridgeDependencies
) => {
  const execute = (
    parameters: MaskCommandParameters,
    onCompleted?: (document: ImageDocument) => void
  ) => {
    const dependencies = resolveDependencies();
    const admittedDocument = dependencies.getDocument();
    if (!admittedDocument) {
      dependencies.setError(unavailable);
      return;
    }
    const execution = dependencies.execute(parameters);
    if (!execution) {
      dependencies.setError(unavailable);
      return;
    }
    void execution.then((result) => {
      if (result.status !== 'completed') return;
      const current = resolveDependencies().getDocument();
      if (!current || current.id !== admittedDocument.id) return;
      onCompleted?.(current);
    }).catch((reason) => {
      const current = resolveDependencies().getDocument();
      if (current?.id !== admittedDocument.id) return;
      resolveDependencies().setError(
        reason instanceof Error ? reason.message : 'The layer mask command failed.'
      );
    });
  };

  return {
    add: () => {
      const dependencies = resolveDependencies();
      const layerId = dependencies.getDocument()?.activeLayerId;
      if (!layerId) return dependencies.setError(unavailable);
      execute({
        layerId,
        operation: 'add',
        source: dependencies.hasSelection() ? 'selection' : 'reveal-all'
      }, (document) => {
        if (document.activeLayerId === layerId && findDocumentLayer(document, layerId)?.mask) {
          resolveDependencies().setPaintTarget('mask', '#000000');
        }
      });
    },
    toggle: () => {
      const document = resolveDependencies().getDocument();
      const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
      if (!layer?.mask) return;
      execute({
        layerId: layer.id,
        operation: 'set-enabled',
        enabled: !layer.mask.enabled
      });
    },
    setLinked: (layerId: LayerId, linked: boolean) => {
      execute({ layerId, operation: 'set-linked', linked });
    },
    remove: (requestedLayerId?: LayerId) => {
      const document = resolveDependencies().getDocument();
      const layerId = requestedLayerId ?? document?.activeLayerId;
      if (!document || !layerId) return resolveDependencies().setError(unavailable);
      const wasActive = document.activeLayerId === layerId;
      execute({ layerId, operation: 'remove' }, (current) => {
        if (wasActive && current.activeLayerId === layerId
          && !findDocumentLayer(current, layerId)?.mask) {
          resolveDependencies().setPaintTarget('pixels');
        }
      });
    }
  } as const;
};
