export interface MountedInteractionLifecycleParticipants {
  settleSelection(): Promise<void>;
  settleTransform(): Promise<void>;
  retireToolActivation(): void;
  retireTransitions(retireParticipants: () => void): void;
  retireSelection(): void;
  resetTransform(): void;
}

/** Owns cross-system mounted interaction terminal order; participants retain their algorithms. */
export class MountedInteractionLifecycle {
  constructor(private readonly participants: MountedInteractionLifecycleParticipants) {}

  readonly settlePixels = async (isCurrent: () => boolean): Promise<void> => {
    await this.participants.settleSelection();
    if (!isCurrent()) return;
    await this.participants.settleTransform();
  };

  readonly retire = (): void => {
    this.participants.retireToolActivation();
    this.participants.retireTransitions(() => {
      this.participants.retireSelection();
      this.participants.resetTransform();
    });
  };
}
