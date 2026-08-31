import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectAssetBrowser, projectAssetMatchesQuery, requestedGenerationAspectRatio } from './ProjectAssetBrowser';
import type { GenAiAssetReference, GenAiGenerationJob } from '@lighttable/genai-core';

describe('ProjectAssetBrowser', () => {
  it('renders the project directory catalog even when folders contain no indexed assets', () => {
    const markup = renderToStaticMarkup(<ProjectAssetBrowser jobs={[]} assets={[]} sections={[
      { id: 'AI/History', label: 'History' },
      { id: 'Characters', label: 'Characters' },
      { id: 'ExtraFolder', label: 'ExtraFolder' }
    ]} />);
    expect(markup).toContain('History');
    expect(markup).toContain('Characters');
    expect(markup).toContain('ExtraFolder');
    expect(markup.match(/ui-panel-section__header/g)).toHaveLength(3);
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

  it('renders the fixed project asset search control', () => {
    const markup = renderToStaticMarkup(<ProjectAssetBrowser jobs={[]} assets={[]} />);
    expect(markup).toContain('project-asset-browser__header');
    expect(markup).toContain('Search project assets');
    expect(markup).toContain('Search assets');
  });

  it('matches asset names, paths and generation metadata without case or accent sensitivity', () => {
    const asset = {
      id: 'asset-1', projectId: 'project-1', label: 'Caf\u00e9 Portrait.png', mediaType: 'image/png',
      relativePath: 'Characters/Portraits/Cafe.png', section: 'Characters'
    } as unknown as GenAiAssetReference;
    const job = {
      request: { prompt: 'Golden hour portrait', modelId: 'nano-banana-pro', providerId: 'openart' }
    } as unknown as GenAiGenerationJob;
    expect(projectAssetMatchesQuery(asset, 'CAFE')).toBe(true);
    expect(projectAssetMatchesQuery(asset, 'portraits')).toBe(true);
    expect(projectAssetMatchesQuery(asset, 'golden hour', job)).toBe(true);
    expect(projectAssetMatchesQuery(asset, 'environment')).toBe(false);
  });
});
