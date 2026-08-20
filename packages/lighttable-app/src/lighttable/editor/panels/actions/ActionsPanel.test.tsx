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
      onPlayFromStep={() => undefined}
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

  it('offers dependency-aware single-step and play-from debugging controls', () => {
    const markup = renderToStaticMarkup(<ActionsPanel
      capabilities={[]} definitions={[definition]} onExecute={() => null}
      recording={{ status: 'stopped', id: 'action-1', name: 'Layer setup', startedAt: 1,
        stoppedAt: 2, byteLength: 10, limitReached: false, steps: [{
          sequence: 1, requestId: 'request-1', command: 'layer.createRaster', documentId: 'document-1',
          origin: 'ui', contract: { status: 'complete', schemaVersion: 1 }, parameters: {},
          outcome: 'completed', result: { created: true, layerId: 'layer-1' },
          startedAt: 1, durationMs: 1, replayable: true, note: null
        }] }}
      playback={{ status: 'idle', currentSequence: null, results: [], taskProgress: null }}
      library={{ actions: [], selectedId: null, error: null }}
      onStartRecording={() => undefined} onStopRecording={() => undefined}
      onClearRecording={() => undefined} onPlay={() => undefined}
      onPlayStep={() => undefined} onPlayFromStep={() => undefined}
      onStopPlayback={() => undefined} onSaveAction={() => undefined}
      onLoadAction={() => undefined} onDeleteAction={() => undefined}
    />);

    expect(markup).toContain('Play step');
    expect(markup).toContain('Play from here');
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
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['raster.invert']!.input))
      .toEqual({ layerId: '', channel: 'pixels' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['text.convertToShape']!.input))
      .toEqual({ layerId: '' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['text.rasterize']!.input))
      .toEqual({ layerId: '' });
    expect(createCommandParameterDefaults(LIGHTTABLE_COMMAND_SCHEMAS['raster.fill']!.input))
      .toEqual({ layerId: '', channel: 'pixels', color: '#000000' });
  });

  it('uses shared executable examples for nested paint commands', () => {
    const gradient = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'raster.applyGradient')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: gradient.id, available: true, reason: null }]}
      definitions={[gradient]}
      onExecute={() => null}
    />);
    expect(markup).toContain('agent-sunset');
    expect(markup).not.toContain('must contain at least');
    expect(markup).toContain('>Run</button>');
    expect(markup).not.toContain('disabled="">Run</button>');
  });

  it('renders the canonical workspace document form without MCP-only aliases', () => {
    const create = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'document.create')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: create.id, available: true, reason: null }]}
      definitions={[create]}
      onExecute={() => null}
    />);
    expect(markup).toContain('Social portrait');
    expect(markup).toContain('Bit depth');
    expect(markup).toContain('Background');
    expect(markup).toContain('Transparent');
    expect(markup).not.toContain('backgroundColor');
    expect(markup).not.toContain('legacy property metadata');
    expect(markup).not.toContain('disabled="">Run</button>');
  });

  it('renders discriminated document geometry variants from the shared schema', () => {
    const geometry = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'document.applyGeometry')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: geometry.id, available: true, reason: null }]}
      definitions={[geometry]}
      onExecute={() => null}
    />);
    expect(markup).toContain('Canvas size');
    expect(markup).toContain('Crop');
    expect(markup).toContain('Rotate');
    expect(markup).toContain('Flip canvas');
    expect(markup).toContain('Canvas width');
    expect(markup).not.toContain('cropOverlay');
    expect(markup).not.toContain('legacy property metadata');
    expect(markup).not.toContain('disabled="">Run</button>');
  });

  it('resolves shared vector definitions into an executable Actions form', () => {
    const createVector = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'vector.create')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: createVector.id, available: true, reason: null }]}
      definitions={[createVector]}
      onExecute={() => null}
    />);
    expect(markup).toContain('Rectangle');
    expect(markup).toContain('cornerRadii');
    expect(markup).not.toContain('unresolved schema reference');
    expect(markup).toContain('>Run</button>');
    expect(markup).not.toContain('disabled="">Run</button>');
  });

  it('renders derived atomic operations and result bindings without a JSON editor', () => {
    const batch = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'command.batch')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: batch.id, available: true, reason: null }]}
      definitions={[batch]}
      onExecute={() => null}
    />);

    expect(markup).toContain('Create editable title');
    expect(markup).toContain('create-title');
    expect(markup).toContain('text.create');
    expect(markup).toContain('rename-title');
    expect(markup).toContain('Prior operation result');
    expect(markup).toContain('layerId');
    expect(markup).toContain('Add item');
    expect(markup).not.toContain('legacy property metadata');
    expect(markup).not.toContain('textarea');
    expect(markup).not.toContain('unresolved schema reference');
  });

  it('renders opaque artifact handles without exposing binary payload fields', () => {
    const place = LIGHTTABLE_COMMAND_DEFINITIONS.find(({ id }) => id === 'layer.placeArtifact')!;
    const markup = renderToStaticMarkup(<CommandCatalogView
      capabilities={[{ command: place.id, available: true, reason: null }]}
      definitions={[place]}
      onExecute={() => null}
    />);
    expect(markup).toContain('artifact-input-image');
    expect(markup).toContain('Placed artwork');
    expect(markup).not.toContain('bytes');
    expect(markup).not.toContain('base64');
    expect(markup).not.toContain('disabled=""');
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
      onPlayStep={() => undefined} onPlayFromStep={() => undefined}
      onStopPlayback={() => undefined}
      onSaveAction={() => undefined} onLoadAction={() => undefined}
      onDeleteAction={() => undefined}
    />);
    expect(markup).toContain('Playback: running at step 1 · 42%');
  });
});
