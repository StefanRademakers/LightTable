import { ButtonBase } from '../../../ui/ButtonBase';
import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { writeLightTableDocumentDrag } from './documentTabDrag';
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview
} from 'dockview-react';
import {
  LIGHTTABLE_WORKSPACE_PANEL_IDS,
  type LightTableWorkspacePanelRegistration
} from './workspacePanelRegistry';
import {
  clearWorkspaceLayout,
  persistWorkspaceLayout,
  readWorkspaceLayout,
  type LightTableWorkspacePreset
} from './workspaceLayoutPersistence';
import {
  panelsForWorkspacePreset,
  type SelectableLightTableWorkspacePreset
} from './workspacePresets';
import {
  EditorStatusBar,
  type EditorStatusBarProps
} from '../ui/EditorStatusBar';

const DOCUMENT_HOST_PANEL_ID = LIGHTTABLE_WORKSPACE_PANEL_IDS.documentHost;
// Increment only when the intended fresh-workspace composition changes. A
// versioned key prevents a structurally valid older layout from silently
// overriding the new product default.
const ACCESSORY_PANEL_MINIMUM_WIDTH = 250;
const ACCESSORY_PANEL_MAXIMUM_WIDTH = 520;
const PANEL_TAB_BAR_HEIGHT = 34;
const TAB_MERGE_PRIORITY_EXTENSION = 18;
const SIDE_DOCK_ACTIVATION_DISTANCE = 22;

const allowsWorkspaceDockTarget = (
  workspaceElement: HTMLElement | null,
  kind: 'tab' | 'header_space' | 'content' | 'edge',
  position: 'top' | 'bottom' | 'left' | 'right' | 'center',
  group: { readonly api: { readonly boundingBox?: {
    readonly left: number;
    readonly width: number;
  } } } | undefined,
  clientX: number
): boolean => {
  if (position === 'top' || position === 'bottom') return false;
  if (position !== 'left' && position !== 'right') return true;
  if (!workspaceElement) return false;

  const workspaceBounds = workspaceElement.getBoundingClientRect();
  const targetBounds = kind === 'edge' ? undefined : group?.api.boundingBox;
  const left = targetBounds ? workspaceBounds.left + targetBounds.left : workspaceBounds.left;
  const right = targetBounds ? left + targetBounds.width : workspaceBounds.right;
  const distance = position === 'left' ? clientX - left : right - clientX;
  return distance >= 0 && distance <= SIDE_DOCK_ACTIVATION_DISTANCE;
};

type FloatingFrameBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type DockviewFloatingGroupBridge = {
  overlay: { element: HTMLElement };
  position: (bounds: FloatingFrameBounds) => void;
};

type DockviewApiFloatingGroupsBridge = {
  component?: { floatingGroups?: readonly DockviewFloatingGroupBridge[] };
};

const normalizeFloatingFrameBounds = (
  api: DockviewApi | null,
  frame: HTMLElement,
  workspaceElement: HTMLElement
) => {
  if (!api) return;
  // Dockview currently exposes floating-group positioning only on its
  // component bridge. Keep that private integration isolated here.
  const floatingGroups = (api as unknown as DockviewApiFloatingGroupsBridge)
    .component?.floatingGroups;
  const floatingGroup = floatingGroups?.find((candidate) => candidate.overlay.element === frame);
  if (!floatingGroup) return;

  const workspaceBounds = workspaceElement.getBoundingClientRect();
  const frameBounds = frame.getBoundingClientRect();
  frame.style.removeProperty('left');
  frame.style.removeProperty('right');
  frame.style.removeProperty('top');
  frame.style.removeProperty('bottom');
  floatingGroup.position({
    left: frameBounds.left - workspaceBounds.left,
    top: frameBounds.top - workspaceBounds.top,
    width: frameBounds.width,
    height: frameBounds.height
  });
};

type WorkspaceContentKey = 'documentHost' | string;

export interface LightTableWorkspaceDocument {
  id: string;
  title: string;
  content: React.ReactNode;
  dirty?: boolean;
  thumbnailUrl?: string;
  onClose?: () => void;
}

interface LightTableDockWorkspaceProps {
  canvasOnly?: boolean;
  /** Only the visible document may publish the shared application workspace. */
  persistenceEnabled?: boolean;
  documentKind?: 'image' | 'video' | 'model-3d';
  documents: LightTableWorkspaceDocument[];
  activeDocumentId: string;
  panels: LightTableWorkspacePanelRegistration[];
  status: EditorStatusBarProps;
  accessoryWidthConstraintsEnabled: boolean;
  onResizeInteractionChange?: (active: boolean) => void;
  onActiveDocumentChange?: (documentId: string) => void;
  onDocumentSurfaceReady?: () => void;
}

type DockColumnSide = 'left' | 'right';

interface DockColumnState {
  available: boolean;
  visible: boolean;
}

type DockColumnStates = Record<DockColumnSide, DockColumnState>;

const EMPTY_DOCK_COLUMN_STATES: DockColumnStates = {
  left: { available: false, visible: false },
  right: { available: false, visible: false }
};

export interface LightTableDockWorkspaceHandle {
  resetLayout: () => void;
  applyPreset: (preset: SelectableLightTableWorkspacePreset) => void;
  showPanel: (panelId: string) => void;
}

type WorkspaceContent = Record<WorkspaceContentKey, React.ReactNode>;

const WorkspaceContentContext = createContext<WorkspaceContent | null>(null);

const WorkspacePanel: React.FC<IDockviewPanelProps<{ contentKey: WorkspaceContentKey }>> = ({ params }) => {
  const content = useContext(WorkspaceContentContext);
  if (!content) return null;
  return <>{content[params.contentKey]}</>;
};

