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
  const layerCapabilities = queryLayerCommandCapabilities(snapshot.document);
  const availability = (command: LightTableCommandId, available: boolean,
    reason: string): CommandCapabilitySummary => ({ command, available: ready && available,
    reason: !ready ? 'The document is not ready.' : available ? null : reason });
  return [
    availability('document.create', workspaceCommandsAvailable, 'Document creation is unavailable in this host.'),
    availability('document.duplicate', workspaceCommandsAvailable, 'Document duplication is unavailable in this host.'),
    availability('document.resizeImage', Boolean(ports.resizeImage), 'Image Size is unavailable in this host.'),
    availability('document.applyGeometry', Boolean(ports.applyDocumentGeometry), 'Document geometry is unavailable in this host.'),
    availability('document.assignProfile', Boolean(ports.assignDocumentProfile),
      'Assign Profile is unavailable in this host.'),
    availability('selection.copyPixels', Boolean(ports.copyPixels),
      'Pixel copy is unavailable in this host.'),
    availability('selection.pastePixels', Boolean(ports.pastePixels),
      'Pixel paste is unavailable in this host.'),
    availability('grade.copy', Boolean(ports.copyGrade),
      'Copy Grade is unavailable in this host.'),
    availability('grade.paste', Boolean(ports.pasteGrade),
      'Paste Grade is unavailable in this host.'),
    availability('view.setZoom', true, ''), availability('layer.createRaster', true, ''),
    availability('layer.duplicate', walkLayerTree(snapshot.document.layers)
      .some(({ node }) => node.type === 'raster' || node.type === 'text'),
    'There is no duplicable raster or text layer.'),
    availability('layer.copyToNewLayer', walkLayerTree(snapshot.document.layers)
      .some(({ node }) => node.type === 'raster'), 'There is no raster layer to copy.'),
    availability('layer.delete', layerCapabilities.layerCount > 1, 'The document must retain at least one layer.'),
    availability('layer.move', layerCapabilities.layerCount > 1, 'There is no other layer to move relative to.'),
    availability('layer.setBlendMode', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('layer.setClipping', layerCapabilities.layerCount > 1, 'Clipping requires a lower sibling layer.'),
    availability('layer.setTransform', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('transform.applyFixed', Boolean(ports.executeFixedTransform)
      && Boolean(layerCapabilities.activeLayer), 'Select an editable layer.'),
    availability('adjustment.create', Boolean(ports.executeAdjustmentCreation), 'Adjustment creation is unavailable in this host.'),
    availability('layer.setMask', layerCapabilities.layerCount > 0, 'There are no layers.'),
    availability('layer.removeBackground', Boolean(ports.executeBackgroundRemoval), 'Remove Background is unavailable in this host.'),
    availability('layer.autoAlign', Boolean(ports.executeAutoAlign), 'Auto Align is unavailable in this host.'),
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
    availability('warp.applyStroke', Boolean(ports.executeWarpStrokeCommand), 'Warp stroke commands are unavailable in this host.'),
    availability('raster.fill', Boolean(ports.executeFillCommand), 'Fill commands are unavailable in this host.'),
    availability('raster.applyGradient', Boolean(ports.executeRasterGradientCommand), 'Raster-gradient commands are unavailable in this host.'),
    availability('raster.invert', Boolean(ports.executeRasterInvert), 'Raster invert is unavailable in this host.'),
    availability('text.convertToShape', Boolean(ports.executeTextToShape), 'Text-to-shape conversion is unavailable in this host.'),
    availability('text.rasterize', Boolean(ports.executeTextRasterize), 'Text rasterization is unavailable in this host.'),
    availability('layer.merge', Boolean(ports.executeLayerMerge) && layerCapabilities.layerCount > 1,
      'Layer merge is unavailable or fewer than two layers exist.'),
    availability('layer.flattenGroup', Boolean(ports.executeFlattenGroup), 'Group flatten is unavailable in this host.'),
    availability('document.flattenImage', Boolean(ports.executeFlattenImage) && layerCapabilities.layerCount > 0,
      'Image flatten is unavailable or the image has no layers.'),
    availability('faceWarp.applyOperation', Boolean(ports.executeFaceWarpCommand), 'Face Warp commands are unavailable in this host.'),
    availability('layer.effect.add', true, ''), availability('layer.effect.update', true, ''),
    availability('layer.effect.remove', true, ''), availability('layer.effect.move', true, ''),
    availability('command.batch', true, ''), availability('tool.commitGesture', true, ''),
    availability('selection.applyShape', Boolean(ports.executeSelectionCommand), 'Selection commands are unavailable in this host.'),
    availability('selection.applyMagicWand', Boolean(ports.executeSelectionCommand), 'Selection commands are unavailable in this host.'),
    availability('selection.selectSubject', Boolean(ports.executeSubjectSelection), 'Select Subject is unavailable in this host.'),
    availability('selection.modify', Boolean(ports.executeSelectionCommand), 'Selection commands are unavailable in this host.'),
    availability('grade.setBasic', Boolean(ports.executeBasicAdjustmentCommand), 'Basic Grade commands are unavailable in this host.'),
    availability('grade.setDetail', Boolean(ports.executeDetailAdjustmentCommand), 'Detail commands are unavailable in this host.'),
    availability('task.cancel', snapshot.tasks.activeTaskIds.length > 0, 'There is no running task.'),
    availability('file.exportNative', true, ''), availability('file.exportPng', true, ''),
    availability('file.exportBitmap', true, ''),
    availability('file.exportPsd', true, ''),
    availability('history.undo', snapshot.history.canUndo, 'There is nothing to undo.'),
    availability('history.redo', snapshot.history.canRedo, 'There is nothing to redo.')
  ];
};
