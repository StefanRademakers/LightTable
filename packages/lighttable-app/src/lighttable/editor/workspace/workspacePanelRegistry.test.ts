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
      text: 'text',
      lensFx: 'lensFx',
      layers: 'layers',
      channels: 'channels',
      debug: 'debug'
    };

    const panels = createDefaultLightTableWorkspacePanels(content);

    expect(panels.map((panel) => panel.id)).toEqual([
      LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.channels,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.effects,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.text,
      LIGHTTABLE_WORKSPACE_PANEL_IDS.debug
    ]);
    expect(panels.map((panel) => panel.content)).toEqual([
      content.layers,
      content.channels,
      content.scopes,
      content.grade,
      content.lensFx,
      content.effects,
      content.text,
      content.debug
    ]);
    expect(panels.map((panel) => panel.contentKey)).toEqual([
      'layers',
      'channels',
      'scopes',
      'grade',
      'lensFx',
      'effects',
      'text',
      'debug'
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
      LIGHTTABLE_WORKSPACE_PANEL_IDS.text
    ]);
  });

  it('tabs Scopes into the floating Layers group while keeping Layers active', () => {
    const panels = createDefaultLightTableWorkspacePanels({
      scopes: null,
      grade: null,
      effects: null,
      text: null,
      lensFx: null,
      layers: null,
      channels: null,
      debug: null
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
      text: null,
      lensFx: null,
      layers: null,
      channels: null,
      debug: null
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
      text: null,
      lensFx: null,
      layers: null,
      channels: null,
      debug: null
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
