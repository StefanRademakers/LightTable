import { beforeEach, expect, it, vi } from 'vitest';
import { useFaceWarpScope } from './useFaceWarpScope';

const hooks = vi.hoisted(() => ({ ref: null as null | { current: unknown } }));
vi.mock('react', () => ({ useRef: (current: unknown) => hooks.ref ??= { current },
  useCallback: (callback: unknown) => callback }));
beforeEach(() => { hooks.ref = null; });

it('captures concrete session identity and current admission while retaining exact renderer scope', () => {
  let accepting = true;
  let rendererCurrent = true;
  const session = { id: 'same-id', isAcceptingMutations: () => accepting };
  const mounted = () => ({ isCurrent: () => rendererCurrent });
  const capture = useFaceWarpScope(session, mounted);
  const opening = capture(); expect(opening.isCurrent()).toBe(true);
  accepting = false; expect(opening.isCurrent()).toBe(false);
  accepting = true; rendererCurrent = false; expect(opening.isCurrent()).toBe(false);
  rendererCurrent = true;
  const successor = { id: 'same-id', isAcceptingMutations: () => true };
  useFaceWarpScope(successor, mounted);
  expect(opening.isCurrent()).toBe(false);
  expect(capture().isCurrent()).toBe(true);
});
