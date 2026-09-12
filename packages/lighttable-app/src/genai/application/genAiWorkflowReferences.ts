import type { GenAiAssetReference, GenAiWorkflowDefinition } from '@lighttable/genai-core';

export const workflowReferences = (
  workflow: GenAiWorkflowDefinition | undefined,
  values: Readonly<Record<string, unknown>>
): readonly GenAiAssetReference[] => {
  if (!workflow) return [];
  return [...new Map(workflow.fields.filter(({ kind }) => kind === 'asset').flatMap(field => {
    const value = values[field.key];
    return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  }).filter((value): value is GenAiAssetReference => 'id' in value && typeof value.id === 'string')
    .map(reference => [reference.id, reference])).values()];
};

export const assignWorkflowReferences = (
  workflow: GenAiWorkflowDefinition | undefined,
  values: Readonly<Record<string, unknown>>,
  references: readonly GenAiAssetReference[]
): Readonly<Record<string, unknown>> => {
  if (!workflow) return values;
  const firstFrame = workflow.fields.find(({ role }) => role === 'first-frame');
  const lastFrame = workflow.fields.find(({ role }) => role === 'last-frame');
  const general = workflow.fields.find(({ role }) => role === 'references');
  return { ...values,
    ...(firstFrame ? { [firstFrame.key]: references[0] } : {}),
    ...(lastFrame ? { [lastFrame.key]: references[1] } : {}),
    ...(general ? { [general.key]: firstFrame || lastFrame ? [] : references } : {}) };
};
