export interface ProcessingInteractionSettlementParticipants {
  finishAdjustment(): void;
  finishDocumentTransaction(): void;
}

/** Owns the target-change terminal order for processing gestures. */
export class ProcessingInteractionSettlement {
  constructor(private readonly participants: ProcessingInteractionSettlementParticipants) {}

  readonly finish = (): void => {
    this.participants.finishAdjustment();
    this.participants.finishDocumentTransaction();
  };
}
