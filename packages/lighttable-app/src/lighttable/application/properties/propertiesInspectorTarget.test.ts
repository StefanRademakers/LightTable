import { describe, expect, it } from 'vitest';
import type { ImageDocument, LayerNode } from '../../editor/document/documentTypes';
import {
  createDefaultLayerStyle,
  createDefaultLayerStyleStack
} from '../../editor/styles/layerStyleDefaults';
import {
  propertiesInspectorView,
  propertiesTargetIsValid,
  reconcilePropertiesTarget,
  type PropertiesInspectorTarget
} from './propertiesInspectorTarget';

const layer = (partial: Partial<LayerNode> & Pick<LayerNode, 'id' | 'type'>) => ({
  name: String(partial.id),
  visible: true,
  locks: { transparency: false, pixels: false, position: false, all: false },
  opacity: 1,
  fillOpacity: 1,
  blendMode: 'normal',
  clipping: false,
  styleStack: { enabled: true, effects: [] },
  transform: [1, 0, 0, 1, 0, 0],
  revision: 1,
  geometryRevision: 1,
  createdAt: 1,
  modifiedAt: 1,
  mask: null,
  ...partial
}) as LayerNode;

const documentWith = (active: LayerNode): ImageDocument => ({
  id: 'document' as ImageDocument['id'],
  name: 'Document',
  width: 100,
  height: 100,
  colorSettings: { colorSpace: 'srgb', profileState: 'assigned' },
  layers: [active],
  activeLayerId: active.id,
  guides: [],
  revision: 1,
  createdAt: 1,
  modifiedAt: 1
} as unknown as ImageDocument);

describe('properties inspector target', () => {
  it('routes layer content to the matching reusable editor', () => {
    const text = layer({ id: 'text' as LayerNode['id'], type: 'text' });
    expect(propertiesInspectorView(documentWith(text), { kind: 'layer', layerId: text.id }))
      .toBe('text');

    const raster = layer({ id: 'raster' as LayerNode['id'], type: 'raster', adjustmentStack: null });
    expect(propertiesInspectorView(documentWith(raster), { kind: 'layer', layerId: raster.id }))
      .toBe('grade');
  });

  it('distinguishes local Grade, Lens Fx and Layer Style children', () => {
    const shadow = createDefaultLayerStyle('drop-shadow');
    const raster = layer({
      id: 'raster' as LayerNode['id'],
      type: 'raster',
      adjustmentStack: {
        id: 'stack',
        revision: 1,
        modules: [{ id: 'lens-blur', type: 'lt.lens-blur', enabled: true, revision: 1, settings: {} }]
      },
      styleStack: { ...createDefaultLayerStyleStack(), effects: [shadow] }
    });
    const document = documentWith(raster);
    expect(propertiesInspectorView(document, {
      kind: 'processing', layerId: raster.id, owner: 'lens-fx'
    })).toBe('lens-fx');
    expect(propertiesInspectorView(document, {
      kind: 'style', layerId: raster.id, effectId: shadow.id
    })).toBe('effects');
  });

  it('keeps an explicitly requested neutral local editor available before first authoring', () => {
    const raster = layer({ id: 'raster' as LayerNode['id'], type: 'raster', adjustmentStack: null });
    const stale: PropertiesInspectorTarget = {
      kind: 'processing', layerId: raster.id, owner: 'grade'
    };
    const document = documentWith(raster);
    expect(propertiesTargetIsValid(document, stale)).toBe(true);
    expect(reconcilePropertiesTarget(document, stale)).toBe(stale);
    expect(propertiesInspectorView(document, stale)).toBe('grade');
  });
});
