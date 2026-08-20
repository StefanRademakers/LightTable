import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionsPanel } from './ActionsPanel';
import { CommandCatalogView } from './CommandCatalogView';

const definition = {
  id: 'layer.createRaster' as const, category: 'layer' as const, label: 'New raster layer',
  description: 'Create a raster layer.', scope: 'document' as const, effect: 'edit' as const,
  invocation: 'direct' as const, agentAccess: true, externalMcp: 'execute' as const
};

describe('ActionsPanel', () => {
  it('keeps recorded Actions primary and the command browser in a separate view', () => {
    const markup = renderToStaticMarkup(<ActionsPanel
      capabilities={[{ command: 'layer.createRaster', available: true, reason: null }]}
      definitions={[definition]}
      onExecute={() => null}
      recording={{ status: 'idle', id: null, name: 'Untitled Action', startedAt: null,
        stoppedAt: null, steps: [], byteLength: 0, limitReached: false }}
      playback={{ status: 'idle', currentSequence: null, results: [], taskProgress: null }}
      library={{ actions: [], selectedId: null, error: null }}
      onStartRecording={() => undefined}
      onStopRecording={() => undefined}
      onClearRecording={() => undefined}
      onPlay={() => undefined}
      onPlayStep={() => undefined}
      onStopPlayback={() => undefined}
      onSaveAction={() => undefined}
      onLoadAction={() => undefined}
      onDeleteAction={() => undefined}
    />);

    expect(markup).toContain('Actions panel views');
    expect(markup).toContain('Commands');
    expect(markup).toContain('Untitled Action');
    expect(markup).toContain('Record');
    expect(markup).not.toContain('New raster layer');
  });

  it('discovers categorized commands without an arbitrary JSON executor', () => {
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: 'layer.createRaster', available: true, reason: null }]}
      definitions={[definition]}
      onExecute={() => null}
    />);
    expect(markup).toContain('1 of 1 commands');
    expect(markup).toContain('New raster layer');
    expect(markup).toContain('layer.createRaster');
    expect(markup).toContain('Properties');
    expect(markup).toContain('None');
    expect(markup).not.toContain('textarea');
  });

  it('shows subscribed asynchronous task progress in the recorder status', () => {
    const markup = renderToStaticMarkup(<ActionsPanel
      capabilities={[]}
      definitions={[definition]}
      onExecute={() => null}
      recording={{ status: 'stopped', id: 'action-1', name: 'Export', startedAt: 1,
        stoppedAt: 2, steps: [], byteLength: 0, limitReached: false }}
      playback={{ status: 'running', currentSequence: 1, results: [], taskProgress: 0.42 }}
      library={{ actions: [], selectedId: null, error: null }}
      onStartRecording={() => undefined} onStopRecording={() => undefined}
      onClearRecording={() => undefined} onPlay={() => undefined}
      onPlayStep={() => undefined} onStopPlayback={() => undefined}
      onSaveAction={() => undefined} onLoadAction={() => undefined}
      onDeleteAction={() => undefined}
    />);
    expect(markup).toContain('Playback: running at step 1 · 42%');
  });
});
