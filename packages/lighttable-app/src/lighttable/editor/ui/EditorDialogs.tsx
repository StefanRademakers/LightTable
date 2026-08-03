import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { TextInputDialog } from '../../../ui/TextInputDialog';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { LayerId, PhotoshopImportReport } from '../document/documentTypes';
import { PsdImportReportDialog } from '../psd/PsdImportReportDialog';
import type { EditorDialogController } from './useEditorDialogController';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { PdfExportPreflightDialog } from '../pdf/PdfExportPreflightDialog';

export interface EditorDialogsProps {
  readonly controller: EditorDialogController;
  readonly photoshopReport: PhotoshopImportReport | null;
  readonly differenceMetrics: ReferenceDifferenceMetrics | null;
  readonly textFontDiagnostics: readonly TextFontDiagnostic[];
  readonly onResolveTextFont: (layerId: TextFontDiagnostic['layerId']) => void;
  readonly onFeather: (radius: number) => void;
  readonly onFlatten: () => void;
  readonly onConvertTextToShape: (layerId: LayerId) => void;
  readonly onError: (message: string) => void;
}

export const EditorDialogs = ({
  controller,
  photoshopReport,
  differenceMetrics,
  textFontDiagnostics,
  onResolveTextFont,
  onFeather,
  onFlatten,
  onConvertTextToShape,
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
    <ConfirmDialog
      open={Boolean(controller.textToShapeRequest)}
      title="Convert text to shape?"
      description="Each glyph will become an editable vector path. Text content, font and paragraph editing will no longer be available. This can be undone while the document remains open."
      confirmLabel="Convert"
      danger
      onCancel={controller.closeTextToShape}
      onConfirm={() => {
        const request = controller.textToShapeRequest;
        if (!request) return;
        controller.closeTextToShape();
        onConvertTextToShape(request.layerId);
      }}
    />
    <PsdImportReportDialog
      open={controller.psdReportOpen}
      report={photoshopReport}
      metrics={differenceMetrics}
      textFontDiagnostics={textFontDiagnostics}
      onResolveTextFont={onResolveTextFont}
      onClose={controller.closePsdReport}
    />
    <PdfExportPreflightDialog
      open={Boolean(controller.pdfExportPreflightRequest)}
      request={controller.pdfExportPreflightRequest}
      onClose={controller.closePdfExportPreflight}
    />
  </>
);
