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
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview
} from 'dockview-react';

const DOCUMENT_HOST_PANEL_ID = 'lighttable.document-host';
const SCOPES_PANEL_ID = 'lighttable.scopes';
const GRADE_PANEL_ID = 'lighttable.inspector';
const LENS_FX_PANEL_ID = 'lighttable.lens-fx';
const LAYERS_PANEL_ID = 'lighttable.layers';
const DEBUG_PANEL_ID = 'lighttable.debug';
const WORKSPACE_STORAGE_KEY = 'lighttable.workspace.layout.v1';
const ACCESSORY_PANEL_MINIMUM_WIDTH = 250;
const ACCESSORY_PANEL_MAXIMUM_WIDTH = 520;
const PANEL_TAB_BAR_HEIGHT = 34;
const TAB_MERGE_PRIORITY_EXTENSION = 18;

type WorkspaceContentKey = 'documentHost' | 'scopes' | 'grade' | 'lensFx' | 'layers' | 'debug';

export interface LightTableWorkspaceDocument {
  id: string;
  title: string;
  content: React.ReactNode;
  dirty?: boolean;
  onClose?: () => void;
}

interface LightTableDockWorkspaceProps {
  documents: LightTableWorkspaceDocument[];
  activeDocumentId: string;
  scopes: React.ReactNode;
  grade: React.ReactNode;
  lensFx: React.ReactNode;
  layers: React.ReactNode;
  debug: React.ReactNode;
  accessoryWidthConstraintsEnabled: boolean;
  onResizeInteractionChange?: (active: boolean) => void;
  onActiveDocumentChange?: (documentId: string) => void;
  onDocumentSurfaceReady?: () => void;
}

export interface LightTableDockWorkspaceHandle {
  resetLayout: () => void;
  showDebugPanel: () => void;
}

interface WorkspaceContent {
  documentHost: React.ReactNode;
  scopes: React.ReactNode;
  grade: React.ReactNode;
  lensFx: React.ReactNode;
  layers: React.ReactNode;
  debug: React.ReactNode;
}

const WorkspaceContentContext = createContext<WorkspaceContent | null>(null);

const WorkspacePanel: React.FC<IDockviewPanelProps<{ contentKey: WorkspaceContentKey }>> = ({ params }) => {
  const content = useContext(WorkspaceContentContext);
  if (!content) return null;
  return <>{content[params.contentKey]}</>;
};

const PersistentPanelTab: React.FC<IDockviewPanelHeaderProps> = (props) => (
  <DockviewDefaultTab {...props} hideClose />
);

const applyWorkspacePanelConstraints = (api: DockviewApi, widthConstraintsEnabled: boolean) => {
  const minimumWidth = widthConstraintsEnabled ? ACCESSORY_PANEL_MINIMUM_WIDTH : 0;
  const maximumWidth = widthConstraintsEnabled ? ACCESSORY_PANEL_MAXIMUM_WIDTH : 1_000_000;
  api.getPanel(DOCUMENT_HOST_PANEL_ID)?.api.setConstraints({
    minimumWidth
  });
  [SCOPES_PANEL_ID, GRADE_PANEL_ID, LENS_FX_PANEL_ID, LAYERS_PANEL_ID, DEBUG_PANEL_ID].forEach((panelId) => {
    api.getPanel(panelId)?.api.setConstraints({
      minimumWidth,
      maximumWidth
    });
  });
  api.getPanel(LAYERS_PANEL_ID)?.api.setConstraints({
    minimumWidth,
    maximumWidth,
    minimumHeight: 140
  });
};

