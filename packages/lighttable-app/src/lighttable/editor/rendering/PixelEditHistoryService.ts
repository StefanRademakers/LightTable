import type { LayerId } from '../document/documentTypes';
import type { ReversiblePixelEdit } from '../history/ReversiblePixelEdit';
import type { PaintChannel } from '../session/editorSession';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { PixelEditSessionStore } from './PixelEditSessionStore';

interface PixelEditHistoryServiceOptions {
  device: GPUDevice;
  layerResources: LayerRuntimeStore;
  sessions: PixelEditSessionStore;
  dimensions: () => { width: number; height: number };
  createTexture: (label: string) => GPUTexture;
  maskTextureFor: (layerId: LayerId) => GPUTexture | null;
  invalidateLayer: (layerId: LayerId) => void;
}

/**
 * Owns one transactional pixel/mask snapshot and turns it into a reversible
 * GPU history entry. Tools only author pixels between begin and finish.
 */
export class PixelEditHistoryService {
  constructor(private readonly options: PixelEditHistoryServiceOptions) {}

  begin(layerId: LayerId, channel: PaintChannel) {
    const runtime = this.options.layerResources.raster(layerId);
    if (channel === 'pixels' && !runtime) {
      throw new Error('The active raster layer is not available on the GPU.');
    }
    const target = channel === 'mask'
      ? this.options.maskTextureFor(layerId)
      : runtime?.texture;
    if (!target) {
      throw new Error('The active paint channel is not available on the GPU.');
    }
    const snapshot = this.options.createTexture('LightTable pixel edit undo snapshot');
    const { width, height } = this.options.dimensions();
    const encoder = this.options.device.createCommandEncoder({
      label: 'LightTable begin pixel edit'
    });
    this.options.invalidateLayer(layerId);
    encoder.copyTextureToTexture(
      { texture: target },
      { texture: snapshot },
      [width, height]
    );
    this.options.device.queue.submit([encoder.finish()]);
    this.options.sessions.begin({ layerId, channel, texture: snapshot });
  }

  finish(): ReversiblePixelEdit | null {
    const before = this.options.sessions.complete();
    if (!before) return null;
    const { width, height } = this.options.dimensions();
    let undoTexture: GPUTexture | null = before.texture;
    let redoTexture: GPUTexture | null = null;
    let applied = true;
    const swap = (direction: 'undo' | 'redo') => {
      const source = direction === 'undo' ? undoTexture : redoTexture;
      if (!source || applied !== (direction === 'undo')) return false;
      const runtime = this.options.layerResources.raster(before.layerId);
      const target = before.channel === 'mask'
        ? this.options.maskTextureFor(before.layerId)
        : runtime?.texture;
      if (!target) return false;
      const inverse = this.options.createTexture(
        `LightTable ${direction} pixel history`
      );
      const encoder = this.options.device.createCommandEncoder({
        label: `LightTable ${direction} pixel edit`
      });
      encoder.copyTextureToTexture(
        { texture: target },
        { texture: inverse },
        [width, height]
      );
      encoder.copyTextureToTexture(
        { texture: source },
        { texture: target },
        [width, height]
      );
      this.options.device.queue.submit([encoder.finish()]);
      this.options.invalidateLayer(before.layerId);
      source.destroy();
      if (direction === 'undo') {
        undoTexture = null;
        redoTexture = inverse;
        applied = false;
      } else {
        redoTexture = null;
        undoTexture = inverse;
        applied = true;
      }
      return true;
    };
    return {
      byteSize: width * height * 8,
      undo: () => swap('undo'),
      redo: () => swap('redo'),
      destroy: () => {
        undoTexture?.destroy();
        redoTexture?.destroy();
        undoTexture = null;
        redoTexture = null;
      }
    };
  }

  cancel() {
    return this.options.sessions.cancel();
  }
}
