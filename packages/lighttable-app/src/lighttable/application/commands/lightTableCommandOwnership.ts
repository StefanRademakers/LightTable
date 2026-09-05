import type {
  DocumentLightTableCommandPorts,
  LightTableCommandId
} from './lightTableCommandContract';

/** Commands completed by the workspace/service without a document command owner. */
export const SERVICE_OWNED_COMMANDS: ReadonlySet<LightTableCommandId> = new Set([
  'document.create',
  'document.duplicate',
  'file.openArtifact',
  'task.cancel'
]);

/**
 * Commands implemented by the mounted presentation owner.
 *
 * Keep this list explicit: adding a command to the public contract must not
 * silently advertise it until one concrete owner implements the complete route.
 */
type DocumentCommandPort = keyof DocumentLightTableCommandPorts;

const MOUNTED_DOCUMENT_COMMAND_PORTS = {
  'document.resizeImage': 'resizeImage',
  'document.applyGeometry': 'applyDocumentGeometry',
  'document.assignProfile': 'assignDocumentProfile',
  'view.setZoom': 'setZoom',
  'layer.createRaster': 'createRasterLayer',
  'layer.duplicate': 'executeLayerCommand',
  'layer.copyToNewLayer': 'executeLayerCommand',
  'layer.delete': 'executeLayerCommand',
  'layer.move': 'executeLayerCommand',
  'layer.setBlendMode': 'executeLayerCommand',
  'layer.setClipping': 'executeLayerCommand',
  'layer.setTransform': 'executeLayerCommand',
  'transform.applyFixed': 'executeFixedTransform',
  'adjustment.create': 'executeAdjustmentCreation',
  'raster.invert': 'executeRasterInvert',
  'layer.rasterize': 'executeLayerRasterize',
  'text.convertToShape': 'executeTextToShape',
  'text.rasterize': 'executeTextRasterize',
  'layer.merge': 'executeLayerMerge',
  'layer.flattenGroup': 'executeFlattenGroup',
  'document.flattenImage': 'executeFlattenImage',
  'layer.setMask': 'executeLayerCommand',
  'layer.removeBackground': 'executeBackgroundRemoval',
  'layer.autoAlign': 'executeAutoAlign',
  'layer.setLock': 'executeLayerCommand',
  'layer.placeArtifact': 'placeArtifact',
  'layer.rename': 'renameLayer',
  'layer.setVisibility': 'setLayerVisibility',
  'layer.setFillOpacity': 'setLayerFillOpacity',
  'layer.style.setEnabled': 'setLayerStyleEnabled',
  'layer.style.update': 'executeLayerStyleCommand',
  'layer.effect.setEnabled': 'setLayerEffectEnabled',
  'text.create': 'executeTextCommand',
  'text.replaceRange': 'executeTextCommand',
  'text.format': 'executeTextCommand',
  'text.setLayout': 'executeTextCommand',
  'vector.create': 'executeVectorCommand',
  'vector.update': 'executeVectorCommand',
  'vector.remove': 'executeVectorCommand',
  'vector.importSvg': 'executeSvgImport',
  'warp.applyStroke': 'executeWarpStrokeCommand',
  'raster.fill': 'executeFillCommand',
  'raster.applyGradient': 'executeRasterGradientCommand',
  'faceWarp.applyOperation': 'executeFaceWarpCommand',
  'layer.effect.add': 'executeLayerStyleCommand',
  'layer.effect.update': 'executeLayerStyleCommand',
  'layer.effect.remove': 'executeLayerStyleCommand',
  'layer.effect.move': 'executeLayerStyleCommand',
  'command.batch': 'executeAtomicBatch',
  'tool.commitGesture': 'finishGesture',
  'selection.applyShape': 'executeSelectionCommand',
  'selection.applyMagicWand': 'executeSelectionCommand',
  'selection.selectSubject': 'executeSubjectSelection',
  'selection.modify': 'executeSelectionCommand',
  'selection.cutPixels': 'cutPixels',
  'selection.copyPixels': 'copyPixels',
  'selection.pastePixels': 'pastePixels',
  'grade.copy': 'copyGrade',
  'grade.paste': 'pasteGrade',
  'grade.setBasic': 'executeBasicAdjustmentCommand',
  'grade.setDetail': 'executeDetailAdjustmentCommand',
  'file.exportNative': 'exportNativeArtifact',
  'file.exportPng': 'exportPngArtifact',
  'file.exportBitmap': 'exportBitmapArtifact',
  'file.exportPsd': 'exportPsdArtifact',
  'file.exportSvg': 'exportSvgArtifact',
  'history.undo': 'undo',
  'history.redo': 'redo'
} as const satisfies Partial<Record<LightTableCommandId, DocumentCommandPort>>;

export const MOUNTED_DOCUMENT_COMMANDS: ReadonlySet<LightTableCommandId> = new Set(
  Object.keys(MOUNTED_DOCUMENT_COMMAND_PORTS) as LightTableCommandId[]
);

export const isServiceOwnedCommand = (command: LightTableCommandId): boolean => (
  SERVICE_OWNED_COMMANDS.has(command)
);

export const isMountedDocumentCommand = (command: LightTableCommandId): boolean => (
  MOUNTED_DOCUMENT_COMMANDS.has(command)
);

export const mountedDocumentCommandPort = (
  command: LightTableCommandId
): DocumentCommandPort | null => MOUNTED_DOCUMENT_COMMAND_PORTS[
  command as keyof typeof MOUNTED_DOCUMENT_COMMAND_PORTS
] ?? null;
