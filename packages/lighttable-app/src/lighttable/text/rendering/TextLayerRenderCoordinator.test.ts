import {
  CONTRACT_FIXTURE_FONT_INSTANCE,
  TEXT_LAYOUT_SCHEMA_VERSION,
  createDefaultTextLayerData
} from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  createTextLayerNode,
  type DocumentFontAsset
} from '../../editor/document/documentTypes';
import { TextLayerRenderCoordinator, type TextFontRuntimePort } from './TextLayerRenderCoordinator';
import type { TextSourceCostSample } from './TextSourceCostModel';
import { setFlowTextContent, setTextLayerTransform } from '../../editor/document/textLayerCommands';

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
  let costObserver: ((sample: TextSourceCostSample) => void) | null = null;
  const publish = vi.fn(() => ({}));
  const discard = vi.fn();
  const prepareTightSource = vi.fn(() => ({ publish, discard }));
  const prepareAtlasSource = vi.fn(() => ({ publish, discard }));
  const renderer = {
    sync: vi.fn(),
    setVisibleLayerIds: vi.fn(),
    snapshot: vi.fn(() => ({
      publicationRevision: 0,
      textureBytes: 0,
      cacheBudgetBytes: 256 * 1024 * 1024
    })),
    dispose: vi.fn(),
    resolve: vi.fn(() => ({})),
    hasExactSource: vi.fn(() => true),
    isTransparent: vi.fn(() => false),
    markTransparent: vi.fn(() => false),
    release: vi.fn(() => false),
    thumbnailSource: vi.fn(() => null),
    setCostObserver: vi.fn((observer: ((sample: TextSourceCostSample) => void) | null) => {
      costObserver = observer;
    }),
    prepareAtlasSource,
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
    retainGlyphs: vi.fn(() => vi.fn()),
    metrics: vi.fn(() => ({
      allocatedBytes: 0, hits: 0, misses: 0, evictions: 0
    })),
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
  return {
    coordinator, renderer, client, backend, submit, port, publish, discard,
    observeCost: (sample: TextSourceCostSample) => costObserver?.(sample)
  };
};

