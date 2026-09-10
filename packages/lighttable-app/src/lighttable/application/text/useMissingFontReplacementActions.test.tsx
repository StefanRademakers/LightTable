import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { textFontSourceIdentity } from '../../text/fonts/textLayerFontStatus';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { useMissingFontReplacementActions } from './useMissingFontReplacementActions';

const fontMock = vi.hoisted(() => ({
  resolve: vi.fn<(registry: DocumentFontRegistry, assetId: string) => Promise<DocumentFontAsset | null>>()
}));

vi.mock('../../text/fonts/bundledTextFont', () => ({
  registerBundledTextFontByAssetId: fontMock.resolve
}));

const replacement: DocumentFontAsset = {
  assetId: 'replacement', faceIndex: 0, fingerprintSha256: 'a'.repeat(64), source: 'bundled',
  container: 'woff2', outline: 'truetype',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Replacement'], postScriptName: 'Replacement-Regular', styleName: 'Regular',
  weight: 400, stretch: 100, italic: false, byteLength: 1024
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
};

const setup = (initial?: ImageDocument) => {
  let document: ImageDocument = initial ?? createImageDocument('A', 32, 32, 'transparent');
  let preview = document;
  const history: unknown[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: (next) => { document = next; preview = next; },
    previewSnapshot: (next) => { preview = next; },
    discardPreview: () => { preview = document; },
    pushHistoryEntry: (entry) => history.push(entry)
  }));
  const registry = { availableAssets: [] } as unknown as DocumentFontRegistry;
  let actions!: ReturnType<typeof useMissingFontReplacementActions>;
  const View = () => {
    actions = useMissingFontReplacementActions({
      documentId: document.id,
      getDocument: () => document,
      registry,
      substitutionFamilies: [],
      documentMutations: mutations,
      closeRecovery: vi.fn(), requestRecovery: vi.fn(), beginEditing: vi.fn(),
      setStatus: vi.fn(), setError: vi.fn()
    });
    return null;
  };
  renderToString(createElement(View));
  return {
    actions, mutations, history,
    get document() { return document; },
    set document(next) { document = next; preview = next; },
    get preview() { return preview; }
  };
};

describe('useMissingFontReplacementActions document admission', () => {
  beforeEach(() => fontMock.resolve.mockReset());

  it('rejects a deferred preview after switching to another document', async () => {
    const asset = deferred<DocumentFontAsset | null>();
    fontMock.resolve.mockReturnValue(asset.promise);
    const state = setup();
    const pending = state.actions.preview('missing' as never, 'replacement', 'source', null);
    const other = createImageDocument('B', 32, 32, 'transparent');
    state.document = other;
    asset.resolve(replacement);
    await pending;
    expect(state.document).toBe(other);
    expect(state.preview).toBe(other);
    expect(state.mutations.active).toBe(false);
    expect(state.history).toHaveLength(0);
  });

  it('rejects a deferred preview after same-id canonical replacement', async () => {
    const asset = deferred<DocumentFontAsset | null>();
    fontMock.resolve.mockReturnValue(asset.promise);
    const state = setup();
    const pending = state.actions.preview('missing' as never, 'replacement', 'source', null);
    const replacementDocument = { ...state.document };
    state.document = replacementDocument;
    asset.resolve(replacement);
    await pending;
    expect(state.document).toBe(replacementDocument);
    expect(state.preview).toBe(replacementDocument);
    expect(state.mutations.active).toBe(false);
  });

  it('cancels the transaction when a resolved preview is a no-op', async () => {
    fontMock.resolve.mockResolvedValue(replacement);
    const state = setup();
    await state.actions.preview('missing' as never, 'replacement', 'source', null);
    expect(state.mutations.active).toBe(false);
    expect(state.history).toHaveLength(0);
  });

  it('replaces an existing staged preview without cancelling its lease', async () => {
    const document = createTextLayer(
      createImageDocument('Fonts', 120, 80, 'transparent'),
      createDefaultTextLayerData(),
      'Text'
    );
    const layerId = document.activeLayerId!;
    const layer = findDocumentLayer(document, layerId);
    if (layer?.type !== 'text' || layer.text.source.kind !== 'flow') {
      throw new Error('Expected editable text.');
    }
    const sourceIdentity = textFontSourceIdentity(layer.text.source.styleRuns[0]!);
    const second = { ...replacement, assetId: 'second', fingerprintSha256: 'b'.repeat(64),
      familyNames: ['Second'], postScriptName: 'Second-Regular' };
    fontMock.resolve.mockImplementation(async (_registry, assetId) => (
      assetId === 'second' ? second : replacement
    ));
    const state = setup(document);

    await state.actions.preview(layerId, 'replacement', sourceIdentity, null);
    await state.actions.preview(layerId, 'second', sourceIdentity, null);

    const previewLayer = findDocumentLayer(state.preview, layerId);
    expect(previewLayer?.type === 'text' && previewLayer.text.source.kind === 'flow'
      ? previewLayer.text.source.styleRuns[0]?.requestedFont.preferredAsset?.assetId
      : null).toBe('second');
    expect(state.mutations.active).toBe(true);
    state.actions.cancelPreview();
    expect(state.mutations.active).toBe(false);
    expect(state.preview).toBe(document);
  });
});
