import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import { createTextLayerNode } from '../../editor/document/documentTypes';
import { translationMatrix } from '../../editor/geometry/affine';
import { TextLayerRenderer, textLayerSourceKey, tightCoverageBounds } from './TextLayerRenderer';

describe('TextLayerRenderer', () => {
  it('publishes only exact immutable sources and maps tight pixels into document space', () => {
    const renderer = new TextLayerRenderer<object>();
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    layer.transform = translationMatrix(30, 40);
    const texture = {};
    renderer.publish({
      layerId: layer.id,
      texture,
      width: 200,
      height: 80,
      localBounds: { x: -3, y: 5, width: 100, height: 40 },
      sourceScale: 2,
      sourceKey: textLayerSourceKey(layer),
      mode: 'cached',
      byteLength: 200 * 80 * 8
    });

    expect(renderer.resolve(layer, translationMatrix(7, -2))).toMatchObject({
      texture,
      dimensions: { width: 200, height: 80 },
      bounds: { x: -3, y: 5, width: 100, height: 40 },
      transform: { a: 0.5, d: 0.5, tx: 34, ty: 43 }
    });
  });

  it('rejects stale authored revisions without destroying the last valid source', () => {
    const renderer = new TextLayerRenderer<object>();
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    const destroy = vi.fn();
    renderer.publish({
      layerId: layer.id, texture: {}, width: 8, height: 4,
      localBounds: { x: 0, y: 0, width: 8, height: 4 }, sourceScale: 1,
      sourceKey: textLayerSourceKey(layer), mode: 'atlas', byteLength: 256, destroy
    });
    const changed = {
      ...structuredClone(layer),
      text: {
        ...structuredClone(layer.text),
        revisions: {
          ...layer.text.revisions,
          content: layer.text.revisions.content + 1
        }
      }
    };

    expect(renderer.resolve(changed)).toBeNull();
    expect(destroy).not.toHaveBeenCalled();
    expect(renderer.resolve(layer)).not.toBeNull();
  });

  it('releases replaced and detached textures and reports exact VRAM', () => {
    const renderer = new TextLayerRenderer<object>();
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    const firstDestroy = vi.fn();
    const secondDestroy = vi.fn();
    const source = (texture: object, destroy: () => void, bytes: number) => ({
      layerId: layer.id, texture, width: 4, height: 4,
      localBounds: { x: 0, y: 0, width: 4, height: 4 }, sourceScale: 1,
      sourceKey: textLayerSourceKey(layer), mode: 'cached' as const,
      byteLength: bytes, destroy
    });
    renderer.publish(source({}, firstDestroy, 128));
    renderer.publish(source({}, secondDestroy, 256));
    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(renderer.snapshot()).toMatchObject({ readyLayerCount: 1, textureBytes: 256 });

    renderer.sync([]);
    expect(secondDestroy).toHaveBeenCalledOnce();
    expect(renderer.estimatedTextureBytes()).toBe(0);
  });

  it('validates tight texture resource contracts', () => {
    const renderer = new TextLayerRenderer<object>();
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    expect(() => renderer.publish({
      layerId: layer.id, texture: {}, width: 9, height: 9,
      localBounds: { x: 0, y: 0, width: 9, height: 9 }, sourceScale: 1,
      sourceKey: textLayerSourceKey(layer), mode: 'cached', byteLength: 8
    })).toThrow(/byte length/i);
  });

  it('distinguishes settled transparent text from an unready placeholder', () => {
    const renderer = new TextLayerRenderer<object>();
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Whitespace');
    expect(renderer.isTransparent(layer)).toBe(false);
    expect(renderer.markTransparent(layer)).toBe(true);
    expect(renderer.isTransparent(layer)).toBe(true);
    expect(renderer.resolve(layer)).toBeNull();
    expect(renderer.snapshot()).toMatchObject({
      readyLayerCount: 1,
      textureBytes: 0,
      mode: 'cached'
    });
    const changed = {
      ...layer,
      text: {
        ...layer.text,
        revisions: { ...layer.text.revisions, content: layer.text.revisions.content + 1 }
      }
    };
    expect(renderer.isTransparent(changed)).toBe(false);
  });

  it('computes a tight fringe around transformed glyph quads and encodes once', () => {
    const texture = { createView: vi.fn(() => ({})) };
    const retireTexture = vi.fn();
    const renderer = new TextLayerRenderer({
      createTexture: vi.fn(() => texture),
      createView: (source) => source.createView() as GPUTextureView,
      retireTexture,
      maximumTextureDimension: 4096
    });
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Text');
    const draw = {
      glyph: {
        placement: {
          serializedKey: 'glyph', pageId: 0, pageGeneration: 0, atlasGeneration: 0,
          x: 0, y: 0, width: 10, height: 20, bearingX: -2, bearingY: 15, empty: false
        },
        bearingX: -2,
        bearingY: 15
      },
      x: 4,
      y: 30,
      color: [1, 1, 1, 1] as const,
      transform: [1, 0, 0, 1] as const
    };
    const encode = vi.fn(() => 1);

    expect(tightCoverageBounds([draw], 2)).toEqual({ x: 0, y: 13, width: 14, height: 24 });
    expect(renderer.encodeTightSource({} as GPUCommandEncoder, layer, { encode }, [draw])).toMatchObject({
      dimensions: { width: 14, height: 24 },
      bounds: { x: 0, y: 13, width: 14, height: 24 }
    });
    expect(encode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 14, height: 24, loadOp: 'clear' }),
      [expect.objectContaining({ x: 4, y: 17 })]
    );
    expect(renderer.estimatedTextureBytes()).toBe(14 * 24 * 8);
    expect(retireTexture).not.toHaveBeenCalled();
  });
});
