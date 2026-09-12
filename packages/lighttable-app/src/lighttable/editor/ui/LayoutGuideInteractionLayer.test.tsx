import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { LayoutGuideInteractionLayer } from './LayoutGuideInteractionLayer';
import { DocumentGuideInteraction } from '../../application/tools/snapping/DocumentGuideInteraction';
import { createImageDocument } from '../document/documentTypes';
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }), useLayoutEffect: (effect: () => void | (() => void)) => effects.push(effect),
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}));
beforeEach(() => { effects.length = 0; });
const setup = () => {
  let document = createImageDocument('Guide', 200, 100, 'a'); document.guides = [{ id: 'a', orientation: 'vertical', position: 10 }];
  const owner = new DocumentGuideInteraction({ capture: () => ({ isCurrent: () => true, getDocument: () => document }),
    changeDocument: mutate => { document = mutate(document); return true; }, reportFailure: vi.fn() });
  const node = LayoutGuideInteractionLayer({ imageRect: { x: 20, y: 30, width: 400, height: 200 }, scale: 2,
    guides: document.guides, rulersVisible: false, guidesVisible: true, guidesLocked: false, interactive: true, ready: true, interaction: owner }) as ReactElement<any>;
  let captured = false;
  const surface = { getBoundingClientRect: () => ({ left: 100, top: 50 }), setPointerCapture: vi.fn(() => { captured = true; }),
    hasPointerCapture: () => captured, releasePointerCapture: vi.fn(() => { captured = false; }) };
  node.props.ref.current = surface;
  const cleanups = effects.map(effect => effect());
  const hit = node.props.children[1][0] as ReactElement<any>;
  const event = (clientX: number, clientY: number, altKey = false) => ({ button: 0, pointerId: 7, clientX, clientY, altKey, shiftKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn() });
  return { node, owner, surface, hit, event, document: () => document, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
};
it('converts the final pointer-up sample and modifiers even without a move event, then releases capture', () => {
  const f = setup(); f.hit.props.onPointerDown(f.event(140, 100));
  f.node.props.onPointerUp(f.event(180, 200, true));
  expect(f.document().guides[0]).toMatchObject({ orientation: 'horizontal', position: 60 });
  expect(f.surface.releasePointerCapture).toHaveBeenCalledOnce();
});
it.each(['retire', 'unmount', 'lost-capture'] as const)('releases pointer ownership on %s without committing', reason => {
  const f = setup(), opening = f.document(); f.hit.props.onPointerDown(f.event(140, 100));
  f.node.props.onPointerMove(f.event(180, 200));
  if (reason === 'retire') f.owner.cancel(); else if (reason === 'unmount') f.unmount();
  else f.node.props.onLostPointerCapture(f.event(180, 200));
  expect(f.surface.releasePointerCapture).toHaveBeenCalledOnce(); expect(f.owner.getSnapshot()).toBeNull();
  f.node.props.onPointerUp(f.event(200, 200)); expect(f.document()).toBe(opening);
});
