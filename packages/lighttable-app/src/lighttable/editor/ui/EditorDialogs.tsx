import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { TextInputDialog } from '../../../ui/TextInputDialog';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { PhotoshopImportReport } from '../document/documentTypes';
import { PsdImportReportDialog } from '../psd/PsdImportReportDialog';
import type { EditorDialogController } from './useEditorDialogController';

export interface EditorDialogsProps {
  readonly controller: EditorDialogController;
  readonly photoshopReport: PhotoshopImportReport | null;
  readonly differenceMetrics: ReferenceDifferenceMetrics | null;
  readonly onFeather: (radius: number) => void;
  readonly onFlatten: () => void;
  readonly onError: (message: string) => void;
}

export const EditorDialogs = ({
  controller,
  photoshopReport,
  differenceMetrics,
  onFeather,
  onFlatten,
  onError
}: EditorDialogsProps) => (
  <>
    <TextInputDialog
      open={controller.featherOpen}
      title="Select feather"
      initialValue="8.0"
      selectAllOnOpen
      compact
      backdropClassName="lighttable-dialog-backdrop"
      onCancel={controller.closeFeather}
      onConfirm={(value) => {
        const radius = Number(value);
        if (!Number.isFinite(radius) || radius < 0 || radius > 250) {
          onError('Feather radius must be a number between 0 and 250 pixels.');
          return;
        }
        controller.closeFeather();
        onFeather(radius);
      }}
    />
    <ConfirmDialog
      open={Boolean(controller.flattenRequest)}
      title={
        controller.flattenRequest?.kind === 'group'
          ? 'Flatten group?'
          : 'Flatten image?'
      }
      description={
        controller.flattenRequest?.kind === 'group'
          ? 'The visible raster contents of this group will become one raster layer. This can be undone while the document remains open.'
          : 'The visible layer stack will become one raster layer. This can be undone while the document remains open.'
      }
      confirmLabel="Flatten"
      danger
      onCancel={controller.closeFlatten}
      onConfirm={onFlatten}
    />
    <PsdImportReportDialog
      open={controller.psdReportOpen}
      report={photoshopReport}
      metrics={differenceMetrics}
      onClose={controller.closePsdReport}
    />
  </>
);
