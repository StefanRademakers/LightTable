import type { VectorEditingOverlay } from '@lighttable/vector-rendering';
import type { PenRubberBand } from './PenToolController';
import type { VectorToolSessionController } from './VectorToolSessionController';
import type { VectorRuntimeScope } from './VectorRuntimeBinding';

export interface PenPresentationRenderer {
  setPenEditingOverlay(overlay: VectorEditingOverlay | null): void;
  setPenRubberBandOverlay(band: PenRubberBand | null): void;
}

/** Terminal/presentation adapter bound to one renderer, not a path or history owner. */
export class PenPresentationBinding {
  private mounted = false;
  constructor(private readonly controller: Pick<VectorToolSessionController,
    'finishPenPath' | 'cancelPenPath' | 'undoPenAnchor' | 'penEditingOverlay'>,
    private readonly renderer: PenPresentationRenderer | null,
    private readonly scope: VectorRuntimeScope) {}

  setOverlay = (overlay: VectorEditingOverlay | null) => {
    if (this.mounted && this.scope.isCurrent()) this.renderer?.setPenEditingOverlay(overlay);
  };
  setRubberBand = (band: PenRubberBand | null) => {
    if (this.mounted && this.scope.isCurrent()) this.renderer?.setPenRubberBandOverlay(band);
  };
  private terminal(operation: () => boolean) {
    if (!this.mounted || !this.scope.isCurrent()) return false;
    const changed = operation();
    this.setOverlay(this.controller.penEditingOverlay());
    this.setRubberBand(null);
    return changed;
  }
  finish = () => this.terminal(() => this.controller.finishPenPath());
  cancel = () => this.terminal(() => this.controller.cancelPenPath());
  undoAnchor = () => this.terminal(() => this.controller.undoPenAnchor());
  mount = () => { this.mounted = true; };
  unmount = () => {
    if (!this.mounted) return;
    this.mounted = false;
    if (!this.scope.isCurrent()) return;
    this.renderer?.setPenEditingOverlay(null);
    this.renderer?.setPenRubberBandOverlay(null);
  };
}
