import { describe, expect, it, vi } from 'vitest';
import { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import { DocumentStartupTelemetry } from '../../application/telemetry/documentStartupTelemetry';
import { createDocumentRendererLifecycleBridge } from './createDocumentRendererLifecycleBridge';
import { createInitialTextRenderPresentation, TextRenderPresentation } from '../../application/telemetry/TextRenderPresentation';

const canvases = {
  hueDistribution: {} as HTMLCanvasElement,
  colorMixerHueDistribution: {} as HTMLCanvasElement,
  parade: {} as HTMLCanvasElement,
  vectorscope: {} as HTMLCanvasElement
};

const createRenderer = () => ({
  setStartupTimeline: vi.fn(),
  setActive: vi.fn(),
  setLensBlurDepthVisualization: vi.fn(),
  setScopeOptions: vi.fn(),
  initializeScopes: vi.fn().mockResolvedValue(undefined),
  waitForPresentation: vi.fn().mockResolvedValue(undefined)
});

describe('createDocumentRendererLifecycleBridge', () => {
  it('passes the original open guard through deferred text presentation, including beforeOpen reset ordering', () => {
    const frames: (() => void)[] = [], trace = vi.fn();
    const presentation = new TextRenderPresentation({ request: callback => frames.push(callback), cancel: vi.fn() });
    presentation.connect(trace);
    let current = true;
    const isCurrent = () => current;
    const bridge = createDocumentRendererLifecycleBridge({
      isCurrent, telemetry: new DocumentStartupTelemetry(() => 0), lifecycle: new DocumentRendererLifecycle(),
      scopeCanvases: null,
      getScopeOptions: () => ({ histogramVisible: false, options: {
        hueDistributionVisible: false, paradeVisible: false, vectorscopeVisible: false,
        quality: 'medium', traceBrightness: 0.8, vectorscopeRange: 'all', vectorscopeZoom2x: false
      } }),
      publishTextRenderPresentation: presentation.receive,
      publishHistogram: vi.fn(), publishGpuMemory: vi.fn(), publishError: vi.fn(),
      publishScopeError: vi.fn(), publishFeatureError: vi.fn(), publishTimings: vi.fn(), publishLoading: vi.fn()
    });
    presentation.reset(); // Actual lifecycle constructs the bridge before beforeOpen.
    const snapshot = { ...createInitialTextRenderPresentation(), publicationRevision: 1, traceMessage: 'current' };
    bridge.callbacks.onTextRenderPresentation?.(snapshot); frames[0]!();
    expect(presentation.getSnapshot()).toBe(snapshot);
    expect(trace).toHaveBeenCalledOnce();
    bridge.callbacks.onTextRenderPresentation?.({ ...snapshot, publicationRevision: 2, traceMessage: 'retired' });
    current = false; frames[1]!();
    expect(presentation.getSnapshot()).toBe(snapshot);
    expect(trace).toHaveBeenCalledOnce();
    bridge.callbacks.onTextRenderPresentation?.(snapshot);
    expect(frames).toHaveLength(2);
  });

  it.each([true, false])('completes the first frame with scope surfaces present: %s', async (scopesPresent) => {
    let time = 10;
    const telemetry = new DocumentStartupTelemetry(() => time);
    telemetry.begin();
    const renderer = createRenderer();
    const publishTimings = vi.fn();
    const bridge = createDocumentRendererLifecycleBridge({
      isCurrent: () => true,
      telemetry,
      lifecycle: new DocumentRendererLifecycle(),
      scopeCanvases: scopesPresent ? canvases : null,
      getScopeOptions: () => ({
        histogramVisible: true,
        options: {
          hueDistributionVisible: true,
          paradeVisible: true,
          vectorscopeVisible: false,
          quality: 'medium',
          traceBrightness: 0.8,
          vectorscopeRange: 'all',
          vectorscopeZoom2x: false
        }
      }),
      publishHistogram: vi.fn(),
      publishGpuMemory: vi.fn(),
      publishError: vi.fn(),
      publishScopeError: vi.fn(),
      publishFeatureError: vi.fn(),
      publishTimings,
      publishLoading: vi.fn()
    });

    bridge.onRendererReady(renderer, 4);
    time = 20;
    bridge.callbacks.onFirstFrame?.();
    bridge.callbacks.onFirstFrame?.();
    await Promise.resolve();

    expect(renderer.setActive).toHaveBeenCalledWith(true);
    expect(renderer.setLensBlurDepthVisualization).toHaveBeenCalledWith(false);
    expect(renderer.setScopeOptions).toHaveBeenCalledTimes(2);
    expect(renderer.initializeScopes).toHaveBeenCalledTimes(scopesPresent ? 1 : 0);
    expect(publishTimings).toHaveBeenCalledTimes(scopesPresent ? 2 : 1);
  });

  it('publishes current open failures and rejects late events after replacement', () => {
    let current = true;
    const publishError = vi.fn();
    const publishOpenFailure = vi.fn();
    const publishLoading = vi.fn();
    const publishGpuMemory = vi.fn();
    const lifecycle = new DocumentRendererLifecycle();
    lifecycle.beginStart();
    const bridge = createDocumentRendererLifecycleBridge({
      isCurrent: () => current,
      telemetry: new DocumentStartupTelemetry(() => 0),
      lifecycle,
      scopeCanvases: canvases,
      getScopeOptions: () => ({
        histogramVisible: false,
        options: {
          hueDistributionVisible: true,
          paradeVisible: false,
          vectorscopeVisible: false,
          quality: 'medium',
          traceBrightness: 0.8,
          vectorscopeRange: 'all',
          vectorscopeZoom2x: false
        }
      }),
      publishHistogram: vi.fn(),
      publishGpuMemory,
      publishError,
      publishOpenFailure,
      publishScopeError: vi.fn(),
      publishFeatureError: vi.fn(),
      publishTimings: vi.fn(),
      publishLoading
    });

    bridge.onFailed(new Error('current failure'));
    expect(publishError).toHaveBeenCalledWith('current failure');
    expect(publishOpenFailure).toHaveBeenCalledWith('current failure');
    publishError.mockClear();
    publishOpenFailure.mockClear();
    current = false;
    bridge.callbacks.onGpuMemoryEstimate?.(100);
    bridge.callbacks.onDeviceLost?.('lost');
    bridge.onFailed(new Error('failed'));
    bridge.onSettled();

    expect(publishGpuMemory).not.toHaveBeenCalled();
    expect(publishError).not.toHaveBeenCalled();
    expect(publishOpenFailure).not.toHaveBeenCalled();
    expect(publishLoading).not.toHaveBeenCalled();
  });

  it('separates renderer failure from physical device loss while failing the generation', () => {
    const publishError = vi.fn();
    const lifecycle = new DocumentRendererLifecycle();
    const generation = lifecycle.beginStart();
    const bridge = createDocumentRendererLifecycleBridge({
      isCurrent: () => true,
      telemetry: new DocumentStartupTelemetry(() => 0),
      lifecycle,
      scopeCanvases: null,
      getScopeOptions: () => ({
        histogramVisible: false,
        options: {
          hueDistributionVisible: false, paradeVisible: false,
          vectorscopeVisible: false, quality: 'medium', traceBrightness: 0.8,
          vectorscopeRange: 'all', vectorscopeZoom2x: false
        }
      }),
      publishHistogram: vi.fn(), publishGpuMemory: vi.fn(), publishError,
      publishScopeError: vi.fn(), publishFeatureError: vi.fn(),
      publishTimings: vi.fn(), publishLoading: vi.fn()
    });

    bridge.callbacks.onRendererError?.('render validation failed');

    expect(publishError).toHaveBeenCalledWith('Rendering stopped. Technical details are shown on the canvas.');
    expect(lifecycle.getSnapshot()).toMatchObject({
      generation, status: 'failed', error: 'render validation failed'
    });
  });

  it('starts a background document renderer suspended', () => {
    const lifecycle = new DocumentRendererLifecycle();
    lifecycle.setActive(false);
    const renderer = createRenderer();
    const bridge = createDocumentRendererLifecycleBridge({
      isCurrent: () => true,
      telemetry: new DocumentStartupTelemetry(() => 0),
      lifecycle,
      scopeCanvases: canvases,
      getScopeOptions: () => ({
        histogramVisible: false,
        options: {
          hueDistributionVisible: true,
          paradeVisible: false,
          vectorscopeVisible: false,
          quality: 'medium',
          traceBrightness: 0.8,
          vectorscopeRange: 'all',
          vectorscopeZoom2x: false
        }
      }),
      publishHistogram: vi.fn(),
      publishGpuMemory: vi.fn(),
      publishError: vi.fn(),
      publishScopeError: vi.fn(),
      publishFeatureError: vi.fn(),
      publishTimings: vi.fn(),
      publishLoading: vi.fn()
    });

    bridge.onRendererReady(renderer, 0);

    expect(renderer.setActive).toHaveBeenCalledWith(false);
  });
});