const createDefaultLayout = (api: DockviewApi, widthConstraintsEnabled: boolean) => {
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

  const scopes = api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: SCOPES_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Scopes',
    params: { contentKey: 'scopes' },
    renderer: 'always',
    position: { referencePanel: documentHost, direction: 'right' },
    initialWidth: 290,
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH
  });

  const grade = api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: GRADE_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Grade',
    params: { contentKey: 'grade' },
    renderer: 'always',
    position: { referencePanel: scopes, direction: 'right' },
    initialWidth: 310,
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH
  });

  api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: DEBUG_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Debug',
    params: { contentKey: 'debug' },
    renderer: 'always',
    position: { referencePanel: scopes, direction: 'within' },
    inactive: true,
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH
  });

  api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: LENS_FX_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Lens Fx',
    params: { contentKey: 'lensFx' },
    renderer: 'always',
    position: { referencePanel: grade, direction: 'within' },
    inactive: true,
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH
  });

  api.addPanel<{ contentKey: WorkspaceContentKey }>({
    id: LAYERS_PANEL_ID,
    component: 'workspacePanel',
    tabComponent: 'persistentPanelTab',
    title: 'Layers',
    params: { contentKey: 'layers' },
    renderer: 'always',
    position: { referencePanel: grade, direction: 'below' },
    minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
    maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH,
    initialHeight: 220,
    minimumHeight: 140
  });
  applyWorkspacePanelConstraints(api, widthConstraintsEnabled);
};

const isUsableSavedLayout = (layout: SerializedDockview) =>
  Boolean(
    layout.panels[DOCUMENT_HOST_PANEL_ID] &&
    layout.panels[SCOPES_PANEL_ID] &&
    layout.panels[GRADE_PANEL_ID] &&
    layout.panels[LENS_FX_PANEL_ID] &&
    layout.panels[LAYERS_PANEL_ID]
  );

