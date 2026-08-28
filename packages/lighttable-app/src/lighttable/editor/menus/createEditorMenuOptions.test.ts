import { describe, expect, it, vi } from 'vitest';
import { FILTER_DEFINITIONS } from '@lighttable/filter-core';
import type { ContextMenuOption } from '../../../ui/ContextMenu';
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
  showDifference: false,
  blendModes: [
    { id: 'normal', label: 'Normal', selected: true, separatorBefore: false },
    { id: 'multiply', label: 'Multiply', selected: false, separatorBefore: true }
  ],
  ...change
});

const commands = (): EditorMenuCommands => new Proxy({} as EditorMenuCommands, {
  get: (target, property: keyof EditorMenuCommands) => {
    if (Object.prototype.hasOwnProperty.call(target, property)) return target[property];
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

const findMenuOption = (
  options: readonly ContextMenuOption<string>[],
  value: string
): ContextMenuOption<string> | undefined => {
  for (const option of options) {
    if (option.value === value) return option;
    const nested = findMenuOption(option.children ?? [], value);
    if (nested) return nested;
  }
  return undefined;
};

describe('createEditorMenuOptions', () => {
  it('offers every active filter pack through the shared menu route', () => {
    const menuCommands = commands();
    const filter = createEditorMenuOptions('filter', state(), labels, menuCommands);
    expect(filter.map(({ label }) => label)).toEqual([
      'Blur', 'Blur Gallery', 'Distort', 'Noise', 'Pixelate', 'Render', 'Sharpen',
      'Stylize', 'Filter Gallery', 'Other'
    ]);
    const leaves = filter.flatMap(({ children }) => children ?? []);
    expect(leaves).toHaveLength(FILTER_DEFINITIONS.length);
    const gaussian = findMenuOption(filter, 'filter-gaussian-blur');
    expect(gaussian).toMatchObject({ label: 'Gaussian Blur...', disabled: false });
    gaussian?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('gaussian-blur');
    expect(gaussian?.trailingAction).toMatchObject({
      label: 'Attach Gaussian Blur to selected layer',
      disabled: false
    });
    gaussian?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('gaussian-blur');
    const motion = findMenuOption(filter, 'filter-motion-blur');
    motion?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('motion-blur');
    motion?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('motion-blur');
    const highPass = findMenuOption(filter, 'filter-high-pass');
    highPass?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('high-pass');
    expect(highPass?.trailingAction?.disabled).toBe(false);
    const unsharp = findMenuOption(filter, 'filter-unsharp-mask');
    unsharp?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('unsharp-mask');
    const smart = findMenuOption(filter, 'filter-smart-sharpen');
    smart?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('smart-sharpen');
    smart?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('smart-sharpen');
    const reduceNoise = findMenuOption(filter, 'filter-reduce-noise');
    reduceNoise?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('reduce-noise');
    reduceNoise?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('reduce-noise');
    const offset = findMenuOption(filter, 'filter-offset');
    offset?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('offset');
    offset?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('offset');
    const maximum = findMenuOption(filter, 'filter-maximum');
    maximum?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('maximum');
    maximum?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('maximum');
    const minimum = findMenuOption(filter, 'filter-minimum');
    minimum?.onClick?.();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('minimum');
    minimum?.trailingAction?.onClick();
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('minimum');
    for (const kind of ['surface-blur', 'displace', 'median'] as const) {
      const option = findMenuOption(filter, `filter-${kind}`);
      expect(option?.disabled).toBe(false);
      option?.onClick?.();
      expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith(kind);
      option?.trailingAction?.onClick();
      expect(menuCommands.attachAdjustment).toHaveBeenCalledWith(kind);
    }
    expect(leaves.every(({ disabled, onClick }) => !disabled && Boolean(onClick))).toBe(true);
    expect(filter.every(({ disabled }) => !disabled)).toBe(true);
  });

  it('only enables the Gaussian Blur link action for an unlocked raster layer', () => {
    const noLayer = createEditorMenuOptions('filter', state({ layer: null }), labels, commands());
    expect(findMenuOption(noLayer, 'filter-gaussian-blur')?.trailingAction?.disabled).toBe(true);

    const locked = createEditorMenuOptions('filter', state({
      layer: { ...state().layer!, locked: true }
    }), labels, commands());
    expect(findMenuOption(locked, 'filter-gaussian-blur')?.trailingAction?.disabled).toBe(true);
  });

  it('keeps fixed target transforms distinct from canvas geometry', () => {
    const menuCommands = commands();
    const edit = createEditorMenuOptions('edit', state(), labels, menuCommands);
    const transform = edit.find(({ value }) => value === 'edit-transform')?.children;
    expect(transform?.map(({ label }) => label)).toEqual([
      'Rotate 180°', 'Rotate 90° Clockwise', 'Rotate 90° Counter Clockwise',
      'Flip Horizontal', 'Flip Vertical'
    ]);
    transform?.find(({ value }) => value === 'transform-flip-horizontal')?.onClick?.();
    expect(menuCommands.applyFixedTransform).toHaveBeenCalledWith('flip-horizontal');
    expect(menuCommands.applyDocumentGeometry).not.toHaveBeenCalled();
  });

  it('exposes the complete current adjustment catalog with Photoshop shortcuts', () => {
    const menuCommands = commands();
    const image = createEditorMenuOptions('image', state(), labels, menuCommands);
    const adjustments = image.find(({ value }) => value === 'image-adjustments')?.children;
    const curves = adjustments?.find(({ value }) => value === 'image-adjustments-curves');
    expect(curves).toMatchObject({ label: 'Curves...', shortcut: 'Ctrl+M', disabled: false });
    expect(Object.fromEntries(adjustments?.filter(({ shortcut }) => shortcut).map(({ label, shortcut }) => [
      label, shortcut
    ]) ?? [])).toEqual({
      'Levels...': 'Ctrl+L',
      'Curves...': 'Ctrl+M',
      'Hue / Saturation...': 'Ctrl+U',
      'Color Balance...': 'Ctrl+B',
      'Black & White...': 'Alt+Shift+Ctrl+B',
      'Invert...': 'Ctrl+I'
    });
    curves?.onClick?.();
    expect(menuCommands.applyAdjustment).toHaveBeenCalledWith('curves');
    expect(adjustments?.map(({ label }) => label)).toEqual([
      'Grade...', 'Lens Fx...',
      'Brightness / Contrast...', 'Levels...', 'Curves...', 'Exposure...',
      'Color and Vibrance...', 'Hue / Saturation...', 'Color Balance...',
      'Black & White...', 'Photo Filter...', 'Channel Mixer...', 'Color Lookup...',
      'Invert...', 'Posterize...', 'Threshold...', 'Gradient Map...', 'Selective Color...',
      'Clarity and Dehaze...', 'Grain...'
    ]);
    expect(adjustments?.filter(({ separatorBefore }) => separatorBefore).map(({ value }) => value))
      .toEqual([
        'image-adjustments-brightness-contrast',
        'image-adjustments-color-vibrance',
        'image-adjustments-invert',
        'image-adjustments-clarity-dehaze'
      ]);
  });

  it('separates canvas geometry from layer transforms in the Image menu', () => {
    const menuCommands = commands();
    const image = createEditorMenuOptions('image', state(), labels, menuCommands);
    expect(image.map(({ value }) => value)).toEqual([
      'image-mode',
      'image-adjustments',
      'image-size',
      'canvas-size',
      'image-rotation',
      'image-crop',
      'duplicate-image'
    ]);
    expect(image.find(({ value }) => value === 'image-size')?.separatorBefore).toBe(true);
    expect(image.find(({ value }) => value === 'canvas-size')).toMatchObject({
      label: 'Canvas Size...', shortcut: 'Ctrl+Alt+C', disabled: false
    });
    const rotation = image.find(({ value }) => value === 'image-rotation')?.children;
    expect(rotation?.map(({ label }) => label)).toEqual([
      '180°', '90° Clockwise', '90° Counter Clockwise', 'Arbitrary...',
      'Flip Canvas Horizontal', 'Flip Canvas Vertical'
    ]);
    rotation?.find(({ value }) => value === 'flip-canvas-horizontal')?.onClick?.();
    expect(menuCommands.applyDocumentGeometry).toHaveBeenCalledWith({ operation: 'flip', axis: 'horizontal' });
  });

  it('routes Image Duplicate through the document command and disables it without a document', () => {
    const menuCommands = commands();
    const image = createEditorMenuOptions('image', state(), labels, menuCommands);
    const duplicate = image.find(({ value }) => value === 'duplicate-image');
    expect(duplicate).toMatchObject({ label: 'Duplicate...', disabled: false, separatorBefore: true });
    duplicate?.onClick?.();
    expect(menuCommands.duplicateImage).toHaveBeenCalledOnce();
    expect(createEditorMenuOptions('image', state({ hasDocument: false }), labels, commands())
      .find(({ value }) => value === 'duplicate-image')?.disabled).toBe(true);
  });

  it('moves document color commands into Photoshop-compatible Edit and Image menus', () => {
    const menuCommands = commands();
    const colorState = state({ documentColor: { bitDepth: 16, profileState: 'assumed' } });
    const edit = createEditorMenuOptions('edit', colorState, labels, menuCommands);
    const assign = edit.find(({ value }) => value === 'assign-profile');
    expect(assign?.children?.[0]).toMatchObject({ label: 'sRGB', disabled: false });
    assign?.children?.[0]?.onClick?.();
    expect(menuCommands.assignSrgbProfile).toHaveBeenCalledOnce();
    expect(edit.find(({ value }) => value === 'convert-profile')).toMatchObject({
      label: 'Convert to Profile...', disabled: true
    });

    const image = createEditorMenuOptions('image', colorState, labels, menuCommands);
    expect(image.find(({ value }) => value === 'image-mode')?.children?.map(({ label }) => label)).toEqual([
      'RGB Color ✓', '8 Bits/Channel', '16 Bits/Channel ✓'
    ]);
  });

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

  it('toggles registered workspace panels and marks the visible ones', () => {
    const menuCommands = commands();
    menuCommands.workspacePanels = [
      { id: 'layers', title: 'Layers', visible: true },
      { id: 'debug', title: 'Debug', visible: false }
    ];
    menuCommands.toggleWorkspacePanel = vi.fn();
    const options = createEditorMenuOptions('view', state(), labels, menuCommands);
    const layers = options.find(({ value }) => value === 'workspace-panel-layers');
    const debug = options.find(({ value }) => value === 'workspace-panel-debug');

    expect(layers?.label).toBe('Layers panel ✓');
    expect(debug?.label).toBe('Debug panel');
    debug?.onClick?.();
    expect(menuCommands.toggleWorkspacePanel).toHaveBeenCalledWith('debug');
  });

  it('offers all four primary workspaces from the View menu', () => {
    const menuCommands = commands();
    const workspace = createEditorMenuOptions('view', state(), labels, menuCommands)
      .find(({ value }) => value === 'workspace');

    expect(workspace?.children?.slice(0, 4).map(({ label }) => label))
      .toEqual(['Photo Edit', 'Grading', 'AI Generation', 'Video']);
    workspace?.children?.[1]?.onClick?.();
    expect(menuCommands.applyGradingWorkspace).toHaveBeenCalledOnce();
    workspace?.children?.[3]?.onClick?.();
    expect(menuCommands.applyVideoWorkspace).toHaveBeenCalledOnce();
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
      { label: 'Import SVG as Editable Vectors...', shortcut: undefined },
      { label: 'Open Recent', shortcut: undefined },
      { label: 'Saving...', shortcut: 'Ctrl+S' },
      { label: 'Export PNG', shortcut: 'Ctrl+Shift+S' },
      { label: 'Export', shortcut: undefined },
      { label: 'Exit', shortcut: undefined }
    ]);
    expect(options.filter(({ value }) => value !== 'export' && value !== 'exit-application')
      .every((option) => option.disabled)).toBe(true);
    expect(options.find(({ value }) => value === 'exit-application'))
      .toMatchObject({ label: 'Exit', separatorBefore: true, disabled: false });
    expect(options.find(({ value }) => value === 'export')?.children?.slice(0, 6)
      .every((option) => option.disabled)).toBe(true);
    expect(options.find(({ value }) => value === 'export')?.children?.at(-1)?.disabled).not.toBe(true);
  });

  it('groups secondary export formats in one submenu', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions('file', state(), labels, menuCommands);
    const children = options.find(({ value }) => value === 'export')?.children;
    expect(children?.map(({ label }) => label)).toEqual([
      'PNG...', 'JPG...', 'WebP...', 'TIFF...', 'Photoshop PSD (Editable)...',
      'Photoshop PSD (Maximum Appearance)...', 'SVG (Editable Vectors)...', 'PDF...', 'Format Support...'
    ]);
    children?.[0]?.onClick?.();
    children?.[1]?.onClick?.();
    children?.[2]?.onClick?.();
    children?.[3]?.onClick?.();
    children?.[4]?.onClick?.();
    children?.[5]?.onClick?.();
    children?.[6]?.onClick?.();
    children?.[7]?.onClick?.();
    expect(menuCommands.exportPng).toHaveBeenCalledOnce();
    expect(menuCommands.exportJpeg).toHaveBeenCalledOnce();
    expect(menuCommands.exportWebp).toHaveBeenCalledOnce();
    expect(menuCommands.exportTiff).toHaveBeenCalledOnce();
    expect(menuCommands.exportPsd).toHaveBeenCalledOnce();
    expect(menuCommands.exportPsdMaximumAppearance).toHaveBeenCalledOnce();
    expect(menuCommands.exportSvg).toHaveBeenCalledOnce();
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
      id: 'project-1', name: 'Campaign', rootPath: 'D:/Campaign',
      manifestPath: 'D:/Campaign/project.ltproject', lastUsedDocument: null
    };
    menuCommands.recentProjects = [{
      ...menuCommands.activeProject, recentId: 'recent-project-1', available: true
    }];
    const options = createEditorMenuOptions('file', state(), labels, menuCommands);
    expect(options.map(({ value }) => value)).toEqual([
      'new-document', 'open-image', 'place-image', 'import-svg', 'open-recent',
      'save-corrected', 'export-png', 'export',
      'new-project', 'open-project', 'open-recent-project', 'close-project',
      'exit-application'
    ]);
    expect(options.filter(({ separatorBefore }) => separatorBefore).map(({ value }) => value))
      .toEqual(['export-png', 'new-project', 'exit-application']);
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
    expect(findMenuOption(options, 'feather-selection')?.disabled).toBe(false);
    expect(options.find((option) => option.value === 'invert-selection'))
      .toMatchObject({ label: 'Inverse', shortcut: 'Ctrl+Shift+I' });
    expect(options.map(({ value }) => value)).toEqual([
      'select-all',
      'select-none',
      'invert-selection',
      'clear-selection',
      'select-modify',
      'select-similar',
      'remove-object',
      'remove-background'
    ]);
    const similar = options.find((option) => option.value === 'select-similar');
    expect(similar).toMatchObject({ label: 'Similar', disabled: false });
  });

  it('routes Select and Layer background removal through one command', () => {
    const menuCommands = commands();
    const selectAction = createEditorMenuOptions('select', state(), labels, menuCommands)
      .find((option) => option.value === 'remove-background');
    const layerAction = createEditorMenuOptions('layer', state(), labels, menuCommands)
      .find((option) => option.value === 'remove-background');

    expect(selectAction).toMatchObject({ label: 'Remove Background', disabled: false });
    expect(layerAction).toMatchObject({ label: 'Remove Background', disabled: false });
    selectAction?.onClick?.();
    layerAction?.onClick?.();
    expect(menuCommands.removeBackground).toHaveBeenCalledTimes(2);

    const lockedAction = createEditorMenuOptions(
      'layer', state({ layer: { ...state().layer!, locked: true } }), labels, commands()
    ).find((option) => option.value === 'remove-background');
    expect(lockedAction?.disabled).toBe(true);
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
    expect(values).toEqual([
      'cut-selected-content',
      'copy-selected-content',
      'copy-merged-content',
      'paste-selected-content',
      'copy-grade',
      'paste-grade',
      'edit-transform',
      'assign-profile',
      'convert-profile',
      'settings'
    ]);
  });

  it('guards invalid layer operations and forwards valid blend commands', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions(
      'layer',
      state(),
      labels,
      menuCommands
    );

    expect(findMenuOption(options, 'merge-down')?.disabled).toBe(true);
    expect(findMenuOption(options, 'delete-layer')?.disabled).toBe(true);
    const blend = options.find((option) => option.value === 'blend-mode');
    expect(blend?.children?.[0].label).toBe('Normal ✓');
    blend?.children?.[1].onClick?.();
    expect(menuCommands.setBlendMode).toHaveBeenCalledWith('multiply');
    expect(options.map(({ value }) => value)).toEqual([
      'layer-new',
      'duplicate-layer',
      'layer-delete',
      'add-adjustment',
      'add-effect',
      'rename-layer',
      'blend-mode',
      'invert-layer-colors',
      'remove-background',
      'clipping-mask',
      'edit-layer-pixels',
      'layer-mask',
      'toggle-visibility',
      'arrange',
      'auto-align',
      'toggle-lock',
      'merge-down',
      'flatten-group',
      'flatten-image'
    ]);
    expect(options.find(({ value }) => value === 'layer-new')?.children?.map(({ value }) => value))
      .toEqual(['new-layer', 'layer-via-copy']);
    expect(options.find(({ value }) => value === 'layer-delete')?.children?.map(({ value }) => value))
      .toEqual(['delete-layer']);
    expect(options.find(({ value }) => value === 'layer-mask')?.children?.map(({ value }) => value))
      .toEqual(['add-mask', 'edit-layer-mask', 'toggle-mask', 'remove-mask']);
    expect(options.find(({ value }) => value === 'arrange')?.children?.map(({ value }) => value))
      .toEqual(['move-up', 'move-down']);
  });

  it('creates global or attached adjustments and adds Layer Styles from the Layer menu', () => {
    const menuCommands = commands();
    const options = createEditorMenuOptions('layer', state(), labels, menuCommands);
    const adjustments = options.find(({ value }) => value === 'add-adjustment');
    const curves = findMenuOption(adjustments?.children ?? [], 'layer-add-adjustment-curves');
    curves?.onClick?.();
    curves?.trailingAction?.onClick();
    expect(menuCommands.createAdjustmentLayer).toHaveBeenCalledWith('curves');
    expect(menuCommands.attachAdjustment).toHaveBeenCalledWith('curves');
    expect(curves?.trailingAction?.disabled).toBe(false);

    const effects = options.find(({ value }) => value === 'add-effect');
    expect(effects?.children?.map(({ label }) => label)).toEqual([
      'Drop Shadow', 'Inner Shadow', 'Outer Glow', 'Inner Glow',
      'Bevel & Emboss', 'Stroke', 'Satin', 'Color Overlay',
      'Gradient Overlay', 'Pattern Overlay'
    ]);
    findMenuOption(effects?.children ?? [], 'layer-add-effect-drop-shadow')?.onClick?.();
    expect(menuCommands.addLayerEffect).toHaveBeenCalledWith('drop-shadow');

    const adjustmentLayerOptions = createEditorMenuOptions(
      'layer', state({ layer: { ...state().layer!, type: 'adjustment' } }), labels, commands()
    );
    expect(adjustmentLayerOptions.find(({ value }) => value === 'add-effect')?.disabled).toBe(true);
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
    expect(findMenuOption(options, 'convert-text-to-shape'))
      .toMatchObject({ label: 'Convert to Shape...', disabled: false });
    expect(findMenuOption(options, 'rasterize-text')?.label).toBe('Rasterize Type');
    expect(options.find((option) => option.value === 'edit-layer-pixels')?.disabled).toBe(true);
    expect(findMenuOption(options, 'delete-layer')?.disabled).toBe(true);
    findMenuOption(options, 'rasterize-text')?.onClick?.();
    expect(menuCommands.rasterizeText).toHaveBeenCalledOnce();
    findMenuOption(options, 'convert-text-to-shape')?.onClick?.();
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
      state({ zoomMode: '100', showDifference: false }),
      labels,
      menuCommands
    );

    expect(options.find((option) => option.value === 'actual-size')?.label).toBe('100% (current)');
    expect(options.find((option) => option.value === 'fit')?.shortcut).toBe('Ctrl+0');
    expect(options.find((option) => option.value === 'actual-size')?.shortcut).toBe('Ctrl+1');
    expect(options.find((option) => option.value === 'show-original')).toBeUndefined();
    expect(findMenuOption(options, 'toggle-screen-mode'))
      .toMatchObject({ label: 'Toggle screen mode', shortcut: 'F' });
    expect(options.find((option) => option.value === 'ui-style-guide'))
      .toMatchObject({ label: 'UI Style Guide...' });
    options.find((option) => option.value === 'ui-style-guide')?.onClick?.();
    expect(menuCommands.openStyleGuide).toHaveBeenCalledOnce();
    expect(options.map(({ value }) => value).slice(0, 10)).toEqual([
      'fit',
      'actual-size',
      'show-difference',
      'screen-mode',
      'extras',
      'show-overlays',
      'rulers',
      'snap',
      'snap-to',
      'guides'
    ]);
  });

  it('omits the optional UI devtools contribution from the base View menu', () => {
    const menuCommands = commands();
    menuCommands.openStyleGuide = undefined;
    const options = createEditorMenuOptions('view', state(), labels, menuCommands);
    expect(options.some((option) => option.value === 'ui-style-guide')).toBe(false);
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
