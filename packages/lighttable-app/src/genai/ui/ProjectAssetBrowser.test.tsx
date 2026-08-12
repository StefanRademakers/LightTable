import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectAssetBrowser, requestedGenerationAspectRatio } from './ProjectAssetBrowser';
import type { GenAiGenerationJob } from '@lighttable/genai-core';

describe('ProjectAssetBrowser', () => {
  it('renders the project directory catalog even when folders contain no indexed assets', () => {
    const markup = renderToStaticMarkup(<ProjectAssetBrowser jobs={[]} assets={[]} sections={[
      { id: 'AiRenders/History', label: 'AI History' },
      { id: 'Characters', label: 'Characters' },
      { id: 'ExtraFolder', label: 'ExtraFolder' }
    ]} />);
    expect(markup).toContain('AI History');
    expect(markup).toContain('Characters');
    expect(markup).toContain('ExtraFolder');
    expect(markup.match(/lighttable-group__header/g)).toHaveLength(3);
    expect(markup).toContain('area_open.png');
    expect(markup).toContain('area_closed.png');
  });

  it('retains the requested output aspect for an unfinished generation tile', () => {
    const job = {
      id: 'job-1', status: 'running', createdAt: 1, updatedAt: 2, results: [],
      request: {
        providerId: 'openart', modelId: 'nano-banana-pro', workflowId: 'openart:nano-banana-pro:image2image',
        prompt: 'A long private prompt that must not become the tile', providerPrompt: 'A provider prompt',
        promptBindings: [], output: { aspectRatio: '16:9', size: '2K', count: 1 },
        fields: { aspectRatio: '16:9' }, references: []
      }
    } as unknown as GenAiGenerationJob;
    expect(requestedGenerationAspectRatio(job)).toBeCloseTo(16 / 9, 5);
  });
});