const restoreLayout = (api: DockviewApi, widthConstraintsEnabled: boolean) => {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return false;
    const layout = JSON.parse(raw) as SerializedDockview;
    if (!isUsableSavedLayout(layout)) return false;
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
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      return false;
    }
    documentHost.group.header.hidden = true;
    documentHost.group.locked = false;
    if (!api.getPanel(DEBUG_PANEL_ID)) {
      const scopes = api.getPanel(SCOPES_PANEL_ID);
      if (scopes) {
        api.addPanel<{ contentKey: WorkspaceContentKey }>({
          id: DEBUG_PANEL_ID,
          component: 'workspacePanel',
          tabComponent: 'persistentPanelTab',
          title: 'Debug',
          params: { contentKey: 'debug' },
          renderer: 'always',
          position: { referencePanel: scopes, direction: 'within' },
          inactive: true,
          minimumWidth: ACCESSORY_PANEL_MINIMUM_WIDTH,
          maximumWidth: ACCESSORY_PANEL_MAXIMUM_WIDTH
        });
      }
    }
    applyWorkspacePanelConstraints(api, widthConstraintsEnabled);
    return true;
  } catch {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
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
            >
              <button
                type="button"
                className="lighttable-document-tab__title"
                title={document.title}
                onClick={() => onActiveDocumentChange?.(document.id)}
              >
                {document.title}
                {document.dirty ? <span aria-label="Unsaved changes"> *</span> : null}
              </button>
              {document.onClose ? (
                <button
                  type="button"
                  className="lighttable-document-tab__close"
                  aria-label={`Close ${document.title}`}
                  title={`Close ${document.title}`}
                  onClick={document.onClose}
                >
                  ×
                </button>
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
  documents,
  activeDocumentId,
  scopes,
  grade,
  lensFx,
  layers,
  debug,
  accessoryWidthConstraintsEnabled,
  onResizeInteractionChange,
  onActiveDocumentChange,
  onDocumentSurfaceReady
}, ref) => {
  const apiRef = useRef<DockviewApi | null>(null);
  const workspaceElementRef = useRef<HTMLDivElement | null>(null);
  const layoutListenerRef = useRef<{ dispose: () => void } | null>(null);
  const dropListenerRef = useRef<{ dispose: () => void } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastLayoutChangeAtRef = useRef(0);
  const [ready, setReady] = useState(false);

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
      if (!api) return;
      try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(api.toJSON()));
      } catch {
        // A workspace remains usable when browser storage is unavailable.
      }
    };

    saveTimerRef.current = window.setTimeout(persistWhenSettled, 150);
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    if (!restoreLayout(event.api, accessoryWidthConstraintsEnabled)) {
      createDefaultLayout(event.api, accessoryWidthConstraintsEnabled);
    }
    layoutListenerRef.current?.dispose();
    layoutListenerRef.current = event.api.onDidLayoutChange(saveLayout);
    dropListenerRef.current?.dispose();
    dropListenerRef.current = event.api.onWillDrop((dropEvent) => {
      const transfer = dropEvent.getData();
      if (!transfer || transfer.viewId !== event.api.id) return;
      if (transfer.panelId === DOCUMENT_HOST_PANEL_ID) return;

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
    setReady(true);
  }, [accessoryWidthConstraintsEnabled, saveLayout]);

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    api.clear();
    createDefaultLayout(api, accessoryWidthConstraintsEnabled);
    saveLayout();
  }, [accessoryWidthConstraintsEnabled, saveLayout]);

  const showDebugPanel = useCallback(() => {
    apiRef.current?.getPanel(DEBUG_PANEL_ID)?.api.setActive();
  }, []);

  useImperativeHandle(ref, () => ({ resetLayout, showDebugPanel }), [resetLayout, showDebugPanel]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    layoutListenerRef.current?.dispose();
    layoutListenerRef.current = null;
    dropListenerRef.current?.dispose();
    dropListenerRef.current = null;
    apiRef.current = null;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const api = apiRef.current;
    if (!api) return;
    applyWorkspacePanelConstraints(api, accessoryWidthConstraintsEnabled);
    const documentHost = api.getPanel(DOCUMENT_HOST_PANEL_ID);
    if (documentHost) {
      documentHost.group.header.hidden = true;
      documentHost.group.locked = false;
    }
  }, [accessoryWidthConstraintsEnabled, ready]);

  useEffect(() => {
    const workspaceElement = workspaceElementRef.current;
    if (!workspaceElement || !onResizeInteractionChange) return;
    let resizing = false;

    const finishResize = () => {
      if (!resizing) return;
      resizing = false;
      onResizeInteractionChange(false);
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
      resizing = true;
      onResizeInteractionChange(true);
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
      if (resizing) onResizeInteractionChange(false);
    };
  }, [onResizeInteractionChange]);

  const content = useMemo<WorkspaceContent>(() => ({
    documentHost: (
      <DocumentHost
        documents={documents}
        activeDocumentId={activeDocumentId}
        onActiveDocumentChange={onActiveDocumentChange}
        onSurfaceReady={onDocumentSurfaceReady}
      />
    ),
    scopes,
    grade,
    lensFx,
    layers,
    debug
  }), [activeDocumentId, debug, documents, grade, layers, lensFx, onActiveDocumentChange, onDocumentSurfaceReady, scopes]);

  const components = useMemo(() => ({ workspacePanel: WorkspacePanel }), []);
  const tabComponents = useMemo(() => ({ persistentPanelTab: PersistentPanelTab }), []);

  return (
    <WorkspaceContentContext.Provider value={content}>
      <div ref={workspaceElementRef} className="lighttable-dock-workspace dockview-theme-dark">
        <DockviewReact
          components={components}
          tabComponents={tabComponents}
          onReady={onReady}
          dndEdges={{ size: { value: 24, type: 'pixels' } }}
          floatingGroupBounds="boundedWithinViewport"
          // Reuse the empty area to the right of the tabs as the floating
          // window handle. This keeps the header to a single row: dragging a
          // tab redocks that panel, while the empty tabbar moves the float
          // (Shift+drag redocks the complete floating group).
          floatingGroupDragHandle="tabbar"
        />
      </div>
    </WorkspaceContentContext.Provider>
  );
});

LightTableDockWorkspace.displayName = 'LightTableDockWorkspace';
