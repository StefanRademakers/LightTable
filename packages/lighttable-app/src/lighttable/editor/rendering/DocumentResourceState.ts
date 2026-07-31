export interface DocumentDimensions {
  width: number;
  height: number;
}

/**
 * Owns the identity of the GPU resources for the active document.
 *
 * Async readbacks and decodes capture `generation`; replacing or destroying
 * a document invalidates those operations without coupling them to React or
 * to the renderer's individual services.
 */
export class DocumentResourceState {
  private currentDimensions: DocumentDimensions = { width: 0, height: 0 };
  private currentGeneration = 0;

  dimensions = (): DocumentDimensions => ({ ...this.currentDimensions });

  generation = () => this.currentGeneration;

  setDimensions(width: number, height: number) {
    this.currentDimensions = { width, height };
  }

  invalidate() {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  isCurrent(generation: number) {
    return generation === this.currentGeneration;
  }
}
