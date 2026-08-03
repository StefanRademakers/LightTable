import {
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  type RgbaColor
} from '@lighttable/text-core';
import { createTextLayer, setLayerTransform } from '../../editor/document/documentCommands';
import type {
  DocumentFontAsset,
  ImageDocument
} from '../../editor/document/documentTypes';
import type { TextToolSettings } from '../../editor/session/editorSession';
import { findLayerNode } from '../../editor/document/layerTree';
import {
  buildSceneTransformIndex,
  documentPointToLocal
} from '../../editor/document/sceneTransformGraph';
import { translationMatrix } from '../../editor/geometry/affine';

export interface PointTextCreationRequest {
  readonly documentId: ImageDocument['id'];
  readonly origin: { readonly x: number; readonly y: number };
  readonly text: string;
}

export interface PointTextCreationSnapshot {
  readonly status: 'idle' | 'editing';
  readonly request: PointTextCreationRequest | null;
}

export const resolveTextToolFont = (
  fonts: readonly DocumentFontAsset[],
  settings: Pick<TextToolSettings, 'family' | 'style'>
) => [...fonts]
  .sort((left, right) =>
    left.styleName.localeCompare(right.styleName)
    || left.fingerprintSha256.localeCompare(right.fingerprintSha256)
    || left.faceIndex - right.faceIndex
    || left.assetId.localeCompare(right.assetId)
  )
  .find((font) =>
    font.familyNames.includes(settings.family)
    && font.styleName === settings.style
  ) ?? null;

export const defaultTextStyleForFamily = (
  fonts: readonly DocumentFontAsset[],
  family: string
) => resolveTextToolFont(
  fonts.filter((font) => font.familyNames.includes(family)),
  { family, style: 'Regular' }
)?.styleName ?? [...fonts]
  .filter((font) => font.familyNames.includes(family))
  .sort((left, right) =>
    left.styleName.localeCompare(right.styleName)
    || left.fingerprintSha256.localeCompare(right.fingerprintSha256)
    || left.assetId.localeCompare(right.assetId)
  )[0]?.styleName ?? null;

export class PointTextCreationController {
  private snapshot: PointTextCreationSnapshot = { status: 'idle', request: null };
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(documentId: ImageDocument['id'], origin: PointTextCreationRequest['origin']) {
    this.snapshot = {
      status: 'editing',
      request: { documentId, origin: { ...origin }, text: 'Text' }
    };
    this.emit();
  }

  update(text: string) {
    if (!this.snapshot.request) return false;
    this.snapshot = {
      status: 'editing',
      request: { ...this.snapshot.request, text }
    };
    this.emit();
    return true;
  }

  commit(): PointTextCreationRequest | null {
    const request = this.snapshot.request;
    this.cancel();
    return request?.text.length ? request : null;
  }

  cancel() {
    if (!this.snapshot.request) return false;
    this.snapshot = { status: 'idle', request: null };
    this.emit();
    return true;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

const colorFromHex = (hex: string): RgbaColor => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 };
  return {
    colorSpace: 'srgb',
    r: Number.parseInt(match[1]!, 16) / 255,
    g: Number.parseInt(match[2]!, 16) / 255,
    b: Number.parseInt(match[3]!, 16) / 255,
    a: 1
  };
};

export const createPointTextDocument = (
  document: ImageDocument,
  request: PointTextCreationRequest,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string
): ImageDocument => {
  if (request.documentId !== document.id) return document;
  const anchor = document.activeLayerId
    ? findLayerNode(document.layers, document.activeLayerId)
    : null;
  const parentPoint = anchor?.parentId
    ? documentPointToLocal(
        buildSceneTransformIndex(document).get(anchor.parentId)!,
        request.origin
      )
    : request.origin;
  if (!parentPoint) return document;
  const source = createDefaultFlowTextSource(request.text);
  const preferredAsset = {
    assetId: font.assetId,
    faceIndex: font.faceIndex,
    fingerprintSha256: font.fingerprintSha256,
    source: font.source,
    container: font.container,
    outline: font.outline,
    postScriptName: font.postScriptName,
    embedding: { ...font.embedding }
  };
  const text = {
    ...createDefaultTextLayerData(),
    source: {
      ...source,
      layout: {
        mode: 'point' as const,
        origin: { x: 0, y: 0 },
        writingMode: 'horizontal-tb' as const
      },
      styleRuns: source.styleRuns.map((run) => ({
        ...run,
        requestedFont: {
          families: [font.familyNames[0] ?? settings.family],
          postScriptName: font.postScriptName,
          preferredAsset
        },
        fontSize: settings.size,
        fontWeight: font.weight,
        fontStyle: font.italic ? 'italic' as const : 'normal' as const,
        fontStretch: font.stretch,
        fill: { kind: 'solid' as const, color: colorFromHex(foregroundColor) }
      })),
      paragraphRuns: source.paragraphRuns.map((run) => ({
        ...run,
        alignment: settings.alignment
      }))
    }
  };
  const inserted = createTextLayer(document, text, request.text.slice(0, 40) || 'Text');
  const withLayer = inserted.activeLayerId
    ? setLayerTransform(
        inserted,
        inserted.activeLayerId,
        translationMatrix(parentPoint.x, parentPoint.y)
      )
    : inserted;
  if (withLayer.assets.fonts.some(({ assetId }) => assetId === font.assetId)) return withLayer;
  return {
    ...withLayer,
    assets: {
      ...withLayer.assets,
      fonts: [...withLayer.assets.fonts, structuredClone(font)]
    }
  };
};
