import { afterEach, expect, it, vi } from 'vitest';
import { EditorToolSettings } from './EditorToolSettings';
import { EditorApplicationSession } from '../workspace/editorApplicationSession';
import type { ToolId } from '../../editor/session/editorSession';
const fixture = (tool: ToolId = 'brush') => {
  const session = new EditorApplicationSession(); session.update(current => ({ ...current, activeTool: tool }));
  const owner = new EditorToolSettings(update => session.update(current => ({ ...current, ...update(current) })));
  return { owner, read: session.getSnapshot, session };
};
afterEach(() => vi.restoreAllMocks());
it.each(['brush', 'erase', 'clone-stamp', 'healing-brush', 'dodge', 'burn', 'sponge', 'face-warp', 'warp', 'select-paint-brush'] as const)(
  '%s size and hardness change only its intended settings with existing stepping', tool => {
    const f = fixture(tool), before = f.read(); f.owner.changeBrushSize(1); f.owner.changeBrushHardness(1);
    const state = f.read();
    if (tool === 'warp') {
      expect(state.warp).toMatchObject({ diameterPx: 600, hardness: 0.6 });
      expect(state.brush).toEqual(before.brush); expect(state.selectionPaintBrush).toEqual(before.selectionPaintBrush);
    } else if (tool === 'select-paint-brush') {
      expect(state.selectionPaintBrush).toMatchObject({ size: 50, hardness: 0.9 });
      expect(state.brush).toEqual(before.brush); expect(state.warp).toEqual(before.warp);
    } else {
      expect(state.brush).toMatchObject({ size: 50, hardness: 0.9 });
      expect(state.selectionPaintBrush).toEqual(before.selectionPaintBrush); expect(state.warp).toEqual(before.warp);
    }
  });
it('preserves stepping clamps and percent timeout/zero/target separation', () => {
  const f = fixture(); f.owner.brush({ size: 1000, hardness: 1 });
  f.owner.changeBrushSize(1); f.owner.changeBrushHardness(1); expect(f.read().brush).toMatchObject({ size: 1000, hardness: 1 });
  f.owner.brush({ size: 1, hardness: 0 }); f.owner.changeBrushSize(-1); f.owner.changeBrushHardness(-1);
  expect(f.read().brush).toMatchObject({ size: 1, hardness: 0 });
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  f.owner.inputBrushPercent('opacity', 4); now.mockReturnValue(100); f.owner.inputBrushPercent('opacity', 5);
  expect(f.read().brush.opacity).toBe(0.45);
  f.owner.inputBrushPercent('opacity', 2); f.owner.inputBrushPercent('flow', 3); expect(f.read().brush.flow).toBe(0.3);
  now.mockReturnValue(1000); f.owner.inputBrushPercent('flow', 0); expect(f.read().brush.flow).toBe(1);
});
it('selection paint percentages always change opacity and preserve ordinary brush opacity/flow', () => {
  const f = fixture('select-paint-brush'), before = f.read().brush;
  f.owner.inputBrushPercent('flow', 2); expect(f.read().selectionPaintBrush.opacity).toBe(0.2); expect(f.read().brush).toEqual(before);
});
it('functional color operations read each latest update rather than a rendered toolbar snapshot', () => {
  const f = fixture(); f.owner.brush({ color: '#123456', backgroundColor: '#abcdef' });
  f.owner.swapColors(); expect(f.read().brush).toMatchObject({ color: '#abcdef', backgroundColor: '#123456' });
  f.owner.swapColors(); expect(f.read().brush).toMatchObject({ color: '#123456', backgroundColor: '#abcdef' });
  f.owner.resetColors(); expect(f.read().brush).toMatchObject({ color: '#000000', backgroundColor: '#ffffff' });
});
it('grouped patches preserve sibling fields and keep marquee ratio one update', () => {
  const f = fixture(), before = f.read(); const notify = vi.fn(); f.session.subscribe(notify);
  f.owner.sampledBrush({ aligned: false }); f.owner.toneBrush({ exposure: 0.2 });
  f.owner.shape({ width: 140 }); f.owner.pen({ rubberBand: false }); f.owner.vectorStyle({ strokeWidth: 7 });
  f.owner.magicWand({ tolerance: 12 }); f.owner.smartSelection({ mode: 'object-finder' });
  f.owner.selectionPaintBrush({ smooth: 0.8 }); f.owner.warp({ strength: 0.3 });
  notify.mockClear(); f.owner.selection({ selectionMarqueeWidth: 16, selectionMarqueeHeight: 9, selectionCombineMode: 'add' });
  expect(notify).toHaveBeenCalledOnce();
  expect(f.read()).toMatchObject({ selectionMarqueeWidth: 16, selectionMarqueeHeight: 9,
    sampledBrush: { aligned: false, diffusion: before.sampledBrush.diffusion },
    shape: { width: 140, height: before.shape.height }, pen: { rubberBand: false, autoAddDelete: before.pen.autoAddDelete },
    vectorStyle: { strokeWidth: 7, fillColor: before.vectorStyle.fillColor }, warp: { strength: 0.3, diameterPx: before.warp.diameterPx } });
  expect(f.read().text).toEqual(before.text); expect(f.read().gradient).toEqual(before.gradient); expect(f.read().snap).toEqual(before.snap);
});
