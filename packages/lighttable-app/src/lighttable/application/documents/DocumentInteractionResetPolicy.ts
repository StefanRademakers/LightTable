import type { EditorSession } from '../../editor/session/editorSession';

export interface DocumentInteractionResetParticipants {
  finishTextEditing(): void;
  selection: {
    resetGesture(): void;
    clearDraft(): void;
    clearClipboardFeedback(): void;
    closeDialogs(): void;
    publishNewEditorSession(session: EditorSession): void;
    clearPublishedGeometry(): void;
  };
  resetPaint(): void;
  resetTransform(): void;
  lensBlur: { resetDepth(): void; clearPickers(): void; showResult(): void };
}

/**
 * Distinct document lifecycle transitions, not a universal reset-all operation.
 * Participants own their state/cleanup. No document, history or renderer access
 * is available here; canonical selection reset is admitted only by source open.
 */
export class DocumentInteractionResetPolicy {
  constructor(private readonly participants: DocumentInteractionResetParticipants) {}

  prepareNewSource = (): void => { this.participants.finishTextEditing(); };

  initializeNewSelection = (session: EditorSession): void => {
    const p = this.participants;
    p.selection.publishNewEditorSession(session);
    p.selection.resetGesture();
    p.resetPaint();
    p.selection.clearDraft();
    p.selection.clearClipboardFeedback();
    p.selection.closeDialogs();
    p.resetTransform();
  };

  initializeLensBlur = (): void => {
    const p = this.participants;
    p.lensBlur.resetDepth(); p.lensBlur.clearPickers(); p.lensBlur.showResult();
  };

  sourcePublished = (): void => {
    const p = this.participants;
    p.lensBlur.resetDepth(); p.lensBlur.clearPickers();
    p.selection.resetGesture(); p.resetPaint(); p.selection.clearDraft();
    p.resetTransform();
    p.selection.clearPublishedGeometry();
    p.selection.clearClipboardFeedback(); p.selection.closeDialogs();
    p.lensBlur.showResult();
  };

  rebindExisting = (): void => {
    const p = this.participants;
    p.finishTextEditing();
    p.selection.resetGesture(); p.resetPaint(); p.resetTransform();
    p.selection.clearDraft(); p.selection.clearClipboardFeedback();
    // Deliberately preserve committed selection, tool settings, Lens Blur state,
    // processing and history. A tab rebind is not another source publication.
  };
}
