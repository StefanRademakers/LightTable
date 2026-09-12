export interface DocumentFilePreparationParticipants {
  /** Exact opening session/renderer lifetime, not a revision changed by these commits. */
  assertCurrent(): void;
  settlePixels(): Promise<void>;
  finishTextCreation(): Promise<void>;
  finishTextEditing(): void;
  /** Completion must include any pending gesture admission, not merely signal end. */
  commitAdjustments(): Promise<void>;
  commitLayerDocument(): Promise<void>;
}

/** File-only prerequisites. The named tool owners retain their commits and history. */
export const prepareDocumentFileIntent = async (
  participants: DocumentFilePreparationParticipants
): Promise<void> => {
  participants.assertCurrent();
  await participants.settlePixels();
  participants.assertCurrent();
  // Finish existing document gestures before text creation dispatches a new
  // semantic mutation, which could otherwise supersede their pending owner.
  await participants.commitAdjustments();
  participants.assertCurrent();
  // Typing owns its own document transaction and observation; generic layer
  // settlement must not steal that transaction before the text owner closes it.
  participants.finishTextEditing();
  participants.assertCurrent();
  await participants.commitLayerDocument();
  participants.assertCurrent();
  await participants.finishTextCreation();
  participants.assertCurrent();
};
