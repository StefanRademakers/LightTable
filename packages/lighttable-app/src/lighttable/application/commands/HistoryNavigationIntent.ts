export interface HistoryNavigationTerminal {
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}

export interface HistoryNavigationParticipants {
  finishAdjustment(): void;
  finishDocumentTransaction(): void;
  history: HistoryNavigationTerminal;
}

/** Commits coalesced UI edits before entering canonical history navigation. */
export class HistoryNavigationIntent {
  constructor(private readonly participants: HistoryNavigationParticipants) {}

  readonly undo = async (): Promise<boolean> => {
    this.finishInteractions();
    return this.participants.history.undo();
  };

  readonly redo = async (): Promise<boolean> => {
    this.finishInteractions();
    return this.participants.history.redo();
  };

  private finishInteractions(): void {
    this.participants.finishAdjustment();
    this.participants.finishDocumentTransaction();
  }
}
