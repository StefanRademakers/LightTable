import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionsPanel } from './ActionsPanel';

describe('ActionsPanel', () => {
  it('discovers categorized commands without an arbitrary JSON executor', () => {
    const markup = renderToStaticMarkup(<ActionsPanel
      capabilities={[{ command: 'layer.createRaster', available: true, reason: null }]}
      definitions={[{
        id: 'layer.createRaster', category: 'layer', label: 'New raster layer',
        description: 'Create a raster layer.', scope: 'document', effect: 'edit',
        invocation: 'direct', agentAccess: true, externalMcp: 'execute'
      }]}
      onExecute={() => null}
    />);

    expect(markup).toContain('1 of 1 commands');
    expect(markup).toContain('New raster layer');
    expect(markup).toContain('layer.createRaster');
    expect(markup).not.toContain('textarea');
  });
});
