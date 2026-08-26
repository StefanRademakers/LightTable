import { describe, expect, it } from 'vitest';
import {
  createDefaultLightTableWorkspacePanels,
  LIGHTTABLE_WORKSPACE_PANEL_IDS
} from './workspacePanelRegistry';

describe('workspacePanelRegistry', () => {
  it('registers built-in panels in dependency-safe layout order', () => {
    const content = {
      scopes: 'scopes',
      properties: 'properties',
      layers: 'layers',
      channels: 'channels',
      debug: 'debug',
      agent: 'agent',
      actions: 'actions',
      genAi: 'genAi',
      aiHistory: 'aiHistory',
      color: 'color',
      videoControls: 'videoControls'
    };

    const panels = createDefaultLightTableWorkspacePanels(content);

    expect(panels.map((panel) => panel.id)).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.agent,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.actions,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.debug,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.color,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.videoControls
    ]);
    expect(panels.map((panel) => panel.content)).toEqual([
      content.layers,
      content.channels,
      content.scopes,
      content.properties,
      content.aiHistory,
      content.genAi,
      content.agent,
      content.actions,
      content.debug,
      content.color,
      content.videoControls
    ]);
    expect(panels.map((panel) => panel.contentKey)).toEqual([
      'layers',
      'channels',
      'scopes',
      'properties',
      'aiHistory',
      'genAi',
      'agent',
      'actions',
      'debug',
      'color',
      'videoControls'
    ]);
    expect(panels.find(({ id }) => id === LIGHTTABLE_WORKSPACE_PANEL_IDS.properties)?.title)
      .toBe('Properties');
    expect(
      panels
        .filter((panel) => panel.requiredForSavedLayout)
        .map((panel) => panel.id)
    ).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.agent
    ]);
  });

  it('tabs Scopes into the floating Layers group while keeping Layers active', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      properties: null,
      layers: null,
      channels: null,
      debug: null,
      agent: null,
      actions: null,
      genAi: null,
      aiHistory: null
    });
    const scopesPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes
    );

    expect(scopesPanel).toMatchObject({
      initiallyInactive: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
        direction: 'within'
      }
    });
  });

  it('groups auxiliary panels with contextual Properties while keeping Properties active', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      properties: null,
      layers: null,
      channels: null,
      debug: null,
      agent: null,
      actions: null,
      genAi: null,
      aiHistory: null
    });
    const debugPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.debug
    );
    expect(debugPanel).toMatchObject({
      initiallyInactive: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
        direction: 'within'
      }
    });
    expect(debugPanel?.requiredForSavedLayout).toBeUndefined();
    expect(panels.some(({ title }) => title === 'Text' || title === 'Effects' || title === 'Lens Fx'))
      .toBe(false);
  });

  it('starts Layers as a compact floating panel over the document', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      properties: null,
      layers: null,
      channels: null,
      debug: null,
      agent: null,
      actions: null,
      genAi: null,
      aiHistory: null
    });
    const layersPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.layers
    );

    expect(layersPanel).toMatchObject({
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'within'
      },
      defaultFloating: {
        width: 260,
        height: 370,
        xRatio: 0.67,
        yRatio: 0.58
      }
    });
  });
});
