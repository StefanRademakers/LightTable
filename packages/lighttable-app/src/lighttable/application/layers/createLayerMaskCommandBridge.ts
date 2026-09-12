import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';

type MaskCommandParameters =
  | { readonly layerId: LayerId; readonly operation: 'add'; readonly source: 'reveal-all' | 'selection' }
  | { readonly layerId: LayerId; readonly operation: 'remove' }
  | { readonly layerId: LayerId; readonly operation: 'set-enabled'; readonly enabled: boolean }
  | { readonly layerId: LayerId; readonly operation: 'set-linked'; readonly linked: boolean };

interface LayerMaskCommandBridgeDependencies {
  /** Captured for this intent; exact session/renderer lifetime, not document ID. */
  isCurrent(): boolean;
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
    plan: (dependencies: LayerMaskCommandBridgeDependencies, document: ImageDocument) => {
      parameters: MaskCommandParameters;
      onCompleted?: (document: ImageDocument) => void;
    } | null
  ) => {
    const dependencies = resolveDependencies();
    if (!dependencies.isCurrent()) return;
    const admittedDocument = dependencies.getDocument();
    if (!admittedDocument) {
      dependencies.setError(unavailable);
      return;
    }
    let planned: ReturnType<typeof plan>;
    let execution: Promise<LightTableCommandResult> | null;
    try {
      planned = plan(dependencies, admittedDocument);
      if (!planned || !dependencies.isCurrent()) return;
      execution = dependencies.execute(planned.parameters);
    } catch (reason) {
      if (dependencies.isCurrent()) dependencies.setError(
        reason instanceof Error ? reason.message : 'The layer mask command failed.');
      return;
    }
    if (!execution) {
      if (dependencies.isCurrent()) dependencies.setError(unavailable);
      return;
    }
    void execution.then((result) => {
      if (!dependencies.isCurrent()) return;
      if (result.status === 'rejected') {
        dependencies.setError(result.message);
        return;
      }
      if (result.status !== 'completed') return;
      const current = dependencies.getDocument();
      if (!current || current.id !== admittedDocument.id) return;
      planned.onCompleted?.(current);
    }).catch((reason) => {
      if (!dependencies.isCurrent()) return;
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The layer mask command failed.'
      );
    });
  };

  return {
    add: () => execute((dependencies, document) => {
      const layerId = document.activeLayerId;
      if (!layerId) { dependencies.setError(unavailable); return null; }
      return { parameters: {
        layerId,
        operation: 'add',
        source: dependencies.hasSelection() ? 'selection' : 'reveal-all'
      }, onCompleted: (document) => {
        if (document.activeLayerId === layerId && findDocumentLayer(document, layerId)?.mask) {
          dependencies.setPaintTarget('mask', '#000000');
        }
      } };
    }),
    toggle: () => execute((_dependencies, document) => {
      const layer = findDocumentLayer(document, document.activeLayerId);
      if (!layer?.mask) return null;
      return { parameters: {
        layerId: layer.id,
        operation: 'set-enabled',
        enabled: !layer.mask.enabled
      } };
    }),
    setLinked: (layerId: LayerId, linked: boolean) => {
      execute(() => ({ parameters: { layerId, operation: 'set-linked', linked } }));
    },
    remove: (requestedLayerId?: LayerId) => execute((dependencies, document) => {
      const layerId = requestedLayerId ?? document.activeLayerId;
      if (!layerId) { dependencies.setError(unavailable); return null; }
      const wasActive = document.activeLayerId === layerId;
      return { parameters: { layerId, operation: 'remove' }, onCompleted: (current) => {
        if (wasActive && current.activeLayerId === layerId
          && !findDocumentLayer(current, layerId)?.mask) {
          dependencies.setPaintTarget('pixels');
        }
      } };
    })
  } as const;
};
