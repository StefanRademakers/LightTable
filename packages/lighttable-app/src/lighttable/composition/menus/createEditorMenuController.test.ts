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
        openFormats: 'PNG',
        primaryShortcut: (key) => `Ctrl+${key}`
      },
      file: {
        open: vi.fn(),
        save: vi.fn(),
        download: vi.fn(),
        reset: vi.fn()
      },
      edit: {
        copySelectedContent: vi.fn(),
        pasteSelectedContent: vi.fn(),
        pasteGrade: vi.fn(),
        copyGrade: vi.fn()
      },
      selection: {
        selectAll: vi.fn(),
        clear: vi.fn(),
        invert: vi.fn()
      },
      layers: {
        panel,
        duplicate: vi.fn(),
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
        resetLayout: vi.fn()
      }
    });

    findOption(controller.optionsFor('layer'), 'toggle-visibility')?.onClick?.();

    expect(setVisibility).toHaveBeenCalledWith(
      [document.activeLayerId],
      false
    );
  });
});
