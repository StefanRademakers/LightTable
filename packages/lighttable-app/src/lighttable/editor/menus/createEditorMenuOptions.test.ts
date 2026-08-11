import { describe, expect, it, vi } from 'vitest';
import {
  createEditorMenuOptions,
  type EditorMenuCommands,
  type EditorMenuState
} from './createEditorMenuOptions';

const state = (change: Partial<EditorMenuState> = {}): EditorMenuState => ({
  saving: false,
  hasDocument: true,
  hasMetadata: true,
  hasSourceKey: true,
  hasCompatibilityReport: false,
  copiedGradeName: null,
  hasSelection: false,
  selectionClipboardAvailable: false,
  activeChannel: 'pixels',
  layer: {
    type: 'raster',
    hasMask: false,
    maskEnabled: false,
    visible: true,
    locked: false,
    clipping: false,
    activeIndex: 0,
    siblingCount: 1,
    belowIsRaster: false,
    canFlattenGroup: false,
    canDelete: false
  },
  rasterLayerCount: 1,
  layerCount: 1,
  canFlattenImage: false,
  autoAlignPreview: false,
  autoAlignAvailable: false,
  zoomMode: 'fit',
  showOriginal: false,
  showDifference: false,
  blendModes: [
    { id: 'normal', label: 'Normal', selected: true, separatorBefore: false },
    { id: 'multiply', label: 'Multiply', selected: false, separatorBefore: true }
  ],
  ...change
});

const commands = (): EditorMenuCommands => new Proxy({} as EditorMenuCommands, {
  get: (target, property: keyof EditorMenuCommands) => {
    if (property === 'recentFiles' || property === 'recentProjects') return target[property] ?? [];
    if (property === 'activeProject') return target[property] ?? null;
    if (property === 'projectsAvailable') return target[property] ?? false;
    target[property] ??= vi.fn() as never;
    return target[property];
  }
});

const labels = {
  primaryShortcut: (key: string, shift = false) => `Ctrl+${shift ? 'Shift+' : ''}${key}`
};

