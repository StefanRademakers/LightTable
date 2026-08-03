import {
  analyzePositionedTextRecovery,
  type PositionedTextRecoveryAnalysis
} from '@lighttable/text-core';
import { recoverPositionedTextAsFlow } from '../../editor/document/textLayerCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface PositionedTextRecoveryCommandDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
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
    const before = dependencies.getDocument();
    if (!before) return false;
    const after = recoverPositionedTextAsFlow(before, layerId);
    if (after === before) return false;
    const latest = this.resolveDependencies();
    if (latest.getDocument() !== before) return false;
    latest.applyDocument(after);
    latest.pushDocumentHistory(before, after);
    return true;
  }
}
