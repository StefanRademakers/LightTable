import type { DocumentSessionSnapshot } from '../documents/documentSession';
import { walkLayerTree } from '../../editor/document/layerTree';
import { queryLayerCommandCapabilities } from '../layers/layerCommandCapabilities';
import type {
  CommandCapabilitySummary,
  LightTableCommandId,
  LightTableCommandPorts
} from './lightTableCommandContract';

export const projectCommandCapabilities = (
  snapshot: DocumentSessionSnapshot,
  ports: LightTableCommandPorts,
  workspaceCommandsAvailable: boolean
): readonly CommandCapabilitySummary[] | null => {
  if (!snapshot.document) return null;
  const ready = snapshot.lifecycle === 'ready';
  const supports = (port: string, fallback: unknown): boolean => (
    ports.supportsPort?.(snapshot.id, port) ?? Boolean(fallback)
  );
  const layerCapabilities = queryLayerCommandCapabilities(snapshot.document);
  const availability = (command: LightTableCommandId, available: boolean,
    reason: string): CommandCapabilitySummary => {
    const ownerSupportsCommand = ports.supportsCommand?.(snapshot.id, command) ?? true;
    const commandAvailable = available && ownerSupportsCommand;
    return { command, available: ready && commandAvailable,
      reason: !ready ? 'The document is not ready.' : commandAvailable ? null
        : ownerSupportsCommand ? reason : 'The command requires the active document renderer.' };
  };
  return [
    availability('document.create', workspaceCommandsAvailable, 'Document creation is unavailable in this host.'),
    availability('document.duplicate', workspaceCommandsAvailable, 'Document duplication is unavailable in this host.'),
    availability('document.resizeImage', supports('resizeImage', ports.resizeImage), 'Image Size is unavailable in this host.'),
    availability('document.applyGeometry', supports('applyDocumentGeometry', ports.applyDocumentGeometry), 'Document geometry is unavailable in this host.'),
    availability('document.assignProfile', supports('assignDocumentProfile', ports.assignDocumentProfile),
      'Assign Profile is unavailable in this host.'),
    availability('selection.copyPixels', supports('copyPixels', ports.copyPixels),
      'Pixel copy is unavailable in this host.'),
    availability('selection.cutPixels', supports('cutPixels', ports.cutPixels),
      'Pixel cut is unavailable in this host.'),
    availability('selection.pastePixels', supports('pastePixels', ports.pastePixels),
      'Pixel paste is unavailable in this host.'),
    availability('grade.copy', supports('copyGrade', ports.copyGrade),
      'Copy Grade is unavailable in this host.'),
    availability('grade.paste', supports('pasteGrade', ports.pasteGrade),
      'Paste Grade is unavailable in this host.'),
    availability('view.setZoom', true, ''), availability('layer.createRaster', true, ''),
    availability('layer.duplicate', layerCapabilities.layerCount > 0,
      'There is no layer to duplicate.'),
    availability('layer.copyToNewLayer', walkLayerTree(snapshot.document.layers)
      .some(({ node }) => node.type === 'raster'), 'There is no raster layer to copy.'),
    availability('layer.delete', layerCapabilities.layerCount > 1, 'The document must retain at least one layer.'),
    availability('layer.move', layerCapabilities.layerCount > 1, 'There is no other layer to move relative to.'),
    availability('layer.setBlendMode', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('layer.setClipping', layerCapabilities.layerCount > 1, 'Clipping requires a lower sibling layer.'),
    availability('layer.setTransform', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('transform.applyFixed', supports('executeFixedTransform', ports.executeFixedTransform)
      && Boolean(layerCapabilities.activeLayer), 'Select an editable layer.'),
    availability('adjustment.create', supports('executeAdjustmentCreation', ports.executeAdjustmentCreation), 'Adjustment creation is unavailable in this host.'),
    availability('layer.setMask', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('layer.removeBackground', supports('executeBackgroundRemoval', ports.executeBackgroundRemoval), 'Remove Background is unavailable in this host.'),
    availability('layer.autoAlign', supports('executeAutoAlign', ports.executeAutoAlign), 'Auto Align is unavailable in this host.'),
    availability('layer.setLock', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('layer.placeArtifact', true, ''),
    availability('layer.rename', Boolean(layerCapabilities.activeLayer), 'Select an existing layer.'),
    availability('layer.setVisibility', true, ''), availability('layer.setFillOpacity', true, ''),
    availability('layer.style.setEnabled', true, ''), availability('layer.style.update', true, ''),
    availability('layer.effect.setEnabled', true, ''),
    availability('file.openArtifact', workspaceCommandsAvailable, 'Artifact open is unavailable in this host.'),
    availability('text.create', true, ''), availability('text.replaceRange', true, ''),
    availability('text.format', true, ''), availability('text.setLayout', true, ''),
    availability('vector.create', true, ''), availability('vector.update', true, ''),
    availability('vector.remove', true, ''),
    availability('vector.importSvg', supports('executeSvgImport', ports.executeSvgImport), 'SVG import is unavailable in this host.'),
    availability('warp.applyStroke', supports('executeWarpStrokeCommand', ports.executeWarpStrokeCommand), 'Warp stroke commands are unavailable in this host.'),
    availability('raster.fill', supports('executeFillCommand', ports.executeFillCommand), 'Fill commands are unavailable in this host.'),
    availability('raster.applyGradient', supports('executeRasterGradientCommand', ports.executeRasterGradientCommand), 'Raster-gradient commands are unavailable in this host.'),
    availability('raster.invert', supports('executeRasterInvert', ports.executeRasterInvert), 'Raster invert is unavailable in this host.'),
    availability('layer.rasterize', supports('executeLayerRasterize', ports.executeLayerRasterize)
      && layerCapabilities.hasRasterizableLayer,
    'Layer rasterization is unavailable or every layer is pixel-locked.'),
    availability('text.convertToShape', supports('executeTextToShape', ports.executeTextToShape), 'Text-to-shape conversion is unavailable in this host.'),
    availability('text.rasterize', supports('executeTextRasterize', ports.executeTextRasterize), 'Text rasterization is unavailable in this host.'),
    availability('layer.merge', supports('executeLayerMerge', ports.executeLayerMerge)
      && layerCapabilities.hasMergeCandidate,
    'Layer merge is unavailable or no two sibling layers can be merged.'),
    availability('layer.flattenGroup', supports('executeFlattenGroup', ports.executeFlattenGroup)
      && layerCapabilities.hasFlattenableGroup,
    'Group flatten is unavailable or no non-empty group exists.'),
    availability('document.flattenImage', supports('executeFlattenImage', ports.executeFlattenImage) && layerCapabilities.layerCount > 0,
      'Image flatten is unavailable or the image has no layers.'),
    availability('faceWarp.applyOperation', supports('executeFaceWarpCommand', ports.executeFaceWarpCommand), 'Face Warp commands are unavailable in this host.'),
    availability('layer.effect.add', true, ''), availability('layer.effect.update', true, ''),
    availability('layer.effect.remove', true, ''), availability('layer.effect.move', true, ''),
    availability('command.batch', true, ''), availability('tool.commitGesture', true, ''),
    availability('selection.applyShape', supports('executeSelectionCommand', ports.executeSelectionCommand), 'Selection commands are unavailable in this host.'),
    availability('selection.applyMagicWand', supports('executeSelectionCommand', ports.executeSelectionCommand), 'Selection commands are unavailable in this host.'),
    availability('selection.selectSubject', supports('executeSubjectSelection', ports.executeSubjectSelection), 'Select Subject is unavailable in this host.'),
    availability('selection.modify', supports('executeSelectionCommand', ports.executeSelectionCommand), 'Selection commands are unavailable in this host.'),
    availability('grade.setBasic', supports('executeBasicAdjustmentCommand', ports.executeBasicAdjustmentCommand), 'Basic Grade commands are unavailable in this host.'),
    availability('grade.setDetail', supports('executeDetailAdjustmentCommand', ports.executeDetailAdjustmentCommand), 'Detail commands are unavailable in this host.'),
    availability('task.cancel', snapshot.tasks.activeTaskIds.length > 0, 'There is no running task.'),
    availability('file.exportNative', true, ''), availability('file.exportPng', true, ''),
    availability('file.exportBitmap', true, ''),
    availability('file.exportPsd', true, ''),
    availability('file.exportSvg', supports('exportSvgArtifact', ports.exportSvgArtifact), 'SVG export is unavailable in this host.'),
    availability('history.undo', snapshot.history.canUndo, 'There is nothing to undo.'),
    availability('history.redo', snapshot.history.canRedo, 'There is nothing to redo.')
  ];
};