describe('createEditorMenuOptions', () => {
  it('exposes AI providers with connection state and planned providers disabled', () => {
    const menuCommands = commands();
    const disconnected = createEditorMenuOptions('ai', state(), labels, menuCommands);
    const providers = disconnected[0]?.children;
    expect(disconnected[0]?.label).toBe('Providers');
    expect(providers?.map(({ label, disabled, status }) => ({ label, disabled, status }))).toEqual([
      { label: 'OpenArt', disabled: undefined, status: 'disconnected' },
      { label: 'Higgsfield', disabled: true, status: undefined },
      { label: 'ComfyUI', disabled: true, status: undefined }
    ]);

    const connectedCommands = commands();
    const connected = createEditorMenuOptions(
      'ai', state(), labels, connectedCommands, { openArt: 'connected' }
    );
    expect(connected[0]?.children?.[0]?.status).toBe('connected');
    providers?.[0]?.onClick?.();
    expect(menuCommands.connectOpenArtProvider).toHaveBeenCalledOnce();
    connected[0]?.children?.[0]?.onClick?.();
    expect(connectedCommands.disconnectOpenArtProvider).toHaveBeenCalledOnce();
  });

  it('opens the same GenAI panel from the View menu', () => {
    const menuCommands = commands();
    const option = createEditorMenuOptions('view', state(), labels, menuCommands)
      .find(({ value }) => value === 'show-genai-panel');

    option?.onClick?.();

    expect(option?.label).toBe('GenAI panel');
    expect(menuCommands.showGenAiPanel).toHaveBeenCalledOnce();
  });

  it('keeps the compact file workflow declarative', () => {
    const options = createEditorMenuOptions(
      'file',
      state({ saving: true }),
      labels,
      commands()
    );

    expect(options.map(({ label, shortcut }) => ({ label, shortcut }))).toEqual([
      { label: 'New', shortcut: 'Ctrl+N' },
      { label: 'Open', shortcut: 'Ctrl+O' },
      { label: 'Open place...', shortcut: undefined },
      { label: 'Open Recent', shortcut: undefined },
      { label: 'Saving...', shortcut: 'Ctrl+S' },
      { label: 'Export PNG', shortcut: 'Ctrl+Shift+S' },
      { label: 'Export', shortcut: undefined }
    ]);
    expect(options.filter(({ value }) => value !== 'export').every((option) => option.disabled)).toBe(true);
    expect(options.find(({ value }) => value === 'export')?.children?.slice(0, 3)
      .every((option) => option.disabled)).toBe(true);
    expect(options.find(({ value }) => value === 'export')?.children?.at(-1)?.disabled).not.toBe(true);
  });

  it('groups secondary export formats in one submenu', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions('file', state(), labels, menuCommands);
    const children = options.find(({ value }) => value === 'export')?.children;
    expect(children?.map(({ label }) => label)).toEqual([
      'JPG...', 'Photoshop PSD...', 'PDF...', 'Format Support...'
    ]);
    children?.[0]?.onClick?.();
    children?.[1]?.onClick?.();
    children?.[2]?.onClick?.();
    expect(menuCommands.exportJpeg).toHaveBeenCalledOnce();
    expect(menuCommands.exportPsd).toHaveBeenCalledOnce();
    expect(menuCommands.pdfExportPreflight).toHaveBeenCalledOnce();
  });

  it('shows at most fifteen recent files and clears them from the submenu', () => {
    const menuCommands = commands();
    menuCommands.recentFiles = Array.from({ length: 17 }, (_, index) => ({
      id: `recent-${index}`,
      name: `Document ${index}.psd`,
      available: true
    }));
    const options = createEditorMenuOptions('file', state(), labels, menuCommands);
    const recent = options.find(({ value }) => value === 'open-recent');

    expect(recent?.children).toHaveLength(16);
    recent?.children?.[0]?.onClick?.();
    expect(menuCommands.openRecent).toHaveBeenCalledWith('recent-0');
    expect(recent?.children?.at(-1)).toMatchObject({
      value: 'clear-recent',
      label: 'Clear list',
      separatorBefore: true
    });
    recent?.children?.at(-1)?.onClick?.();
    expect(menuCommands.clearRecent).toHaveBeenCalledOnce();
  });

  it('projects optional project management without changing document commands', () => {
    const menuCommands = commands();
    menuCommands.projectsAvailable = true;
    menuCommands.activeProject = {
      id: 'project-1', name: 'Campaign', rootPath: 'D:/Campaign', manifestPath: 'D:/Campaign/project.ltproject'
    };
    menuCommands.recentProjects = [{
      ...menuCommands.activeProject, recentId: 'recent-project-1', available: true
    }];
    const options = createEditorMenuOptions('file', state(), labels, menuCommands);
    expect(options.map(({ value }) => value)).toEqual([
      'new-document', 'open-image', 'place-image', 'open-recent',
      'save-corrected', 'export-png', 'export',
      'new-project', 'open-project', 'open-recent-project', 'close-project'
    ]);
    expect(options.filter(({ separatorBefore }) => separatorBefore).map(({ value }) => value))
      .toEqual(['export-png', 'new-project']);
    expect(options.find(({ value }) => value === 'close-project')?.label).toBe('Close Project (Campaign)');
    options.find(({ value }) => value === 'open-recent-project')?.children?.[0]?.onClick?.();
    expect(menuCommands.openRecentProject).toHaveBeenCalledWith('recent-project-1');
  });

  it('derives selection availability without reading editor state', () => {
    const options = createEditorMenuOptions(
      'select',
      state({ hasSelection: true }),
      labels,
      commands()
    );

    expect(options.find((option) => option.value === 'select-none')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'feather-selection')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'invert-selection'))
      .toMatchObject({ label: 'Invert selection', shortcut: 'Ctrl+Shift+I' });
  });

  it('keeps every copy command above its corresponding paste command', () => {
    const options = createEditorMenuOptions(
      'edit',
      state({ copiedGradeName: 'Warm grade' }),
      labels,
      commands()
    );
    const values = options.map(({ value }) => value);

    expect(values.indexOf('copy-selected-content')).toBeLessThan(values.indexOf('paste-selected-content'));
    expect(values.indexOf('copy-merged-content')).toBeLessThan(values.indexOf('paste-selected-content'));
    expect(values.indexOf('copy-grade')).toBeLessThan(values.indexOf('paste-grade'));
    expect(options.find(({ value }) => value === 'copy-grade')?.separatorBefore).toBe(true);
  });

  it('guards invalid layer operations and forwards valid blend commands', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions(
      'layer',
      state(),
      labels,
      menuCommands
    );

    expect(options.find((option) => option.value === 'merge-down')?.disabled).toBe(true);
    expect(options.find((option) => option.value === 'delete-layer')?.disabled).toBe(true);
    const blend = options.find((option) => option.value === 'blend-mode');
    expect(blend?.children?.[0].label).toBe('Normal ✓');
    blend?.children?.[1].onClick?.();
    expect(menuCommands.setBlendMode).toHaveBeenCalledWith('multiply');
  });

  it('offers apply/cancel commands only while auto-align has a preview', () => {
    const options = createEditorMenuOptions(
      'layer',
      state({ autoAlignPreview: true }),
      labels,
      commands()
    );

    expect(options.some((option) => option.value === 'apply-auto-align')).toBe(true);
    expect(options.some((option) => option.value === 'cancel-auto-align')).toBe(true);
    expect(options.some((option) => option.value === 'auto-align')).toBe(false);
  });

  it('exposes only completed fixture-safe text layer actions', () => {
    const menuCommands = commands();
    const textLayer = { ...state().layer!, type: 'text' as const };
    const options = createEditorMenuOptions(
      'layer',
      state({ layer: textLayer }),
      labels,
      menuCommands
    );

    expect(options.find((option) => option.value === 'duplicate-layer')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'rename-layer')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'convert-text-to-shape'))
      .toMatchObject({ label: 'Convert to Shape...', disabled: false });
    expect(options.find((option) => option.value === 'rasterize-text')?.label).toBe('Rasterize Type');
    expect(options.find((option) => option.value === 'edit-layer-pixels')?.disabled).toBe(true);
    expect(options.find((option) => option.value === 'delete-layer')?.disabled).toBe(true);
    options.find((option) => option.value === 'rasterize-text')?.onClick?.();
    expect(menuCommands.rasterizeText).toHaveBeenCalledOnce();
    options.find((option) => option.value === 'convert-text-to-shape')?.onClick?.();
    expect(menuCommands.convertTextToShape).toHaveBeenCalledOnce();
  });

  it('exposes convert to shape in the Type menu only for unlocked text', () => {
    const menuCommands = commands();
    const textLayer = { ...state().layer!, type: 'text' as const };

    const available = createEditorMenuOptions(
      'type',
      state({ layer: textLayer }),
      labels,
      menuCommands
    );
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      value: 'convert-text-to-shape',
      label: 'Convert to Shape...',
      disabled: false
    });
    available[0].onClick?.();
    expect(menuCommands.convertTextToShape).toHaveBeenCalledOnce();

    const locked = createEditorMenuOptions(
      'type',
      state({ layer: { ...textLayer, locked: true } }),
      labels,
      commands()
    );
    expect(locked[0].disabled).toBe(true);

    const raster = createEditorMenuOptions('type', state(), labels, commands());
    expect(raster[0].disabled).toBe(true);
  });

  it('keeps view state mutually represented in its labels', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions(
      'view',
      state({ zoomMode: '100', showOriginal: true, showDifference: false }),
      labels,
      menuCommands
    );

    expect(options.find((option) => option.value === 'actual-size')?.label).toBe('100% (current)');
    expect(options.find((option) => option.value === 'fit')?.shortcut).toBe('Ctrl+0');
    expect(options.find((option) => option.value === 'actual-size')?.shortcut).toBe('Ctrl+1');
    expect(options.find((option) => option.value === 'show-original')?.label).toBe('Show corrected');
    expect(options.find((option) => option.value === 'toggle-screen-mode'))
      .toMatchObject({ label: 'Toggle screen mode', shortcut: 'F' });
    expect(options.find((option) => option.value === 'ui-style-guide'))
      .toMatchObject({ label: 'UI Style Guide...' });
    options.find((option) => option.value === 'ui-style-guide')?.onClick?.();
    expect(menuCommands.openStyleGuide).toHaveBeenCalledOnce();
  });

  it('exposes concise third-party license information from Help', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions('help', state(), labels, menuCommands);

    expect(options.map(({ value }) => value)).toEqual([
      'command-help',
      'guided-sample',
      'third-party-licenses',
      'about'
    ]);
    expect(options.find(({ value }) => value === 'third-party-licenses')).toMatchObject({
      label: 'Third-party Licenses...',
      separatorBefore: true
    });
    options.find(({ value }) => value === 'third-party-licenses')?.onClick?.();
    expect(menuCommands.openThirdPartyLicenses).toHaveBeenCalledOnce();
  });
});