describe('TextLayerRenderCoordinator', () => {
  it('feeds renderer work samples into the document-local source policy', () => {
    const state = harness();
    state.observeCost({
      phase: 'atlas-composite', durationMs: 0.5, glyphCount: 10, pixelCount: 100
    });
    expect(state.coordinator.snapshot().sourceDecisionMeasurements).toBe(1);
  });

  it('is inert without visible canonical text', async () => {
    const state = harness();
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(createImageDocument('Raster', 32, 24, 'source'));
    await flush();

    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('does no worker or GPU work while suspended and resumes the latest document', async () => {
    const state = harness();
    const document = createImageDocument('Background text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.setActive(false);
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.client.registerFontDetailed).not.toHaveBeenCalled();
    expect(state.client.realizeTextDetailed).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();

    state.coordinator.setActive(true);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
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
    expect(state.coordinator.editingLayout(document.layers[0]!.id)).toMatchObject({
      layerId: document.layers[0]!.id,
      layout: { key: 'layout' }
    });

    state.coordinator.sync(document);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledOnce();
  });

  it('publishes small eligible text as a retained direct atlas plan without a private submit', async () => {
    const state = harness();
    state.client.realizeTextDetailed.mockResolvedValueOnce({
      layout: {
        schemaVersion: TEXT_LAYOUT_SCHEMA_VERSION,
        key: 'direct-layout',
        glyphRuns: [{
          font: CONTRACT_FIXTURE_FONT_INSTANCE, fontSize: 16,
          fontResolution: { kind: 'positioned-exact', sourceRunIndex: 0 },
          paint: { fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } } },
          renderingMode: 'fill', direction: 'ltr',
          glyphIds: new Uint32Array([7]), clusters: new Uint32Array([0]),
          geometry: new Float32Array([2, 12, 10, 0])
        }],
        lines: [], caretStops: [], selectionGeometry: [], clusterMap: [],
        inkBounds: { x: 2, y: 0, width: 10, height: 16 },
        logicalBounds: { x: 2, y: 0, width: 10, height: 16 }, warnings: []
      }, metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    } as never);
    state.backend.lookupGlyph.mockReturnValue({
      placement: {
        serializedKey: 'glyph', pageId: 0, pageGeneration: 0, atlasGeneration: 0,
        x: 0, y: 0, width: 10, height: 16, empty: false
      }, bearingX: 0, bearingY: 12
    });
    const document = createImageDocument('Direct text', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.renderer.prepareAtlasSource).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.publish).toHaveBeenCalledOnce();
  });

  it('reuses realized geometry but redraws a paint-only text update', async () => {
    const state = harness();
    const document = createImageDocument('Text paint', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    const layer = document.layers[0]!;
    if (layer.type !== 'text' || layer.text.source.kind !== 'flow') {
      throw new Error('Expected flow text fixture.');
    }
    const source = layer.text.source;
    const repainted = setFlowTextContent(document, layer.id, source.text, source.styleRuns.map((run) => ({
      ...run,
      fill: { kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 } }
    })), source.paragraphRuns);
    state.coordinator.sync(repainted);
    await flush();

    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);
    expect(state.submit).toHaveBeenCalledTimes(2);
  });

  it('skips exact settled siblings when one visible text layer changes', async () => {
    const state = harness();
    const document = createImageDocument('Text siblings', 32, 24, 'source');
    document.layers = [
      createTextLayerNode(createDefaultTextLayerData(), 'First'),
      createTextLayerNode(createDefaultTextLayerData(), 'Second')
    ];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(2);
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);

    const first = document.layers[0]!;
    if (first.type !== 'text' || first.text.source.kind !== 'flow') {
      throw new Error('Expected flow text fixture.');
    }
    const changed = setFlowTextContent(
      document,
      first.id,
      first.text.source.text,
      first.text.source.styleRuns.map((run) => ({ ...run, tracking: run.tracking + 1 })),
      first.text.source.paragraphRuns
    );
    state.coordinator.sync(changed);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledTimes(3);
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(3);
  });

  it('freezes source scale during an interaction and rebuilds once at settle', async () => {
    const state = harness();
    const document = createImageDocument('Interactive transform', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();

    state.coordinator.setLayerInteraction(layer.id, true);
    const transformed = setTextLayerTransform(document, layer.id, {
      a: 3, b: 0, c: 0, d: 3, tx: 12, ty: 8
    });
    expect(transformed.layers[0]?.transform).toMatchObject({ a: 3, d: 3 });
    state.coordinator.sync(transformed);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();
    expect(state.coordinator.editingLayout(layer.id)?.localToDocument).toMatchObject({
      a: 3, d: 3, tx: 12, ty: 8
    });

    state.coordinator.setLayerInteraction(layer.id, false);
    await state.coordinator.waitForSettledSource(layer.id);
    await flush();
    expect(state.client.realizeTextDetailed).toHaveBeenCalledOnce();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);
  });

  it('settles text prepared during an editing interaction after the interaction ends', async () => {
    const state = harness();
    const document = createImageDocument('Interactive text', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.setLayerInteraction(layer.id, true);
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledOnce();

    state.coordinator.setLayerInteraction(layer.id, false);
    await flush();
    expect(state.renderer.prepareTightSource).toHaveBeenCalledTimes(2);
    expect(state.submit).toHaveBeenCalledTimes(2);
  });

  it('correlates a text input with the exact source submitted by the document frame', async () => {
    const state = harness();
    const document = createImageDocument('Input latency', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    if (layer.text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');

    state.coordinator.beginTextInput(layer.id, 10);
    const nextText = `${layer.text.source.text}x`;
    const styleRuns = layer.text.source.styleRuns.map((run, index, runs) => (
      index === runs.length - 1 ? { ...run, end: nextText.length } : run
    ));
    const paragraphRuns = layer.text.source.paragraphRuns.map((run, index, runs) => (
      index === runs.length - 1 ? { ...run, end: nextText.length } : run
    ));
    const changed = setFlowTextContent(
      document,
      layer.id,
      nextText,
      styleRuns,
      paragraphRuns
    );
    state.coordinator.sync(changed);
    await flush();
    const submitted = state.coordinator.markFrameSubmitted(changed, 24);
    expect(submitted).toHaveLength(1);
    state.coordinator.markFrameGpuComplete(submitted, 31);
    expect(state.coordinator.snapshot()).toMatchObject({
      textInputLatencySamples: 1,
      pendingTextInputs: 0,
      inputToSubmitP95Ms: 14,
      inputToGpuP95Ms: 21
    });
  });

  it('publishes editing geometry even when source preparation fails afterward', async () => {
    const state = harness();
    state.renderer.prepareTightSource.mockImplementation(() => {
      throw new Error('allocation failed');
    });
    const document = createImageDocument('Editing geometry', 32, 24, 'source');
    document.layers = [createTextLayerNode(createDefaultTextLayerData(), 'Text')];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    expect(state.coordinator.editingLayout(document.layers[0]!.id)).toMatchObject({
      layerId: document.layers[0]!.id,
      layout: { key: 'layout' }
    });
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('invalidates queued work when text becomes hidden', async () => {
    const state = harness();
    let resolveLayout!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    state.client.realizeTextDetailed.mockImplementationOnce((...args: unknown[]) => new Promise((resolve) => {
      signal = args[1] as AbortSignal | undefined;
      resolveLayout = resolve;
    }) as never);
    const document = createImageDocument('Text', 32, 24, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    state.coordinator.configureFonts(state.port);
    state.coordinator.sync(document);
    await flush();
    state.coordinator.sync({ ...document, layers: [{ ...layer, visible: false }] });
    expect(signal?.aborted).toBe(true);
    resolveLayout({
      layout: { key: 'stale', glyphRuns: [] },
      metrics: {}, roundTripDurationMs: 0, responseTransferBytes: 0
    });
    await flush();

    expect(state.renderer.prepareTightSource).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.coordinator.editingLayout(layer.id)).toBeNull();
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
    expect(state.coordinator.editingLayout(document.layers[0]!.id)).toBeNull();
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
