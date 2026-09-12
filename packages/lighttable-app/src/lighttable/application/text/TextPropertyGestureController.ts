import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { applyTextLayerDataMutation } from '../../editor/document/textLayerCommands';
import type { DocumentMutationController, DocumentMutationCloseReason } from '../documents/useDocumentMutationController';
import type { DocumentSessionId } from '../documents/documentSession';
import { DocumentTextPropertyGestureController } from './DocumentTextPropertyGestureController';
import type { FlowTextEditingSessionController } from './flowTextEditingSession';
import {
  formatFlowTextSource,
  type ParagraphStylePatch,
  type TextStylePatch
} from './flowTextFormatting';
import {
  semanticParagraphPatchFromCanonical,
  semanticStylePatchFromCanonical
} from './semanticTextCommandExecutor';

type Gesture =
  | {
      readonly kind: 'text';
      readonly commandDocumentId: DocumentSessionId;
      readonly layerId: LayerId;
      readonly range: { readonly start: number; readonly end: number } | null;
      style: TextStylePatch;
      paragraph: ParagraphStylePatch;
      recordable: boolean;
    }
  | {
      readonly kind: 'document';
      readonly commandDocumentId: DocumentSessionId;
      readonly documentId: ImageDocument['id'];
      readonly layerId: LayerId;
      readonly projection: DocumentTextPropertyGestureController;
      readonly terminal: { reason: DocumentMutationCloseReason | null };
      style: TextStylePatch;
      paragraph: ParagraphStylePatch;
      recordable: boolean;
    };

export interface TextPropertyGestureDependencies {
  getDocument(): ImageDocument | null;
  getCommandDocumentId(): DocumentSessionId;
  readonly documentMutations: Pick<DocumentMutationController, 'begin'>;
  readonly textEditing: FlowTextEditingSessionController;
  recordObservedCommand(
    commandId: 'text.format',
    documentId: DocumentSessionId,
    parameters: Record<string, unknown>,
    result: { readonly layerId: LayerId }
  ): void;
  reportError(message: string): void;
  requestFrame(callback: () => void): number;
  cancelFrame(frame: number): void;
}

/**
 * Owns the complete lifetime of one continuous Text-properties interaction.
 * React supplies input samples; this owner retains the admitted document/text
 * transaction, coalesces paint samples, and publishes one observed command.
 */
export class TextPropertyGestureController {
  private gesture: Gesture | null = null;
  private pendingPaintPatch: TextStylePatch | null = null;
  private paintFrame: number | null = null;

  constructor(private readonly dependencies: () => TextPropertyGestureDependencies) {}

  begin(activeFlowLayerId: LayerId | null | undefined) {
    if (this.gesture) return false;
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const layerId = document?.activeLayerId;
    if (!document || !layerId || layerId !== activeFlowLayerId) return false;
    const editing = dependencies.textEditing.getSnapshot();
    if (editing.status === 'editing' && editing.layerId === layerId) {
      if (!dependencies.textEditing.beginFormatting()) return false;
      this.gesture = {
        kind: 'text', commandDocumentId: dependencies.getCommandDocumentId(), layerId,
        range: {
          start: Math.min(editing.selection.anchor, editing.selection.focus),
          end: Math.max(editing.selection.anchor, editing.selection.focus)
        },
        style: {}, paragraph: {}, recordable: true
      };
      return true;
    }
    const terminal = { reason: null as DocumentMutationCloseReason | null };
    const transaction = dependencies.documentMutations.begin('text-properties', undefined,
      reason => { terminal.reason = reason; });
    if (!transaction) return false;
    this.gesture = {
      kind: 'document', commandDocumentId: dependencies.getCommandDocumentId(),
      documentId: document.id, layerId, terminal,
      projection: new DocumentTextPropertyGestureController(transaction, {
        request: dependencies.requestFrame,
        cancel: dependencies.cancelFrame,
        reportError: dependencies.reportError
      }),
      style: {}, paragraph: {}, recordable: true
    };
    return true;
  }

