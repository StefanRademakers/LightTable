import { describe, expect, it, vi } from 'vitest';
import { createEditorSession } from '../../editor/session/editorSession';
import { TextPointerRouter, type TextPointerPorts } from './TextPointerRouter';

const setup = () => {
  const events: string[] = [];
  const participant = (name: string) => ({
    begin: vi.fn(() => { events.push(name); return false; }),
    owns: vi.fn(() => false), move: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => false)
  });
  const hit = participant('hit'); const move = participant('move'); const path = participant('path');
  const frame = participant('frame'); const selection = participant('selection');
  const creation = participant('creation');
  const p: TextPointerPorts = {
    getDocument: () => null, getTool: () => 'text-point', getScale: () => 2,
    getVectorSelection: () => createEditorSession().vectorSelection,
    activation: { begin: hit.begin }, pendingHit: { ...hit, cancelPointer: hit.cancel },
    layerMove: move, pathHandle: path, frameResize: frame, selection,
    creation: { ...creation, beginPoint: vi.fn(async () => undefined), beginParagraph: vi.fn(() => {
      events.push('creation'); creation.owns.mockReturnValue(true); return true;
    }), cancelPointer: creation.cancel },
    finishEditing: vi.fn(() => { events.push('finish-editing'); }), reportFailure: vi.fn()
  };
  return { p, router: new TextPointerRouter(() => p), hit, move, path, frame, selection, creation, events };
};
describe('Text pointer routing', () => {
  it('honors temporary layer move before path handles and glyph hits', () => {
    const h = setup(); h.move.begin.mockReturnValue(true);
    expect(h.router.beginPoint(1, { x: 5, y: 6 }, true, 2, false)).toBe(true);
    expect(h.move.begin).toHaveBeenCalledOnce(); expect(h.path.begin).not.toHaveBeenCalled();
    expect(h.hit.begin).not.toHaveBeenCalled();
  });
  it('orders paragraph handles, existing text and new draft without a second mutation route', () => {
    const h = setup(); h.router.beginParagraph(1, { x: 5, y: 6 }, false, 2, true);
    expect(h.events).toEqual(['path', 'frame', 'hit', 'finish-editing', 'creation']);
    expect(h.path.begin).toHaveBeenCalledWith(1, { x: 5, y: 6 }, 4);
    expect(h.hit.begin).toHaveBeenCalledWith({ x: 5, y: 6 }, 'any', 1, 2, true);
  });
  it('existing text consumes a point creation click', () => {
    const h = setup(); h.hit.begin.mockReturnValue(true); h.router.createAtPoint({ x: 5, y: 6 }, 1, false);
    expect(h.p.creation.beginPoint).not.toHaveBeenCalled(); expect(h.p.finishEditing).not.toHaveBeenCalled();
  });
  it('a genuine miss finishes editing then requests point creation', () => {
    const h = setup(); h.router.createAtPoint({ x: 5, y: 6 }, 1, false);
    expect(h.p.finishEditing).toHaveBeenCalledOnce(); expect(h.p.creation.beginPoint).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
  it('a missing native path is reported, never replaced by plain point text', () => {
    const h = setup(); h.p.getTool = () => 'text-path'; h.router.createAtPoint({ x: 5, y: 6 }, 1, false);
    expect(h.p.reportFailure).toHaveBeenCalledWith('Select exactly one native path before creating Path Text.');
    expect(h.p.creation.beginPoint).not.toHaveBeenCalled();
  });
  it.each(['hit', 'move', 'selection', 'path', 'frame', 'creation'] as const)(
    'routes pointer samples and terminal to owning %s only', key => {
      const h = setup(); h[key].owns.mockReturnValue(true);
      expect(h.router.owns(1)).toBe(true); h.router.move(1, { x: 7, y: 8 }); h.router.finish(1, { x: 9, y: 10 });
      for (const name of ['hit', 'move', 'selection', 'path', 'frame', 'creation'] as const) {
        if (name === key) { expect(h[name].move).toHaveBeenCalledOnce(); expect(h[name].finish).toHaveBeenCalledOnce(); }
        else { expect(h[name].move).not.toHaveBeenCalled(); expect(h[name].finish).not.toHaveBeenCalled(); }
      }
    });
  it('does not try another owner after a failed current sample', () => {
    const h = setup(); h.hit.owns.mockReturnValue(true); h.hit.move.mockReturnValue(false); h.creation.owns.mockReturnValue(true);
    expect(h.router.move(1, { x: 5, y: 6 })).toBe(false); expect(h.creation.move).not.toHaveBeenCalled();
  });
  it('replays a delayed completed drag into its new paragraph owner without re-hitting glyphs', () => {
    const h = setup(); const current = { x: 50, y: 60 };
    h.router.miss({ pointerId: 1, start: { x: 5, y: 6 }, current, finished: true },
      { point: { x: 5, y: 6 }, radius: 4, tool: 'text-point', clickCount: 1, extend: false });
    expect(h.hit.begin).not.toHaveBeenCalled(); expect(h.p.creation.beginParagraph).toHaveBeenCalledOnce();
    expect(h.creation.move).toHaveBeenCalledWith(1, current); expect(h.creation.finish).toHaveBeenCalledWith(1, current);
  });
  it('replays a delayed drag to a frame handle if that handle wins, not to a nonexistent draft', () => {
    const h = setup(); h.frame.begin.mockImplementation(() => { h.frame.owns.mockReturnValue(true); return true; });
    const current = { x: 50, y: 60 };
    h.router.miss({ pointerId: 1, start: { x: 5, y: 6 }, current, finished: true },
      { point: { x: 5, y: 6 }, radius: 4, tool: 'text-point', clickCount: 1, extend: false });
    expect(h.p.creation.beginParagraph).not.toHaveBeenCalled();
    expect(h.frame.move).toHaveBeenCalledWith(1, current); expect(h.frame.finish).toHaveBeenCalledWith(1, current);
    expect(h.creation.finish).not.toHaveBeenCalled();
  });
});
