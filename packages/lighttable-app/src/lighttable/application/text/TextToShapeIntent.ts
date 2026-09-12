import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface TextToShapeConfirmation {
  readonly layerId: LayerId;
  isCurrent(): boolean;
  confirm(): Promise<void>;
  cancel(): void;
}
export interface TextToShapeIntentContext {
  isCurrent(): boolean;
  getDocument(): ImageDocument | null;
  getRevision(): number;
  readonly text: { finishBeforeTransition(next: () => void): boolean };
  readonly creation: { cancelPoint(): unknown; cancelParagraph(): unknown };
  execute(layerId: LayerId, expectedRevision: number): Promise<{ status: string; message?: string }>;
}
export interface TextToShapeIntentPorts {
  isMounted(): boolean;
  capture(): TextToShapeIntentContext;
  readonly dialogs: {
    requestTextToShape(request: TextToShapeConfirmation): void;
    closeTextToShape(request: TextToShapeConfirmation): void;
  };
  status(message: string | null): void;
  error(message: string): void;
}

/** Confirmation and UI outcome ownership only; conversion remains one semantic command. */
export class TextToShapeIntent {
  private current: { cancel(): void } | null = null;
  constructor(private readonly read: () => TextToShapeIntentPorts) {}
  cancel = () => { this.current?.cancel(); };
  request = (layerId: LayerId): void => {
    this.cancel();
    const ports = this.read();
    if (!ports.isMounted()) return;
    let context: TextToShapeIntentContext;
    try { context = ports.capture(); }
    catch (reason) { ports.error(reason instanceof Error ? reason.message : String(reason)); return; }
    if (!context.isCurrent()) return;
    const attempt = { cancel: () => { if (this.current === attempt) this.current = null; } };
    this.current = attempt;
    const owns = () => this.current === attempt && context.isCurrent();
    try {
      const opening = context.getDocument();
      const layer = opening && findDocumentLayer(opening, layerId);
      if (layer?.type !== 'text' || layer.locks.all || layer.locks.pixels) {
        throw new Error('Select an editable text layer to convert to shapes.');
      }
      if (!context.text.finishBeforeTransition(() => undefined)) {
        throw new Error('Text conversion was stopped because the text edit could not be committed.');
      }
      if (!owns()) return;
      context.creation.cancelPoint(); context.creation.cancelParagraph();
      if (!owns()) return;
      const document = context.getDocument(), target = document && findDocumentLayer(document, layerId);
      if (target?.type !== 'text' || target.locks.all || target.locks.pixels) {
        throw new Error('The text conversion target changed while finishing the edit.');
      }
      let pending = false;
      const request: TextToShapeConfirmation = {
        layerId, isCurrent: owns,
        cancel: () => attempt.cancel(),
        confirm: async () => {
          if (!owns() || pending) return;
          pending = true; ports.dialogs.closeTextToShape(request);
          try {
            const currentDocument = context.getDocument();
            if (!currentDocument || findDocumentLayer(currentDocument, layerId) !== target) {
              throw new Error('The text layer changed after conversion was requested. Open Convert to Shape again.');
            }
            ports.status('Converting text to editable shapes...');
            const result = await context.execute(layerId, context.getRevision());
            if (!owns()) return;
            if (result.status !== 'completed') throw new Error(result.message ?? 'Text could not be converted to shapes.');
            ports.status('Text converted to editable shapes.');
          } catch (reason) {
            if (owns()) {
              ports.status(null);
              ports.error(reason instanceof Error ? reason.message : 'Text could not be converted to shapes.');
            }
          } finally { attempt.cancel(); }
        }
      };
      attempt.cancel = () => {
        if (this.current === attempt) this.current = null;
        ports.dialogs.closeTextToShape(request);
      };
      ports.dialogs.requestTextToShape(request);
    } catch (reason) {
      if (owns()) ports.error(reason instanceof Error ? reason.message : String(reason));
      attempt.cancel();
    }
  };
}