const PersistentPanelTab: React.FC<IDockviewPanelHeaderProps> = (props) => (
  <DockviewDefaultTab {...props} hideClose />
);

const applyWorkspacePanelConstraints = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean
) => {
  const minimumWidth = widthConstraintsEnabled ? ACCESSORY_PANEL_MINIMUM_WIDTH : 0;
  api.getPanel(DOCUMENT_HOST_PANEL_ID)?.api.setConstraints({
    minimumWidth
  });
  panels.forEach((panel) => {
    api.getPanel(panel.id)?.api.setConstraints({
      minimumWidth,
      maximumWidth: widthConstraintsEnabled
        ? ACCESSORY_PANEL_MAXIMUM_WIDTH
        : Number.MAX_SAFE_INTEGER,
      ...(panel.minimumHeight === undefined ? {} : { minimumHeight: panel.minimumHeight })
    });
  });
};

const synchronizeWorkspacePanelTitles = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[]
) => {
  panels.forEach((panel) => {
    const restoredPanel = api.getPanel(panel.id);
    if (restoredPanel?.api.title !== panel.title) {
      restoredPanel?.api.setTitle(panel.title);
    }
  });
};

const applyWorkspacePanelRenderers = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[]
) => {
  panels.forEach((panel) => {
    const restoredPanel = api.getPanel(panel.id);
    if (restoredPanel?.api.renderer !== 'onlyWhenVisible') {
      restoredPanel?.api.setRenderer('onlyWhenVisible');
    }
  });
};

const addRegisteredPanel = (
  api: DockviewApi,
  panel: LightTableWorkspacePanelRegistration
) => {
  const referencePanel = api.getPanel(panel.defaultPosition.referencePanelId);
  if (!referencePanel) return null;
  return api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: panel.id,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: panel.title,
    params: { contentKey: panel.contentKey },
    renderer: 'onlyWhenVisible',
    position: {
      referencePanel,
      direction: panel.defaultPosition.direction
    },
    inactive: panel.initiallyInactive,
    initialWidth: panel.initialWidth,
    initialHeight: panel.initialHeight,
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH,
    minimumHeight: panel.minimumHeight
  });
};

const createDefaultLayout = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean
) => {
  const documentHost = api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: DOCUMENT_HOST_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Documents',
    params: { contentKey: 'documentHost' },
    renderer: 'always',
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH
  });
  documentHost.group.header.hidden = true;
  // Keep the document header hidden, but allow its content drop target to
  // receive panel drops. LightTable converts a centre drop there into a
  // floating panel; edge drops remain regular Dockview splits.
  documentHost.group.locked = false;
  // Build sequentially. A panel that starts floating must become a floating
  // group before a later registration can be added `within` that group.
  // Otherwise Dockview leaves the later tab behind in the original dock.
  panels.forEach((panel) => {
    const dockPanel = addRegisteredPanel(api, panel);
    const floating = panel.defaultFloating;
    if (!floating || !dockPanel) return;

    const width = Math.min(floating.width, Math.max(250, api.width - 24));
    const height = Math.min(floating.height, Math.max(240, api.height - 24));
    api.addFloatingGroup(dockPanel, {
      x: Math.max(12, Math.min(Math.round(api.width * floating.xRatio), api.width - width - 12)),
      y: Math.max(12, Math.min(Math.round(api.height * floating.yRatio), api.height - height - 12)),
      width,
      height
    });
  });
  applyWorkspacePanelConstraints(api, panels, widthConstraintsEnabled);
};

/**
 * Rebuilds only the accessory portion of the workspace.
 *
 * The document host owns the live canvas surface and must never participate in
 * a workspace-layout transaction. Floating groups are user-positioned UI and
 * remain stable across presets; only docked accessories follow the preset.
 */
const rebuildAccessoryLayout = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  basePanels: readonly LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean,
  preserveFloatingGroups: boolean
) => {
  const preservedPanelIds = new Set<string>();
  if (preserveFloatingGroups) {
    const basePanelsById = new Map(basePanels.map((panel) => [panel.id, panel]));
    api.groups.forEach((group) => {
      if (group.api.location.type !== 'floating') return;
      group.panels.forEach((panel) => {
        const requested = panels.find((candidate) => candidate.id === panel.id);
        const base = basePanelsById.get(panel.id);
        if (
          requested
          && base
          && requested.defaultPosition.referencePanelId === base.defaultPosition.referencePanelId
          && requested.defaultPosition.direction === base.defaultPosition.direction
        ) preservedPanelIds.add(panel.id);
      });
    });
  }

  for (const panel of panels) {
    const existing = api.getPanel(panel.id);
    if (!existing) continue;
    if (preservedPanelIds.has(panel.id)) continue;
    api.removePanel(existing);
  }

  for (const panel of panels) {
    if (api.getPanel(panel.id)) continue;
    const dockPanel = addRegisteredPanel(api, panel);
    const floating = panel.defaultFloating;
    if (!floating || !dockPanel) continue;

    const width = Math.min(floating.width, Math.max(250, api.width - 24));
    const height = Math.min(floating.height, Math.max(240, api.height - 24));
    api.addFloatingGroup(dockPanel, {
      x: Math.max(12, Math.min(Math.round(api.width * floating.xRatio), api.width - width - 12)),
      y: Math.max(12, Math.min(Math.round(api.height * floating.yRatio), api.height - height - 12)),
      width,
      height
    });
  }

  const documentHost = api.getPanel(DOCUMENT_HOST_PANEL_ID);
  if (!documentHost) throw new Error('Workspace layout lost the document host.');
  documentHost.group.header.hidden = true;
  documentHost.group.locked = false;
  applyWorkspacePanelConstraints(api, panels, widthConstraintsEnabled);
};

