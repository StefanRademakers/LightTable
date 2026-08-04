import type { LayerId } from '../document/documentTypes';
import type { PaintChannel } from '../session/editorSession';

export interface PixelEditSnapshot {
  layerId: LayerId;
  channel: PaintChannel;
  width: number;
  height: number;
  tiles: PixelEditSnapshotTile[];
  capturedTileKeys: Set<string>;
}

export interface PixelEditSnapshotTile {
  x: number;
  y: number;
  width: number;
  height: number;
  texture: GPUTexture;
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
    snapshot.tiles.forEach(({ texture }) => texture.destroy());
    return true;
  }

  estimatedTextureBytes(_rgba16Bytes: number) {
    return this.activeSnapshot
      ? this.activeSnapshot.tiles.reduce(
          (bytes, tile) => bytes + tile.width * tile.height
            * (this.activeSnapshot?.channel === 'mask' ? 1 : 8),
          0
        )
      : 0;
  }

  destroy() {
    this.cancel();
  }
}
