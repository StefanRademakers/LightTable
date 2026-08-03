import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  createTextLayerNode,
  type DocumentFontAsset
} from '../../editor/document/documentTypes';
import { TextLayerRenderCoordinator, type TextFontRuntimePort } from './TextLayerRenderCoordinator';

const asset: DocumentFontAsset = {
  assetId: 'font-1',
  fingerprintSha256: 'a'.repeat(64),
  faceIndex: 0,
  postScriptName: 'Fixture-Regular',
  source: 'document',
  container: 'sfnt',
  outline: 'truetype',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false },
  familyNames: ['Fixture'],
  styleName: 'Regular',
  weight: 400,
  stretch: 100,
  italic: false,
  byteLength: 4
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const harness = () => {
  const publish = vi.fn(() => ({}));
  const discard = vi.fn();
  const prepareTightSource = vi.fn(() => ({ publish, discard }));
  const renderer = {
    sync: vi.fn(),
    snapshot: vi.fn(() => ({ publicationRevision: 0 })),
    dispose: vi.fn(),
    resolve: vi.fn(() => null),
    release: vi.fn(() => false),
    thumbnailSource: vi.fn(() => null),
    prepareTightSource
  };
  const client = {
    registerFontDetailed: vi.fn(async () => ({ metrics: {} })),
    realizeTextDetailed: vi.fn(async () => ({
      layout: { key: 'layout', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    })),
    rasterizeGlyph: vi.fn(),
    releaseSession: vi.fn(async () => undefined)
  };
  const backend = {
    lookupGlyph: vi.fn(),
    prepareGlyph: vi.fn(),
    encode: vi.fn(),
    retireSubmittedResources: vi.fn(async () => undefined),
    dispose: vi.fn()
  };
  const submit = vi.fn();
  const coordinator = new TextLayerRenderCoordinator({
    device: {
      createCommandEncoder: vi.fn(() => ({ finish: vi.fn(() => ({})) })),
      queue: { submit }
    } as unknown as GPUDevice,
    renderer: renderer as never,
    requestRender: vi.fn(),
    loadDependencies: vi.fn(async () => ({ client, backend } as never))
  });
  const port: TextFontRuntimePort = {
    revision: 1,
    assets: [asset],
    bytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    subscribe: vi.fn(() => () => undefined)
  };
  return { coordinator, renderer, client, backend, submit, port, publish, discard };
};

describe('TextLayerRenderCoordinator', () => {
  it('is inert without visible canonical text', async () => {
    const state = harness();
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(createImageDocument('Raster', 32, 24, 'source'));
    await flush();

    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('prepares one atomic source and deduplicates unchanged documents', async () => {
    const state = harness();
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledOnce();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();
    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();

    state.coordinator.sync(document);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
  });

  it('invalidates queued work when text becomes hidden', async () => {
    const state = harness();
    let resolveLayout!: (value: unknown) => void;
    state.client.realizeTextDetailed.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLayout = resolve;
    }) as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.sync({ ...document, layers: [{ ...layer, visible: false }] });
    resolveLayout({
      layout: { key: 'stale', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    });
    await flush();

    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('drops delayed work when the font port is detached', async () => {
    const state = harness();
    let resolveLayout!: (value: unknown) => void;
    state.client.realizeTextDetailed.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLayout = resolve;
    }) as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.configureFonts(null);
    resolveLayout({ layout: { key: 'stale', glyphRuns: [] } });
    await flush();

    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.renderer.dispose).toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('does not publish a candidate when queue submission fails', async () => {
    const state = harness();
    state.submit.mockImplementation(() => { throw new Error('device lost'); });
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    expect(state.discard).toHaveBeenCalledTimes(2);
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('releases a failed candidate font session and permits an exact retry', async () => {
    const state = harness();
    state.client.registerFontDetailed
      .mockRejectedValueOnce(new Error('bad font transfer'))
      .mockResolvedValueOnce({ metrics: {} } as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.sync(document);
    await flush();

    expect(state.client.registerFontDetailed).toHaveBeenCalledTimes(2);
    expect(state.client.releaseSession).toHaveBeenCalled();
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('rechecks ownership after asynchronously releasing a previous document session', async () => {
    const state = harness();
    const first = createImageDocument('First', 32, 24, 'source');
    first.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(first);
    await flush();
    expect(state.publish).toHaveBeenCalledOnce();

    let finishRelease!: () => void;
    state.client.releaseSession.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      finishRelease = () => resolve(undefined);
    }));
    const second = { ...first, id: 'second-document' as typeof first.id };
    state.coordinator.sync(second);
    await flush();
    state.coordinator.configureFonts(null);
    finishRelease();
    await flush();

    expect(state.publish).toHaveBeenCalledOnce();
    expect(state.renderer.dispose).toHaveBeenCalled();
    expect(state.client.releaseSession.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
