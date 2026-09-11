export interface InteractionScopeSource {
  getWorkspaceId(): string;
  getLifecycleIdentity(): object;
  getRenderer(): object | null;
  getRendererGeneration(): number;
}

/**
 * A terminal operation may legitimately change canonical revision. Its scope
 * tracks the mounted workspace and renderer generation, not that revision.
 * This token owns no state or resources and cannot recover a stale operation.
 */
export const captureInteractionScope = (source: InteractionScopeSource) => {
  const workspaceId = source.getWorkspaceId();
  const lifecycle = source.getLifecycleIdentity();
  const renderer = source.getRenderer();
  const generation = source.getRendererGeneration();
  const isCurrent = () => source.getWorkspaceId() === workspaceId
    && source.getLifecycleIdentity() === lifecycle
    && source.getRenderer() === renderer
    && source.getRendererGeneration() === generation;
  return {
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) throw new Error('Interaction settlement belongs to a retired document renderer.');
    }
  };
};
