import {
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  type FlowTextLayout,
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

export interface ParagraphTextCreationRequest {
  readonly documentId: ImageDocument['id'];
  readonly pointerId: number | null;
  readonly aboveLayerId: ImageDocument['activeLayerId'];
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly text: string;
}

export interface ParagraphTextCreationSnapshot {
  readonly status: 'idle' | 'dragging' | 'editing';
  readonly request: ParagraphTextCreationRequest | null;
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

export class ParagraphTextCreationController {
  private snapshot: ParagraphTextCreationSnapshot = { status: 'idle', request: null };
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(
    documentId: ImageDocument['id'],
    aboveLayerId: ImageDocument['activeLayerId'],
    pointerId: number,
    start: ParagraphTextCreationRequest['start']
  ) {
    if (this.snapshot.status !== 'idle') return false;
    this.snapshot = {
      status: 'dragging',
      request: {
        documentId,
        aboveLayerId,
        pointerId,
        start: { ...start },
        end: { ...start },
        text: 'Text'
      }
    };
    this.emit();
    return true;
  }

  owns(pointerId: number) {
    return this.snapshot.status === 'dragging'
      && this.snapshot.request?.pointerId === pointerId;
  }

  move(pointerId: number, end: ParagraphTextCreationRequest['end']) {
    if (!this.owns(pointerId) || !this.snapshot.request) return false;
    this.snapshot = {
      status: 'dragging',
      request: { ...this.snapshot.request, end: { ...end } }
    };
    this.emit();
    return true;
  }

  finish(pointerId: number) {
    if (!this.owns(pointerId) || !this.snapshot.request) return false;
    const request = this.snapshot.request;
    const width = Math.abs(request.end.x - request.start.x);
    const height = Math.abs(request.end.y - request.start.y);
    this.snapshot = {
      status: 'editing',
      request: {
        ...request,
        pointerId: null,
        end: {
          x: width >= 1 ? request.end.x : request.start.x + 240,
          y: height >= 1 ? request.end.y : request.start.y + 120
        }
      }
    };
    this.emit();
    return true;
  }

  update(text: string) {
    if (this.snapshot.status !== 'editing' || !this.snapshot.request) return false;
    this.snapshot = {
      status: 'editing',
      request: { ...this.snapshot.request, text }
    };
    this.emit();
    return true;
  }

  commit(): ParagraphTextCreationRequest | null {
    if (this.snapshot.status !== 'editing') return null;
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

const createAuthoredFlowTextData = (
  value: string,
  layout: FlowTextLayout,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string
) => {
  const source = createDefaultFlowTextSource(value);
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
  return {
    ...createDefaultTextLayerData(),
    source: {
      ...source,
      layout,
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
};

const attachFontAsset = (
  document: ImageDocument,
  font: DocumentFontAsset
): ImageDocument => document.assets.fonts.some(({ assetId }) => assetId === font.assetId)
  ? document
  : {
      ...document,
      assets: {
        ...document.assets,
        fonts: [...document.assets.fonts, structuredClone(font)]
      }
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
  const text = createAuthoredFlowTextData(
    request.text,
    {
        mode: 'point' as const,
        origin: { x: 0, y: 0 },
        writingMode: 'horizontal-tb' as const
    },
    settings,
    font,
    foregroundColor
  );
  const inserted = createTextLayer(document, text, request.text.slice(0, 40) || 'Text');
  const withLayer = inserted.activeLayerId
    ? setLayerTransform(
        inserted,
        inserted.activeLayerId,
        translationMatrix(parentPoint.x, parentPoint.y)
      )
    : inserted;
  return attachFontAsset(withLayer, font);
};

export const createParagraphTextDocument = (
  document: ImageDocument,
  request: ParagraphTextCreationRequest,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string
): ImageDocument => {
  if (request.documentId !== document.id) return document;
  const anchor = request.aboveLayerId
    ? findLayerNode(document.layers, request.aboveLayerId)
    : null;
  const parentTransform = anchor?.parentId
    ? buildSceneTransformIndex(document).get(anchor.parentId)
    : null;
  const start = parentTransform
    ? documentPointToLocal(parentTransform, request.start)
    : request.start;
  const end = parentTransform
    ? documentPointToLocal(parentTransform, request.end)
    : request.end;
  if (!start || !end) return document;
  const origin = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 1 || height < 1) return document;
  const text = createAuthoredFlowTextData(
    request.text,
    {
      mode: 'paragraph',
      frame: { x: 0, y: 0, width, height },
      overflow: 'indicator',
      writingMode: 'horizontal-tb'
    },
    settings,
    font,
    foregroundColor
  );
  const inserted = createTextLayer(
    document,
    text,
    request.text.slice(0, 40) || 'Text',
    request.aboveLayerId
  );
  const positioned = inserted.activeLayerId
    ? setLayerTransform(
        inserted,
        inserted.activeLayerId,
        translationMatrix(origin.x, origin.y)
      )
    : inserted;
  return attachFontAsset(positioned, font);
};
