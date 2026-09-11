import { describe, expect, it, vi } from 'vitest';
import { PenPresentationBinding } from './PenPresentationBinding';

const setup = () => {
  let current = true;
  const controller = { finishPenPath: vi.fn(() => true), cancelPenPath: vi.fn(() => true),
    undoPenAnchor: vi.fn(() => true), penEditingOverlay: vi.fn(() => null) };
  const renderer = { setPenEditingOverlay: vi.fn(), setPenRubberBandOverlay: vi.fn() };
  const binding = new PenPresentationBinding(controller, renderer, { isCurrent: () => current });
  binding.mount();
  return { controller, renderer, binding, retire: () => { current = false; } };
};
describe('Pen presentation lifetime', () => {
  it.each(['finish', 'cancel', 'undoAnchor'] as const)('publishes %s once on the bound renderer', operation => {
    const h = setup();
    expect(h.binding[operation]()).toBe(true);
    expect(h.renderer.setPenEditingOverlay).toHaveBeenCalledOnce();
    expect(h.renderer.setPenRubberBandOverlay).toHaveBeenCalledWith(null);
  });
  it('cannot address a successor renderer or complete retired tool work', () => {
    const h = setup(); h.retire();
    h.binding.setRubberBand({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
    h.binding.setOverlay(null); h.binding.unmount();
    expect(h.binding.finish()).toBe(false);
    expect(h.controller.finishPenPath).not.toHaveBeenCalled();
    expect(h.renderer.setPenEditingOverlay).not.toHaveBeenCalled();
    expect(h.renderer.setPenRubberBandOverlay).not.toHaveBeenCalled();
  });
  it('rechecks lifetime if a terminal publication replaces its renderer', () => {
    const h = setup(); h.controller.finishPenPath.mockImplementation(() => { h.retire(); return true; });
    expect(h.binding.finish()).toBe(true);
    expect(h.renderer.setPenEditingOverlay).not.toHaveBeenCalled();
    expect(h.renderer.setPenRubberBandOverlay).not.toHaveBeenCalled();
  });
});
