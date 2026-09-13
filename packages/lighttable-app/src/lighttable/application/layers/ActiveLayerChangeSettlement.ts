import type { LayerId } from '../../editor/document/documentTypes';

export interface ActiveLayerChangeSettlementParticipants {
  hasPendingTransform(): boolean;
  settleTransform(): Promise<void>;
  getEditingTextLayerId(): LayerId | null;
  finishTextEditing(): void;
  prepareVectorTarget(layerId: LayerId): void;
}

/**
 * Owns the cross-domain terminal order required before the active layer changes.
 * Individual tools retain their algorithms and transactions; this owner only
 * settles the opening target before the Layers controller publishes a successor.
 */
export class ActiveLayerChangeSettlement {
  constructor(private readonly participants: ActiveLayerChangeSettlementParticipants) {}

  readonly prepare = async (layerId: LayerId, isCurrent: () => boolean): Promise<void> => {
    if (this.participants.hasPendingTransform()) {
      await this.participants.settleTransform();
    }
    if (!isCurrent()) return;

    if (this.participants.getEditingTextLayerId() !== layerId) {
      this.participants.finishTextEditing();
    }
    if (!isCurrent()) return;

    this.participants.prepareVectorTarget(layerId);
  };
}
