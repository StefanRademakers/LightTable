import type { LayerId } from '../document/documentTypes';
import type { RenderIslandPlan, RenderIslandPlanEntry } from './RenderIslandPlanner';

export type RenderIslandResourceId = string & { readonly __brand: 'RenderIslandResourceId' };

export interface RetainedRenderIsland extends RenderIslandPlanEntry {
  readonly resourceId: RenderIslandResourceId;
}

export interface RetainedRenderIslandReconciliation {
  readonly islands: readonly RetainedRenderIsland[];
  readonly releasedResourceIds: readonly RenderIslandResourceId[];
}

interface RetainedIdentity {
  readonly resourceId: RenderIslandResourceId;
  readonly candidateKey: string;
  readonly role: RenderIslandPlanEntry['role'];
  readonly isolationOwnerId: LayerId | null;
  readonly canonicalLayerIds: readonly LayerId[];
  readonly anchorLayerId: LayerId;
}

const overlap = (left: readonly LayerId[], right: readonly LayerId[]) => {
  const ids = new Set(left);
  return right.reduce((count, id) => count + (ids.has(id) ? 1 : 0), 0);
};

/**
 * Reconciles pure plans with renderer-owned identities. Canonical layer IDs are
 * never rewritten; this registry only stabilizes retained GPU/Rust resources.
 */
export class RetainedRenderIslandRegistry {
  private sequence = 0;
  private retained: RetainedIdentity[] = [];

  reconcile(plan: RenderIslandPlan): RetainedRenderIslandReconciliation {
    const available = new Set(this.retained.map(({ resourceId }) => resourceId));
    const claim = (island: RenderIslandPlanEntry): RetainedIdentity | null => {
      const candidates = this.retained.filter(({ resourceId }) => available.has(resourceId));
      const exact = candidates.find(({ candidateKey }) => candidateKey === island.candidateKey);
      if (exact) return exact;
      if (island.isolationOwnerId) {
        const owner = candidates.find(({ isolationOwnerId }) => (
          isolationOwnerId === island.isolationOwnerId
        ));
        if (owner) return owner;
      }
      return candidates
        .map(identity => ({
          identity,
          overlap: overlap(identity.canonicalLayerIds, island.canonicalLayerIds),
          anchor: identity.anchorLayerId === island.anchorLayerId ? 1 : 0
        }))
        .filter(({ overlap: shared }) => shared > 0)
        .sort((left, right) => (
          right.overlap - left.overlap
          || right.anchor - left.anchor
          || left.identity.resourceId.localeCompare(right.identity.resourceId)
        ))[0]?.identity ?? null;
    };

    const next = plan.islands.map(island => {
      const existing = claim(island);
      const resourceId = existing?.resourceId
        ?? `vector-island-${this.sequence += 1}` as RenderIslandResourceId;
      available.delete(resourceId);
      return { ...island, resourceId };
    });
    const releasedResourceIds = this.retained
      .map(({ resourceId }) => resourceId)
      .filter(resourceId => available.has(resourceId));
    this.retained = next.map(({
      resourceId, candidateKey, role, isolationOwnerId, canonicalLayerIds, anchorLayerId
    }) => ({
      resourceId, candidateKey, role, isolationOwnerId, canonicalLayerIds, anchorLayerId
    }));
    return { islands: next, releasedResourceIds };
  }

  clear(): readonly RenderIslandResourceId[] {
    const released = this.retained.map(({ resourceId }) => resourceId);
    this.retained = [];
    return released;
  }
}
