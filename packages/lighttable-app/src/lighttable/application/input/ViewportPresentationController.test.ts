import { describe, expect, it, vi } from 'vitest';
import type { LightTableViewState } from '../../types';
import { ViewportPresentationController } from './ViewportPresentationController';

const view = (): LightTableViewState => ({ scale: 1, panX: 0, panY: 0 });
const frameHost = () => ({ request: vi.fn(() => 1), cancel: vi.fn() });

describe('ViewportPresentationController', () => {
  it('cancels a retained gesture immediately when the document owner changes', () => {
    const setA = vi.fn();
    const setB = vi.fn();
    const controller = new ViewportPresentationController('a', setA, frameHost());
    expect(controller.beginPan({
      pointerId: 1,
      button: 1,
      buttons: 4,
      initiator: 'middle-button',
      point: { x: 10, y: 10 },
      view: view(),
      hasDocumentMetadata: true,
      competingGesture: false
    })).toBe(true);
    const nextOwner = controller.prepare('b', setB);
    expect(controller.movePan(1, { x: 20, y: 20 })).toBe(true);
    controller.commit(nextOwner);
    expect(controller.movePan(1, { x: 30, y: 30 })).toBe(false);
    expect(setA).not.toHaveBeenCalled();
    expect(setB).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('does not expose a pending view after rebinding', () => {
    const controller = new ViewportPresentationController('a', vi.fn(), frameHost());
    controller.scheduleView({ ...view(), scale: 2 });
    expect(controller.pendingView()?.scale).toBe(2);
    controller.commit(controller.prepare('b', vi.fn()));
    expect(controller.pendingView()).toBeNull();
    controller.dispose();
  });

  it('does not cancel committed input while a speculative owner is only prepared', () => {
    const setA = vi.fn();
    const controller = new ViewportPresentationController('a', setA, frameHost());
    expect(controller.beginPan({
      pointerId: 1,
      button: 1,
      buttons: 4,
      initiator: 'middle-button',
      point: { x: 10, y: 10 },
      view: view(),
      hasDocumentMetadata: true,
      competingGesture: false
    })).toBe(true);
    controller.prepare('speculative-b', vi.fn());
    expect(controller.ownsPan(1)).toBe(true);
    controller.dispose();
  });
});
