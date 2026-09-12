export type InteractionTransitionPolicy =
  | 'preserve'
  | 'commit-before-mutation';

export type InteractionTransitionAdmission =
  | { readonly status: 'admitted' }
  | { readonly status: 'rejected'; readonly reason: string };

export interface InteractionTransitionDependencies {
  readonly settleMountedInteraction: (isCurrent: () => boolean) => Promise<void>;
  readonly reportFailure: (message: string) => void;
}

export interface InteractionTransitionCoordinator {
  request(policy: InteractionTransitionPolicy, scope?: { isCurrent(): boolean }): Promise<InteractionTransitionAdmission>;
  retire(retireParticipants: () => void): void;
}

const admitted = (): InteractionTransitionAdmission => ({ status: 'admitted' });
const rejected = (reason: string): InteractionTransitionAdmission => ({ status: 'rejected', reason });

/**
 * Serializes transitions between mounted-document interactions.
 *
 * UI controls do not get to decide how a pending selection/transform is
 * finalized. They request one of the explicit lifecycle policies here and may
 * mutate document state only after admission. A document retirement also
 * invalidates queued admissions, so work belonging to an old document cannot
 * start after the new document has mounted.
 */
export const createInteractionTransitionCoordinator = (
  dependencies: InteractionTransitionDependencies
): InteractionTransitionCoordinator => {
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  return {
    retire: (retireParticipants) => {
      generation += 1;
      retireParticipants();
    },
    request: (policy, scope) => {
      if (policy === 'preserve') return Promise.resolve(admitted());

      const requestedGeneration = generation;
      const isCurrent = () => requestedGeneration === generation && (!scope || scope.isCurrent());
      const admission = queue.then(async () => {
        if (!isCurrent()) {
          return rejected('The document interaction was retired before mutation admission.');
        }
        try {
          await dependencies.settleMountedInteraction(isCurrent);
          if (!isCurrent()) {
            return rejected('The document interaction was retired during mutation admission.');
          }
          return admitted();
        } catch (cause) {
          if (!isCurrent()) return rejected('The document interaction was retired during mutation admission.');
          const detail = cause instanceof Error ? cause.message : String(cause);
          const reason = `Could not finish the active document interaction: ${detail}`;
          dependencies.reportFailure(reason);
          return rejected(reason);
        }
      });
      queue = admission.then(() => undefined);
      return admission;
    }
  };
};
