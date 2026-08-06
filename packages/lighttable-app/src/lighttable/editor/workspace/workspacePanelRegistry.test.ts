import { describe, expect, it } from 'vitest';
import {
  createDefaultLightTableWorkspacePanels,
  LIGHTTABLE_WORKSPACE_PANEL_IDS
} from './workspacePanelRegistry';

describe('workspacePanelRegistry', () => {
  it('registers built-in panels in dependency-safe layout order', () => {
    const content = {
      scopes: 'scopes',
      grade: 'grade',
      effects: 'effects',
      color: 'color',
      text: 'text',
      lensFx: 'lensFx',
      layers: 'layers',
      channels: 'channels',
      debug: 'debug',
      agent: 'agent'
    };

    const panels = createDefaultLightTableWorkspacePanels(content);

    expect(panels.map((panel) => panel.id)).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.effects,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.color,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.text,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.debug,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.agent
    ]);
    expect(panels.map((panel) => panel.content)).toEqual([
      content.layers,
      content.channels,
      content.scopes,
      content.grade,
      content.lensFx,
      content.effects,
      content.color,
      content.text,
      content.debug,
      content.agent
    ]);
    expect(panels.map((panel) => panel.contentKey)).toEqual([
      'layers',
      'channels',
      'scopes',
      'grade',
      'lensFx',
      'effects',
      'color',
      'text',
      'debug',
      'agent'
    ]);
    expect(panels.find(({ id }) => id === LIGHTTABLE_WORKSPACE_PANEL_IDS.grade)?.title)
      .toBe('Grade');
    expect(
      panels
        .filter((panel) => panel.requiredForSavedLayout)
        .map((panel) => panel.id)
    ).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.effects,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.color,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.text,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.agent
    ]);
  });

  it('tabs Scopes into the floating Layers group while keeping Layers active', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      grade: null,
      effects: null,
      color: null,
      text: null,
      lensFx: null,
      layers: null,
      channels: null,
      debug: null,
      agent: null
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

  it('groups Lens Fx, Effects, Text and Debug with Grade while keeping Grade active by default', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      grade: null,
      effects: null,
      color: null,
      text: null,
      lensFx: null,
      layers: null,
      channels: null,
      debug: null,
      agent: null
    });
    const debugPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.debug
    );
    const textPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.text
    );
    const effectsPanel = panels.find(
      (panel) => panel.id === LIGHTTABLE_WORKSPACE_PANEL_IDS.effects
    );

    expect(debugPanel).toMatchObject({
      initiallyInactive: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
        direction: 'within'
      }
    });
    expect(debugPanel?.requiredForSavedLayout).toBeUndefined();
    expect(textPanel).toMatchObject({
      title: 'Text',
      initiallyInactive: true,
      requiredForSavedLayout: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
        direction: 'within'
      }
    });
    expect(effectsPanel).toMatchObject({
      title: 'Effects',
      initiallyInactive: true,
      requiredForSavedLayout: true,
      defaultPosition: {
        referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
        direction: 'within'
      }
    });
  });

  it('starts Layers as a compact floating panel over the document', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      grade: null,
      effects: null,
      color: null,
      text: null,
      lensFx: null,
      layers: null,
      channels: null,
      debug: null,
      agent: null
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
        xRatio: 0.34,
        yRatio: 0.27
      }
    });
  });
});
