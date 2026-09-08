export interface SelectionTextureStoreOptions {
  createSelectionTexture: (label: string) => GPUTexture;
  createClipboardTexture: (label: string) => GPUTexture;
  initializeTargets?: (mask: GPUTexture, result: GPUTexture, shape: GPUTexture) => void;
}

export interface SelectionTargetState {
  readonly mask: GPUTexture;
  readonly result: GPUTexture;
  readonly shape: GPUTexture;
  readonly active: boolean;
}

/**
 * Owns the mutable GPU textures that form one document's selection state.
 * Selection commands still encode the operations; allocation and lifetime are
 * centralized here so document teardown cannot leave an orphaned channel.
 */
export class SelectionTextureStore {
  mask: GPUTexture | null = null;
  result: GPUTexture | null = null;
  shape: GPUTexture | null = null;
  clipboard: GPUTexture | null = null;
  active = false;

  constructor(private readonly options: SelectionTextureStoreOptions) {}

  ensureTargets() {
    if (this.mask && this.result && this.shape) return false;
    this.mask?.destroy();
    this.result?.destroy();
    this.shape?.destroy();
    this.mask = this.options.createSelectionTexture('LightTable active selection');
    this.result = this.options.createSelectionTexture('LightTable selection result');
    this.shape = this.options.createSelectionTexture('LightTable selection shape');
    this.options.initializeTargets?.(this.mask, this.result, this.shape);
    return true;
  }

  swapMaskAndResult() {
    [this.mask, this.result] = [this.result, this.mask];
  }

  exchangeTargets(replacement: { mask: GPUTexture; result: GPUTexture; shape: GPUTexture }) {
    if (!this.mask || !this.result || !this.shape) {
      throw new Error('Selection targets are unavailable.');
    }
    const current = { mask: this.mask, result: this.result, shape: this.shape };
    this.mask = replacement.mask;
    this.result = replacement.result;
    this.shape = replacement.shape;
    return current;
  }

  /**
   * Atomically exchanges the complete committed selection projection.
   * Clipboard pixels deliberately stay with the document renderer: they are
   * not part of selection state and must survive selection undo/redo.
   */
  exchangeState(replacement: SelectionTargetState): SelectionTargetState {
    if (!this.mask || !this.result || !this.shape) {
      throw new Error('Selection targets are unavailable.');
    }
    const current = {
      mask: this.mask,
      result: this.result,
      shape: this.shape,
      active: this.active,
    };
    this.mask = replacement.mask;
    this.result = replacement.result;
    this.shape = replacement.shape;
    this.active = replacement.active;
    return current;
  }

  detachState(): SelectionTargetState {
    if (!this.mask || !this.result || !this.shape) {
      throw new Error('Selection targets are unavailable.');
    }
    const state = {
      mask: this.mask,
      result: this.result,
      shape: this.shape,
      active: this.active,
    };
    this.mask = null;
    this.result = null;
    this.shape = null;
    this.active = false;
    return state;
  }

  attachState(state: SelectionTargetState): void {
    if (this.mask || this.result || this.shape) {
      throw new Error('Selection targets are already attached.');
    }
    this.mask = state.mask;
    this.result = state.result;
    this.shape = state.shape;
    this.active = state.active;
  }

  static destroyState(state: SelectionTargetState): void {
    state.mask.destroy();
    state.result.destroy();
    state.shape.destroy();
  }

  replaceClipboard() {
    this.clipboard?.destroy();
    this.clipboard = this.options.createClipboardTexture('LightTable selection clipboard');
    return this.clipboard;
  }

  estimatedTextureBytes(width: number, height: number) {
    const pixels = Math.max(1, width) * Math.max(1, height);
    let bytes = 0;
    if (this.mask) bytes += pixels * 2;
    if (this.result) bytes += pixels * 2;
    if (this.shape) bytes += pixels * 2;
    if (this.clipboard) bytes += pixels * 8;
    return bytes;
  }

  destroy() {
    this.mask?.destroy();
    this.result?.destroy();
    this.shape?.destroy();
    this.clipboard?.destroy();
    this.mask = null;
    this.result = null;
    this.shape = null;
    this.clipboard = null;
    this.active = false;
  }
}
