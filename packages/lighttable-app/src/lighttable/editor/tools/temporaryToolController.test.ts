import { describe, expect, it } from 'vitest';
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
});
