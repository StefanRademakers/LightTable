import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LIGHTTABLE_DEFAULT_ACTION_SET_ID } from '../../../application/actions/semanticActionLibrary';
import { ActionsPanel, type ActionsPanelProps } from './ActionsPanel';

const definition = {
  id: 'layer.createRaster' as const, category: 'layer' as const, label: 'New raster layer',
  description: 'Create a raster layer.', scope: 'document' as const, effect: 'edit' as const,
  invocation: 'direct' as const, agentAccess: true, externalMcp: 'execute' as const
};

const renderPanel = (overrides: Partial<ActionsPanelProps> = {}) => renderToStaticMarkup(<ActionsPanel
  definitions={[definition]}
  recording={{ status: 'idle', id: null, name: 'Untitled Action', startedAt: null,
    stoppedAt: null, steps: [], variables: [], byteLength: 0, limitReached: false }}
  playback={{ status: 'idle', currentSequence: null, results: [], taskProgress: null }}
  library={{ sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set',
    createdAt: 0, updatedAt: 0 }], selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  actions: [], selectedId: null, error: null }}
  onStartRecording={() => undefined} onStopRecording={() => undefined}
  onClearRecording={() => undefined} onPlay={() => undefined}
  onPlayStep={() => undefined} onPlayFromStep={() => undefined}
  onStopPlayback={() => undefined} onCreateActionSet={async () => null}
  onCreateAction={async () => null}
  onRenameActionSet={async () => false} onSelectActionSet={() => undefined}
  onDeleteActionSet={() => undefined} onLoadAction={() => undefined}
  onDeleteAction={() => undefined} {...overrides} />);

describe('ActionsPanel', () => {
  it('uses the Action Set tree and record/play footer as its primary UI', () => {
    const markup = renderPanel();
    expect(markup).toContain('aria-label="Action Sets"');
    expect(markup).toContain('Default Set');
    expect(markup).toContain('aria-label="Record"');
    expect(markup).toContain('aria-label="New Action Set"');
    expect(markup).toContain('aria-label="New Action"');
    expect(markup).not.toContain('Search commands');
  });

  it('projects a recorded command as a named, addressable Action step', () => {
    const recording = { status: 'stopped' as const, id: 'action-1', name: 'Layer setup',
      startedAt: 1, stoppedAt: 2, byteLength: 10, limitReached: false, variables: [], steps: [{
        sequence: 1, requestId: 'request-1', command: 'layer.createRaster', documentId: 'document-1',
        origin: 'ui' as const, contract: { status: 'complete' as const, schemaVersion: 1 }, parameters: {},
        outcome: 'completed' as const, result: { created: true, layerId: 'layer-1' },
        startedAt: 1, durationMs: 1, replayable: true, note: null, rationale: null
      }] };
    const markup = renderPanel({ recording, library: {
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1', error: null,
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: 'Layer setup', createdAt: 1, updatedAt: 2, recording }]
    } });
    expect(markup).toContain('data-command="layer.createRaster"');
    expect(markup).toContain('New raster layer');
    expect(markup).not.toContain('Toggle dialog for New raster layer');
  });

  it('announces task-aware playback progress', () => {
    expect(renderPanel({ playback: { status: 'running', currentSequence: 1,
      results: [], taskProgress: 0.42 } })).toContain('Playback: running · step 1 · 42%');
  });
});
