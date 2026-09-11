import { TransformSelectionPublicationError } from './publishTransformDocumentSelection';

export interface BoundSelectionRenderer {
  publishTransformState(publish: () => void, isIndeterminate: (reason: unknown) => boolean): Promise<void>;
}

/** Queue admission precedes the synchronous compound transform publication. */
export const publishBoundSelection = async (input: {
  renderer: BoundSelectionRenderer;
  bindingIsCurrent(): boolean;
  publish(): void;
}): Promise<void> => {
  if (!input.bindingIsCurrent()) {
    throw new Error('The transform renderer or selection lease is no longer current.');
  }
  await input.renderer.publishTransformState(
    () => {
      if (!input.bindingIsCurrent()) {
        throw new Error('The transform renderer or selection changed during restoration.');
      }
      input.publish();
    },
    (reason) => reason instanceof TransformSelectionPublicationError && reason.phase === 'indeterminate'
  );
};
