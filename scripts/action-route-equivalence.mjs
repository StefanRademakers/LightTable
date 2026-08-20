import assert from 'node:assert/strict';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const readPath = (value, path) => path.split('.').reduce(
  (current, key) => isRecord(current) ? current[key] : undefined,
  value
);

export const resolveRecordedParameters = (parameters, results) => {
  const visit = (value) => {
    if (isRecord(value) && Object.keys(value).length === 1 && isRecord(value.$lighttableResult)) {
      const { step, path } = value.$lighttableResult;
      const resolved = readPath(results.get(step), path);
      if (resolved === undefined) throw new Error(`Step ${step} result has no ${path}.`);
      return resolved;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  return visit(parameters);
};

const collectGeneratedIds = ({ document, layers, vectors, texts }) => {
  const ids = new Map();
  if (document?.id) ids.set(document.id, '$document');
  layers.forEach((layer, index) => {
    if (layer?.id) ids.set(layer.id, `$layer${index + 1}`);
  });
  vectors.forEach((vector, vectorIndex) => {
    vector?.elements?.forEach((element, elementIndex) => {
      if (element?.id) ids.set(element.id, `$vector${vectorIndex + 1}.element${elementIndex + 1}`);
    });
  });
  texts.forEach((text, index) => {
    if (text?.textId) ids.set(text.textId, `$text${index + 1}`);
  });
  return ids;
};

const normalizeValue = (value, generatedIds) => {
  if (typeof value === 'string') return generatedIds.get(value) ?? value;
  if (Array.isArray(value)) return value.map((child) => normalizeValue(child, generatedIds));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([childKey]) => ![
      'revision', 'geometryRevision', 'transformRevision', 'styleRevision',
      'estimatedGpuBytes', 'estimatedBytes'
    ].includes(childKey)
      && !['viewport', 'renderer', 'tasks', 'vectorContent'].includes(childKey))
    .map(([childKey, child]) => [childKey, normalizeValue(child, generatedIds)]));
};

export const normalizeRouteState = (state) => {
  const generatedIds = collectGeneratedIds(state);
  const document = { ...state.document };
  delete document.title;
  return normalizeValue({ ...state, document }, generatedIds);
};

export const assertEquivalentRouteStates = (states) => {
  const entries = Object.entries(states);
  assert.ok(entries.length >= 2, 'At least two route states are required.');
  const [baselineName, baseline] = entries[0];
  for (const [name, candidate] of entries.slice(1)) {
    assert.deepEqual(candidate, baseline, `${name} state diverged from ${baselineName}.`);
  }
};

export const mcpResult = (result, label) => {
  if (result?.isError) {
    throw new Error(`${label}: ${result.content?.map((entry) => entry.text).filter(Boolean).join(' | ')}`);
  }
  return result?.structuredContent;
};
