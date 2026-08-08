import type { LayerId, Rect } from '../document/documentTypes';
import type { ReversiblePixelEdit } from '../history/ReversiblePixelEdit';
import type { PaintChannel } from '../session/editorSession';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { PixelEditSessionStore, PixelEditSnapshotTile } from './PixelEditSessionStore';

const HISTORY_TILE_SIZE = 256;

interface PixelEditHistoryServiceOptions {
  device: GPUDevice;
  layerResources: LayerRuntimeStore;
  sessions: PixelEditSessionStore;
  dimensions: () => { width: number; height: number };
  createTextureSized: (label: string, width: number, height: number) => GPUTexture;
  createMaskTextureSized: (label: string, width: number, height: number) => GPUTexture;
  maskTextureFor: (layerId: LayerId) => GPUTexture | null;
  invalidateLayer: (layerId: LayerId) => void;
}

const clippedIntegerRect = (rect: Rect, width: number, height: number): Rect | null => {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};

/** GPU-only tile snapshots for one atomic pixel/mask history gesture. */
export class PixelEditHistoryService {
  constructor(private readonly options: PixelEditHistoryServiceOptions) {}

  begin(layerId: LayerId, channel: PaintChannel) {
    const runtime = this.options.layerResources.raster(layerId);
    if (channel === 'pixels' && !runtime) {
      throw new Error('The active raster layer is not available on the GPU.');
    }
    const target = channel === 'mask' ? this.options.maskTextureFor(layerId) : runtime?.texture;
    if (!target) throw new Error('The active paint channel is not available on the GPU.');
    const { width, height } = channel === 'pixels' && runtime
      ? runtime
      : this.options.dimensions();
    this.options.invalidateLayer(layerId);
    this.options.sessions.begin({
      layerId, channel, width, height, tiles: [], capturedTileKeys: new Set()
    });
  }

  captureRegions(layerId: LayerId, channel: PaintChannel, regions: readonly Rect[]): number {
    const snapshot = this.options.sessions.current;
    if (!snapshot || snapshot.layerId !== layerId || snapshot.channel !== channel) return 0;
    const runtime = this.options.layerResources.raster(layerId);
    const target = channel === 'mask' ? this.options.maskTextureFor(layerId) : runtime?.texture;
    if (!target) return 0;
    const missing: PixelEditSnapshotTile[] = [];
    const tilesAcross = Math.ceil(snapshot.width / HISTORY_TILE_SIZE);
    for (const region of regions) {
      const clipped = clippedIntegerRect(region, snapshot.width, snapshot.height);
      if (!clipped) continue;
      const firstX = Math.floor(clipped.x / HISTORY_TILE_SIZE);
      const firstY = Math.floor(clipped.y / HISTORY_TILE_SIZE);
      const lastX = Math.floor((clipped.x + clipped.width - 1) / HISTORY_TILE_SIZE);
      const lastY = Math.floor((clipped.y + clipped.height - 1) / HISTORY_TILE_SIZE);
      for (let tileY = firstY; tileY <= lastY; tileY += 1) {
        for (let tileX = firstX; tileX <= lastX; tileX += 1) {
          const key = tileY * tilesAcross + tileX;
          if (snapshot.capturedTileKeys.has(key)) continue;
          snapshot.capturedTileKeys.add(key);
          const x = tileX * HISTORY_TILE_SIZE;
          const y = tileY * HISTORY_TILE_SIZE;
          const width = Math.min(HISTORY_TILE_SIZE, snapshot.width - x);
          const height = Math.min(HISTORY_TILE_SIZE, snapshot.height - y);
          const texture = channel === 'mask'
            ? this.options.createMaskTextureSized('LightTable mask edit undo tile', width, height)
            : this.options.createTextureSized('LightTable pixel edit undo tile', width, height);
          missing.push({ x, y, width, height, texture });
        }
      }
    }
    if (!missing.length) return 0;
    const encoder = this.options.device.createCommandEncoder({ label: 'LightTable capture pixel edit tiles' });
    missing.forEach((tile) => encoder.copyTextureToTexture(
      { texture: target, origin: { x: tile.x, y: tile.y } },
      { texture: tile.texture },
      [tile.width, tile.height]
    ));
    this.options.device.queue.submit([encoder.finish()]);
    snapshot.tiles.push(...missing);
    return missing.length;
  }

  captureAll(layerId: LayerId, channel: PaintChannel): number {
    const snapshot = this.options.sessions.current;
    return snapshot ? this.captureRegions(layerId, channel, [{
      x: 0, y: 0, width: snapshot.width, height: snapshot.height
    }]) : 0;
  }

  finish(): ReversiblePixelEdit | null {
    const before = this.options.sessions.complete();
    if (!before || before.tiles.length === 0) return null;
    let undoTiles: PixelEditSnapshotTile[] | null = before.tiles;
    let redoTiles: PixelEditSnapshotTile[] | null = null;
    let applied = true;
    const swap = (direction: 'undo' | 'redo') => {
      const source = direction === 'undo' ? undoTiles : redoTiles;
      if (!source || applied !== (direction === 'undo')) return false;
      const runtime = this.options.layerResources.raster(before.layerId);
      const target = before.channel === 'mask'
        ? this.options.maskTextureFor(before.layerId)
        : runtime?.texture;
      if (!target) return false;
      const inverse = source.map((tile) => ({
        ...tile,
        texture: before.channel === 'mask'
          ? this.options.createMaskTextureSized(`LightTable ${direction} mask history tile`, tile.width, tile.height)
          : this.options.createTextureSized(`LightTable ${direction} pixel history tile`, tile.width, tile.height)
      }));
      const encoder = this.options.device.createCommandEncoder({ label: `LightTable ${direction} pixel edit tiles` });
      source.forEach((tile, index) => {
        encoder.copyTextureToTexture(
          { texture: target, origin: { x: tile.x, y: tile.y } },
          { texture: inverse[index]!.texture },
          [tile.width, tile.height]
        );
        encoder.copyTextureToTexture(
          { texture: tile.texture },
          { texture: target, origin: { x: tile.x, y: tile.y } },
          [tile.width, tile.height]
        );
      });
      this.options.device.queue.submit([encoder.finish()]);
      this.options.invalidateLayer(before.layerId);
      source.forEach(({ texture }) => texture.destroy());
      if (direction === 'undo') {
        undoTiles = null; redoTiles = inverse; applied = false;
      } else {
        redoTiles = null; undoTiles = inverse; applied = true;
      }
      return true;
    };
    const byteSize = before.tiles.reduce(
      (bytes, tile) => bytes + tile.width * tile.height * (before.channel === 'mask' ? 1 : 8), 0
    );
    return {
      byteSize,
      undo: () => swap('undo'),
      redo: () => swap('redo'),
      destroy: () => {
        undoTiles?.forEach(({ texture }) => texture.destroy());
        redoTiles?.forEach(({ texture }) => texture.destroy());
        undoTiles = null;
        redoTiles = null;
      }
    };
  }

  cancel() { return this.options.sessions.cancel(); }
}
