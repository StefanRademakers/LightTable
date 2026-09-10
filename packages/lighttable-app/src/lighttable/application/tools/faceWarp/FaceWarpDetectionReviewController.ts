import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { layerIsLocked } from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import { setRasterLayerAdjustmentStack } from '../../../editor/document/documentCommands';
import type { LayerThumbnailBlob } from '../../../editor/rendering/LayerThumbnailService';
import { FaceWarpDetector } from '../../../effects/faceWarp/FaceWarpDetector';
import { mapDetectedFaceToLayerSource } from '../../../effects/faceWarp/faceWarpDetectionMapping';
import { assessFaceWarpDetection, matchFaceWarpObservations } from '../../../effects/faceWarp/faceWarpDetectionQuality';
import { semanticLandmarksFromMesh } from '../../../effects/faceWarp/faceWarpLandmarks';
import {
  MEDIAPIPE_FACE_CANONICAL_POSITIONS,
  MEDIAPIPE_FACE_CANONICAL_UVS,
  MEDIAPIPE_FACE_TOPOLOGY_ID,
  MEDIAPIPE_FACE_TRIANGLE_INDICES,
  MEDIAPIPE_FACE_VERTEX_COUNT
} from '../../../effects/faceWarp/canonicalFaceTopology';
import {
  addFaceWarpNodeToStack,
  createDefaultFaceWarpParameters,
  createFaceWarpModuleInstance,
  findFaceWarpModuleInstance,
  setFaceWarpNodeSettings,
  type FaceWarpFace,
  type FaceWarpNodeSettings
} from '../../../effects/faceWarp/faceWarpTypes';
import type { DocumentMutationController } from '../../documents/useDocumentMutationController';
import { faceWarpDetectionReviewMatches, type FaceWarpDetectionReviewSource } from './faceWarpDetectionReview';

export interface FaceWarpDetectionRenderer {
  exportLayerThumbnail(
    layerId: LayerId,
    maskChannel: boolean,
    maximumWidth: number,
    maximumHeight: number
  ): Promise<LayerThumbnailBlob | null>;
}

export interface FaceWarpDetectionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): FaceWarpDetectionRenderer | null;
  getRendererGeneration(): number;
  changeDocument: DocumentMutationController['change'];
  createDetector?(): FaceWarpDetector;
  createId(kind: 'stack' | 'module'): string;
  setStatus(message: string): void;
  setError(message: string | null): void;
}

export interface FaceWarpDetectionSnapshot {
  readonly busy: boolean;
  readonly pending: { readonly source: FaceWarpDetectionReviewSource; readonly settings: FaceWarpNodeSettings } | null;
  readonly selectedFaceId: string | null;
  readonly meshVisible: boolean;
}

const EMPTY: FaceWarpDetectionSnapshot = Object.freeze({
  busy: false, pending: null, selectedFaceId: null, meshVisible: false
});

