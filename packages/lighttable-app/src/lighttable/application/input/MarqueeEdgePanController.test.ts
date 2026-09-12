import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LightTableViewState } from '../../types';
import type { ViewportFrameOwner } from './ViewportPresentationController';
import { MarqueeEdgePanController } from './MarqueeEdgePanController';

afterEach(() => vi.unstubAllGlobals());

const setup = (imageX = -100) => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let view: LightTableViewState = {
    scale: 1, panX: 0, panY: 0
  };
  const owner: ViewportFrameOwner = {
    documentId: 'document',
    setView: (update) => { view = typeof update === 'function' ? update(view) : update; }
  };
  const moveSelection = vi.fn();
  let currentOwner = owner;
  const controller = new MarqueeEdgePanController(
    imageX === 0
      ? { x: 0, y: 0, width: 400, height: 300 }
      : { x: imageX, y: -80, width: 600, height: 500 },
    {
      isOwnerCurrent: (candidate) => candidate === currentOwner,
      moveSelection,
      setCustomZoomMode: vi.fn(),
      requestFrame: (callback) => {
        const handle = ++nextFrame;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => { frames.delete(handle); },
      now: () => 0
    }
  );
  const update = () => controller.update({
    pointerId: 3,
    clientX: 0,
    clientY: 0,
    bounds: { left: 0, top: 0, width: 400, height: 300 },
    point: { x: 10, y: 20, pressure: 1 },
    activeTool: 'select-rectangle',
    selectionEmpty: true,
    combineMode: 'replace',
    shiftKey: true,
    altKey: true,
    scale: 1,
    repositionDraft: false,
    owner
  });
  const runNext = (time: number) => {
    const [handle, callback] = frames.entries().next().value!;
    frames.delete(handle);
    callback(time);
  };
  return {
    controller, frames, moveSelection, owner, update, runNext,
    view: () => view,
    replaceOwner: () => { currentOwner = { ...owner }; }
  };
};

describe('MarqueeEdgePanController', () => {
  it('keeps the browser receiver for default frame request and cancellation', () => {
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    const request = vi.fn(function (this: unknown, callback: FrameRequestCallback) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      const handle = ++nextFrame; frames.set(handle, callback); return handle;
    });
    const cancel = vi.fn(function (this: unknown, handle: number) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      frames.delete(handle);
    });
    vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel);
    const owner: ViewportFrameOwner = { documentId: 'document', setView: vi.fn() };
    const controller = new MarqueeEdgePanController({ x: -100, y: -80, width: 600, height: 500 }, {
      isOwnerCurrent: () => true, moveSelection: vi.fn(), setCustomZoomMode: vi.fn(), now: () => 0
    });
    expect(() => controller.update({ pointerId: 1, clientX: 0, clientY: 0,
      bounds: { left: 0, top: 0, width: 400, height: 300 }, point: { x: 10, y: 20, pressure: 1 },
      activeTool: 'select-rectangle', selectionEmpty: true, combineMode: 'replace', shiftKey: false,
      altKey: false, scale: 1, repositionDraft: false, owner })).not.toThrow();
    const frame = frames.get(1)!; frames.delete(1); frame(16);
    expect(request).toHaveBeenCalledTimes(2);
    expect(() => controller.dispose()).not.toThrow();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(2); expect(frames.size).toBe(0);
  });
  it('continues a stationary corner drag and preserves marquee modifiers', () => {
    const test = setup();
    test.update();
    test.runNext(16);
    test.runNext(32);

    expect(test.moveSelection).toHaveBeenCalledTimes(2);
    expect(test.moveSelection).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      false,
      { constrainAspect: true, fromCenter: true },
      true
    );
    expect(test.view().panX).toBeGreaterThan(0);
    expect(test.view().panY).toBeGreaterThan(0);
    expect(test.frames.size).toBe(1);
  });

  it('stops at the document boundary without publishing another selection move', () => {
    const test = setup(0);
    test.update();
    test.runNext(16);
    expect(test.moveSelection).not.toHaveBeenCalled();
    expect(test.frames.size).toBe(0);
  });

  it('rejects a queued frame after the viewport owner changes', () => {
    const test = setup();
    test.update();
    test.replaceOwner();
    test.runNext(16);
    expect(test.moveSelection).not.toHaveBeenCalled();
    expect(test.frames.size).toBe(0);
  });
});
