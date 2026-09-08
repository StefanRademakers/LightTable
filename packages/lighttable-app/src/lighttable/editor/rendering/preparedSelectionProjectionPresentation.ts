import type { PreparedSelectionProjection } from '@lighttable/editor-kernel';

/** Adds viewport invalidation to a prepared projection without owning its state. */
export const withSelectionProjectionPresentation = <Coverage, Provenance>(
  prepared: PreparedSelectionProjection<Coverage, Provenance>,
  invalidate: () => void,
): PreparedSelectionProjection<Coverage, Provenance> => ({
  transactionId: prepared.transactionId,
  baselineRevision: prepared.baselineRevision,
  result: prepared.result,
  activate: () => {
    const activation = prepared.activate();
    invalidate();
    return {
      accept: () => activation.accept(),
      rollback: () => {
        activation.rollback();
        invalidate();
      },
    };
  },
  dispose: () => prepared.dispose(),
});
