import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import type { LightTableCommandId } from '../commands/lightTableCommandService';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { resolveFilterSnapshotOwner } from '../filters/filterSnapshotOwner';
import { layerStyleSnapshot } from '../styles/completeLayerStyleSnapshot';

export interface LayerPanelCommandIntentPorts {
  getDocument(): ImageDocument | null;
  execute(command: LightTableCommandId, parameters: unknown): Promise<LightTableCommandResult>;
  reportError(message: string): void;
}

/** Owns semantic command mapping for layer-panel actions; document algorithms stay in command handlers. */
export class LayerPanelCommandIntents {
  constructor(private readonly ports: LayerPanelCommandIntentPorts) {}

  readonly setAttachedFilterEnabled = (layerId: LayerId, adjustmentId: string, enabled: boolean): boolean => {
    const document = this.ports.getDocument();
    const target = { kind: 'attached' as const, layerId, adjustmentId };
    const owner = document ? resolveFilterSnapshotOwner(document, target) : null;
    if (!owner) return false;
    void this.ports.execute('filter.setSnapshot', {
      target,
      snapshot: { ...owner.snapshot, enabled }
    });
    return true;
  };

  readonly rasterizeActiveLayer = async (): Promise<boolean> => {
    const layerId = this.ports.getDocument()?.activeLayerId;
    if (!layerId) {
      this.ports.reportError('Select a layer to rasterize.');
      return false;
    }
    const result = await this.ports.execute('layer.rasterize', { layerId });
    return result.status === 'completed';
  };

  readonly loadMaskSelection = async (layerId: LayerId): Promise<void> => {
    await this.ports.execute('layer.setMask', { layerId, operation: 'load-selection' });
  };

  readonly loadTransparencySelection = async (layerId: LayerId): Promise<void> => {
    await this.ports.execute('selection.modify', {
      kind: 'modify', operation: 'load-transparency', layerId
    });
  };

  readonly setStyleStackEnabled = (layerId: LayerId, enabled: boolean): void => {
    void this.ports.execute('layer.style.setEnabled', { layerId, enabled });
  };

  readonly setStyleEnabled = (layerId: LayerId, effectId: string, enabled: boolean): void => {
    void this.ports.execute('layer.effect.setEnabled', { layerId, effectId, enabled });
  };

  readonly removeStyle = (layerId: LayerId, effectId: string): void => {
    void this.ports.execute('layer.effect.remove', { layerId, effectId });
  };

  readonly clearStyles = (layerId: LayerId): void => {
    const document = this.ports.getDocument();
    const layer = document ? findDocumentLayer(document, layerId) : null;
    if (!layer) {
      this.ports.reportError('The layer is unavailable.');
      return;
    }
    void this.ports.execute('layer.style.setSnapshot', {
      layerId,
      snapshot: { ...layerStyleSnapshot(layer.styleStack), effects: [] }
    });
  };
}
