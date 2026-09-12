import type { PositionedTextRecoveryAnalysis } from '@lighttable/text-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { PositionedTextRecoveryCommandController } from './PositionedTextRecoveryCommandController';

export interface PositionedTextRecoveryIntentPorts {
  isCurrent(): boolean;
  getDocument(): ImageDocument | null;
  captureScope(): { isCurrent(): boolean };
  readonly text: { finishBeforeTransition(transition: () => void): boolean };
  readonly command: Pick<PositionedTextRecoveryCommandController, 'analyze' | 'recover'>;
  status(message: string): void;
  error(message: string): void;
}
export interface PositionedTextRecoveryOffer {
  readonly analysis: PositionedTextRecoveryAnalysis;
  onRecover(): boolean;
}

/** A recovery button offers one positioned source, not whichever text exists when it is clicked. */
export class PositionedTextRecoveryIntent {
  constructor(private readonly ports: PositionedTextRecoveryIntentPorts) {}

  offer(layerId: LayerId | null): PositionedTextRecoveryOffer | null {
    const ports = this.ports, document = ports.getDocument();
    const layer = document && layerId && findDocumentLayer(document, layerId);
    if (!layer || layer.type !== 'text' || layer.text.source.kind !== 'positioned') return null;
    const source = layer.text.source, scope = ports.captureScope();
    const analysis = ports.command.analyze(layer.id);
    if (!analysis) return null;
    const ownsContext = () => ports.isCurrent() && scope.isCurrent();
    const ownsSource = () => {
      const current = ports.getDocument(), target = current && findDocumentLayer(current, layer.id);
      return current?.id === document.id && current.activeLayerId === layer.id
        && target?.type === 'text' && target.text.source === source;
    };
    return { analysis, onRecover: () => {
      if (!ownsContext()) return false;
      try {
        if (!ownsSource()) throw new Error('The imported text changed. Review its current recovery preview first.');
        if (!ports.text.finishBeforeTransition(() => undefined)) {
          if (ownsContext()) ports.error('Text recovery was stopped because the text edit could not be committed.');
          return false;
        }
        if (!ownsContext()) return false;
        if (!ownsSource()) throw new Error('The imported text changed. Review its current recovery preview first.');
        const recovered = ports.command.recover(layer.id, source);
        // Our own successful commit replaces the offered source. Only runtime ownership gates feedback.
        if (ownsContext()) {
          if (recovered) ports.status('Imported text recovered as editable flow text. Undo restores exact positioned glyphs.');
          else ports.error('Imported text could not be recovered.');
        }
        return recovered;
      } catch (reason) {
        if (ownsContext()) ports.error(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    } };
  }
}
