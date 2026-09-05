import {
  analyzePositionedTextRecovery,
  type PositionedTextRecoveryAnalysis
} from '@lighttable/text-core';
import { recoverPositionedTextAsFlow } from '../../editor/document/textLayerCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';

export interface PositionedTextRecoveryCommandDependencies {
  getDocument(): ImageDocument | null;
  documentMutations: Pick<DocumentMutationController, 'change'>;
}

/** Typed query/command seam for UI, host automation and a future MCP adapter. */
export class PositionedTextRecoveryCommandController {
  constructor(private readonly resolveDependencies: () => PositionedTextRecoveryCommandDependencies) {}

  analyze(layerId: LayerId): PositionedTextRecoveryAnalysis | null {
    const document = this.resolveDependencies().getDocument();
    const layer = document && findDocumentLayer(document, layerId);
    return layer?.type === 'text' && layer.text.source.kind === 'positioned'
      ? analyzePositionedTextRecovery(layer.text.source)
      : null;
  }

  recover(layerId: LayerId): boolean {
    const dependencies = this.resolveDependencies();
    return dependencies.documentMutations.change(
      (current) => recoverPositionedTextAsFlow(current, layerId),
      true,
      { label: 'Recover Editable Type', type: 'text.recover', layerIds: [layerId] }
    );
  }
}
