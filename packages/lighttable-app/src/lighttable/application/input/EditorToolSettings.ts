import type { EditorApplicationState } from '../../editor/session/editorSession';
import { steppedBrushHardness, steppedBrushSize } from '../../editor/tools/toolCapabilities';
import { BrushPercentInput } from './brushPercentInput';

export type SelectionToolDefaults = Pick<EditorApplicationState,
  'selectionPixelSnap' | 'transformAutoSelectLayer' | 'selectionCombineMode' | 'selectionFeather'
  | 'selectionAntiAlias' | 'selectionMarqueeStyle' | 'selectionMarqueeWidth' | 'selectionMarqueeHeight'
  | 'selectionRowHeight' | 'selectionColumnWidth' | 'selectionSmooth'>;
type Group = 'brush' | 'warp' | 'sampledBrush' | 'toneBrush' | 'shape' | 'pen'
  | 'vectorStyle' | 'magicWand' | 'smartSelection' | 'selectionPaintBrush';
export type EditorToolDefaults = Pick<EditorApplicationState, Group> & SelectionToolDefaults;
type CurrentSettings = EditorToolDefaults & Pick<EditorApplicationState, 'activeTool'>;
export type UpdateToolDefaults = (update: (current: CurrentSettings) => Partial<EditorToolDefaults>) => void;

/** Tool preferences only. ApplicationSession remains the state owner; this retains only digit input. */
export class EditorToolSettings {
  private readonly percentInput = new BrushPercentInput();
  constructor(private readonly update: UpdateToolDefaults) {}
  private patch<K extends Group>(group: K, change: Partial<EditorToolDefaults[K]>) {
    this.update(current => ({ [group]: { ...current[group], ...change } }));
  }
  brush = (change: Partial<EditorToolDefaults['brush']>) => this.patch('brush', change);
  warp = (change: Partial<EditorToolDefaults['warp']>) => this.patch('warp', change);
  sampledBrush = (change: Partial<EditorToolDefaults['sampledBrush']>) => this.patch('sampledBrush', change);
  toneBrush = (change: Partial<EditorToolDefaults['toneBrush']>) => this.patch('toneBrush', change);
  shape = (change: Partial<EditorToolDefaults['shape']>) => this.patch('shape', change);
  pen = (change: Partial<EditorToolDefaults['pen']>) => this.patch('pen', change);
  vectorStyle = (change: Partial<EditorToolDefaults['vectorStyle']>) => this.patch('vectorStyle', change);
  magicWand = (change: Partial<EditorToolDefaults['magicWand']>) => this.patch('magicWand', change);
  smartSelection = (change: Partial<EditorToolDefaults['smartSelection']>) => this.patch('smartSelection', change);
  selectionPaintBrush = (change: Partial<EditorToolDefaults['selectionPaintBrush']>) => this.patch('selectionPaintBrush', change);
  selection = (change: Partial<SelectionToolDefaults>) => this.update(() => change);
  swapColors = () => this.update(current => ({ brush: { ...current.brush,
    color: current.brush.backgroundColor, backgroundColor: current.brush.color } }));
  resetColors = () => this.brush({ color: '#000000', backgroundColor: '#ffffff' });
  changeBrushSize = (direction: -1 | 1) => this.update(current => current.activeTool === 'warp'
    ? { warp: { ...current.warp, diameterPx: steppedBrushSize(current.warp.diameterPx, direction) } }
    : current.activeTool === 'select-paint-brush'
      ? { selectionPaintBrush: { ...current.selectionPaintBrush, size: steppedBrushSize(current.selectionPaintBrush.size, direction) } }
      : { brush: { ...current.brush, size: steppedBrushSize(current.brush.size, direction) } });
  changeBrushHardness = (direction: -1 | 1) => this.update(current => current.activeTool === 'warp'
    ? { warp: { ...current.warp, hardness: steppedBrushHardness(current.warp.hardness * 100, direction) / 100 } }
    : current.activeTool === 'select-paint-brush'
      ? { selectionPaintBrush: { ...current.selectionPaintBrush,
        hardness: steppedBrushHardness(current.selectionPaintBrush.hardness * 100, direction) / 100 } }
      : { brush: { ...current.brush, hardness: steppedBrushHardness(current.brush.hardness * 100, direction) / 100 } });
  inputBrushPercent = (target: 'opacity' | 'flow', digit: number) => {
    const percent = this.percentInput.input(target, digit);
    this.update(current => current.activeTool === 'select-paint-brush'
      ? { selectionPaintBrush: { ...current.selectionPaintBrush, opacity: percent / 100 } }
      : { brush: { ...current.brush, [target]: percent / 100 } });
  };
  clearPercentInput = () => this.percentInput.clear();
}
