import type { VectorEditingOverlay } from '@lighttable/vector-rendering';
import { buildFaceWarpMeshOverlay } from '../../../effects/faceWarp/faceWarpMeshOverlay';
import type { FaceWarpView } from './faceWarpView';

export interface FaceWarpMeshRenderer { setFaceWarpEditingOverlay(overlay: VectorEditingOverlay | null): void; }
export interface FaceWarpMeshInputs { readonly active: boolean; readonly visible: boolean; readonly view: FaceWarpView; }

/** Disposable mesh projection bound to one concrete renderer, never the current renderer lookup. */
export class FaceWarpMeshPresentationBinding {
  private mounted = false;
  constructor(private readonly renderer: FaceWarpMeshRenderer | null,
    private readonly isCurrent: () => boolean, private readonly read: () => FaceWarpMeshInputs) {}
  mount = () => { this.mounted = true; this.present(); };
  unmount = () => {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.isCurrent()) this.renderer?.setFaceWarpEditingOverlay(null);
  };
  present = () => {
    if (!this.mounted || !this.isCurrent()) return;
    const { active, visible, view } = this.read();
    this.renderer?.setFaceWarpEditingOverlay(active && visible && view.layer && view.faces.length
      ? buildFaceWarpMeshOverlay(view.faces, view.layer.transform,
        view.pending?.settings.topology.triangleIndices ?? view.settings?.topology.triangleIndices ?? [],
        view.selectedFaceId) : null);
  };
}
