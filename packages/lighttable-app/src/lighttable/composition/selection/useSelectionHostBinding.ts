import { useLayoutEffect, useMemo, useRef } from 'react';
import type { LightTableCommandService } from '../../application/commands/lightTableCommandService';
import type { DocumentSession } from '../../application/documents/documentSession';
import { SelectionCommandObservation } from '../../application/tools/selection/SelectionCommandObservation';
import { DocumentSelectionStateStore } from '../../application/tools/selection/DocumentSelectionStateStore';
import { SelectionGestureHostBinding, type SelectionGestureHostInputs,
  type SelectionGestureProjection } from '../../application/tools/selection/SelectionGestureHostBinding';

/** Mounted adaptation only; gestures and the kernel retain all selection ownership. */
export const useSelectionHostBinding = (
  session: DocumentSession | undefined, renderer: object | null, generation: number,
  lifecycle: object, captureScope: () => { isCurrent(): boolean },
  commands: Pick<LightTableCommandService, 'recordObservedCommand'>,
  read: () => SelectionGestureHostInputs, projection: SelectionGestureProjection
) => {
  const latest = useRef({ session, read, projection });
  latest.current = { session, read, projection };
  const binding = useMemo(() => {
    const scope = captureScope();
    const lease = { mounted: false };
    const isCurrent = () => lease.mounted && latest.current.session === session
      && session?.getSnapshot().lifecycle !== 'disposed' && scope.isCurrent();
    return { lease,
      hasActiveSelection: () => {
        if (!isCurrent() || !session?.getSnapshot().document) {
          throw new Error('The current document selection is unavailable.');
        }
        return new DocumentSelectionStateStore(session)
          .acquire(session.getSnapshot().documentRevision).selection.active;
      },
      gesture: new SelectionGestureHostBinding(() => latest.current.read(), {
        updateEditor: update => latest.current.projection.updateEditor(update),
        draft: shape => latest.current.projection.draft(shape),
        snapFeedback: (matches, bounds) => latest.current.projection.snapFeedback(matches, bounds)
      }, isCurrent),
      observation: new SelectionCommandObservation(session, commands, isCurrent)
    };
  }, [session, renderer, generation, lifecycle, captureScope, commands]);
  useLayoutEffect(() => {
    binding.lease.mounted = true;
    return () => { binding.lease.mounted = false; };
  }, [binding]);
  return binding;
};
