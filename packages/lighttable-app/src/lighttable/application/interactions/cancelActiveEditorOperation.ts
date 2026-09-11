/** Escape precedence is application interaction policy, not keyboard/UI policy. */
export interface EditorCancellationTarget {
  isActive(): boolean;
  cancel(): void;
}

export interface EditorEscapeParticipants {
  readonly faceDetection: EditorCancellationTarget;
  readonly toolMenu: EditorCancellationTarget;
  readonly crop: EditorCancellationTarget;
  readonly textEditing: EditorCancellationTarget;
  cancelParagraphCreation(): boolean;
  cancelPointCreation(): boolean;
  readonly transform: EditorCancellationTarget;
  readonly autoAlign: EditorCancellationTarget;
  readonly warp: EditorCancellationTarget;
  readonly selectionDraft: EditorCancellationTarget;
  cancelPenPath(): boolean;
  readonly selection: EditorCancellationTarget;
}

export type EditorEscapeOutcome =
  | 'face-detection' | 'tool-menu' | 'crop' | 'text-editing'
  | 'paragraph-creation' | 'point-creation' | 'transform'
  | 'auto-align' | 'warp' | 'selection-draft' | 'pen-path' | 'selection' | 'idle';

const cancel = (target: EditorCancellationTarget): boolean => {
  if (!target.isActive()) return false;
  target.cancel();
  return true;
};

/**
 * Consume exactly one Escape. A terminal failure propagates: it must not cancel
 * a lower-priority interaction as an alternative or clear a committed selection.
 * Each participant retains its own commit/cancel implementation and history.
 * In particular, ending text editing is the text owner's finish operation.
 */
export const cancelActiveEditorOperation = (
  participants: EditorEscapeParticipants
): EditorEscapeOutcome => {
  if (cancel(participants.faceDetection)) return 'face-detection';
  if (cancel(participants.toolMenu)) return 'tool-menu';
  if (cancel(participants.crop)) return 'crop';
  if (cancel(participants.textEditing)) return 'text-editing';
  if (participants.cancelParagraphCreation()) return 'paragraph-creation';
  if (participants.cancelPointCreation()) return 'point-creation';
  if (cancel(participants.transform)) return 'transform';
  if (cancel(participants.autoAlign)) return 'auto-align';
  if (cancel(participants.warp)) return 'warp';
  if (cancel(participants.selectionDraft)) return 'selection-draft';
  if (participants.cancelPenPath()) return 'pen-path';
  if (cancel(participants.selection)) return 'selection';
  return 'idle';
};
