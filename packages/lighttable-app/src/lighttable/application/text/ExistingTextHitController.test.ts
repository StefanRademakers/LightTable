import { createDefaultTextLayerData, type RealizedTextLayout } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  createTextLayerNode,
  semanticLayerDependencyKey
} from '../../editor/document/documentTypes';
import type { LayerId } from '../../editor/document/documentTypes';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import { ExistingTextHitController } from './ExistingTextHitController';

const layout = (): TextLayerEditingLayout => ({
  layerId: 'text' as LayerId, preparationKey: 'key', sourceText: 'Text', writingMode: 'horizontal-tb',
  localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  layout: {
    schemaVersion: 2, key: 'layout', glyphRuns: [], lines: [], selectionGeometry: [],
    clusterMap: [], warnings: [], inkBounds: { x: 0, y: 0, width: 40, height: 20 },
    logicalBounds: { x: 0, y: 0, width: 40, height: 20 },
    caretStops: [{ textOffset: 0, x: 0, y: 20, height: 20, affinity: 'downstream' }]
  } as RealizedTextLayout
});

describe('ExistingTextHitController', () => {
  it('retains a plausible click until the exact renderer layout is ready', async () => {
    const document = createImageDocument('Text', 100, 100, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    layer.derivedPreview = {
      width: 40, height: 20, transform: layer.transform,
      dependencyKey: semanticLayerDependencyKey(layer)!, source: 'photoshop-layer-preview'
    };
    document.layers = [layer];
    let presentation: TextLayerEditingLayout | null = null;
    const renderer = {
      currentTextEditingLayout: vi.fn(() => presentation),
      waitForTextEditingLayout: vi.fn(async () => {
        presentation = layout();
        return { kind: 'ready' as const, presentation };
      })
    };
    const publish = vi.fn();
    const controller = new ExistingTextHitController({
      getDocument: () => document, getRenderer: () => renderer, getRendererGeneration: () => 3, reportFailure: vi.fn()
    });

    expect(controller.resolve([layer], { x: 10, y: 10 }, 4, publish, vi.fn())).toBe('pending');
    await Promise.resolve();
    await Promise.resolve();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ layer }), false);
  });

  it('drops a late layout after renderer replacement', async () => {
    const document = createImageDocument('Text', 100, 100, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    layer.derivedPreview = {
      width: 40, height: 20, transform: layer.transform,
      dependencyKey: semanticLayerDependencyKey(layer)!, source: 'photoshop-layer-preview'
    };
    document.layers = [layer];
    let release!: () => void;
    const renderer = {
      currentTextEditingLayout: vi.fn<() => TextLayerEditingLayout | null>(() => layout()),
      waitForTextEditingLayout: vi.fn(() => new Promise<{ kind: 'ready'; presentation: TextLayerEditingLayout }>((resolve) => {
        release = () => resolve({ kind: 'ready', presentation: layout() });
      }))
    };
    renderer.currentTextEditingLayout.mockReturnValueOnce(null);
    let generation = 1;
    const publish = vi.fn();
    const controller = new ExistingTextHitController({
      getDocument: () => document, getRenderer: () => renderer, getRendererGeneration: () => generation, reportFailure: vi.fn()
    });

    expect(controller.resolve([layer], { x: 10, y: 10 }, 4, publish, vi.fn())).toBe('pending');
    generation = 2;
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });

  it('buffers a complete pointer intent and resumes the terminal miss path', async () => {
    const document = createImageDocument('Text', 100, 100, 'source');
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    document.layers = [layer];
    const renderer = {
      currentTextEditingLayout: vi.fn<() => TextLayerEditingLayout | null>(() => null),
      waitForTextEditingLayout: vi.fn(async () => ({ kind: 'unavailable' as const }))
    };
    const miss = vi.fn();
    const controller = new ExistingTextHitController({
      getDocument: () => document, getRenderer: () => renderer, getRendererGeneration: () => 1, reportFailure: vi.fn()
    });

    expect(controller.resolve(
      [layer], { x: 80, y: 70 }, 4, vi.fn(), miss, 9
    )).toBe('pending');
    expect(controller.owns(9)).toBe(true);
    expect(controller.move(9, { x: 90, y: 85 })).toBe(true);
    expect(controller.finish(9, { x: 92, y: 88 })).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(miss).toHaveBeenCalledWith({
      pointerId: 9,
      start: { x: 80, y: 70 },
      current: { x: 92, y: 88 },
      finished: true
    });
    expect(controller.owns(9)).toBe(false);
  });
});
