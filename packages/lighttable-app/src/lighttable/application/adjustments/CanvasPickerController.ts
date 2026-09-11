import type { captureInteractionScope } from '../interactions/captureInteractionScope';
import type { BasicAdjustments } from '../../types';
import type { DepthAnalysisResult } from '../../analysis/depth/types';
import { sampleMedianDepth } from '../../analysis/depth/normalization';
import { mapLensDistortionUv } from '../../effects/lensDistortion/settings';
import { linearRgbToOklab, srgbToLinear } from '../../colorMath';
import { appendPointColorSample } from '../../pointColor';

type Point = { x: number; y: number };
export interface CanvasPickerPorts {
  captureScope(): ReturnType<typeof captureInteractionScope>;
  getTargetIdentity(): string | null;
  getBrushIntent(): string;
  getRenderer(): { sampleDisplayColor(point: Point): Promise<readonly number[]> } | null;
  getFocusSource(): { depth: DepthAnalysisResult; width: number; height: number;
    distortion: BasicAdjustments['effects']['lensDistortion'] } | null;
  finishAdjustment(): void;
  settleInteraction(): Promise<void>;
  change(recipe: (current: BasicAdjustments) => BasicAdjustments, domain: 'grade' | 'lens-fx'): boolean;
  publishBrushColor(hex: string): void;
}

/** One click's readback, admission and terminal UI all share the same request. */
export class CanvasPickerController {
  private snapshot = { pointColorActive: false, focusActive: false };
  private colorGeneration = 0;
  private focusGeneration = 0;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly getPorts: () => CanvasPickerPorts) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<typeof this.snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  setPointColorActive = (active: boolean): void => {
    ++this.colorGeneration; this.publish({ pointColorActive: active });
  };
  setFocusActive = (active: boolean): void => {
    ++this.focusGeneration; this.publish({ focusActive: active });
  };
  togglePointColor = (): void => this.setPointColorActive(!this.snapshot.pointColorActive);
  toggleFocus = (): void => this.setFocusActive(!this.snapshot.focusActive);
  /** Viewport accepted a click; hiding the cursor must not cancel its pending edit. */
  disarmFocus = (): void => { this.publish({ focusActive: false }); };
  reset = (): void => {
    ++this.colorGeneration; ++this.focusGeneration;
    this.publish({ pointColorActive: false, focusActive: false });
  };

  pickColor = async (point: Point): Promise<boolean> => {
    const p = this.getPorts();
    const renderer = p.getRenderer();
    if (!renderer) throw new Error('The color sampling renderer is unavailable.');
    const request = ++this.colorGeneration;
    const pointColor = this.snapshot.pointColorActive;
    const target = pointColor ? p.getTargetIdentity() : p.getBrushIntent();
    const scope = p.captureScope();
    const isCurrent = () => request === this.colorGeneration && scope.isCurrent()
      && p.getRenderer() === renderer
      && target === (pointColor ? p.getTargetIdentity() : p.getBrushIntent());
    const color = await renderer.sampleDisplayColor(point);
    if (!isCurrent()) return false;
    if (!pointColor) {
      p.publishBrushColor(`#${color.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16).padStart(2, '0')).join('')}`);
      return true;
    }
    p.finishAdjustment();
    await p.settleInteraction();
    if (!isCurrent()) return false;
    const lab = linearRgbToOklab(srgbToLinear([color[0] / 255, color[1] / 255, color[2] / 255]));
    const id = `point-color-${globalThis.crypto.randomUUID()}`;
    const changed = p.change(current => ({ ...current, pointColor: appendPointColorSample(
      current.pointColor, id, lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])
    ) }), 'grade');
    // A synchronous observer can arm a new picker during publication.
    if (request === this.colorGeneration) this.publish({ pointColorActive: false });
    return changed;
  };

  pickFocus = async (point: Point): Promise<boolean> => {
    if (!this.snapshot.focusActive) return false;
    const p = this.getPorts();
    const source = p.getFocusSource();
    if (!source) return false;
    const scope = p.captureScope();
    const target = p.getTargetIdentity();
    const request = ++this.focusGeneration;
    const uv = mapLensDistortionUv(point.x, point.y, source.width, source.height, source.distortion);
    const depth = sampleMedianDepth(source.depth, uv.x, uv.y);
    if (depth === null) return false;
    p.finishAdjustment();
    await p.settleInteraction();
    if (request !== this.focusGeneration || !scope.isCurrent() || p.getTargetIdentity() !== target) return false;
    return p.change(current => ({ ...current, effects: { ...current.effects,
      lensBlur: { ...current.effects.lensBlur, focusDistance: depth }
    } }), 'lens-fx');
  };
}