/** Owns async detection, review admission and cancellation outside React. */
export class FaceWarpDetectionReviewController {
  private snapshot: FaceWarpDetectionSnapshot = EMPTY;
  private generation = 0;
  private detector: FaceWarpDetector | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly dependencies: () => FaceWarpDetectionDependencies) {}

  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(change: Partial<FaceWarpDetectionSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...change });
    for (const listener of this.listeners) listener();
  }

  pendingFor(source: FaceWarpDetectionReviewSource | null) {
    return this.snapshot.pending
      && faceWarpDetectionReviewMatches(this.snapshot.pending.source, source)
      ? this.snapshot.pending : null;
  }

  readonly setSelectedFaceId = (selectedFaceId: string | null) => {
    this.publish({ selectedFaceId });
  };
  readonly setMeshVisible = (meshVisible: boolean) => { this.publish({ meshVisible }); };

  synchronize(source: FaceWarpDetectionReviewSource | null) {
    if (this.snapshot.pending
      && !faceWarpDetectionReviewMatches(this.snapshot.pending.source, source)) {
      this.generation += 1;
      this.publish({ pending: null, busy: false });
    }
  }

  async detect() {
    const dependencies = this.dependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const layer = document ? findRasterLayer(document, document.activeLayerId) : null;
    if (!document || !renderer || !layer) {
      dependencies.setError('Face Warp requires an active pixel layer.');
      return false;
    }
    if (layerIsLocked(layer)) {
      dependencies.setError('Unlock the pixel layer before using Face Warp.');
      return false;
    }
    const generation = ++this.generation;
    const rendererGeneration = dependencies.getRendererGeneration();
    const source = {
      documentId: document.id,
      layerId: layer.id,
      pixelRevision: layer.pixelRevision,
      transform: { ...layer.transform }
    };
    this.publish({ busy: true, pending: null });
    dependencies.setError(null);
    try {
      const preview = await renderer.exportLayerThumbnail(layer.id, false, 1024, 1024);
      if (!this.isCurrent(generation, document, renderer, rendererGeneration)) return false;
      if (!preview) throw new Error('The active layer has no image pixels to analyze.');
      const detector = this.detector ??= dependencies.createDetector?.() ?? new FaceWarpDetector();
      const detection = await detector.detect({
        blob: preview.blob, sourceWidth: preview.width, sourceHeight: preview.height
      });
      if (!this.isCurrent(generation, document, renderer, rendererGeneration)) return false;
      const currentDocument = dependencies.getDocument();
      const currentLayer = currentDocument ? findRasterLayer(currentDocument, layer.id) : null;
      const currentSource = currentDocument && currentLayer ? {
        documentId: currentDocument.id, layerId: currentLayer.id,
        pixelRevision: currentLayer.pixelRevision, transform: currentLayer.transform
      } : null;
      if (!faceWarpDetectionReviewMatches(source, currentSource)) {
        throw new Error('The layer changed while faces were being detected. Detect faces again.');
      }
      if (!detection.meshes.length) throw new Error('No face was detected in the active layer.');
      const rejectedReasons: string[] = [];
      const observations = matchFaceWarpObservations(detection.meshes, detection.observations);
      const faces: FaceWarpFace[] = detection.meshes.flatMap((mesh, index) => {
        const observation = observations[index];
        if (!observation) {
          rejectedReasons.push('The face could not be confirmed by the independent detector. Try a clearer or larger face.');
          return [];
        }
        const quality = assessFaceWarpDetection(
          mesh, detection.poseMatrices[index], preview.width, preview.height, observation
        );
        if (!quality.accepted) {
          rejectedReasons.push(quality.reason ?? 'A detected face could not be edited safely.');
          return [];
        }
        const sourceMesh = mapDetectedFaceToLayerSource(mesh.slice(0, 468), preview.sourceToOutput);
        return [{
          id: `face-${index + 1}`, confidence: quality.confidence,
          landmarks: semanticLandmarksFromMesh(sourceMesh),
          parameters: createDefaultFaceWarpParameters(),
          poseMatrix: detection.poseMatrices[index]
        }];
      });
      if (!faces.length) throw new Error(rejectedReasons[0] ?? 'No editable face was detected in the active layer.');
      const settings: FaceWarpNodeSettings = {
        version: 2, opacity: 1, sourceRevision: layer.pixelRevision,
        detector: { id: 'mediapipe-face-landmarker', version: '1.0.1' },
        topology: {
          id: MEDIAPIPE_FACE_TOPOLOGY_ID,
          vertexCount: MEDIAPIPE_FACE_VERTEX_COUNT,
          triangleIndices: MEDIAPIPE_FACE_TRIANGLE_INDICES,
          canonicalPositions: MEDIAPIPE_FACE_CANONICAL_POSITIONS,
          canonicalUvs: MEDIAPIPE_FACE_CANONICAL_UVS
        },
        faces
      };
      this.publish({ pending: { source, settings }, selectedFaceId: faces[0]!.id, meshVisible: true });
      dependencies.setStatus(`${faces.length} face${faces.length === 1 ? '' : 's'} detected. Check the mesh before accepting.`);
      return true;
    } catch (reason) {
      dependencies.setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }

  accept() {
    const pending = this.snapshot.pending;
    if (!pending) return false;
    const dependencies = this.dependencies();
    const current = dependencies.getDocument();
    const layer = current ? findRasterLayer(current, pending.source.layerId) : null;
    const source = current && layer ? {
      documentId: current.id, layerId: layer.id,
      pixelRevision: layer.pixelRevision, transform: layer.transform
    } : null;
    if (!faceWarpDetectionReviewMatches(pending.source, source) || !layer || layerIsLocked(layer)) {
      this.publish({ pending: null });
      dependencies.setError('The layer changed while the face mesh was being reviewed. Detect faces again.');
      return false;
    }
    const opening = current;
    const changed = dependencies.changeDocument((document) => {
      if (document !== opening) return document;
      const target = findRasterLayer(document, pending.source.layerId);
      if (!target || layerIsLocked(target)) return document;
      let stack = target.adjustmentStack
        ? structuredClone(target.adjustmentStack)
        : { id: dependencies.createId('stack'), revision: 0, modules: [] };
      const existing = findFaceWarpModuleInstance(stack);
      stack = existing
        ? setFaceWarpNodeSettings(stack, pending.settings)
        : addFaceWarpNodeToStack(stack, createFaceWarpModuleInstance(
          dependencies.createId('module'), pending.settings
        ));
      return setRasterLayerAdjustmentStack(document, target.id, stack);
    }, true, { label: 'Face Warp', type: 'layer.face-warp', layerIds: [layer.id] });
    if (!changed) return false;
    this.publish({ pending: null });
    dependencies.setStatus(`${pending.settings.faces.length} face${pending.settings.faces.length === 1 ? '' : 's'} accepted.`);
    return true;
  }

  cancel(activeFaces: readonly FaceWarpFace[]) {
    this.generation += 1;
    this.publish({
      busy: false, pending: null,
      selectedFaceId: activeFaces[0]?.id ?? null,
      meshVisible: activeFaces.length > 0
    });
    this.dependencies().setStatus('Face detection cancelled.');
  }

  reset() {
    this.generation += 1;
    this.publish({ busy: false, pending: null });
  }

  dispose() {
    this.reset();
    this.detector?.dispose();
    this.detector = null;
    this.listeners.clear();
  }

  private isCurrent(
    generation: number,
    document: ImageDocument,
    renderer: FaceWarpDetectionRenderer,
    rendererGeneration: number
  ) {
    const dependencies = this.dependencies();
    return generation === this.generation
      && dependencies.getDocument() === document
      && dependencies.getRenderer() === renderer
      && dependencies.getRendererGeneration() === rendererGeneration;
  }
}
