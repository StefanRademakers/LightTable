import { describe, expect, it } from 'vitest';
import { captureInteractionScope } from './captureInteractionScope';

describe('mounted interaction scope', () => {
  it.each(['workspace', 'renderer', 'generation', 'lifecycle'] as const)(
    'rejects retirement through %s, including equal generation on a replacement lifecycle', (key) => {
      const state = { workspace: 'one', renderer: {}, generation: 1, lifecycle: {} };
      const scope = captureInteractionScope({
        getWorkspaceId: () => state.workspace,
        getRenderer: () => state.renderer,
        getRendererGeneration: () => state.generation,
        getLifecycleIdentity: () => state.lifecycle
      });
      expect(scope.isCurrent()).toBe(true);
      if (key === 'workspace') state.workspace = 'two';
      else if (key === 'generation') state.generation++;
      else state[key] = {};
      expect(scope.isCurrent()).toBe(false);
      expect(scope.assertCurrent).toThrow('retired document renderer');
    }
  );
});
