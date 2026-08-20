import type { SemanticParagraphStylePatch, SemanticTextCommand, SemanticTextFontRequest,
  SemanticTextStylePatch } from '../commands/semanticTextCommandContract';
import type { ImageDocument, DocumentFontAsset, LayerId } from '../../editor/document/documentTypes';
import type { TextToolSettings } from '../../editor/session/editorSession';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { renameLayer } from '../../editor/document/documentCommands';
import { applyTextLayerDataMutation, setFlowTextLayout, setTextLayerTransform } from '../../editor/document/textLayerCommands';
import { replaceFlowTextSelection } from './flowTextEditing';
import { formatFlowTextSource, type ParagraphStylePatch, type TextStylePatch } from './flowTextFormatting';
import { createParagraphTextDocument, createPathTextDocument, createPointTextDocument,
  resolveTextToolFont, type ParagraphTextCreationRequest, type PathTextCreationTarget,
  type PointTextCreationRequest } from './pointTextCreation';
import { solidTextPaintHex, textFillEnabledPatch, textFillPatchFromHex, textFontPatch,
  textStrokePatch } from './textPropertyPresentation';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { registerBundledTextFontByAssetId, registerBundledTextFontForSettings } from '../../text/fonts/bundledTextFont';

export interface SemanticTextCommandDependencies {
  readonly fontRegistry: DocumentFontRegistry;
  getDocument(): ImageDocument | null;
  getTextSettings(): TextToolSettings;
  getForegroundColor(): string;
  applyDocument(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
}

const creationStyle = (settings: TextToolSettings, font: DocumentFontAsset, color: string) => ({
  font: { assetId: font.assetId }, fontSize: settings.size,
  fill: { enabled: settings.fillEnabled, color }
});

export const pointTextCreateCommand = (
  request: PointTextCreationRequest, settings: TextToolSettings, font: DocumentFontAsset,
  color: string, vertical: boolean
): Extract<SemanticTextCommand, { kind: 'create' }> => ({
  kind: 'create', mode: 'point', text: request.text, origin: request.origin,
  writingMode: vertical ? 'vertical-rl' : 'horizontal-tb', style: creationStyle(settings, font, color),
  paragraph: { alignment: settings.alignment }
});

export const paragraphTextCreateCommand = (
  request: ParagraphTextCreationRequest, settings: TextToolSettings, font: DocumentFontAsset,
  color: string, vertical: boolean
): Extract<SemanticTextCommand, { kind: 'create' }> => ({
  kind: 'create', mode: 'paragraph', text: request.text,
  origin: { x: Math.min(request.start.x, request.end.x), y: Math.min(request.start.y, request.end.y) },
  frame: { width: Math.abs(request.end.x - request.start.x), height: Math.abs(request.end.y - request.start.y) },
  writingMode: vertical ? 'vertical-rl' : 'horizontal-tb', style: creationStyle(settings, font, color),
  paragraph: { alignment: settings.alignment }
});

export const pathTextCreateCommand = (
  request: PointTextCreationRequest,
  target: PathTextCreationTarget,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  color: string
): Extract<SemanticTextCommand, { kind: 'create' }> => ({
  kind: 'create', mode: 'path', text: request.text, origin: request.origin,
  writingMode: 'horizontal-tb', style: creationStyle(settings, font, color),
  paragraph: { alignment: settings.alignment },
  path: {
    layerId: target.pathLayerId,
    elementId: target.pathElementId,
    subpathId: target.pathSubpathId,
    startOffset: 0,
    side: 'left',
    upright: true,
    direction: 'forward'
  }
});

export const semanticStylePatchFromCanonical = (
  patch: TextStylePatch
): SemanticTextStylePatch | null => {
  const unsupported = ['baselineShift', 'horizontalScale', 'verticalScale', 'kerning', 'language',
    'scriptOverride', 'directionOverride', 'openTypeFeatures', 'variableAxes']
    .some((key) => Object.hasOwn(patch, key));
  if (unsupported) return null;
  const fontAsset = patch.requestedFont?.replacement?.replacementAsset
    ?? patch.requestedFont?.preferredAsset;
  const fill = Object.hasOwn(patch, 'fill') ? patch.fill
    ? solidTextPaintHex(patch.fill) : null : undefined;
  const strokePaint = patch.stroke?.paint.kind === 'solid' ? solidTextPaintHex(patch.stroke.paint) : null;
  if ((patch.fill && !fill) || (patch.stroke && !strokePaint)) return null;
  return { ...(patch.requestedFont ? { font: { ...(fontAsset ? { assetId: fontAsset.assetId } : {}),
    ...(!fontAsset && patch.requestedFont.families[0] ? { family: patch.requestedFont.families[0] } : {}) } } : {}),
    ...(patch.fontSize === undefined ? {} : { fontSize: patch.fontSize }),
    ...(patch.fontWeight === undefined ? {} : { fontWeight: patch.fontWeight }),
    ...(patch.fontStyle === undefined ? {} : { fontStyle: patch.fontStyle }),
    ...(patch.syntheticBold === undefined ? {} : { syntheticBold: patch.syntheticBold }),
    ...(patch.syntheticItalic === undefined ? {} : { syntheticItalic: patch.syntheticItalic }),
    ...(patch.tracking === undefined ? {} : { tracking: patch.tracking }),
    ...(patch.underline === undefined ? {} : { underline: patch.underline }),
    ...(fill === undefined ? {} : { fill: fill ? { enabled: true, color: fill } : { enabled: false } }),
    ...(Object.hasOwn(patch, 'stroke') ? { stroke: patch.stroke
      ? { enabled: true, color: strokePaint!, width: patch.stroke.width } : { enabled: false } } : {}) };
};

export const semanticParagraphPatchFromCanonical = (
  patch: ParagraphStylePatch
): SemanticParagraphStylePatch | null => {
  if (patch.hyphenation !== undefined) return null;
  return { ...(patch.alignment ? { alignment: patch.alignment } : {}),
  ...(patch.direction ? { direction: patch.direction } : {}),
  ...(patch.lineHeight ? { leading: patch.lineHeight.kind === 'normal' ? 'normal' as const
    : { kind: patch.lineHeight.kind, value: patch.lineHeight.value } } : {}),
  ...(patch.firstLineIndent === undefined ? {} : { firstLineIndent: patch.firstLineIndent }),
  ...(patch.startIndent === undefined ? {} : { startIndent: patch.startIndent }),
  ...(patch.endIndent === undefined ? {} : { endIndent: patch.endIndent }),
  ...(patch.spaceBefore === undefined ? {} : { spaceBefore: patch.spaceBefore }),
  ...(patch.spaceAfter === undefined ? {} : { spaceAfter: patch.spaceAfter }) };
};

const resolveFont = async (
  registry: DocumentFontRegistry,
  request: SemanticTextFontRequest | undefined,
  fallback: TextToolSettings
): Promise<DocumentFontAsset> => {
  if (request?.assetId) await registerBundledTextFontByAssetId(registry, request.assetId);
  if (!request?.assetId && request?.family) {
    await registerBundledTextFontForSettings(registry, {
      ...fallback, family: request.family, style: request.style ?? 'Regular'
    });
  }
  if (!request) await registerBundledTextFontForSettings(registry, fallback);
  const available = registry.availableAssets;
  const asset = request?.assetId
    ? available.find(({ assetId }) => assetId === request.assetId)
    : resolveTextToolFont(available, request?.family
      ? { family: request.family, style: request.style ?? 'Regular' }
      : fallback);
  if (!asset) throw new Error(`The requested font${request?.family ? ` “${request.family}”` : ''} is unavailable; no text was changed.`);
  return asset;
};

const patches = async (
  registry: DocumentFontRegistry,
  style: SemanticTextStylePatch | undefined,
  fallback: TextToolSettings
): Promise<{ style: TextStylePatch; font: DocumentFontAsset | null }> => {
  const font = style?.font ? await resolveFont(registry, style.font, fallback) : null;
  const result: TextStylePatch = {
    ...(font ? textFontPatch(font) : {}),
    ...(style?.fontSize === undefined ? {} : { fontSize: style.fontSize }),
    ...(style?.fontWeight === undefined ? {} : { fontWeight: style.fontWeight }),
    ...(style?.fontStyle === undefined ? {} : { fontStyle: style.fontStyle }),
    ...(style?.syntheticBold === undefined ? {} : { syntheticBold: style.syntheticBold }),
    ...(style?.syntheticItalic === undefined ? {} : { syntheticItalic: style.syntheticItalic }),
    ...(style?.tracking === undefined ? {} : { tracking: style.tracking }),
    ...(style?.underline === undefined ? {} : { underline: style.underline })
  };
  if (style?.fill) Object.assign(result, style.fill.enabled
    ? textFillPatchFromHex(style.fill.color ?? '#000000') ?? {}
    : textFillEnabledPatch(false));
  if (style?.stroke) Object.assign(result, style.stroke.enabled
    ? textStrokePatch(style.stroke.color ?? '#000000', style.stroke.width ?? 1) ?? {}
    : { stroke: undefined });
  return { style: result, font };
};

const paragraphPatch = (command: Extract<SemanticTextCommand, { kind: 'create' | 'format' }>): ParagraphStylePatch => {
  const patch = command.paragraph;
  if (!patch) return {};
  return { ...(patch.alignment ? { alignment: patch.alignment } : {}),
    ...(patch.direction ? { direction: patch.direction } : {}),
    ...(patch.leading ? { lineHeight: patch.leading === 'normal'
      ? { kind: 'normal' as const }
      : { kind: patch.leading.kind ?? 'absolute', value: patch.leading.value } } : {}),
    ...(patch.firstLineIndent === undefined ? {} : { firstLineIndent: patch.firstLineIndent }),
    ...(patch.startIndent === undefined ? {} : { startIndent: patch.startIndent }),
    ...(patch.endIndent === undefined ? {} : { endIndent: patch.endIndent }),
    ...(patch.spaceBefore === undefined ? {} : { spaceBefore: patch.spaceBefore }),
    ...(patch.spaceAfter === undefined ? {} : { spaceAfter: patch.spaceAfter }) };
};

const attachFont = (document: ImageDocument, font: DocumentFontAsset | null) => !font
  || document.assets.fonts.some(({ assetId }) => assetId === font.assetId) ? document : {
    ...document, assets: { ...document.assets, fonts: [...document.assets.fonts, structuredClone(font)] }
  };

const applyFormat = async (
  document: ImageDocument,
  command: Extract<SemanticTextCommand, { kind: 'format' }>,
  dependencies: SemanticTextCommandDependencies
): Promise<{ document: ImageDocument; font: DocumentFontAsset | null }> => {
  const layer = findDocumentLayer(document, command.layerId as LayerId);
  if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return { document, font: null };
  const resolved = await patches(dependencies.fontRegistry, command.style, dependencies.getTextSettings());
  const selection = command.start === undefined ? null : { anchor: command.start, focus: command.end! };
  const changed = applyTextLayerDataMutation(document, layer.id, { ...layer.text,
    source: formatFlowTextSource(layer.text.source, selection, resolved.style, paragraphPatch(command)) });
  return { document: attachFont(changed, resolved.font), font: resolved.font };
};

export const executeSemanticTextCommand = async (
  command: SemanticTextCommand,
  dependencies: SemanticTextCommandDependencies
): Promise<{ readonly layerId: LayerId; readonly fontStatus?: unknown } | null> => {
  const before = dependencies.getDocument();
  if (!before) return null;
  let after = before;
  let fontStatus: unknown;
  if (command.kind === 'create') {
    const settings = dependencies.getTextSettings();
    const font = await resolveFont(dependencies.fontRegistry, command.style?.font, settings);
    const authoredSettings: TextToolSettings = { ...settings,
      family: font.familyNames[0] ?? font.postScriptName ?? settings.family,
      style: font.styleName, size: command.style?.fontSize ?? settings.size,
      alignment: command.paragraph?.alignment ?? settings.alignment,
      fillEnabled: command.style?.fill?.enabled ?? settings.fillEnabled };
    after = command.mode === 'point'
      ? createPointTextDocument(before, { documentId: before.id, origin: command.origin, text: command.text },
          authoredSettings, font, command.style?.fill?.color ?? dependencies.getForegroundColor(), command.writingMode)
      : command.mode === 'paragraph'
        ? createParagraphTextDocument(before, { documentId: before.id, pointerId: null,
          aboveLayerId: before.activeLayerId, start: command.origin,
          end: { x: command.origin.x + command.frame!.width, y: command.origin.y + command.frame!.height },
          text: command.text }, authoredSettings, font,
          command.style?.fill?.color ?? dependencies.getForegroundColor(), command.writingMode)
        : createPathTextDocument(before, {
          documentId: before.id, origin: command.origin, text: command.text
        }, {
          pathLayerId: command.path!.layerId as LayerId,
          pathElementId: command.path!.elementId,
          pathSubpathId: command.path!.subpathId
        }, authoredSettings, font,
        command.style?.fill?.color ?? dependencies.getForegroundColor(), {
          startOffset: command.path!.startOffset,
          side: command.path!.side,
          upright: command.path!.upright,
          direction: command.path!.direction
        });
    if (after === before) return null;
    const createdId = after.activeLayerId;
    if (!createdId) return null;
    if (command.name) after = renameLayer(after, createdId, command.name);
    const created = findDocumentLayer(after, createdId);
    if (created?.type === 'text' && created.text.source.kind === 'flow') {
      const resolved = await patches(dependencies.fontRegistry, command.style, authoredSettings);
      after = applyTextLayerDataMutation(after, createdId, { ...created.text,
        source: formatFlowTextSource(created.text.source, null, resolved.style, paragraphPatch(command)) });
    }
    fontStatus = { kind: 'exact', assetId: font.assetId, family: font.familyNames[0], style: font.styleName };
  } else if (command.kind === 'replace') {
    const layer = findDocumentLayer(before, command.layerId as LayerId);
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return null;
    const edit = replaceFlowTextSelection(layer.text.source,
      { anchor: command.start, focus: command.end }, command.text);
    after = applyTextLayerDataMutation(before, layer.id, { ...layer.text, source: edit.source });
  } else if (command.kind === 'format') {
    const formatted = await applyFormat(before, command, dependencies);
    after = formatted.document;
    if (formatted.font) fontStatus = { kind: 'exact', assetId: formatted.font.assetId,
      family: formatted.font.familyNames[0], style: formatted.font.styleName };
  } else {
    const layer = findDocumentLayer(before, command.layerId as LayerId);
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') return null;
    let layout = layer.text.source.layout;
    const writingMode = command.writingMode ?? (layout.mode === 'path' ? 'horizontal-tb' : layout.writingMode);
    if (command.mode === 'point' || (command.origin && layout.mode === 'point')) {
      layout = { mode: 'point', origin: command.origin ?? (layout.mode === 'point' ? layout.origin : {
        x: layout.mode === 'paragraph' ? layout.frame.x : 0, y: layout.mode === 'paragraph' ? layout.frame.y : 0
      }), writingMode };
    } else if (command.mode === 'paragraph' || command.frame || layout.mode === 'paragraph') {
      const frame = command.frame ?? (layout.mode === 'paragraph' ? layout.frame : {
        x: layout.mode === 'point' ? layout.origin.x : 0, y: layout.mode === 'point' ? layout.origin.y : 0,
        width: 240, height: 120
      });
      layout = { mode: 'paragraph', frame, overflow: layout.mode === 'paragraph' ? layout.overflow : 'indicator', writingMode };
    }
    after = setFlowTextLayout(before, layer.id, layout);
    if (command.transform) after = setTextLayerTransform(after, layer.id, command.transform);
  }
  if (after === before) return null;
  dependencies.applyDocument(after);
  dependencies.recordHistory(before, after);
  const resultLayerId = command.kind === 'create' ? after.activeLayerId! : command.layerId as LayerId;
  return { layerId: resultLayerId,
    ...(fontStatus ? { fontStatus } : {}) };
};