  apply(patch: TextStylePatch, paragraphPatch: ParagraphStylePatch = {}) {
    const gesture = this.gesture;
    if (!gesture) return false;
    gesture.style = { ...gesture.style, ...patch };
    gesture.paragraph = { ...gesture.paragraph, ...paragraphPatch };
    if (!semanticStylePatchFromCanonical(gesture.style)
      || !semanticParagraphPatchFromCanonical(gesture.paragraph)) gesture.recordable = false;
    const dependencies = this.dependencies();
    if (gesture.kind === 'text') {
      const editing = dependencies.textEditing.getSnapshot();
      if (editing.status !== 'editing' || editing.layerId !== gesture.layerId) return false;
      dependencies.textEditing.format(patch, paragraphPatch);
      return true;
    }
    if (dependencies.getDocument()?.id !== gesture.documentId) return false;
    return gesture.projection.stage((document) => {
      const layer = findDocumentLayer(document, gesture.layerId);
      if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return document;
      return applyTextLayerDataMutation(document, gesture.layerId, {
        ...layer.text,
        source: formatFlowTextSource(layer.text.source, null, patch, paragraphPatch)
      });
    });
  }

  queuePaint(patch: TextStylePatch) {
    const dependencies = this.dependencies();
    this.pendingPaintPatch = patch;
    if (this.paintFrame !== null) return;
    this.paintFrame = dependencies.requestFrame(() => {
      this.paintFrame = null;
      this.flushPaint();
    });
  }

  flushPaint() {
    const patch = this.pendingPaintPatch;
    this.pendingPaintPatch = null;
    this.cancelPaintFrame();
    if (patch) this.apply(patch);
  }

  commit() {
    this.flushPaint();
    const gesture = this.gesture;
    if (!gesture) return false;
    const dependencies = this.dependencies();
    const changed = gesture.kind === 'text'
      ? dependencies.textEditing.endFormatting()
      : gesture.projection.commit();
    this.gesture = null;
    if (!changed || !gesture.recordable) return changed;
    const style = semanticStylePatchFromCanonical(gesture.style);
    const paragraph = semanticParagraphPatchFromCanonical(gesture.paragraph);
    if (!style || !paragraph || (!Object.keys(style).length && !Object.keys(paragraph).length)) {
      return changed;
    }
    dependencies.recordObservedCommand('text.format', gesture.commandDocumentId, {
      layerId: gesture.layerId,
      ...(gesture.kind === 'text' && gesture.range ? gesture.range : {}),
      ...(Object.keys(style).length ? { style } : {}),
      ...(Object.keys(paragraph).length ? { paragraph } : {})
    }, { layerId: gesture.layerId });
    return changed;
  }

  commitDocumentGesture() {
    if (this.gesture?.kind !== 'document') return null;
    return this.commit();
  }

  cancel() {
    this.cancelPaint();
    const gesture = this.gesture;
    if (!gesture) return false;
    const dependencies = this.dependencies();
    const canceled = gesture.kind === 'text'
      ? dependencies.textEditing.cancelFormatting()
      : gesture.projection.cancel();
    this.gesture = null;
    return canceled;
  }

  cancelDocumentGesture() {
    if (this.gesture?.kind !== 'document') return false;
    return this.cancel();
  }

  finishBeforeTransition(transition: () => void) {
    const gesture = this.gesture;
    if (gesture) {
      const changed = this.commit();
      // A no-op commit is a valid terminal; false alone also represents stale,
      // canceled or rejected document work and must not admit the next tab.
      if (gesture.kind === 'document' ? gesture.terminal.reason !== 'commit' : !changed) return false;
    }
    const editing = this.dependencies().textEditing;
    const snapshot = editing.getSnapshot();
    if (snapshot.status === 'editing' && !editing.finish()) return false;
    transition();
    return true;
  }

  finishIfEditingLayerChanged(activeLayerId: LayerId | null) {
    const gesture = this.gesture;
    const editing = this.dependencies().textEditing;
    const snapshot = editing.getSnapshot();
    if (snapshot.status !== 'editing' || snapshot.layerId === activeLayerId) return;
    if (gesture?.kind === 'text' && gesture.layerId === snapshot.layerId) this.commit();
    editing.finish();
  }

  dispose() {
    this.cancel();
    this.cancelPaint();
  }

  private cancelPaint() {
    this.pendingPaintPatch = null;
    this.cancelPaintFrame();
  }

  private cancelPaintFrame() {
    if (this.paintFrame === null) return;
    this.dependencies().cancelFrame(this.paintFrame);
    this.paintFrame = null;
  }
}
