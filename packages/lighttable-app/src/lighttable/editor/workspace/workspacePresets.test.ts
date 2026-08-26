import { describe, expect, it } from 'vitest';
import {
  createDefaultLightTableWorkspacePanels,
  LIGHTTABLE_WORKSPACE_PANEL_IDS
} from './workspacePanelRegistry';
import { panelsForWorkspacePreset } from './workspacePresets';

const panels = () => createDefaultLightTableWorkspacePanels({
  scopes: null,
  properties: null,
  layers: null,
  channels: null,
  debug: null,
  agent: null,
  actions: null,
  history: null,
  genAi: null,
  aiHistory: null
});

describe('workspace presets', () => {
  it('keeps the canonical Photo Edit inspector order', () => {
    expect(panelsForWorkspacePreset(panels(), 'photo-edit').slice(3).map(({ title }) => title))
      .toEqual(['Properties', 'Assets', 'GenAI', 'Agent']);
    expect(panelsForWorkspacePreset(panels(), 'photo-edit').some(
      ({ id }) => id === LIGHTTABLE_WORKSPACE_PANEL_IDS.debug
    )).toBe(false);
  });

  it('places GenAI and Agent left and activates Assets on the right', () => {
    const preset = panelsForWorkspacePreset(panels(), 'ai-generation');
    const find = (id: string) => preset.find((panel) => panel.id === id);

    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi)).toMatchObject({
      initiallyInactive: false,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'left'
      }
    });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.agent)?.defaultPosition)
      .toEqual({ referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi, direction: 'within' });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory)).toMatchObject({
      initiallyInactive: false,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.properties,
        direction: 'within'
      }
    });
  });

  it('builds a grading workspace with active Scopes left and Properties right', () => {
    const preset = panelsForWorkspacePreset(panels(), 'grading');
    const find = (id: string) => preset.find((panel) => panel.id === id);

    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes)).toMatchObject({
      initiallyInactive: false,
      initialWidth: 300,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'left'
      }
    });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi)).toMatchObject({
      initiallyInactive: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
        direction: 'within'
      }
    });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.properties)).toMatchObject({
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'right'
      }
    });
  });

  it('builds a focused video workspace with transport and no image-only panels', () => {
    const preset = panelsForWorkspacePreset(panels(), 'video');
    const find = (id: string) => preset.find((panel) => panel.id === id);

    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.videoControls)).toMatchObject({
      initiallyInactive: false,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
        direction: 'below'
      }
    });
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi)).toBeUndefined();
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory)).toBeUndefined();
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.layers)).toBeUndefined();
    expect(find(LIGHTTABLE_WORKSPACE_PANEL_IDS.properties)).toBeUndefined();
  });
});
