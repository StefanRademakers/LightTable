import type { LayerId } from '../../editor/document/documentTypes';
import { setLayerTransform } from '../../editor/document/documentCommands';
import type { SemanticLayerCommand } from '../commands/semanticLayerCommandContract';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { LayerPanelController } from './useLayerPanelController';
import type { LayerDocumentCommands } from './useLayerDocumentCommands';
import { executeSemanticMaskCommand } from './executeSemanticMaskCommand';

export interface MountedLayerCommandPorts {
  assertCurrent(): void;
  settlePixels(): Promise<void>;
  waitForPresentation(): Promise<void>;
  loadMaskAsSelection(layerId: LayerId): Promise<boolean>;
  readonly mutations: Pick<DocumentMutationController, 'change'>;
  readonly pixels: Pick<LayerDocumentCommands, 'duplicateLayer' | 'layerViaCopy'
    | 'addLayerMask' | 'invertLayerColors' | 'applyLayerMask' | 'removeLayerMask'>;
  readonly panel: Pick<LayerPanelController, 'deleteSelection' | 'move' | 'setOpacity'
    | 'setVectorAntiAlias' | 'setBlendMode' | 'setClipping' | 'reorder' | 'ungroupSelection' | 'setLock'> & {
      createGradientFillLayer(): LayerId | null;
      createGroup(): LayerId | null;
      groupSelection(layerIds: LayerId[]): LayerId | null;
    };
}

/** Mounted command dispatch only: existing model, pixel, mask and transaction owners retain all algorithms. */
export class MountedLayerCommandAdapter {
  constructor(private readonly capture: () => MountedLayerCommandPorts) {}

  execute = async (command: SemanticLayerCommand): Promise<unknown | null> => {
    const p = this.capture(); p.assertCurrent();
    const settle = async () => { await p.settlePixels(); p.assertCurrent(); };
    switch (command.kind) {
      case 'duplicate': {
        const layerId = p.pixels.duplicateLayer(command.layerId);
        return layerId ? { sourceLayerId: command.layerId, layerId } : null;
      }
      case 'copy-to-new-layer': {
        await settle();
        p.assertCurrent();
        const result = p.pixels.layerViaCopy(command.layerId);
        return result ? { sourceLayerId: command.layerId, ...result } : null;
      }
      case 'delete':
        p.panel.deleteSelection([...command.layerIds]); return { layerIds: command.layerIds };
      case 'move':
        p.panel.move(command.layerId, command.direction); return { layerId: command.layerId, direction: command.direction };
      case 'set-opacity':
        p.panel.setOpacity(command.layerId, command.opacity); return { layerId: command.layerId, opacity: command.opacity };
      case 'set-vector-anti-alias':
        p.panel.setVectorAntiAlias(command.layerId, command.antiAlias); return { layerId: command.layerId, antiAlias: command.antiAlias };
      case 'set-blend-mode':
        p.panel.setBlendMode(command.layerId, command.blendMode); return { layerId: command.layerId, blendMode: command.blendMode };
      case 'set-clipping':
        p.panel.setClipping(command.layerId, command.clipping); return { layerId: command.layerId, clipping: command.clipping };
      case 'set-transform': {
        const changed = p.mutations.change(document => setLayerTransform(document, command.layerId, command.transform),
          true, { label: 'Free Transform', type: 'layer.transform', layerIds: [command.layerId] });
        return changed ? { layerId: command.layerId, transform: command.transform } : null;
      }
      case 'set-mask': {
        const current = <T,>(execute: () => T): T => { p.assertCurrent(); return execute(); };
        const result = await executeSemanticMaskCommand(command, {
          commands: {
            addLayerMask: (...args) => current(() => p.pixels.addLayerMask(...args)),
            invertLayerColors: (...args) => current(() => p.pixels.invertLayerColors(...args)),
            applyLayerMask: (...args) => current(() => p.pixels.applyLayerMask(...args)),
            removeLayerMask: (...args) => current(() => p.pixels.removeLayerMask(...args))
          },
          settlePixelInteraction: settle,
          waitForPresentation: async () => {
            p.assertCurrent(); await p.waitForPresentation(); p.assertCurrent();
          },
          loadMaskAsSelection: id => current(() => p.loadMaskAsSelection(id)),
          changeDocument: (...args) => current(() => p.mutations.change(...args))
        });
        p.assertCurrent(); return result;
      }
      case 'reorder':
        p.panel.reorder([...command.layerIds], command.targetLayerId, command.placement); return command;
      case 'create-gradient-fill': {
        const layerId = p.panel.createGradientFillLayer(); return layerId ? { layerId } : null;
      }
      case 'create-group': {
        const layerId = p.panel.createGroup(); return layerId ? { layerId } : null;
      }
      case 'group': {
        const groupId = p.panel.groupSelection([...command.layerIds]);
        return groupId ? { layerIds: command.layerIds, groupId } : null;
      }
      case 'ungroup':
        p.panel.ungroupSelection([...command.layerIds]); return { layerIds: command.layerIds };
      case 'set-lock':
        p.panel.setLock([...command.layerIds], command.lock, command.locked);
        return { layerIds: command.layerIds, lock: command.lock, locked: command.locked };
    }
  };
}
