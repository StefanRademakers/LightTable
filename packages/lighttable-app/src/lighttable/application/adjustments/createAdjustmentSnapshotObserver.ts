import type { LightTableCommandService } from '../commands/lightTableCommandService';
import type { DocumentSessionId } from '../documents/documentSession';
import { parseAttachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import type { BasicAdjustments } from '../../types';
import type { LayerId } from '../../editor/document/documentTypes';
import type { AdjustmentPresentationDomain } from './adjustmentPresentationStore';

export interface CommittedAdjustmentSnapshot {
  readonly after: BasicAdjustments;
  readonly targetLayerId: LayerId | null;
  readonly domain: AdjustmentPresentationDomain;
}

/** Maps committed processing ownership to the one semantic Actions observation. */
export const createAdjustmentSnapshotObserver = (
  commands: Pick<LightTableCommandService, 'recordObservedCommand'>,
  getDocumentId: () => DocumentSessionId
) => ({ after, targetLayerId, domain }: CommittedAdjustmentSnapshot): void => {
  const attached = targetLayerId ? parseAttachedAdjustmentOwnerId(targetLayerId) : null;
  const target = attached
    ? { kind: 'attached' as const, layerId: attached.layerId, adjustmentId: attached.adjustmentId }
    : targetLayerId
      ? { kind: 'layer' as const, layerId: targetLayerId }
      : { kind: 'document' as const, owner: domain === 'lens-fx' ? 'lens-fx' as const : 'grade' as const };
  commands.recordObservedCommand(
    'adjustment.setSnapshot',
    getDocumentId(),
    { target, snapshot: after },
    { target, changed: true }
  );
};
