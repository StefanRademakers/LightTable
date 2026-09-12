import type { DocumentSession } from '../../documents/documentSession';
import type { ImageDocument } from '../../../editor/document/documentTypes';
import type { SemanticSelectionCommand } from '../../commands/semanticSelectionCommandContract';
import type { SelectionSessionController } from './useSelectionSessionController';

interface MountedSelectionCommandPorts {
  readonly session: DocumentSession | undefined;
  readonly renderer: object | null;
  readonly registration: { isCurrent(): boolean };
  getSession(): DocumentSession | undefined;
  getRenderer(): object | null;
  getProjectedDocument(): Pick<ImageDocument, 'id'> | null;
  captureScope(): { assertCurrent(): void };
  settle(): Promise<void>;
  readonly selection: Pick<SelectionSessionController, 'selectLayerTransparency' | 'selectSimilar'
    | 'feather' | 'border' | 'smooth' | 'morphology' | 'applyState' | 'applyMagicWand' | 'applyShape'>;
}

/** Mounted protocol mapping only; the existing selection/kernel owners commit the result. */
export const createMountedSelectionCommandBinding = (ports: MountedSelectionCommandPorts) =>
  async (command: SemanticSelectionCommand): Promise<unknown> => {
    const scope = ports.captureScope(), { session, renderer, selection } = ports;
    const assertCurrent = () => {
      const snapshot = session?.getSnapshot();
      if (!session || !renderer || ports.getSession() !== session || ports.getRenderer() !== renderer
        || snapshot?.lifecycle !== 'ready' || !snapshot.document
        || ports.getProjectedDocument()?.id !== snapshot.document.id || !ports.registration.isCurrent()) {
        throw new Error('Selection command belongs to a retired document renderer.');
      }
      scope.assertCurrent();
    };
    assertCurrent();
    await ports.settle();
    assertCurrent();
    // No post-commit lifetime veto: a retired view cannot undo truthful kernel success.
    if (command.kind === 'apply-shape') {
      const applied = await selection.applyShape(command.shape, command.mode, command.featherRadius, command.antiAlias);
      return applied ? { mode: command.mode, shape: command.shape,
        featherRadius: command.featherRadius, antiAlias: command.antiAlias } : null;
    }
    if (command.kind === 'magic-wand') {
      const applied = await selection.applyMagicWand(command.layerId, command.point, command.mode, command.options);
      return applied ? { layerId: command.layerId, point: command.point, mode: command.mode, options: command.options } : null;
    }
    if (command.operation === 'load-transparency') {
      return await selection.selectLayerTransparency(command.layerId)
        ? { operation: command.operation, layerId: command.layerId } : null;
    }
    if (command.operation === 'similar') {
      const applied = await selection.selectSimilar(command.layerId, {
        tolerance: command.tolerance, antiAlias: command.antiAlias, sampleAllLayers: command.sampleAllLayers
      });
      return applied ? { operation: command.operation, layerId: command.layerId, tolerance: command.tolerance,
        antiAlias: command.antiAlias, sampleAllLayers: command.sampleAllLayers } : null;
    }
    const atBounds = command.applyAtCanvasBounds === true;
    const applied = command.operation === 'feather' ? await selection.feather(command.radius!, atBounds)
      : command.operation === 'border' ? await selection.border(command.width!)
      : command.operation === 'smooth' ? await selection.smooth(command.radius!, atBounds)
      : command.operation === 'expand' || command.operation === 'contract'
        ? await selection.morphology(command.operation, command.radius!, atBounds)
        : await selection.applyState(command.operation);
    return applied ? { operation: command.operation,
      ...(command.operation === 'feather' || command.operation === 'smooth'
        || command.operation === 'expand' || command.operation === 'contract'
        ? { radius: command.radius, applyAtCanvasBounds: atBounds } : {}),
      ...(command.operation === 'border' ? { width: command.width } : {}) } : null;
  };
