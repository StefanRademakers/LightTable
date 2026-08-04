import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { TextInputDialog } from '../../../ui/TextInputDialog';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { DocumentFontAsset, LayerId, PhotoshopImportReport } from '../document/documentTypes';
import { PsdImportReportDialog } from '../psd/PsdImportReportDialog';
import type { EditorDialogController } from './useEditorDialogController';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { PdfExportPreflightDialog } from '../pdf/PdfExportPreflightDialog';
import { MissingFontRecoveryDialog } from './MissingFontRecoveryDialog';
import { FormatSupportDialog } from './FormatSupportDialog';
import { FillDialog } from './FillDialog';

export interface EditorDialogsProps {
  readonly controller: EditorDialogController;
  readonly photoshopReport: PhotoshopImportReport | null;
  readonly differenceMetrics: ReferenceDifferenceMetrics | null;
  readonly textFontDiagnostics: readonly TextFontDiagnostic[];
  readonly replacementFonts: readonly DocumentFontAsset[];
  readonly onResolveTextFont: (layerId: TextFontDiagnostic['layerId']) => void;
  readonly onReplaceTextFont: (
    layerId: LayerId,
    assetId: string,
    offset?: number,
    affinity?: 'upstream' | 'downstream'
  ) => void;
  readonly onReplaceTextFonts: (
    layerIds: readonly LayerId[],
    assetId: string,
    requestedFont: string
  ) => void;
  readonly onFeather: (radius: number) => void;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly onFill: (color: string, preserveTransparency: boolean) => void;
  readonly onFlatten: () => void;
  readonly onConvertTextToShape: (layerId: LayerId) => void;
  readonly onError: (message: string) => void;
}

export const EditorDialogs = ({
  controller,
  photoshopReport,
  differenceMetrics,
  textFontDiagnostics,
  replacementFonts,
  onResolveTextFont,
  onReplaceTextFont,
  onReplaceTextFonts,
  onFeather,
  foregroundColor,
  backgroundColor,
  onFill,
  onFlatten,
  onConvertTextToShape,
  onError
}: EditorDialogsProps) => (
  <>
    <FillDialog
      open={controller.fillOpen}
      foregroundColor={foregroundColor}
      backgroundColor={backgroundColor}
      onCancel={controller.closeFill}
      onFill={onFill}
    />
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
      replacementFonts={replacementFonts}
      onResolveTextFont={onResolveTextFont}
      onReplaceTextFonts={onReplaceTextFonts}
      onClose={controller.closePsdReport}
    />
    <MissingFontRecoveryDialog
      request={controller.missingFontRecoveryRequest}
      diagnostic={controller.missingFontRecoveryRequest
        ? textFontDiagnostics.find(({ layerId }) =>
            layerId === controller.missingFontRecoveryRequest?.layerId) ?? null
        : null}
      fonts={replacementFonts}
      onCancel={controller.closeMissingFontRecovery}
      onManage={() => {
        controller.closeMissingFontRecovery();
        controller.openPsdReport();
      }}
      onReplace={(assetId) => {
        const request = controller.missingFontRecoveryRequest;
        if (!request) return;
        onReplaceTextFont(request.layerId, assetId, request.offset, request.affinity);
      }}
    />
    <PdfExportPreflightDialog
      open={Boolean(controller.pdfExportPreflightRequest)}
      request={controller.pdfExportPreflightRequest}
      onClose={controller.closePdfExportPreflight}
    />
    <FormatSupportDialog
      open={controller.formatSupportOpen}
      onClose={controller.closeFormatSupport}
    />
  </>
);
