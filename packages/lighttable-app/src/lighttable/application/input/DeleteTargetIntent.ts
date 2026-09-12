import type { DocumentSession } from '../documents/documentSession';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import type { ToolId } from '../../editor/session/editorSession';
import type { MountedDocumentAdmission } from '../interactions/MountedDocumentAdmission';
import type { FillCommandController } from '../tools/fill/useFillCommandController';
import type { VectorToolSessionController } from '../vectors/VectorToolSessionController';
import { DocumentSelectionStateStore } from '../tools/selection/DocumentSelectionStateStore';
import { resolveDeleteTarget } from './resolveDeleteTarget';

export interface DeleteTargetIntentPorts {
  isMounted(): boolean;
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { isCurrent(): boolean };
  getTool(): ToolId;
  getSelectedLayerIds(): readonly LayerId[];
  readonly vector: Pick<VectorToolSessionController, 'deleteSelection'>;
  readonly admission: Pick<MountedDocumentAdmission, 'runAfter'>;
  readonly fill: Pick<FillCommandController, 'clearSelection'>;
  readonly transform: { isActive(): boolean; cancel(): void };
  deleteLayers(layerIds: readonly LayerId[], reportFailure: (message: string) => void): void;
  reportFailure(message: string): void;
}

/** Delete intent precedence and target lifetime; existing tool/command owners perform every mutation. */
export class DeleteTargetIntent {
  constructor(private readonly resolve: () => DeleteTargetIntentPorts) {}
  run = (): void => {
    const ports = this.resolve(), session = ports.getSession(), renderer = ports.getRenderer();
    const document = session?.getSnapshot().document;
    if (!session || !document) return;
    const scope = ports.captureScope();
    const ownsContext = () => ports.isMounted() && ports.getSession() === session && ports.getRenderer() === renderer
      && session.getSnapshot().lifecycle !== 'disposed' && scope.isCurrent();
    const isCurrent = () => ownsContext() && Boolean(renderer && session.getSnapshot().document && session.getSnapshot().lifecycle === 'ready'
      && session.getSnapshot().document?.id === ports.getProjectedDocument()?.id);
    const report = (message: string) => { if (ownsContext()) ports.reportFailure(message); };
    try {
      if (!isCurrent()) { report('The document renderer is unavailable for Delete.'); return; }
      const selection = new DocumentSelectionStateStore(session);
      const { vectorSelection, activeChannel } = session.getSnapshot().editor;
      const activeLayerId = document.activeLayerId;
      const target = resolveDeleteTarget({ activeTool: ports.getTool(),
        hasVectorSelection: vectorSelection.elements.length > 0 || vectorSelection.paths.length > 0 || vectorSelection.anchors.length > 0,
        hasPixelSelection: selection.acquire(session.getSnapshot().documentRevision).selection.active,
        hasActiveLayer: Boolean(activeLayerId) });
      if (target === 'vector-selection') { ports.vector.deleteSelection(); return; }
      if (target === 'pixel-selection') {
        ports.admission.runAfter(() => {
          if (!isCurrent()) return;
          const current = session.getSnapshot();
          if (current.document?.activeLayerId !== activeLayerId || current.editor.activeChannel !== activeChannel) {
            report('The Delete target changed while finishing the active interaction.'); return;
          }
          // Settlement may legitimately transform/replace coverage. Use its active result on the
          // invocation target, never reinterpret a disappeared selection as an unrestricted clear.
          if (!selection.acquire(current.documentRevision).selection.active) {
            report('The selection is no longer active; Delete was not applied.'); return;
          }
          if (!activeLayerId) { report('Select a layer before clearing selected pixels.'); return; }
          ports.fill.clearSelection({ layerId: activeLayerId, channel: activeChannel });
        });
        return;
      }
      if (target !== 'layers') return;
      const selected = ports.getSelectedLayerIds();
      const layerIds = selected.length > 0 ? [...selected] : activeLayerId ? [activeLayerId] : [];
      if (ports.transform.isActive()) ports.transform.cancel();
      if (isCurrent() && layerIds.length > 0) ports.deleteLayers(layerIds, report);
    } catch (reason) {
      report(reason instanceof Error ? reason.message : 'Delete could not be completed.');
    }
  };
}
