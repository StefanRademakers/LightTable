export interface HistoryInteractionParticipants {
  assertCurrent(): void;
  settlePixels(): Promise<void>;
  commitPointCreation(): void;
  commitParagraphCreation(): void;
  finishTextEditing(): void;
  resetAdjustment(): void;
  resetDocumentTransaction(): Promise<void>;
}

/** History/geometry prerequisite ordering; individual owners retain terminals. */
export const settleHistoryInteractions = async (
  participants: HistoryInteractionParticipants
): Promise<void> => {
  participants.assertCurrent();
  await participants.settlePixels();
  participants.assertCurrent();
  participants.commitPointCreation();
  participants.commitParagraphCreation();
  participants.finishTextEditing();
  participants.resetAdjustment();
  await participants.resetDocumentTransaction();
  participants.assertCurrent();
};
