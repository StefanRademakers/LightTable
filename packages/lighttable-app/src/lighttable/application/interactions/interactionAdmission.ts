/** Explicit result of trying to reserve one document-bound interaction. */
export type InteractionAdmission<Handle extends object> =
  | { readonly status: 'admitted'; readonly handle: Handle }
  | { readonly status: 'rejected' };

export const admittedInteraction = <Handle extends object>(
  handle: Handle
): InteractionAdmission<Handle> => ({ status: 'admitted', handle });

export const rejectedInteraction = <Handle extends object>(): InteractionAdmission<Handle> => ({
  status: 'rejected'
});

export const admittedHandle = <Handle extends object>(
  admission: InteractionAdmission<Handle> | void
): Handle | null => admission?.status === 'admitted' ? admission.handle : null;
