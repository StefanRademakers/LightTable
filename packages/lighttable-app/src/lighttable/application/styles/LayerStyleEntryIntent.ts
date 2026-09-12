import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerStyleId, LayerStyleKind } from '../../editor/styles/layerStyleTypes';
import type { LightTableCommandResult } from '../commands/lightTableCommandContract';
import type { PropertiesPresentationTicket } from '../properties/PropertiesInspectorPresentation';

export interface LayerStyleEntryPorts {
  isCurrent(): boolean;
  getDocument(): ImageDocument | null;
  beginPresentation(): PropertiesPresentationTicket;
  openEditor(layerId: LayerId, effectId?: LayerStyleId): void;
  execute(layerId: LayerId, effectKind: LayerStyleKind): Promise<LightTableCommandResult>;
  reportFailure(message: string): void;
}

/** Style inspector entry only. Existing style controller and semantic commands own editing. */
export class LayerStyleEntryIntent {
  constructor(private readonly capture: () => LayerStyleEntryPorts) {}
  private openTarget(ports: LayerStyleEntryPorts, ticket: PropertiesPresentationTicket,
    layerId: LayerId, effectId?: LayerStyleId) {
    if (!ports.isCurrent() || !ticket.isCurrent()) return;
    const document = ports.getDocument();
    if (!document || !findDocumentLayer(document, layerId)) return;
    // A locked layer may show the informational inspector without admitting an edit.
    ports.openEditor(layerId, effectId);
    if (ports.isCurrent()) ticket.show(effectId ? { kind: 'style', layerId, effectId } : { kind: 'style-stack', layerId });
  }
  open = (layerId: LayerId, effectId?: LayerStyleId) => {
    const ports = this.capture();
    if (ports.isCurrent()) this.openTarget(ports, ports.beginPresentation(), layerId, effectId);
  };
  add = (effectKind: LayerStyleKind): void => {
    const ports = this.capture(), document = ports.getDocument();
    const layer = document && findDocumentLayer(document, document.activeLayerId);
    if (!ports.isCurrent() || !layer || layer.type === 'adjustment' || layer.locks.all) return;
    const ticket = ports.beginPresentation();
    if (!ticket.isCurrent()) return;
    const report = (reason: unknown) => { if (ports.isCurrent() && ticket.isCurrent()) ports.reportFailure(
      reason instanceof Error ? reason.message : String(reason)); };
    const run = async () => {
      const result = await ports.execute(layer.id, effectKind);
      if (!ports.isCurrent()) return;
      if (result.status === 'rejected') { report(result.message); return; }
      if (result.status !== 'completed' || !ticket.isCurrent()) return;
      const value = result.value as { layerId?: string; effectId?: string };
      const current = ports.getDocument(), target = current && findDocumentLayer(current, layer.id);
      if (value.layerId !== layer.id || !value.effectId || !target?.styleStack.effects.some(effect => effect.id === value.effectId)) {
        report('The added layer effect could not be resolved in its document.'); return;
      }
      this.openTarget(ports, ticket, layer.id, value.effectId as LayerStyleId);
    };
    void run().catch(report);
  };
}
