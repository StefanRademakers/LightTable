import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { LayerDocumentCommands } from './useLayerDocumentCommands';
import type { LayerFinalizationScope } from './LayerFinalizationReadiness';

interface LayerFinalizationCommandPorts {
  captureScope(): LayerFinalizationScope;
  getDocument(): ImageDocument | null;
  waitForFrame(): Promise<void>;
  settlePixels(): Promise<void>;
  commands: Pick<LayerDocumentCommands, 'rasterizeLayerWhenReady' | 'rasterizeTextLayerWhenReady'
    | 'mergeLayersWhenReady' | 'flattenWhenReady'>;
}

/** Semantic host preparation/result translation; finalization commands retain all GPU/history ownership. */
export const createLayerFinalizationCommandBinding = (ports: LayerFinalizationCommandPorts) => {
  const prepare = async (settlePixels: boolean) => {
    const scope = ports.captureScope(); scope.assertCurrent();
    if (settlePixels) { await ports.settlePixels(); scope.assertCurrent(); }
    // Text creation reaches the coordinator on its next editor frame. This is
    // only a host synchronization boundary; exact sources are awaited by the owner.
    const document = ports.getDocument();
    if (!document) throw new Error('The active document renderer is unavailable.');
    await ports.waitForFrame(); scope.assertCurrent();
    const current = ports.getDocument();
    if (!current || current.id !== document.id || current.revision !== document.revision) {
      throw new Error('The document changed before layer finalization could begin.');
    }
    return scope;
  };
  return {
    waitForPresentation: () => prepare(false),
    executeLayerRasterize: async ({ layerId }: { layerId: LayerId }) => {
      const scope = await prepare(false); scope.assertCurrent();
      const outputLayerId = await ports.commands.rasterizeLayerWhenReady(layerId);
      scope.assertCurrent();
      return { sourceLayerId: layerId, outputLayerId, outputType: 'raster' as const };
    },
    executeTextRasterize: async ({ layerId }: { layerId: LayerId }) => {
      const scope = await prepare(false); scope.assertCurrent();
      const outputLayerId = await ports.commands.rasterizeTextLayerWhenReady(layerId);
      scope.assertCurrent();
      return { layerId: outputLayerId, outputType: 'raster' as const };
    },
    executeLayerMerge: async ({ layerIds }: { layerIds: readonly LayerId[] }) => {
      const scope = await prepare(true); scope.assertCurrent();
      const outputLayerId = await ports.commands.mergeLayersWhenReady([...layerIds]);
      scope.assertCurrent();
      return { layerIds, outputLayerId };
    },
    executeFlattenGroup: async ({ groupId }: { groupId: LayerId }) => {
      const scope = await prepare(true); scope.assertCurrent();
      const outputLayerId = await ports.commands.flattenWhenReady({ kind: 'group', groupId });
      scope.assertCurrent();
      return { groupId, outputLayerId };
    },
    executeFlattenImage: async () => {
      const scope = await prepare(true); scope.assertCurrent();
      const outputLayerId = await ports.commands.flattenWhenReady({ kind: 'image' });
      scope.assertCurrent(); return { outputLayerId };
    }
  };
};
