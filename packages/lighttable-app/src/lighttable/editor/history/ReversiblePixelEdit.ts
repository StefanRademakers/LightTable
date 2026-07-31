/**
 * GPU-backed history entry for a destructive pixel operation.
 *
 * The application layer owns the command lifecycle while the concrete
 * renderer owns the textures captured by undo and redo. Keeping this contract
 * independent from LayerDocumentRenderer prevents tool controllers from
 * depending on the renderer facade.
 */
export interface ReversiblePixelEdit {
  byteSize: number;
  undo: () => boolean;
  redo: () => boolean;
  destroy: () => void;
}
