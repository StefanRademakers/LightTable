import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerCommandRendererPort } from './useLayerDocumentCommands';

export interface LayerFinalizationScope { assertCurrent(): void }

interface FinalizationReadinessDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): LayerCommandRendererPort | null;
  captureFinalizationScope(): LayerFinalizationScope;
}

const contributingTextLayerIds = (nodes: readonly LayerNode[], inheritedVisible = true): LayerId[] =>
  nodes.flatMap(node => {
    const visible = inheritedVisible && node.visible && node.opacity > 0;
    if (node.type === 'group') return contributingTextLayerIds(node.children, visible);
    return node.type === 'text' && visible ? [node.id] : [];
  });

/** Prepare exact text/vector/processing sources without acquiring mutation or GPU destination ownership. */
export const createLayerFinalizationReadiness = (
  resolve: () => FinalizationReadinessDependencies
) => async (
  layerIds: readonly LayerId[], forceRootContribution = false,
  finalizationScope: 'layer' | 'document' = 'layer'
): Promise<LayerFinalizationScope> => {
  const dependencies = resolve();
  const scope = dependencies.captureFinalizationScope(); scope.assertCurrent();
  const document = dependencies.getDocument(); const renderer = dependencies.getRenderer();
  if (!document || !renderer) throw new Error('The document renderer is unavailable for text source preparation.');
  const assertCurrent = () => {
    scope.assertCurrent();
    const current = resolve(); const latest = current.getDocument();
    if (!latest || latest.id !== document.id || latest.revision !== document.revision
      || current.getRenderer() !== renderer) {
      throw new Error('The document changed while its rendering sources were being prepared.');
    }
  };
  const targets = layerIds.map(id => findDocumentLayer(document, id))
    .filter((layer): layer is LayerNode => Boolean(layer));
  const readinessTargets = forceRootContribution
    ? targets.map(layer => ({ ...layer, visible: true, opacity: 1 })) : targets;
  for (const id of new Set(contributingTextLayerIds(readinessTargets))) {
    if (!await renderer.waitForTextSource(id)) {
      throw new Error('A contributing text source could not be prepared for compositing.');
    }
    assertCurrent();
  }
  if (!await renderer.waitForLayerFinalizationSources(finalizationScope)) {
    throw new Error('The exact layer rendering sources could not be prepared for finalization.');
  }
  assertCurrent();
  return { assertCurrent };
};
