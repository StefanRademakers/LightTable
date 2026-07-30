import type { ReactNode } from 'react';

export const LIGHTTABLE_WORKSPACE_PANEL_IDS = {
  documentHost: 'lighttable.document-host',
  scopes: 'lighttable.scopes',
  grade: 'lighttable.inspector',
  lensFx: 'lighttable.lens-fx',
  layers: 'lighttable.layers',
  debug: 'lighttable.debug'
} as const;

export type LightTableWorkspacePanelId =
  (typeof LIGHTTABLE_WORKSPACE_PANEL_IDS)[keyof typeof LIGHTTABLE_WORKSPACE_PANEL_IDS];

export interface LightTableWorkspacePanelRegistration {
  id: LightTableWorkspacePanelId | (string & {});
  contentKey: string;
  title: string;
  content: ReactNode;
  defaultPosition: {
    referencePanelId: LightTableWorkspacePanelId | (string & {});
    direction: 'left' | 'right' | 'above' | 'below' | 'within';
  };
  initiallyInactive?: boolean;
  initialWidth?: number;
  initialHeight?: number;
  minimumHeight?: number;
  requiredForSavedLayout?: boolean;
}

export interface DefaultLightTableWorkspacePanelContent {
  scopes: ReactNode;
  grade: ReactNode;
  lensFx: ReactNode;
  layers: ReactNode;
  debug: ReactNode;
}

/**
 * The built-in registry is the only place that decides which accessory
 * panels exist and where a fresh workspace places them. Dockview owns layout;
 * feature composition owns panel content.
 */
export const createDefaultLightTableWorkspacePanels = (
  content: DefaultLightTableWorkspacePanelContent
): LightTableWorkspacePanelRegistration[] => [
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
    contentKey: 'scopes',
    title: 'Scopes',
    content: content.scopes,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost,
      direction: 'right'
    },
    initialWidth: 290,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
    contentKey: 'grade',
    title: 'Grade',
    content: content.grade,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      direction: 'right'
    },
    initialWidth: 310,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.debug,
    contentKey: 'debug',
    title: 'Debug',
    content: content.debug,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes,
      direction: 'within'
    },
    initiallyInactive: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.lensFx,
    contentKey: 'lensFx',
    title: 'Lens Fx',
    content: content.lensFx,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      direction: 'within'
    },
    initiallyInactive: true,
    requiredForSavedLayout: true
  },
  {
    id: LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
    contentKey: 'layers',
    title: 'Layers',
    content: content.layers,
    defaultPosition: {
      referencePanelId: LIGHTTABLE_WORKSPACE_PANEL_IDS.grade,
      direction: 'below'
    },
    initialHeight: 220,
    minimumHeight: 140,
    requiredForSavedLayout: true
  }
];
