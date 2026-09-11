import { describe, expect, it, vi } from 'vitest';
import { TemporaryToolController } from './temporaryToolController';

describe('TemporaryToolController', () => {
  it('overrides without mutating the persistent tool', () => {
    const controller = new TemporaryToolController();
    expect(controller.effectiveTool('brush')).toBe('brush');
    expect(controller.begin('view')).toBe(true);
    expect(controller.effectiveTool('brush')).toBe('view');
    expect(controller.activeTool).toBe('view');
  });

  it('makes repeated keydown and keyup idempotent', () => {
    const controller = new TemporaryToolController();
    expect(controller.begin('view')).toBe(true);
    expect(controller.begin('view')).toBe(false);
    expect(controller.end('view')).toBe(true);
    expect(controller.end('view')).toBe(false);
    expect(controller.active).toBe(false);
  });

  it('does not end a different temporary override', () => {
    const controller = new TemporaryToolController();
    controller.begin('view');
    expect(controller.end('brush')).toBe(false);
    expect(controller.effectiveTool('transform')).toBe('view');
  });

  it('publishes one coherent override on overlap, with no pan/zoom/erase booleans to diverge', () => {
    const controller = new TemporaryToolController();
    const snapshots: unknown[] = [];
    const unsubscribe = controller.subscribe(() => snapshots.push(controller.getSnapshot()));
    controller.begin('view');
    controller.begin('zoom', true);
    expect(controller.effectiveTool('brush')).toBe(controller.getSnapshot().tool);
    expect(controller.end('view')).toBe(false);
    expect(controller.getSnapshot()).toEqual({ tool: 'zoom', zoomOut: true });
    controller.begin('erase');
    expect(controller.getSnapshot()).toEqual({ tool: 'erase', zoomOut: false });
    controller.end();
    expect(snapshots).toEqual([
      { tool: 'view', zoomOut: false }, { tool: 'zoom', zoomOut: true },
      { tool: 'erase', zoomOut: false }, { tool: null, zoomOut: false }
    ]);
    unsubscribe();
    controller.begin('view');
    expect(snapshots).toHaveLength(4);
  });

  it('keeps snapshot identity stable on repeat input and clears direction on retirement', () => {
    const controller = new TemporaryToolController();
    const listener = vi.fn();
    controller.subscribe(listener);
    const idle = controller.getSnapshot();
    controller.begin('zoom', true);
    const zoom = controller.getSnapshot();
    expect(controller.begin('zoom', false)).toBe(false);
    expect(controller.getSnapshot()).toBe(zoom);
    controller.end();
    expect(controller.getSnapshot()).toBe(idle);
    expect(controller.end()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
