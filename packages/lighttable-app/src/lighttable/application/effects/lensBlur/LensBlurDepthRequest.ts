import type { DepthAnalysisProgress, DepthAnalysisResult } from '../../../analysis/depth/types';
import type { BasicAdjustments } from '../../../types';
import type { captureInteractionScope } from '../../interactions/captureInteractionScope';

export interface LensBlurDepthRequestPorts {
  captureScope(): ReturnType<typeof captureInteractionScope>;
  isSourceCurrent(): boolean;
  getTargetIdentity(): string | null;
  getRenderer(): { setDepthMap(depth: DepthAnalysisResult): void } | null;
  estimateDepth(blob: Blob, identity: string, progress: (value: DepthAnalysisProgress) => void): Promise<DepthAnalysisResult>;
  finishAdjustment(): void;
  settleInteraction(): Promise<void>;
  change(recipe: (current: BasicAdjustments) => BasicAdjustments, domain: 'lens-fx'): boolean;
  publishProgress(value: DepthAnalysisProgress): void;
  publishResult(value: DepthAnalysisResult): void;
}

export const depthReadyProgress = (result: Pick<DepthAnalysisResult, 'width' | 'height'>): DepthAnalysisProgress => ({
  status: 'ready', message: `Depth ready (${result.width} x ${result.height})`
});

/** One subscription to shared inference, not another model/cache/resource owner. */
export class LensBlurDepthRequest {
  private retired = false;
  private currentScope = () => false;
  constructor(private readonly ports: LensBlurDepthRequestPorts) {}
  cancel = (): void => { this.retired = true; };
  isCurrent = (): boolean => !this.retired && this.currentScope();

  async run(blob: Blob, identity: string): Promise<void> {
    const p = this.ports;
    const scope = p.captureScope();
    const renderer = p.getRenderer();
    const target = p.getTargetIdentity();
    this.currentScope = () => scope.isCurrent() && p.isSourceCurrent()
      && p.getRenderer() === renderer;
    const current = this.isCurrent;
    if (!renderer || !current()) return;
    p.publishProgress({ status: 'loading-model', message: 'Preparing depth analysis…' });
    let result: DepthAnalysisResult;
    try {
      result = await p.estimateDepth(blob, identity, progress => {
        if (current()) p.publishProgress(progress);
      });
    } catch (reason) {
      if (!current()) return;
      p.publishProgress({ status: 'error', message: reason instanceof Error ? reason.message : 'Depth analysis failed.' });
      if (p.getTargetIdentity() !== target) return;
      p.finishAdjustment();
      await p.settleInteraction();
      if (current() && p.getTargetIdentity() === target) {
        p.change(value => ({ ...value, effects: { ...value.effects,
          lensBlur: { ...value.effects.lensBlur, enabled: false }
        } }), 'lens-fx');
      }
      return;
    }
    if (!current()) return;
    // GPU projection errors are not inference failures and must remain visible.
    renderer.setDepthMap(result);
    p.publishResult(result);
    p.publishProgress(depthReadyProgress(result));
  }
}
