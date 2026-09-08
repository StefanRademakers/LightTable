import type { RasterSelectionMask } from '../../../editor/selection/selectionTypes';
import type { SmartSelectionCandidate } from './SmartSelectionBackend';
import type { SmartSelectionSourceRenderer } from './smartSelectionSource';

export interface SmartSelectionPreviewRenderer extends SmartSelectionSourceRenderer {
  setSmartSelectionPreview(mask: RasterSelectionMask | null): void;
}

export interface SmartSelectionPreviewOwner {
  readonly token: number;
  readonly renderer: SmartSelectionPreviewRenderer | null;
}

/** Owns the exact renderer and generation on which a transient mask is presented. */
export class SmartSelectionPreviewLease {
  private renderer: SmartSelectionPreviewRenderer | null = null;
  private token = 0;
  candidate: SmartSelectionCandidate | null = null;

  publish(
    candidate: SmartSelectionCandidate,
    renderer: SmartSelectionPreviewRenderer | null,
  ): SmartSelectionPreviewOwner {
    if (this.renderer && this.renderer !== renderer) {
      this.renderer.setSmartSelectionPreview(null);
    }
    this.candidate = candidate;
    this.renderer = renderer;
    const token = ++this.token;
    renderer?.setSmartSelectionPreview(candidate.mask);
    return { token, renderer };
  }

  release(owner: SmartSelectionPreviewOwner): void {
    if (this.token !== owner.token || this.renderer !== owner.renderer) return;
    this.candidate = null;
    this.renderer = null;
    owner.renderer?.setSmartSelectionPreview(null);
  }

  clear(): void {
    const renderer = this.renderer;
    this.token += 1;
    this.candidate = null;
    this.renderer = null;
    renderer?.setSmartSelectionPreview(null);
  }
}
