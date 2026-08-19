import { describe, expect, it } from 'vitest';
import type { LightTableCommandDefinition } from '@lighttable/command-contract';
import { actionExposureLabel, buildActionCatalogGroups } from './actionCatalogModel';

const definitions: readonly LightTableCommandDefinition[] = [
  {
    id: 'layer.createRaster', category: 'layer', label: 'New raster layer',
    description: 'Create one layer.', scope: 'document', effect: 'edit',
    invocation: 'direct', agentAccess: true, externalMcp: 'execute'
  },
  {
    id: 'document.resizeImage', category: 'image', label: 'Image size',
    description: 'Resize image pixels.', scope: 'document', effect: 'edit',
    invocation: 'parameters', agentAccess: false, agentAccessReason: 'Needs proof.',
    externalMcp: null, externalMcpReason: 'Not admitted.'
  }
];

describe('action catalog model', () => {
  it('joins catalog metadata to live capability state and filters without executing', () => {
    const groups = buildActionCatalogGroups(definitions, [
      { command: 'layer.createRaster', available: true, reason: null },
      { command: 'document.resizeImage', available: false, reason: 'Unavailable here.' }
    ], { category: 'all', query: 'image' });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Image');
    expect(groups[0]?.items[0]).toMatchObject({
      available: false,
      unavailableReason: 'Unavailable here.'
    });
  });

  it('projects explicit rollout language', () => {
    expect(actionExposureLabel(definitions[0]!)).toBe('MCP');
    expect(actionExposureLabel(definitions[1]!)).toBe('Local only');
  });
});
