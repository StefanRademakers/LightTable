import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { DocumentSessionId } from '../documents/documentSession';
import { parseAttachedAdjustmentOwnerId } from '../../processing/attachedAdjustment';
import type {
  LightTableCommandId,
  LightTableCommandService
} from '../commands/lightTableCommandService';
import type { LayerPanelController } from './useLayerPanelController';
import {
  canRestoreLayerVisibility,
  captureLayerVisibility,
  planAllLayerVisibility,
  planRestoreLayerVisibility,
  planSoloLayerVisibility,
  type LayerVisibilityChange,
  type LayerVisibilitySnapshot
} from './layerVisibilityIsolation';

type ExecuteRegisteredCommand = (
  command: LightTableCommandId,
  parameters: unknown
) => unknown;

export interface CommandLayerPanelControllerOptions {
  readonly controller: LayerPanelController;
  readonly commandService: Pick<LightTableCommandService, 'recordObservedCommand'>;
  readonly documentId: DocumentSessionId;
  readonly executeCommand: ExecuteRegisteredCommand;
  readonly getDocument: () => ImageDocument | null;
  readonly reportError: (message: string) => void;
}

/**
 * Owns the Layers panel's command boundary and continuous gesture lifetime.
 *
 * The lower-level panel controller remains responsible for previews that must
 * update synchronously while a pointer is moving. This adapter admits every
 * discrete mutation through the command service and records a continuous
 * visibility/opacity gesture exactly once after its preview transaction ends.
 */
