import type { Rect } from '../../editor/document/documentTypes';
import type { DocumentSession } from '../documents/documentSession';
import type { captureInteractionScope } from '../interactions/captureInteractionScope';

/** Resolves crop intent from committed coverage, never semantic provenance or another GPU readback. */
export const beginDocumentCrop = async (ports: {
  session: Pick<DocumentSession, 'getSnapshot'> | undefined;
  captureScope(): ReturnType<typeof captureInteractionScope>;
  settleInteraction(): Promise<void>;
  applySelectionCrop(bounds: Rect): void;
  presentInteractiveCrop(bounds: Rect): void;
}): Promise<void> => {
  const session = ports.session;
  if (!session) throw new Error('Crop requires an admitted document session.');
  const scope = ports.captureScope();
  await ports.settleInteraction();
  scope.assertCurrent();
  const { document, editor } = session.getSnapshot();
  if (!document) throw new Error('The crop document is unavailable.');
  const coverage = editor.selectionMaskSnapshot;
  if (!coverage) throw new Error('Crop requires exact committed selection coverage.');
  if (coverage.active) {
    const bounds = editor.selectionSupportBounds;
    if (!bounds) throw new Error('The active selection has no crop area.');
    ports.applySelectionCrop({ ...bounds });
  } else {
    ports.presentInteractiveCrop({ x: 0, y: 0, width: document.width, height: document.height });
  }
};
