import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LIGHTTABLE_COMMAND_DEFINITIONS, LIGHTTABLE_COMMAND_SCHEMAS } from '@lighttable/command-contract';
import { BLEND_MODES } from '../../document/blendModes';
import { BASIC_ADJUSTMENT_RANGES } from '../../../application/adjustments/groupVisibility';
import { ActionsPanel } from './ActionsPanel';
import { CommandCatalogView } from './CommandCatalogView';
import { createCommandParameterDefaults } from './CommandParameterEditor';

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

  it('renders schema-driven controls for commands with a complete shared contract', () => {
    const rename = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'layer.rename')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: 'layer.rename', available: true, reason: null }]}
      definitions={[rename]}
      onExecute={() => null}
    />);

    expect(markup).toContain('Layer ID');
    expect(markup).toContain('Name');
    expect(markup).toContain('must contain at least 1 character');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('textarea');
  });

  it('derives editor defaults and blend choices from the shared schema', () => {
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.setFillOpacity']!.input))
      .toEqual({ layerId: '', opacity: 1 });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.setLock']!.input))
      .toEqual({ layerIds: [], lock: 'all', locked: true });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.duplicate']!.input))
      .toEqual({ layerId: '' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.move']!.input))
      .toEqual({ layerId: '', direction: 'up' });
    expect(LIGHTTABLE_COMMAND_SCHEMAS['layer.setBlendMode']!.input.properties!.blendMode.enum)
      .toEqual(BLEND_MODES.map(({ id }) => id));
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['text.create']!.input))
      .toEqual({ mode: 'point', text: 'Text', origin: { x: 0, y: 0 } });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['text.format']!.input))
      .toEqual({ layerId: '' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.setTransform']!.input))
      .toEqual({ layerId: '', transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['transform.applyFixed']!.input))
      .toEqual({ operation: 'flip-horizontal' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.createRaster']!.input))
      .toEqual({});
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.setMask']!.input))
      .toEqual({ layerId: '', operation: 'add' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['selection.applyShape']!.input))
      .toEqual({ mode: 'replace', shape: { kind: 'rectangle', points: [] } });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['selection.applyMagicWand']!.input))
      .toEqual({ kind: 'magic-wand', layerId: '', point: { x: 0, y: 0 }, mode: 'replace',
        options: { sampleSize: 1, tolerance: 20, antiAlias: true,
          contiguous: true, sampleAllLayers: false } });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['selection.modify']!.input))
      .toEqual({ kind: 'modify', operation: 'all' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['grade.setBasic']!.input))
      .toEqual({ target: { kind: 'document' }, values: { temperature: 0 } });
    expect(Object.fromEntries(Object.entries(
      LIGHTTABLE_COMMAND_SCHEMAS['grade.setBasic']!.input.properties!.values.properties!
    ).map(([key, schema]) => [key, { min: schema.minimum, max: schema.maximum }])))
      .toEqual(BASIC_ADJUSTMENT_RANGES);
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.merge']!.input))
      .toEqual({ layerIds: [] });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['layer.flattenGroup']!.input))
      .toEqual({ groupId: '' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['document.flattenImage']!.input))
      .toEqual({});
  });

  it('renders nested conditional text properties without a free-form command JSON editor', () => {
    const createText = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'text.create')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: 'text.create', available: true, reason: null }]}
      definitions={[createText]}
      onExecute={() => null}
    />);

    expect(markup).toContain('Origin');
    expect(markup).toContain('Layer name');
    expect(markup).toContain('Paragraph frame');
    expect(markup).toContain('Native path');
    expect(markup).toContain('Character style');
    expect(markup).toContain('Add');
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
