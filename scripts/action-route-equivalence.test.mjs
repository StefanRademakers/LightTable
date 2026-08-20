import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertEquivalentRouteStates,
  normalizeRouteState,
  resolveRecordedParameters
} from './action-route-equivalence.mjs';

test('resolves nested recorded Action result bindings', () => {
  const results = new Map([[1, { layerId: 'generated-layer', nested: { elementId: 'shape-1' } }]]);
  assert.deepEqual(resolveRecordedParameters({
    target: { layerId: { $lighttableResult: { step: 1, path: 'layerId' } } },
    elementIds: [{ $lighttableResult: { step: 1, path: 'nested.elementId' } }]
  }, results), {
    target: { layerId: 'generated-layer' },
    elementIds: ['shape-1']
  });
});

test('normalizes generated relationships while retaining semantic state', () => {
  const route = (suffix) => normalizeRouteState({
    document: { id: `document-${suffix}`, canonicalRevision: 2, title: `route-${suffix}`,
      history: { undoDepth: 2, estimatedBytes: 42, undoLabel: 'Rename layer' } },
    layers: [{ id: `layer-${suffix}`, name: 'Card', type: 'vector' }],
    vectors: [{ layerId: `layer-${suffix}`, elements: [{ id: `element-${suffix}`, name: 'Rectangle' }] }],
    texts: []
  });
  const left = route('left');
  const right = route('right');
  assertEquivalentRouteStates({ left, right });
  assert.equal(left.layers[0].id, '$layer1');
  assert.equal(left.vectors[0].elements[0].id, '$vector1.element1');
  assert.equal(left.document.title, undefined);
  assert.equal(left.document.history.undoLabel, 'Rename layer');
});
