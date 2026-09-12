import { beforeEach, expect, it, vi } from 'vitest';
import { useFaceWarpLifecycle } from './useFaceWarpLifecycle';

const effects = vi.hoisted(() => ({ layout: [] as Array<{ setup: () => void | (() => void); deps: unknown[] }>,
  passive: [] as Array<() => () => void> }));
vi.mock('react', () => ({
  useLayoutEffect: (setup: () => void | (() => void), deps: unknown[]) => { effects.layout.push({ setup, deps }); },
  useEffect: (setup: () => () => void) => { effects.passive.push(setup); }
}));
beforeEach(() => { effects.layout = []; effects.passive = []; });

it('retires exact runtime changes before paint, resets tool exit, and disposes only its detector', () => {
  const interaction = { reset: vi.fn() };
  const review = { reset: vi.fn(), synchronize: vi.fn(), dispose: vi.fn() };
  const session = {}; const lifecycle = {};
  useFaceWarpLifecycle(interaction, review, session, lifecycle, 7, false, null);
  expect(effects.layout[0].deps).toEqual([interaction, review, session, lifecycle, 7]);
  const cleanup = effects.layout[0].setup() as () => void;
  expect(interaction.reset).toHaveBeenCalledOnce();
  cleanup(); expect(interaction.reset).toHaveBeenCalledTimes(2);
  effects.layout[0].setup(); expect(interaction.reset).toHaveBeenCalledTimes(3);
  effects.layout[1].setup(); expect(interaction.reset).toHaveBeenCalledTimes(4);
  effects.layout[2].setup(); expect(review.synchronize).toHaveBeenCalledWith(null);
  expect(review.dispose).not.toHaveBeenCalled();
  effects.passive[0]()(); expect(review.dispose).toHaveBeenCalledOnce();
});
