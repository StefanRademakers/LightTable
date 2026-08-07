import type { LayerId } from '../document/documentTypes';
import type { AffineMatrix } from '../tools/transform/transformTypes';

export interface TransformGpuSession {
  layerId: LayerId;
  matrix: AffineMatrix;
  sourceTexture: GPUTexture | null;
  selectionTexture: GPUTexture | null;
  previewTexture: GPUTexture | null;
  selectionPreview: GPUTexture | null;
  settingsBuffer: GPUBuffer | null;
  usesSelection: boolean;
  previewMode: 'none' | 'selection' | 'projective';
  duplicateSelection: boolean;
}

export interface TransformHistorySeed {
  layerId: LayerId;
  sourceTexture: GPUTexture;
  selectionTexture: GPUTexture | null;
  usesSelection: boolean;
}

/**
 * Owns the resources for at most one in-flight transform. A committed session
 * transfers only its history snapshots to the caller; preview resources never
 * escape this lifecycle boundary.
 */
export class TransformSessionStore {
  private activeSession: TransformGpuSession | null = null;

  get current() {
    return this.activeSession;
  }

  begin(session: TransformGpuSession) {
    if (this.activeSession) {
      throw new Error('Finish or cancel the active transform first.');
    }
    this.activeSession = session;
    return session;
  }

  complete(): TransformHistorySeed | null {
    const session = this.activeSession;
    if (!session) return null;
    this.activeSession = null;
    session.previewTexture?.destroy();
    session.selectionPreview?.destroy();
    session.settingsBuffer?.destroy();
    if (!session.sourceTexture) return null;
    return {
      layerId: session.layerId,
      sourceTexture: session.sourceTexture,
      selectionTexture: session.selectionTexture,
      usesSelection: session.usesSelection
    };
  }

  cancel() {
    const session = this.activeSession;
    if (!session) return false;
    this.activeSession = null;
    session.sourceTexture?.destroy();
    session.selectionTexture?.destroy();
    session.previewTexture?.destroy();
    session.selectionPreview?.destroy();
    session.settingsBuffer?.destroy();
    return true;
  }

  estimatedTextureBytes(rgba16Bytes: number, r8Bytes: number) {
    if (!this.activeSession) return 0;
    return (this.activeSession.sourceTexture ? rgba16Bytes : 0)
      + (this.activeSession.previewTexture ? rgba16Bytes : 0)
      + (this.activeSession.selectionTexture ? r8Bytes : 0)
      + (this.activeSession.selectionPreview ? r8Bytes : 0);
  }

  destroy() {
    this.cancel();
  }
}