export const useCommandLayerPanelController = ({
  controller,
  commandService,
  documentId,
  executeCommand,
  getDocument,
  reportError
}: CommandLayerPanelControllerOptions): LayerPanelController => {
  const soloVisibilityRef = useRef<LayerVisibilitySnapshot | null>(null);
  const interactionSequenceRef = useRef(0);
  const visibilityInteractionRef = useRef<{
    readonly token: number;
    readonly documentId: DocumentSessionId;
    initial: Map<LayerId, boolean>;
  } | null>(null);
  const opacityInteractionRef = useRef<{
    readonly token: number;
    readonly documentId: DocumentSessionId;
    initialOpacity: Map<LayerId, number>;
    initialFillOpacity: Map<LayerId, number>;
  } | null>(null);

  useEffect(() => () => {
    soloVisibilityRef.current = null;
    if (visibilityInteractionRef.current) {
      visibilityInteractionRef.current = null;
      controller.cancelVisibilityInteraction();
    }
    if (opacityInteractionRef.current) {
      opacityInteractionRef.current = null;
      controller.cancelOpacityInteraction();
    }
  }, [controller, documentId]);

  const executeVisibilityChanges = useCallback((
    changes: readonly LayerVisibilityChange[],
    name: string
  ) => {
    const operations = changes.flatMap((change, changeIndex) => {
      const chunks: LayerId[][] = [];
      for (let offset = 0; offset < change.layerIds.length; offset += 256) {
        chunks.push(change.layerIds.slice(offset, offset + 256) as LayerId[]);
      }
      return chunks.map((layerIds, chunkIndex) => ({
        operationId: `visibility-${changeIndex}-${chunkIndex}`,
        command: 'layer.setVisibility',
        parameters: { layerIds, visible: change.visible }
      }));
    });
    if (operations.length === 1) {
      void executeCommand('layer.setVisibility', operations[0]!.parameters);
    } else if (operations.length > 1) {
      void executeCommand('command.batch', { name, operations });
    }
  }, [executeCommand]);

  return useMemo<LayerPanelController>(() => ({
    select: controller.select,
    changeChannel: controller.changeChannel,
    createRasterLayer: () => { void executeCommand('layer.createRaster', {}); },
    rename: (layerId, name) => { void executeCommand('layer.rename', { layerId, name }); },
    setVisibility: (layerIds, visible) => {
      soloVisibilityRef.current = null;
      void executeCommand('layer.setVisibility', { layerIds, visible });
    },
    toggleSoloVisibility: (layerId) => {
      const document = getDocument();
      if (!document) return;
      const snapshot = soloVisibilityRef.current;
      if (snapshot?.targetLayerId === layerId && canRestoreLayerVisibility(document, snapshot)) {
        executeVisibilityChanges(planRestoreLayerVisibility(document, snapshot), 'Restore layer visibility');
        soloVisibilityRef.current = null;
        return;
      }
      soloVisibilityRef.current = captureLayerVisibility(document, layerId);
      executeVisibilityChanges(planSoloLayerVisibility(document, layerId), 'Solo layer');
    },
    setOtherLayersVisibility: (layerId, visible) => {
      soloVisibilityRef.current = null;
      const document = getDocument();
      if (document) executeVisibilityChanges(
        visible
          ? planAllLayerVisibility(document, true, layerId)
          : planSoloLayerVisibility(document, layerId),
        `${visible ? 'Show' : 'Hide'} other layers`
      );
    },
    setAllLayersVisibility: (visible) => {
      soloVisibilityRef.current = null;
      const document = getDocument();
      if (document) executeVisibilityChanges(
        planAllLayerVisibility(document, visible),
        `${visible ? 'Show' : 'Hide'} all layers`
      );
    },
    beginVisibilityInteraction: () => {
      soloVisibilityRef.current = null;
      if (visibilityInteractionRef.current || !controller.beginVisibilityInteraction()) return false;
      visibilityInteractionRef.current = {
        token: ++interactionSequenceRef.current,
        documentId,
        initial: new Map()
      };
      return true;
    },
    previewVisibility: (layerIds, visible) => {
      const interaction = visibilityInteractionRef.current;
      if (!interaction || interaction.documentId !== documentId) return;
      const document = getDocument();
      if (document) {
        for (const layerId of layerIds) {
          if (!interaction.initial.has(layerId)) {
            const layer = findDocumentLayer(document, layerId);
            if (layer) interaction.initial.set(layerId, layer.visible);
          }
        }
      }
      controller.previewVisibility(layerIds, visible);
    },
    endVisibilityInteraction: () => {
      const interaction = visibilityInteractionRef.current;
      if (!interaction) return;
      visibilityInteractionRef.current = null;
      if (interaction.documentId !== documentId) {
        controller.cancelVisibilityInteraction();
        return;
      }
      controller.endVisibilityInteraction();
      const document = getDocument();
      const changed = document ? [...interaction.initial].flatMap(([layerId, initial]) => {
        const layer = findDocumentLayer(document, layerId);
        return layer && layer.visible !== initial ? [{ layerId, visible: layer.visible }] : [];
      }) : [];
      interaction.initial.clear();
      const finals = [false, true].flatMap((visible) => {
        const layerIds = changed.filter((change) => change.visible === visible).map(({ layerId }) => layerId);
        return layerIds.length ? [{ layerIds, visible }] : [];
      });
      if (finals.length === 1) {
        commandService.recordObservedCommand(
          'layer.setVisibility', interaction.documentId, finals[0], finals[0]
        );
      } else if (finals.length > 1) {
        const operations = finals.map((parameters, index) => ({
          operationId: `visibility-${index}`,
          command: 'layer.setVisibility' as const,
          parameters
        }));
        commandService.recordObservedCommand(
          'command.batch', interaction.documentId,
          { name: 'Set layer visibility', operations },
          { results: operations.map(({ operationId, parameters }) => ({ operationId, value: parameters })) }
        );
      }
    },
    cancelVisibilityInteraction: () => {
      if (!visibilityInteractionRef.current) return;
      visibilityInteractionRef.current = null;
      controller.cancelVisibilityInteraction();
    },
    setOpacity: (layerId, opacity) => {
      const interaction = opacityInteractionRef.current;
      if (!interaction) {
        void executeCommand('layer.setOpacity', { layerId, opacity });
        return;
      }
      if (interaction.documentId !== documentId) return;
      const current = getDocument();
      const layer = current ? findDocumentLayer(current, layerId) : null;
      if (layer && !interaction.initialOpacity.has(layerId)) {
        interaction.initialOpacity.set(layerId, layer.opacity);
      }
      controller.setOpacity(layerId, opacity);
    },
    setVectorAntiAlias: (layerId, antiAlias) => {
      void executeCommand('layer.setVectorAntiAlias', { layerId, antiAlias });
    },
    setFillOpacity: (layerId, opacity) => {
      const interaction = opacityInteractionRef.current;
      if (!interaction) {
        void executeCommand('layer.setFillOpacity', { layerId, opacity });
        return;
      }
      if (interaction.documentId !== documentId) return;
      const current = getDocument();
      const layer = current ? findDocumentLayer(current, layerId) : null;
      if (layer && !interaction.initialFillOpacity.has(layerId)) {
        interaction.initialFillOpacity.set(layerId, layer.fillOpacity);
      }
      controller.setFillOpacity(layerId, opacity);
    },
    beginOpacityInteraction: () => {
      if (opacityInteractionRef.current || !controller.beginOpacityInteraction()) return false;
      opacityInteractionRef.current = {
        token: ++interactionSequenceRef.current,
        documentId,
        initialOpacity: new Map(),
        initialFillOpacity: new Map()
      };
      return true;
    },
    endOpacityInteraction: () => {
      const interaction = opacityInteractionRef.current;
      if (!interaction) return;
      opacityInteractionRef.current = null;
      if (interaction.documentId !== documentId) {
        controller.cancelOpacityInteraction();
        return;
      }
      controller.endOpacityInteraction();
      const document = getDocument();
      const observed: Array<{
        command: 'layer.setOpacity' | 'layer.setFillOpacity';
        parameters: { layerId: LayerId; opacity: number };
      }> = [];
      if (document) {
        for (const [layerId, initial] of interaction.initialOpacity) {
          const opacity = findDocumentLayer(document, layerId)?.opacity;
          if (opacity !== undefined && opacity !== initial) observed.push({
            command: 'layer.setOpacity', parameters: { layerId, opacity }
          });
        }
        for (const [layerId, initial] of interaction.initialFillOpacity) {
          const opacity = findDocumentLayer(document, layerId)?.fillOpacity;
          if (opacity !== undefined && opacity !== initial) observed.push({
            command: 'layer.setFillOpacity', parameters: { layerId, opacity }
          });
        }
      }
      if (observed.length === 1) {
        commandService.recordObservedCommand(
          observed[0]!.command, interaction.documentId,
          observed[0]!.parameters, observed[0]!.parameters
        );
      } else if (observed.length > 1) {
        const operations = observed.map(({ command, parameters }, index) => ({
          operationId: `opacity-${index}`, command, parameters
        }));
        commandService.recordObservedCommand(
          'command.batch', interaction.documentId,
          { name: 'Set layer opacity', operations },
          { results: operations.map(({ operationId, parameters }) => ({ operationId, value: parameters })) }
        );
      }
      interaction.initialOpacity.clear();
      interaction.initialFillOpacity.clear();
    },
    cancelOpacityInteraction: () => {
      if (!opacityInteractionRef.current) return;
      opacityInteractionRef.current = null;
      controller.cancelOpacityInteraction();
    },
    duplicateActive: () => {
      const layerId = getDocument()?.activeLayerId;
      if (layerId) void executeCommand('layer.duplicate', { layerId });
    },
    rasterizeActive: () => {
      const layerId = getDocument()?.activeLayerId;
      if (!layerId) return reportError('Select a layer to rasterize.');
      void executeCommand('layer.rasterize', { layerId });
    },
    deleteSelection: (layerIds) => { void executeCommand('layer.delete', { layerIds }); },
    move: (layerId, direction) => { void executeCommand('layer.move', { layerId, direction }); },
    moveActive: (direction) => {
      const layerId = getDocument()?.activeLayerId;
      if (layerId) void executeCommand('layer.move', { layerId, direction });
    },
    setBlendMode: (layerId, blendMode) => {
      void executeCommand('layer.setBlendMode', { layerId, blendMode });
    },
    setClipping: (layerId, clipping) => {
      void executeCommand('layer.setClipping', { layerId, clipping });
    },
    reorder: (layerIds, targetLayerId, placement) => {
      void executeCommand('layer.reorder', { layerIds, targetLayerId, placement });
    },
    addMask: controller.addMask,
    loadMaskSelection: controller.loadMaskSelection,
    loadTransparencySelection: (layerId) => {
      void executeCommand('selection.modify', {
        kind: 'modify', operation: 'load-transparency', layerId
      });
    },
    toggleMask: controller.toggleMask,
    setMaskLinked: controller.setMaskLinked,
    removeMask: controller.removeMask,
    setLock: (layerIds, lock, locked) => {
      void executeCommand('layer.setLock', { layerIds, lock, locked });
    },
    createAdjustmentLayer: () => {
      const aboveLayerId = getDocument()?.activeLayerId ?? undefined;
      const created = controller.createAdjustmentLayer();
      const layerId = created;
      if (created && layerId) commandService.recordObservedCommand(
        'adjustment.create', documentId,
        { kind: 'grade', placement: 'adjustment-layer', ...(aboveLayerId ? { aboveLayerId } : {}) },
        { kind: 'grade', placement: 'adjustment-layer', layerId }
      );
      return created;
    },
    createCurvesAdjustmentLayer: () => {
      const aboveLayerId = getDocument()?.activeLayerId ?? undefined;
      const created = controller.createCurvesAdjustmentLayer();
      const layerId = created;
      if (created && layerId) commandService.recordObservedCommand(
        'adjustment.create', documentId,
        { kind: 'curves', placement: 'adjustment-layer', ...(aboveLayerId ? { aboveLayerId } : {}) },
        { kind: 'curves', placement: 'adjustment-layer', layerId }
      );
      return created;
    },
    createLocalProcessing: (layerId, kind) => {
      const changed = controller.createLocalProcessing(layerId, kind);
      if (changed) commandService.recordObservedCommand(
        'adjustment.create', documentId,
        { kind, placement: 'local', layerId }, { kind, placement: 'local', layerId }
      );
      return changed;
    },
    createGradientFillLayer: () => { void executeCommand('layer.createGradientFill', {}); },
    createLensFxLayer: () => {
      const aboveLayerId = getDocument()?.activeLayerId ?? undefined;
      const created = controller.createLensFxLayer();
      const layerId = created;
      if (created && layerId) commandService.recordObservedCommand(
        'adjustment.create', documentId,
        { kind: 'lens-fx', placement: 'adjustment-layer', ...(aboveLayerId ? { aboveLayerId } : {}) },
        { kind: 'lens-fx', placement: 'adjustment-layer', layerId }
      );
      return created;
    },
    createAdjustmentLayerOfKind: (kind, aboveLayerId, settings) => {
      const created = controller.createAdjustmentLayerOfKind(kind, aboveLayerId, settings);
      const layerId = created;
      if (created && layerId) commandService.recordObservedCommand(
        'adjustment.create', documentId,
        { kind, placement: 'adjustment-layer', ...(aboveLayerId ? { aboveLayerId } : {}),
          ...(settings ? { settings } : {}) },
        { kind, placement: 'adjustment-layer', layerId }
      );
      return created;
    },
    createAttachedAdjustment: (layerId, kind, settings) => {
      const adjustmentId = controller.createAttachedAdjustment(layerId, kind, settings);
      if (adjustmentId) commandService.recordObservedCommand(
        'adjustment.create', documentId,
        { kind, placement: 'attached', layerId, ...(settings ? { settings } : {}) },
        { kind, placement: 'attached', layerId, adjustmentId }
      );
      return adjustmentId;
    },
    createGroup: () => { void executeCommand('layer.createGroup', {}); },
    groupSelection: (layerIds) => { void executeCommand('layer.group', { layerIds }); },
    ungroupSelection: (layerIds) => { void executeCommand('layer.ungroup', { layerIds }); },
    setStyleEnabled: (layerId, effectId, enabled) => {
      void executeCommand('layer.effect.setEnabled', { layerId, effectId, enabled });
    },
    setStyleStackEnabled: (layerId, enabled) => {
      void executeCommand('layer.style.setEnabled', { layerId, enabled });
    },
    mergeDown: controller.mergeDown,
    mergeSelected: controller.mergeSelected,
    flattenGroup: controller.flattenGroup,
    flattenImage: controller.flattenImage,
    editStyles: controller.editStyles,
    removeStyle: controller.removeStyle,
    clearStyles: controller.clearStyles,
    setLocalGradeEnabled: (layerId, enabled) => {
      void executeCommand('adjustment.modifyStructure', {
        operation: 'set-enabled', target: { kind: 'local', layerId, owner: 'grade' }, enabled
      });
    },
    setLocalCurvesEnabled: (layerId, enabled) => {
      void executeCommand('adjustment.modifyStructure', {
        operation: 'set-enabled', target: { kind: 'local', layerId, owner: 'curves' }, enabled
      });
    },
    setLocalLensFxEnabled: (layerId, enabled) => {
      void executeCommand('adjustment.modifyStructure', {
        operation: 'set-enabled', target: { kind: 'local', layerId, owner: 'lens-fx' }, enabled
      });
    },
    setGradeGroupEnabled: (ownerId, group, enabled) => {
      const attached = parseAttachedAdjustmentOwnerId(ownerId);
      void executeCommand('adjustment.modifyStructure', {
        operation: 'set-grade-group-enabled',
        target: attached
          ? { kind: 'attached', layerId: attached.layerId, adjustmentId: attached.adjustmentId }
          : { kind: 'layer', layerId: ownerId },
        group,
        enabled
      });
    },
    removeLocalProcessing: (layerId, owner) => {
      void executeCommand('adjustment.modifyStructure', {
        operation: 'remove', target: { kind: 'local', layerId, owner }
      });
    },
    setAttachedAdjustmentEnabled: (layerId, adjustmentId, enabled) => {
      void executeCommand('adjustment.modifyStructure', {
        operation: 'set-enabled', target: { kind: 'attached', layerId, adjustmentId }, enabled
      });
    },
    removeAttachedAdjustment: (layerId, adjustmentId) => {
      void executeCommand('adjustment.modifyStructure', {
        operation: 'remove', target: { kind: 'attached', layerId, adjustmentId }
      });
    }
  }), [commandService, controller, documentId, executeCommand, executeVisibilityChanges,
    getDocument, reportError]);
};
