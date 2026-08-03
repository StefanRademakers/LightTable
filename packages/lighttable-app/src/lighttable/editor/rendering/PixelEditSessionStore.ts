import type { LayerId } from '../document/documentTypes';
import type { PaintChannel } from '../session/editorSession';

export interface PixelEditSnapshot {
  layerId: LayerId;
  channel: PaintChannel;
  texture: GPUTexture;
  width: number;
  height: number;
}

/**
 * Owns the pre-edit snapshot for one in-flight pixel or mask mutation.
 * Completing an edit transfers the snapshot to the history command; cancelling
 * or replacing it always releases the GPU texture here.
 */
export class PixelEditSessionStore {
  private activeSnapshot: PixelEditSnapshot | null = null;

  get current() {
    return this.activeSnapshot;
  }

  begin(snapshot: PixelEditSnapshot) {
    this.cancel();
    this.activeSnapshot = snapshot;
    return snapshot;
  }

  complete() {
    const snapshot = this.activeSnapshot;
    this.activeSnapshot = null;
    return snapshot;
  }

  cancel() {
    const snapshot = this.activeSnapshot;
    if (!snapshot) return false;
    this.activeSnapshot = null;
    snapshot.texture.destroy();
    return true;
  }

  estimatedTextureBytes(_rgba16Bytes: number) {
    return this.activeSnapshot
      ? this.activeSnapshot.width * this.activeSnapshot.height * 8
      : 0;
  }

  destroy() {
    this.cancel();
  }
}