const activateWorkspacePresetPanels = (
  api: DockviewApi,
  preset: SelectableLightTableWorkspacePreset
) => {
  const activePanelIds = preset === 'grading'
    ? [LIGHTTABLE_WORKSPACE_PANEL_IDS.scopes, LIGHTTABLE_WORKSPACE_PANEL_IDS.properties]
    : preset === 'ai-generation'
      ? [
          LIGHTTABLE_WORKSPACE_PANEL_IDS.layers,
          LIGHTTABLE_WORKSPACE_PANEL_IDS.aiHistory,
          LIGHTTABLE_WORKSPACE_PANEL_IDS.genAi
        ]
      : preset === 'video'
        ? [LIGHTTABLE_WORKSPACE_PANEL_IDS.properties]
        : [LIGHTTABLE_WORKSPACE_PANEL_IDS.layers, LIGHTTABLE_WORKSPACE_PANEL_IDS.properties];
  activePanelIds.forEach((panelId) => api.getPanel(panelId)?.api.setActive());
};

const isUsableSavedLayout = (
  layout: SerializedDockview,
  panels: LightTableWorkspacePanelRegistration[]
) =>
  Boolean(
    layout.panels[DOCUMENT_HOST_PANEL_ID] &&
    panels
      .filter((panel) => panel.requiredForSavedLayout)
      .every((panel) => layout.panels[panel.id])
  );

const restoreLayout = (
  api: DockviewApi,
  panels: LightTableWorkspacePanelRegistration[],
  widthConstraintsEnabled: boolean,
  layout: SerializedDockview | undefined
) => {
  try {
    if (!layout) return false;
    if (!isUsableSavedLayout(layout, panels)) {
      clearWorkspaceLayout(localStorage);
      return false;
    }
    api.fromJSON(layout);
    const documentHost = api.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (!documentHost) return false;
    // The document host deliberately hides its Dockview header. If another
    // panel ever lands in that group, its tab becomes unreachable and replaces
    // the canvas. Reject such a saved layout instead of reopening a bricked UI.
    if (
      documentHost.group.panels.length !== 1 ||
      documentHost.group.panels[0]?.id !== DOCUMENT_HOST_PANEL_ID
    ) {
      api.clear();
      clearWorkspaceLayout(localStorage);
      return false;
    }
    documentHost.group.header.hidden = true;
    documentHost.group.locked = false;
    panels.forEach((panel) => {
      if (!api.getPanel(panel.id)) addRegisteredPanel(api, panel);
    });
    // Serialized Dockview layouts include titles. Product-owned labels remain
    // authoritative when an older saved layout is restored.
    synchronizeWorkspacePanelTitles(api, panels);
    // Older serialized layouts retain their original renderer strategy.
    // Reassert the product policy so hidden heavy inspectors do not remain
    // mounted merely because the user upgraded from an older workspace.
    applyWorkspacePanelRenderers(api, panels);
    applyWorkspacePanelConstraints(api, panels, widthConstraintsEnabled);
    return true;
  } catch {
    clearWorkspaceLayout(localStorage);
    return false;
  }
};

