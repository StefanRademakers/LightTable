import { describe, expect, it } from 'vitest';
import type {
  GenAiModelId,
  GenAiProviderId,
  GenAiWorkflowDefinition,
  GenAiWorkflowId
} from '@lighttable/genai-core';
import {
  applyGenAiImageCreateDefaults,
  applyGenAiOutputSizeDefault,
  matchGenAiValuesToDocument
} from './genAiDocumentDefaults';

const workflow = {
  id: 'openart:test:image2image' as GenAiWorkflowId,
  providerId: 'openart' as GenAiProviderId,
  modelId: 'test' as GenAiModelId,
  label: 'Edit', mode: 'image2image',
  fields: [
    {
      key: 'ratio', role: 'aspect-ratio', label: 'Aspect', kind: 'enum', required: true, advanced: false,
      options: ['1:1', '4:3', '16:9', '9:16'].map((value) => ({ value, label: value })), sourceSchema: {}
    },
    {
      key: 'size', role: 'output-size', label: 'Size', kind: 'enum', required: true, advanced: false,
      options: ['1K', '2K', '4K'].map((value) => ({ value, label: value })), sourceSchema: {}
    }
  ]
} as GenAiWorkflowDefinition;

describe('GenAI document defaults', () => {
  it('matches a 1920 by 1080 edit to 16:9 and the covering 2K tier', () => {
    expect(matchGenAiValuesToDocument(workflow, {}, { id: 'a', width: 1920, height: 1080 }))
      .toMatchObject({ ratio: '16:9', size: '2K' });
  });

  it('matches portrait documents and caps oversized canvases at the largest provider tier', () => {
    expect(matchGenAiValuesToDocument(workflow, {}, { id: 'b', width: 1080, height: 1920 }))
      .toMatchObject({ ratio: '9:16', size: '2K' });
    expect(matchGenAiValuesToDocument(workflow, {}, { id: 'c', width: 8000, height: 4000 }))
      .toMatchObject({ ratio: '16:9', size: '4K' });
  });

  it('never automatically drops a small edit document to 1K when 2K is available', () => {
    expect(matchGenAiValuesToDocument(workflow, {}, { id: 'small', width: 512, height: 512 }))
      .toMatchObject({ ratio: '1:1', size: '2K' });
  });

  it('replaces provider-advertised 1K defaults with the supported 2K tier', () => {
    expect(applyGenAiOutputSizeDefault(workflow, { size: '1K' }))
      .toMatchObject({ size: '2K' });
  });

  it('uses 16:9 and 2K as new image-create defaults when the provider supports them', () => {
    const create = { ...workflow, mode: 'text2image' } as GenAiWorkflowDefinition;
    expect(applyGenAiImageCreateDefaults(create, { ratio: '1:1', size: '1K' }))
      .toEqual({ ratio: '16:9', size: '2K' });
  });

  it('keeps UI defaults authoritative over provider-advertised defaults', () => {
    const create = {
      ...workflow, mode: 'text2image',
      fields: workflow.fields.map((field) => field.role === 'aspect-ratio'
        ? { ...field, options: [{ value: '1:1', label: 'Square' }] }
        : field.role === 'output-size'
          ? { ...field, options: [{ value: '1K', label: 'Small' }] }
          : field)
    } as GenAiWorkflowDefinition;
    expect(applyGenAiImageCreateDefaults(create, { ratio: '1:1', size: '1K' }))
      .toEqual({ ratio: '16:9', size: '2K' });
  });

  it('keeps document matching out of image-create mode', () => {
    const create = { ...workflow, mode: 'text2image' } as GenAiWorkflowDefinition;
    expect(matchGenAiValuesToDocument(create, { ratio: '1:1' }, { id: 'a', width: 1920, height: 1080 }))
      .toEqual({ ratio: '1:1' });
  });
});
