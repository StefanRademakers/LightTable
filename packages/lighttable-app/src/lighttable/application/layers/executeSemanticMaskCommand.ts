import type { SemanticLayerCommand } from '../commands/semanticLayerCommandContract';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { setLayerMaskEnabled, setLayerMaskLinked } from '../../editor/document/documentCommands';
import type { LayerDocumentCommands } from './useLayerDocumentCommands';

type MaskCommand = Extract<SemanticLayerCommand, { readonly kind: 'set-mask' }>;

interface SemanticMaskCommandDependencies {
  readonly commands: Pick<LayerDocumentCommands,
    'addLayerMask' | 'invertLayerColors' | 'applyLayerMask' | 'removeLayerMask'>;
  readonly settlePixelInteraction: () => Promise<void>;
  readonly waitForPresentation: () => Promise<void>;
  readonly loadMaskAsSelection: (layerId: MaskCommand['layerId']) => Promise<boolean>;
  readonly changeDocument: (
    change: (document: ImageDocument) => ImageDocument,
    recordHistory: boolean,
    description: { readonly label: string; readonly type: string; readonly layerIds: readonly MaskCommand['layerId'][] }
  ) => boolean;
}

export interface SemanticMaskCommandResult {
  readonly layerId: MaskCommand['layerId'];
  readonly operation: MaskCommand['operation'];
  readonly source?: 'reveal-all' | 'selection';
  readonly enabled?: boolean;
  readonly linked?: boolean;
}

/**
 * Sole presentation adapter for the semantic layer-mask command family.
 * It settles transient pixel work, then delegates canonical mutation to the
 * document/layer owners. React supplies ports but owns no mask transition.
 */
export const executeSemanticMaskCommand = async (
  command: MaskCommand,
  dependencies: SemanticMaskCommandDependencies
): Promise<SemanticMaskCommandResult | null> => {
  if (command.operation === 'add') {
    if (command.source === 'selection') await dependencies.settlePixelInteraction();
    return dependencies.commands.addLayerMask(command.layerId, command.source === 'selection')
      ? { layerId: command.layerId, operation: command.operation,
          source: command.source ?? 'reveal-all' }
      : null;
  }
  if (command.operation === 'invert') {
    await dependencies.settlePixelInteraction();
    return dependencies.commands.invertLayerColors(command.layerId, 'mask')
      ? { layerId: command.layerId, operation: command.operation }
      : null;
  }
  if (command.operation === 'apply') {
    await dependencies.settlePixelInteraction();
    return dependencies.commands.applyLayerMask(command.layerId)
      ? { layerId: command.layerId, operation: command.operation }
      : null;
  }
  if (command.operation === 'load-selection') {
    await dependencies.settlePixelInteraction();
    await dependencies.waitForPresentation();
    return await dependencies.loadMaskAsSelection(command.layerId)
      ? { layerId: command.layerId, operation: command.operation }
      : null;
  }
  if (command.operation === 'remove') {
    return dependencies.commands.removeLayerMask(command.layerId)
      ? { layerId: command.layerId, operation: command.operation }
      : null;
  }
  const changed = dependencies.changeDocument(
    (document) => command.operation === 'set-enabled'
      ? setLayerMaskEnabled(document, command.layerId, command.enabled!)
      : setLayerMaskLinked(document, command.layerId, command.linked!),
    true,
    { label: 'Edit Layer Mask', type: `layer.mask.${command.operation}`, layerIds: [command.layerId] }
  );
  if (!changed) return null;
  return {
    layerId: command.layerId,
    operation: command.operation,
    ...(command.operation === 'set-enabled' ? { enabled: command.enabled } : {}),
    ...(command.operation === 'set-linked' ? { linked: command.linked } : {})
  };
};