const DocumentHost: React.FC<{
  documents: LightTableWorkspaceDocument[];
  activeDocumentId: string;
  onActiveDocumentChange?: (documentId: string) => void;
  onSurfaceReady?: () => void;
}> = ({ documents, activeDocumentId, onActiveDocumentChange, onSurfaceReady }) => {
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? documents[0];
  const [hoveredDocumentId, setHoveredDocumentId] = useState<string | null>(null);

  useLayoutEffect(() => {
    // Dockview creates panel contents after the parent editor effects have
    // already run. Notify the editor on the next frame, when the document and
    // sibling scope canvases have all committed their refs.
    const frame = window.requestAnimationFrame(() => onSurfaceReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [onSurfaceReady]);

  return (
    <section className="lighttable-document-host">
      <div className="lighttable-document-tabs" role="tablist" aria-label="Open LightTable documents">
        {documents.map((document) => {
          const active = document.id === activeDocument?.id;
          return (
            <div
              key={document.id}
              className={`lighttable-document-tab${active ? ' lighttable-document-tab--active' : ''}`}
              role="tab"
              aria-selected={active}
              draggable
              onDragStart={(event) => writeLightTableDocumentDrag(event.dataTransfer, document.id, document.title)}
              onMouseEnter={(event) => {
                setHoveredDocumentId(document.id);
                const bounds = event.currentTarget.getBoundingClientRect();
                const preview = event.currentTarget.querySelector<HTMLElement>('.lighttable-document-tab__preview');
                if (!preview) return;
                preview.style.left = `${Math.round(bounds.left)}px`;
                preview.style.top = `${Math.round(bounds.bottom)}px`;
                // Dockview positions panels with transforms. A fixed descendant
                // therefore uses that transformed panel as its containing block,
                // not the viewport. Measure the actual result and remove that
                // container offset so the preview touches its tab exactly.
                const positioned = preview.getBoundingClientRect();
                preview.style.left = `${Math.round(bounds.left * 2 - positioned.left)}px`;
                preview.style.top = `${Math.round(bounds.bottom * 2 - positioned.top)}px`;
              }}
              onMouseLeave={() => setHoveredDocumentId((current) => current === document.id ? null : current)}
            >
              {document.thumbnailUrl && !active ? (
                <div className="lighttable-document-tab__preview" role="tooltip">
                  {hoveredDocumentId === document.id ? <img src={document.thumbnailUrl} alt="" /> : null}
                </div>
              ) : null}
              <ButtonBase
                type="button"
                className="lighttable-document-tab__title"
                title={document.title}
                onClick={() => onActiveDocumentChange?.(document.id)}
              >
                {document.title}
                {document.dirty ? <span aria-label="Unsaved changes"> *</span> : null}
              </ButtonBase>
              {document.onClose ? (
                <ButtonBase
                  type="button"
                  className="lighttable-document-tab__close"
                  aria-label={`Close ${document.title}`}
                  title={`Close ${document.title}`}
                  onClick={document.onClose}
                >
                  ×
                </ButtonBase>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="lighttable-document-host__content">
        {activeDocument?.content ?? (
          <div className="lighttable-document-host__empty">No document open</div>
        )}
      </div>
    </section>
  );
};

export const LightTableDockWorkspace = forwardRef<
  LightTableDockWorkspaceHandle,
  LightTableDockWorkspaceProps
>(({
  canvasOnly = false,
  persistenceEnabled = true,
  documentKind = 'image',
  documents,
  activeDocumentId,
  panels,
  status,
  accessoryWidthConstraintsEnabled,
  onResizeInteractionChange,
  onActiveDocumentChange,
  onDocumentSurfaceReady
}, ref) => {
  const apiRef = useRef<DockviewApi | null>(null);
  const workspaceElementRef = useRef<HTMLDivElement | null>(null);
  const layoutListenerRef = useRef<{ dispose: () => void } | null>(null);
  const dropListenerRef = useRef<{ dispose: () => void } | null>(null);
  const dropOverlayListenerRef = useRef<{ dispose: () => void } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const presetFinalizeTimerRef = useRef<number | null>(null);
  const workspacePresetRef = useRef<LightTableWorkspacePreset>('default');
  const preVideoWorkspaceRef = useRef<{
    readonly preset: LightTableWorkspacePreset;
    readonly layout: SerializedDockview;
  } | null>(null);
  const automaticVideoWorkspaceRef = useRef(false);
  const automaticWorkspaceDocumentRef = useRef<string | null>(null);
  const resettingLayoutRef = useRef(false);
  const userLayoutMutationRef = useRef(false);
  const canvasOnlyMaximizedRef = useRef(false);
  const lastLayoutChangeAtRef = useRef(0);
  const dockColumnGroupIdsRef = useRef<Record<DockColumnSide, string[]>>({
    left: [],
    right: []
  });
  const tabRestoreVisibilityRef = useRef<Record<DockColumnSide, boolean>>({
    left: true,
    right: true
  });
  const dockColumnSyncFrameRef = useRef<number | null>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const persistenceEnabledRef = useRef(persistenceEnabled);
  persistenceEnabledRef.current = persistenceEnabled;
  const panelLayoutSignature = panels
    .map((panel) => [
      panel.id,
      panel.contentKey,
      panel.title,
      panel.defaultPosition.referencePanelId,
      panel.defaultPosition.direction,
      panel.initialWidth,
      panel.initialHeight,
      panel.minimumHeight,
      panel.defaultFloating?.width,
      panel.defaultFloating?.height,
      panel.defaultFloating?.xRatio,
      panel.defaultFloating?.yRatio,
      panel.initiallyInactive,
      panel.requiredForSavedLayout
    ].join(':'))
    .join('|');
  const [ready, setReady] = useState(false);
  const [dockColumns, setDockColumns] = useState<DockColumnStates>(EMPTY_DOCK_COLUMN_STATES);
  const [workspacePreset, setWorkspacePreset] = useState<LightTableWorkspacePreset>('default');

  const schedulePresetTransactionFinalization = useCallback((api = apiRef.current) => {
    if (presetFinalizeTimerRef.current !== null) {
      window.clearTimeout(presetFinalizeTimerRef.current);
    }
    presetFinalizeTimerRef.current = window.setTimeout(() => {
      presetFinalizeTimerRef.current = null;
      const currentApi = apiRef.current;
      if (!currentApi || (api && currentApi !== api)) return;
      setWorkspacePreset(workspacePresetRef.current);
      if (persistenceEnabledRef.current) {
        persistWorkspaceLayout(localStorage, currentApi.toJSON(), workspacePresetRef.current);
      }
      resettingLayoutRef.current = false;
    }, 180);
  }, []);

  const refreshDockColumns = useCallback((api = apiRef.current) => {
    if (!api) return;
    const documentGroup = api.getPanel(DOCUMENT_HOST_PANEL_ID)?.group;
    const documentBounds = documentGroup?.api.boundingBox;
    if (!documentGroup || !documentBounds) return;

    const storedIds = dockColumnGroupIdsRef.current;
    const nextIds: Record<DockColumnSide, string[]> = {
      left: storedIds.left.filter((id) => Boolean(api.getGroup(id))),
      right: storedIds.right.filter((id) => Boolean(api.getGroup(id)))
    };
    const documentLeft = documentBounds.left;
    const documentRight = documentBounds.left + documentBounds.width;
    const tolerance = 1;

    api.groups.forEach((group) => {
      if (group.id === documentGroup.id || !group.api.isVisible) return;
      const location = group.api.location;
      if (location.type !== 'grid' && location.type !== 'edge') return;
      const bounds = group.api.boundingBox;
      if (!bounds) return;
      const groupRight = bounds.left + bounds.width;
      const side: DockColumnSide | null = groupRight <= documentLeft + tolerance
        ? 'left'
        : bounds.left >= documentRight - tolerance
          ? 'right'
          : null;
      if (side && !nextIds[side].includes(group.id)) nextIds[side].push(group.id);
    });

    dockColumnGroupIdsRef.current = nextIds;
    const nextState: DockColumnStates = {
      left: {
        available: nextIds.left.length > 0,
        visible: nextIds.left.some((id) => api.getGroup(id)?.api.isVisible)
      },
      right: {
        available: nextIds.right.length > 0,
        visible: nextIds.right.some((id) => api.getGroup(id)?.api.isVisible)
      }
    };
    setDockColumns((current) => (
      current.left.available === nextState.left.available
      && current.left.visible === nextState.left.visible
      && current.right.available === nextState.right.available
      && current.right.visible === nextState.right.visible
        ? current
        : nextState
    ));
  }, []);

  const scheduleDockColumnRefresh = useCallback((api = apiRef.current) => {
    if (!api) return;
    if (dockColumnSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dockColumnSyncFrameRef.current);
    }
    dockColumnSyncFrameRef.current = window.requestAnimationFrame(() => {
      dockColumnSyncFrameRef.current = null;
      refreshDockColumns(api);
    });
  }, [refreshDockColumns]);

  const applyDockColumnVisibility = useCallback((
    visibility: Partial<Record<DockColumnSide, boolean>>
  ) => {
    const api = apiRef.current;
    if (!api) return;
    if (
      dockColumnGroupIdsRef.current.left.length === 0
      && dockColumnGroupIdsRef.current.right.length === 0
    ) refreshDockColumns(api);

    resettingLayoutRef.current = true;
    (Object.entries(visibility) as [DockColumnSide, boolean][]).forEach(([side, visible]) => {
      dockColumnGroupIdsRef.current[side].forEach((groupId) => {
        api.getGroup(groupId)?.api.setVisible(visible);
      });
    });
    setDockColumns((current) => ({
      left: visibility.left === undefined
        ? current.left
        : { ...current.left, visible: current.left.available && visibility.left },
      right: visibility.right === undefined
        ? current.right
        : { ...current.right, visible: current.right.available && visibility.right }
    }));
    window.queueMicrotask(() => {
      resettingLayoutRef.current = false;
    });
  }, [refreshDockColumns]);

  const saveLayout = useCallback(() => {
    lastLayoutChangeAtRef.current = performance.now();
    if (saveTimerRef.current !== null) return;

    const persistWhenSettled = () => {
      const remaining = 150 - (performance.now() - lastLayoutChangeAtRef.current);
      if (remaining > 0) {
        saveTimerRef.current = window.setTimeout(persistWhenSettled, remaining);
        return;
      }
      saveTimerRef.current = null;
      const api = apiRef.current;
      if (!api || !persistenceEnabledRef.current) return;
      try {
        persistWorkspaceLayout(localStorage, api.toJSON(), workspacePresetRef.current);
      } catch {
        // A workspace remains usable when browser storage is unavailable.
      }
    };

    saveTimerRef.current = window.setTimeout(persistWhenSettled, 150);
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    resettingLayoutRef.current = true;
    if (presetFinalizeTimerRef.current !== null) {
      window.clearTimeout(presetFinalizeTimerRef.current);
    }
    const saved = readWorkspaceLayout(localStorage);
    workspacePresetRef.current = saved?.preset ?? 'default';
    setWorkspacePreset(workspacePresetRef.current);
    if (!restoreLayout(
      event.api,
      panelsRef.current,
      accessoryWidthConstraintsEnabled,
      saved?.layout
    )) {
      createDefaultLayout(event.api, panelsRef.current, accessoryWidthConstraintsEnabled);
    }
    layoutListenerRef.current?.dispose();
    layoutListenerRef.current = event.api.onDidLayoutChange(() => {
      scheduleDockColumnRefresh(event.api);
      if (resettingLayoutRef.current) return;
      if (!persistenceEnabledRef.current) return;
      // Dockview also emits for host/document geometry changes. Only an
      // explicit panel manipulation turns a named workspace into Custom.
      if (!userLayoutMutationRef.current) return;
      userLayoutMutationRef.current = false;
      workspacePresetRef.current = 'custom';
      setWorkspacePreset('custom');
      saveLayout();
    });
    dropListenerRef.current?.dispose();
    dropOverlayListenerRef.current?.dispose();
    dropOverlayListenerRef.current = event.api.onWillShowOverlay((overlayEvent) => {
      if (!allowsWorkspaceDockTarget(
        workspaceElementRef.current,
        overlayEvent.kind,
        overlayEvent.position,
        overlayEvent.group,
        overlayEvent.nativeEvent.clientX
      )) overlayEvent.preventDefault();
    });
    dropListenerRef.current = event.api.onWillDrop((dropEvent) => {
      const transfer = dropEvent.getData();
      if (!transfer || transfer.viewId !== event.api.id) return;
      if (transfer.panelId === DOCUMENT_HOST_PANEL_ID) return;
      userLayoutMutationRef.current = true;
      if (!allowsWorkspaceDockTarget(
        workspaceElementRef.current,
        dropEvent.kind,
        dropEvent.position,
        dropEvent.group,
        dropEvent.nativeEvent.clientX
      )) {
        dropEvent.preventDefault();
        return;
      }

      const targetIsDocument = dropEvent.group?.panels.some(
        (panel) => panel.id === DOCUMENT_HOST_PANEL_ID
      );
      const sourceGroup = transfer.groupId ? event.api.getGroup(transfer.groupId) : undefined;
      const item = transfer.panelId
        ? event.api.getPanel(transfer.panelId)
        : sourceGroup?.activePanel;
      const draggedDockItem = transfer.panelId ? item : sourceGroup;
      if (transfer.panelId && !item) return;

      // Dockview normally lets the top content split-zone start immediately
      // below the tab bar. That makes combining panels as tabs unnecessarily
      // precise: missing the bar by one pixel creates a new row. Extend the
      // tab target slightly into the content, while keeping the rest of the
      // top split-zone available for deliberate vertical splits.
      if (
        !targetIsDocument &&
        dropEvent.kind === 'content' &&
        dropEvent.position === 'top' &&
        dropEvent.group &&
        sourceGroup &&
        sourceGroup.id !== dropEvent.group.id &&
        !transfer.tabGroupId
      ) {
        const workspaceElement = workspaceElementRef.current;
        const targetBounds = dropEvent.group.api.boundingBox;
        if (workspaceElement && targetBounds) {
          const workspaceBounds = workspaceElement.getBoundingClientRect();
          const pointerY = dropEvent.nativeEvent.clientY - workspaceBounds.top;
          const mergeBoundary =
            targetBounds.top + PANEL_TAB_BAR_HEIGHT + TAB_MERGE_PRIORITY_EXTENSION;

          if (pointerY <= mergeBoundary) {
            const targetGroup = dropEvent.group;
            dropEvent.preventDefault();
            window.queueMicrotask(() => {
              if (apiRef.current !== event.api) return;
              if (transfer.panelId) {
                item?.api.moveTo({ group: targetGroup, position: 'center' });
              } else {
                sourceGroup.api.moveTo({ group: targetGroup, position: 'center' });
              }
            });
            return;
          }
        }
      }

      if (
        !targetIsDocument ||
        dropEvent.kind !== 'content' ||
        dropEvent.position !== 'center'
      ) {
        return;
      }

      // A normal tab drag supplies panelId. Dragging a floating titlebar or a
      // complete single-panel group supplies only groupId; handle both so a
      // group can never silently merge into the headerless document host.
      const workspaceElement = workspaceElementRef.current;
      if (
        !item
        || !draggedDockItem
        || item.id === DOCUMENT_HOST_PANEL_ID
        || !workspaceElement
      ) return;

      dropEvent.preventDefault();
      const rootBounds = workspaceElement.getBoundingClientRect();
      const width = Math.min(
        Math.max(item.group.api.width || 320, 250),
        ACCESSORY_PANEL_MAXIMUM_WIDTH,
        Math.max(250, rootBounds.width - 24)
      );
      // Docked columns are normally workspace-height. Starting a floating
      // panel at that same height makes it awkward to grab and resize.
      const height = Math.min(
        Math.max(Math.round(rootBounds.height * 0.6), 240),
        Math.max(240, rootBounds.height - 24)
      );
      const relativeX = dropEvent.nativeEvent.clientX - rootBounds.left;
      const relativeY = dropEvent.nativeEvent.clientY - rootBounds.top;
      const x = Math.max(0, Math.min(relativeX - 40, rootBounds.width - width));
      const y = Math.max(0, Math.min(relativeY - 15, rootBounds.height - height));

      // Cancel Dockview's normal centre docking. Mutate the layout after the
      // current drop handler has unwound so the source group remains valid.
      window.queueMicrotask(() => {
        if (apiRef.current !== event.api) return;
        // A tab drag floats one panel; dragging the empty tabbar floats the
        // complete group so tabs such as Layers + Scopes stay together.
        event.api.addFloatingGroup(
          draggedDockItem as Parameters<DockviewApi['addFloatingGroup']>[0],
          { x, y, width, height }
        );
      });
    });
    scheduleDockColumnRefresh(event.api);
    setReady(true);
    schedulePresetTransactionFinalization(event.api);
  }, [
    accessoryWidthConstraintsEnabled,
    saveLayout,
    scheduleDockColumnRefresh,
    schedulePresetTransactionFinalization
  ]);

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    resettingLayoutRef.current = true;
    userLayoutMutationRef.current = false;
    workspacePresetRef.current = 'default';
    setWorkspacePreset('default');
    dockColumnGroupIdsRef.current = { left: [], right: [] };
    setDockColumns(EMPTY_DOCK_COLUMN_STATES);
    clearWorkspaceLayout(localStorage);
    rebuildAccessoryLayout(
      api,
      panelsRef.current,
      panelsRef.current,
      accessoryWidthConstraintsEnabled,
      false
    );
    scheduleDockColumnRefresh(api);
    saveLayout();
    window.queueMicrotask(() => { resettingLayoutRef.current = false; });
  }, [accessoryWidthConstraintsEnabled, saveLayout, scheduleDockColumnRefresh]);

  const applyPreset = useCallback((preset: SelectableLightTableWorkspacePreset) => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (presetFinalizeTimerRef.current !== null) {
      window.clearTimeout(presetFinalizeTimerRef.current);
      presetFinalizeTimerRef.current = null;
    }
    resettingLayoutRef.current = true;
    userLayoutMutationRef.current = false;
    workspacePresetRef.current = preset;
    setWorkspacePreset(preset);
    dockColumnGroupIdsRef.current = { left: [], right: [] };
    setDockColumns(EMPTY_DOCK_COLUMN_STATES);
    clearWorkspaceLayout(localStorage);
    try {
      const presetPanels = panelsForWorkspacePreset(panelsRef.current, preset);
      rebuildAccessoryLayout(
        api,
        presetPanels,
        panelsRef.current,
        accessoryWidthConstraintsEnabled,
        true
      );
      activateWorkspacePresetPanels(api, preset);
      scheduleDockColumnRefresh(api);
    } finally {
      // Dockview emits final layout events after the synchronous rebuild.
      // Keep the preset transaction authoritative while they settle so an
      // event cannot immediately relabel a deliberate preset as "custom".
      schedulePresetTransactionFinalization(api);
    }
  }, [
    accessoryWidthConstraintsEnabled,
    scheduleDockColumnRefresh,
    schedulePresetTransactionFinalization
  ]);

  useEffect(() => {
    if (!ready || !persistenceEnabled) return;
    if (automaticWorkspaceDocumentRef.current === activeDocumentId) return;
    automaticWorkspaceDocumentRef.current = activeDocumentId;
    const api = apiRef.current;
    if (!api) return;

    if (documentKind === 'video') {
      if (workspacePresetRef.current === 'video') {
        automaticVideoWorkspaceRef.current = false;
        return;
      }
      preVideoWorkspaceRef.current = {
        preset: workspacePresetRef.current,
        layout: api.toJSON()
      };
      automaticVideoWorkspaceRef.current = true;
      applyPreset('video');
      return;
    }

    if (!automaticVideoWorkspaceRef.current || workspacePresetRef.current !== 'video') {
      automaticVideoWorkspaceRef.current = false;
      return;
    }
    automaticVideoWorkspaceRef.current = false;
    const previous = preVideoWorkspaceRef.current;
    preVideoWorkspaceRef.current = null;
    if (presetFinalizeTimerRef.current !== null) {
      window.clearTimeout(presetFinalizeTimerRef.current);
      presetFinalizeTimerRef.current = null;
    }
    resettingLayoutRef.current = true;
    if (!previous || !restoreLayout(
      api,
      panelsRef.current,
      accessoryWidthConstraintsEnabled,
      previous.layout
    )) {
      applyPreset('photo-edit');
      return;
    }
    workspacePresetRef.current = previous.preset;
    setWorkspacePreset(previous.preset);
    synchronizeWorkspacePanelTitles(api, panelsRef.current);
    applyWorkspacePanelRenderers(api, panelsRef.current);
    scheduleDockColumnRefresh(api);
    schedulePresetTransactionFinalization(api);
  }, [
    accessoryWidthConstraintsEnabled,
    activeDocumentId,
    applyPreset,
    documentKind,
    persistenceEnabled,
    ready,
    scheduleDockColumnRefresh,
    schedulePresetTransactionFinalization
  ]);

  const toggleDockColumn = useCallback((side: DockColumnSide) => {
    userLayoutMutationRef.current = true;
    applyDockColumnVisibility({ [side]: !dockColumns[side].visible });
  }, [applyDockColumnVisibility, dockColumns]);

  const showPanel = useCallback((panelId: string) => {
    const api = apiRef.current;
    const panel = api?.getPanel(panelId);
    if (!api || !panel) return;
    userLayoutMutationRef.current = true;
    const groupId = panel.group.id;
    if (dockColumnGroupIdsRef.current.left.includes(groupId)) {
      applyDockColumnVisibility({ left: true });
    } else if (dockColumnGroupIdsRef.current.right.includes(groupId)) {
      applyDockColumnVisibility({ right: true });
    }
    panel.api.setActive();
  }, [applyDockColumnVisibility]);

  useImperativeHandle(
    ref,
    () => ({ resetLayout, applyPreset, showPanel }),
    [applyPreset, resetLayout, showPanel]
  );

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    if (presetFinalizeTimerRef.current !== null) {
      window.clearTimeout(presetFinalizeTimerRef.current);
      presetFinalizeTimerRef.current = null;
    }
    if (dockColumnSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(dockColumnSyncFrameRef.current);
      dockColumnSyncFrameRef.current = null;
    }
    layoutListenerRef.current?.dispose();
    layoutListenerRef.current = null;
    dropListenerRef.current?.dispose();
    dropListenerRef.current = null;
    dropOverlayListenerRef.current?.dispose();
    dropOverlayListenerRef.current = null;
    apiRef.current = null;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const api = apiRef.current;
    if (!api) return;
    applyWorkspacePanelConstraints(api, panelsRef.current, accessoryWidthConstraintsEnabled);
    synchronizeWorkspacePanelTitles(api, panelsRef.current);
    applyWorkspacePanelRenderers(api, panelsRef.current);
    const documentHost = api.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (documentHost) {
      documentHost.group.header.hidden = true;
      documentHost.group.locked = false;
    }
    scheduleDockColumnRefresh(api);
  }, [accessoryWidthConstraintsEnabled, panelLayoutSignature, ready, scheduleDockColumnRefresh]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab'
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) return;
      const target = event.target;
      if (
        target instanceof Element
        && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
      ) return;
      if (!dockColumns.left.available && !dockColumns.right.available) return;

      event.preventDefault();
      event.stopPropagation();
      const anyVisible = dockColumns.left.visible || dockColumns.right.visible;
      if (anyVisible) {
        tabRestoreVisibilityRef.current = {
          left: dockColumns.left.visible,
          right: dockColumns.right.visible
        };
        applyDockColumnVisibility({ left: false, right: false });
        return;
      }
      applyDockColumnVisibility({
        left: tabRestoreVisibilityRef.current.left,
        right: tabRestoreVisibilityRef.current.right
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [applyDockColumnVisibility, dockColumns]);

  useLayoutEffect(() => {
    if (!ready) return;
    const api = apiRef.current;
    const documentHost = api?.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (!api || !documentHost) return;

    resettingLayoutRef.current = true;
    if (canvasOnly) {
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      api.maximizeGroup(documentHost);
      canvasOnlyMaximizedRef.current = true;
    } else if (canvasOnlyMaximizedRef.current) {
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      canvasOnlyMaximizedRef.current = false;
    }
    window.queueMicrotask(() => {
      resettingLayoutRef.current = false;
    });
  }, [canvasOnly, ready]);

  useEffect(() => {
    const workspaceElement = workspaceElementRef.current;
    if (!workspaceElement) return;
    let resizing = false;
    let floatingResizeCleanup: (() => void) | null = null;

    const finishResize = () => {
      if (!resizing) return;
      resizing = false;
      floatingResizeCleanup?.();
      floatingResizeCleanup = null;
      onResizeInteractionChange?.(false);
      document.removeEventListener('pointerup', finishResize, true);
      document.removeEventListener('pointercancel', finishResize, true);
      document.removeEventListener('contextmenu', finishResize, true);
    };

    const startResize = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const resizeHandle = target.closest('.dv-sash, [class*="dv-resize-handle-"]');
      if (!resizeHandle || !workspaceElement.contains(resizeHandle)) return;
      if (resizing) return;
      userLayoutMutationRef.current = true;
      resizing = true;
      onResizeInteractionChange?.(true);

      const floatingFrame = resizeHandle.closest<HTMLElement>('.dv-resize-container');
      if (floatingFrame) {
        const direction = Array.from(resizeHandle.classList)
          .find((className) => className.startsWith('dv-resize-handle-'))
          ?.slice('dv-resize-handle-'.length);
        const workspaceBounds = workspaceElement.getBoundingClientRect();
        const frameBounds = floatingFrame.getBoundingClientRect();
        const fixedLeft = frameBounds.left - workspaceBounds.left;
        const fixedRight = workspaceBounds.right - frameBounds.right;
        const fixedTop = frameBounds.top - workspaceBounds.top;
        const fixedBottom = workspaceBounds.bottom - frameBounds.bottom;

        const lockStyle = (property: string, value: string) => {
          if (
            floatingFrame.style.getPropertyValue(property) === value
            && floatingFrame.style.getPropertyPriority(property) === 'important'
          ) return;
          floatingFrame.style.setProperty(property, value, 'important');
        };

        const maintainOppositeEdge = () => {
          if (direction?.includes('right')) {
            lockStyle('left', `${fixedLeft}px`);
            lockStyle('right', 'auto');
          } else if (direction?.includes('left')) {
            lockStyle('right', `${fixedRight}px`);
            lockStyle('left', 'auto');
          }
          if (direction?.includes('bottom')) {
            lockStyle('top', `${fixedTop}px`);
            lockStyle('bottom', 'auto');
          } else if (direction?.includes('top')) {
            lockStyle('bottom', `${fixedBottom}px`);
            lockStyle('top', 'auto');
          }
        };

        maintainOppositeEdge();
        const observer = new MutationObserver(maintainOppositeEdge);
        observer.observe(floatingFrame, { attributes: true, attributeFilter: ['style'] });
        floatingResizeCleanup = () => {
          observer.disconnect();
          normalizeFloatingFrameBounds(apiRef.current, floatingFrame, workspaceElement);
        };
      }

      document.addEventListener('pointerup', finishResize, true);
      document.addEventListener('pointercancel', finishResize, true);
      document.addEventListener('contextmenu', finishResize, true);
    };

    /*
     * Capture is intentional: Dockview may stop propagation from a sash or
     * floating resize handle. The callback must therefore remain imperative
     * and must not synchronously update React state; doing that here can
     * replace Dockview nodes before its pointerdown handler installs capture.
     */
    workspaceElement.addEventListener('pointerdown', startResize, true);
    return () => {
      workspaceElement.removeEventListener('pointerdown', startResize, true);
      document.removeEventListener('pointerup', finishResize, true);
      document.removeEventListener('pointercancel', finishResize, true);
      document.removeEventListener('contextmenu', finishResize, true);
      floatingResizeCleanup?.();
      floatingResizeCleanup = null;
      if (resizing) onResizeInteractionChange?.(false);
    };
  }, [onResizeInteractionChange]);

  const content = useMemo<WorkspaceContent>(() => {
    const registeredContent = Object.fromEntries(
      panels.map((panel) => [panel.contentKey, panel.content])
    ) as WorkspaceContent;
    registeredContent.documentHost = (
      <DocumentHost
        documents={documents}
        activeDocumentId={activeDocumentId}
        onActiveDocumentChange={onActiveDocumentChange}
        onSurfaceReady={onDocumentSurfaceReady}
      />
    );
    return registeredContent;
  }, [activeDocumentId, documents, onActiveDocumentChange, onDocumentSurfaceReady, panels]);

  const components = useMemo(() => ({ workspacePanel: WorkspacePanel }), []);
  const tabComponents = useMemo(() => ({ persistentPanelTab: PersistentPanelTab }), []);

  return (
    <WorkspaceContentContext.Provider value={content}>
      <div className="lighttable-dock-workspace-shell">
        <div
          ref={workspaceElementRef}
          className={`lighttable-dock-workspace dockview-theme-dark${canvasOnly ? ' lighttable-dock-workspace--canvas-only' : ''}${accessoryWidthConstraintsEnabled ? ' lighttable-dock-workspace--accessory-width-constrained' : ''}`}
        >
          <DockviewReact
            components={components}
            tabComponents={tabComponents}
            onReady={onReady}
            dndEdges={{
              activationSize: { value: SIDE_DOCK_ACTIVATION_DISTANCE, type: 'pixels' },
              size: { value: SIDE_DOCK_ACTIVATION_DISTANCE, type: 'pixels' }
            }}
            floatingGroupBounds="boundedWithinViewport"
            // Reuse the empty area to the right of the tabs as the floating
            // window handle. This keeps the header to a single row: dragging a
            // tab redocks that panel, while the empty tabbar moves the float
            // (Shift+drag redocks the complete floating group).
            floatingGroupDragHandle="tabbar"
          />
        </div>
        <EditorStatusBar
          {...status}
          leftDockAvailable={dockColumns.left.available}
          leftDockVisible={dockColumns.left.visible}
          rightDockAvailable={dockColumns.right.available}
          rightDockVisible={dockColumns.right.visible}
          onToggleLeftDock={() => toggleDockColumn('left')}
          onToggleRightDock={() => toggleDockColumn('right')}
          workspacePreset={workspacePreset === 'default' ? 'photo-edit' : workspacePreset}
          onWorkspacePresetChange={applyPreset}
        />
      </div>
    </WorkspaceContentContext.Provider>
  );
});

LightTableDockWorkspace.displayName = 'LightTableDockWorkspace';
