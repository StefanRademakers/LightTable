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
    target[property] ??= vi.fn() as never;
    return target[property];
  }
});

const labels = {
  primaryShortcut: (key: string, shift = false) => `Ctrl+${shift ? 'Shift+' : ''}${key}`
};

describe('createEditorMenuOptions', () => {
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
      { label: 'Saving...', shortcut: 'Ctrl+S' },
      { label: 'Quick Export PNG', shortcut: 'Ctrl+Shift+S' },
      { label: 'PDF Export Preflight...', shortcut: undefined },
      { label: 'Document Compatibility Report...', shortcut: undefined },
      { label: 'Format Support...', shortcut: undefined }
    ]);
    expect(options.filter(({ value }) => value !== 'format-support')
      .every((option) => option.disabled)).toBe(true);
    expect(options.find(({ value }) => value === 'format-support')?.disabled).not.toBe(true);
  });

  it('exposes the existing compatibility report only when one is available', () => {
    const menuCommands = commands();
    const unavailable = createEditorMenuOptions('file', state(), labels, menuCommands);
    const available = createEditorMenuOptions(
      'file',
      state({ hasCompatibilityReport: true }),
      labels,
      menuCommands
    );

    expect(unavailable.find(({ value }) => value === 'document-compatibility-report')?.disabled)
      .toBe(true);
    const report = available.find(({ value }) => value === 'document-compatibility-report');
    expect(report?.disabled).toBe(false);
    report?.onClick?.();
    expect(menuCommands.openCompatibilityReport).toHaveBeenCalledOnce();
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
    const options = createEditorMenuOptions(
      'view',
      state({ zoomMode: '100', showOriginal: true, showDifference: false }),
      labels,
      commands()
    );

    expect(options.find((option) => option.value === 'actual-size')?.label).toBe('100% (current)');
    expect(options.find((option) => option.value === 'show-original')?.label).toBe('Show corrected');
    expect(options.find((option) => option.value === 'toggle-screen-mode'))
      .toMatchObject({ label: 'Toggle screen mode', shortcut: 'F' });
  });
});
