import { describe, expect, it, vi } from 'vitest';
import type { LayerPanelController } from '../../application/layers/useLayerPanelController';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { EditorDialogController } from '../../editor/ui/useEditorDialogController';
import { createEditorMenuController } from './createEditorMenuController';

const findOption = (
  options: ReturnType<ReturnType<typeof createEditorMenuController>['optionsFor']>,
  value: string
) => options.find((option) => option.value === value);

describe('createEditorMenuController', () => {
  it('binds active-layer menu operations to the projected document', () => {
    const document = createImageDocument('Menu', 64, 64, 'background');
    const setVisibility = vi.fn();
    const panel = {
      setVisibility
    } as unknown as LayerPanelController;

    const controller = createEditorMenuController({
      projection: {
        document,
        saving: false,
        hasMetadata: true,
        hasSourceKey: true,
        hasCompatibilityReport: false,
        copiedGradeName: null,
        hasSelection: false,
        selectionClipboardAvailable: false,
        activeChannel: 'pixels',
        autoAlignPreview: false,
        zoomMode: 'fit',
        showOriginal: false,
        showDifference: false
      },
      labels: {
        primaryShortcut: (key) => `Ctrl+${key}`
      },
      file: {
        newDocument: vi.fn(),
        open: vi.fn(),
        place: vi.fn(),
        recentFiles: [],
        openRecent: vi.fn(),
        clearRecent: vi.fn(),
        save: vi.fn(),
        exportPng: vi.fn(),
        exportPsd: vi.fn(),
        pdfExportPreflight: vi.fn(),
        openCompatibilityReport: vi.fn(),
        openFormatSupport: vi.fn()
      },
      edit: {
        copySelectedContent: vi.fn(),
        copyMergedContent: vi.fn(),
        pasteSelectedContent: vi.fn(),
        pasteGrade: vi.fn(),
        copyGrade: vi.fn()
      },
      selection: {
        selectAll: vi.fn(),
        clear: vi.fn(),
        invert: vi.fn()
      },
      image: { openSize: vi.fn() },
      layers: {
        panel,
        duplicate: vi.fn(),
        rasterizeText: vi.fn(),
        convertTextToShape: vi.fn(),
        layerViaCopy: vi.fn(),
        rename: vi.fn(),
        invertColors: vi.fn(),
        mergeDown: vi.fn()
      },
      autoAlign: {
        begin: vi.fn(),
        apply: vi.fn(),
        cancel: vi.fn()
      },
      dialogs: {
        openFeather: vi.fn(),
        requestFlatten: vi.fn()
      } as unknown as EditorDialogController,
      viewport: {
        setZoomMode: vi.fn(),
        setView: vi.fn(),
        setShowOriginal: vi.fn(),
        setShowDifference: vi.fn()
      },
      workspace: {
        showDebugPanel: vi.fn(),
        toggleScreenMode: vi.fn(),
        resetLayout: vi.fn()
      }
    });

    findOption(controller.optionsFor('layer'), 'toggle-visibility')?.onClick?.();

    expect(setVisibility).toHaveBeenCalledWith(
      [document.activeLayerId],
      false
    );
    expect(findOption(controller.optionsFor('edit'), 'settings')).toMatchObject({
      label: 'Preferences...',
      shortcut: 'Ctrl+K'
    });
  });

  it('forwards the Type menu conversion command through the controller', () => {
    const document = createImageDocument('Menu', 64, 64, 'background');
    const activeLayer = document.layers[0];
    Object.assign(activeLayer, {
      type: 'text',
      text: {},
      mask: null
    });
    const convertTextToShape = vi.fn();
    const controller = createEditorMenuController({
      projection: {
        document,
        saving: false,
        hasMetadata: true,
        hasSourceKey: true,
        hasCompatibilityReport: false,
        copiedGradeName: null,
        hasSelection: false,
        selectionClipboardAvailable: false,
        activeChannel: 'pixels',
        autoAlignPreview: false,
        zoomMode: 'fit',
        showOriginal: false,
        showDifference: false
      },
      labels: { primaryShortcut: (key) => `Ctrl+${key}` },
      file: {
        newDocument: vi.fn(), open: vi.fn(), place: vi.fn(), recentFiles: [],
        openRecent: vi.fn(), clearRecent: vi.fn(), save: vi.fn(), exportPng: vi.fn(), exportPsd: vi.fn(),
        pdfExportPreflight: vi.fn(),
        openCompatibilityReport: vi.fn(),
        openFormatSupport: vi.fn()
      },
      edit: {
        copySelectedContent: vi.fn(), copyMergedContent: vi.fn(),
        pasteSelectedContent: vi.fn(), pasteGrade: vi.fn(), copyGrade: vi.fn()
      },
      selection: { selectAll: vi.fn(), clear: vi.fn(), invert: vi.fn() },
      image: { openSize: vi.fn() },
      layers: {
        panel: {} as LayerPanelController,
        duplicate: vi.fn(), rasterizeText: vi.fn(), convertTextToShape,
        layerViaCopy: vi.fn(), rename: vi.fn(), invertColors: vi.fn(), mergeDown: vi.fn()
      },
      autoAlign: { begin: vi.fn(), apply: vi.fn(), cancel: vi.fn() },
      dialogs: {} as EditorDialogController,
      viewport: {
        setZoomMode: vi.fn(), setView: vi.fn(),
        setShowOriginal: vi.fn(), setShowDifference: vi.fn()
      },
      workspace: {
        showDebugPanel: vi.fn(), toggleScreenMode: vi.fn(), resetLayout: vi.fn()
      }
    });

    findOption(controller.optionsFor('type'), 'convert-text-to-shape')?.onClick?.();

    expect(convertTextToShape).toHaveBeenCalledOnce();
  });
});
