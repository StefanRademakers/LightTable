import type { RasterSelectionMask } from '../../../editor/selection/selectionTypes';
import type { SmartSelectionCandidate } from './SmartSelectionBackend';
import type { SmartSelectionSourceRenderer } from './smartSelectionSource';

export interface SmartSelectionPreviewRenderer extends SmartSelectionSourceRenderer {
  setSmartSelectionPreview(mask: RasterSelectionMask | null): void;
}

export interface SmartSelectionPreviewOwner {
  readonly token: number;
  readonly renderer: SmartSelectionPreviewRenderer | null;
  readonly scope: { isCurrent(): boolean };
}

/** Owns the exact renderer and generation on which a transient mask is presented. */
export class SmartSelectionPreviewLease {
  private renderer: SmartSelectionPreviewRenderer | null = null;
  private token = 0;
  private scope: SmartSelectionPreviewOwner['scope'] | null = null;
  candidate: SmartSelectionCandidate | null = null;

  publish(
    candidate: SmartSelectionCandidate,
    renderer: SmartSelectionPreviewRenderer | null,
    scope: SmartSelectionPreviewOwner['scope'],
  ): SmartSelectionPreviewOwner {
    if (this.renderer && this.renderer !== renderer && this.scope?.isCurrent()) {
      this.renderer.setSmartSelectionPreview(null);
    }
    this.candidate = candidate;
    this.renderer = renderer;
    this.scope = scope;
    const token = ++this.token;
    if (scope.isCurrent()) renderer?.setSmartSelectionPreview(candidate.mask);
    return { token, renderer, scope };
  }

  release(owner: SmartSelectionPreviewOwner): void {
    if (this.token !== owner.token || this.renderer !== owner.renderer) return;
    this.candidate = null;
    this.renderer = null;
    this.scope = null;
    if (owner.scope.isCurrent()) owner.renderer?.setSmartSelectionPreview(null);
  }

  clear(): void {
    const renderer = this.renderer;
    const scope = this.scope;
    this.token += 1;
    this.candidate = null;
    this.renderer = null;
    this.scope = null;
    if (scope?.isCurrent()) renderer?.setSmartSelectionPreview(null);
  }
}
