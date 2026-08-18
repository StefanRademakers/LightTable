import { describe, expect, it } from 'vitest';
import { classifyHiggsfieldContract } from './higgsfieldContracts';

describe('Higgsfield contract classification', () => {
  it('classifies a complete native family without rejecting additive tools', () => {
    const fields: Readonly<Record<string, readonly string[]>> = {
      models_explore: ['action', 'model_id'], generate_image: ['params'], generate_video: ['params'],
      media_upload: ['method', 'filename', 'content_type'], media_confirm: ['type', 'media_id'], job_status: ['jobId']
    };
    const result = classifyHiggsfieldContract({ tools: [
      'models_explore', 'generate_image', 'generate_video', 'media_upload', 'media_confirm',
      'job_status', 'estimate_image_cost', 'new_additive_tool'
    ].map((name) => ({ name, inputSchema: { properties: Object.fromEntries((fields[name] ?? []).map((key) => [key, {}])) } })) });
    expect(result).toMatchObject({ family: 'native-v1', canPublishBytes: true, canPoll: true, canGenerateImage: true });
    expect(result.fingerprint).toMatch(/^higgsfield:native-v1:/u);
  });

  it('rejects a lookalike native family whose live argument schema drifted', () => {
    const result = classifyHiggsfieldContract({ tools: [
      'models_explore', 'generate_image', 'generate_video', 'media_upload', 'media_confirm', 'job_status'
    ].map((name) => ({ name, inputSchema: { properties: {} } })) });
    expect(result).toMatchObject({ family: 'unsupported', canDiscover: false, canGenerateImage: false });
  });

  it('keeps the catalog family fail-closed when no durable polling path exists', () => {
    const result = classifyHiggsfieldContract({ tools: [
      'models_list', 'models_get', 'generate_image', 'generate_video', 'media_upload_and_confirm'
    ].map((name) => ({ name })) });
    expect(result).toMatchObject({ family: 'catalog-v1', canDiscover: true, canPublishBytes: false, canPoll: false, canGenerateImage: false });
  });
});
