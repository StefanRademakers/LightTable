import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { TextInputDialog } from '../../../ui/TextInputDialog';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { DocumentFontAsset, ImageDocument, LayerId, PhotoshopImportReport } from '../document/documentTypes';
import type { ImageSizeRequest } from '../../application/imageSize/imageSizeModel';
import { PsdImportReportDialog } from '../psd/PsdImportReportDialog';
import type { EditorDialogController } from './useEditorDialogController';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { PdfExportPreflightDialog } from '../pdf/PdfExportPreflightDialog';
import { MissingFontRecoveryDialog } from './MissingFontRecoveryDialog';
import { FormatSupportDialog } from './FormatSupportDialog';
import { FillDialog } from './FillDialog';
import { AboutUpdateDialog } from './AboutUpdateDialog';
import type { LightTableReleaseService } from '../../../platform/LightTableHost';
import { CommandHelpDialog } from './CommandHelpDialog';
import { ImageSizeDialog } from './ImageSizeDialog';

export interface EditorDialogsProps {
  readonly controller: EditorDialogController;
  readonly photoshopReport: PhotoshopImportReport | null;
  readonly differenceMetrics: ReferenceDifferenceMetrics | null;
  readonly textFontDiagnostics: readonly TextFontDiagnostic[];
  readonly replacementFonts: readonly DocumentFontAsset[];
  readonly onResolveTextFont: (layerId: TextFontDiagnostic['layerId']) => void;
  readonly onSelectCompatibilityLayer: (layerId: LayerId) => void;
  readonly onReplaceTextFont: (
    layerId: LayerId,
    assetId: string,
    sourceIdentity: string,
    requestedFont: string | null,
    offset?: number,
    affinity?: 'upstream' | 'downstream'
  ) => void;
  readonly onPreviewTextFont: (
    layerId: LayerId,
    assetId: string,
    sourceIdentity: string,
    requestedFont: string | null
  ) => void;
  readonly onCancelTextFontPreview: () => void;
  readonly onReplaceTextFonts: (
    layerIds: readonly LayerId[],
    assetId: string,
    requestedFont: string,
    sourceIdentity: string
  ) => void;
  readonly onFeather: (radius: number) => void;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly onFill: (color: string, preserveTransparency: boolean) => void;
  readonly onFlatten: () => void;
  readonly onConvertTextToShape: (layerId: LayerId) => void;
  readonly onError: (message: string) => void;
  readonly release?: LightTableReleaseService;
  readonly dirtyDocuments: boolean;
  readonly document: ImageDocument | null;
  readonly imageSizeBusy?: boolean;
  readonly onResizeImage: (request: ImageSizeRequest) => void;
}

export const EditorDialogs = ({
  controller,
  photoshopReport,
  differenceMetrics,
  textFontDiagnostics,
  replacementFonts,
  onResolveTextFont,
  onSelectCompatibilityLayer,
  onReplaceTextFont,
  onPreviewTextFont,
  onCancelTextFontPreview,
  onReplaceTextFonts,
  onFeather,
  foregroundColor,
  backgroundColor,
  onFill,
  onFlatten,
  onConvertTextToShape,
  onError,
  release,
  dirtyDocuments,
  document,
  imageSizeBusy,
  onResizeImage
}: EditorDialogsProps) => (
  <>
    <ImageSizeDialog
      open={controller.imageSizeOpen}
      document={document}
      busy={imageSizeBusy}
      onCancel={controller.closeImageSize}
      onCommit={onResizeImage}
    />
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
      onSelectLayer={onSelectCompatibilityLayer}
      onReplaceTextFonts={onReplaceTextFonts}
      onClose={controller.closePsdReport}
    />
    <MissingFontRecoveryDialog
      request={controller.missingFontRecoveryRequest}
      diagnostic={controller.missingFontRecoveryRequest
        ? textFontDiagnostics.find(({ layerId, sourceIdentity }) =>
            layerId === controller.missingFontRecoveryRequest?.layerId
            && sourceIdentity === controller.missingFontRecoveryRequest?.sourceIdentity) ?? {
              layerId: controller.missingFontRecoveryRequest.layerId,
              layerName: controller.missingFontRecoveryRequest.layerName,
              editable: true, issue: 'font-missing',
              requestedFont: controller.missingFontRecoveryRequest.requestedFont,
              sourceIdentity: controller.missingFontRecoveryRequest.sourceIdentity,
              runIndices: [], metricsChanged: controller.missingFontRecoveryRequest.metricsChanged,
              status: { kind: 'missing', label: 'Missing font', detail: 'Font replacement preview.' }
            }
        : null}
      fonts={replacementFonts}
      onCancel={() => { onCancelTextFontPreview(); controller.closeMissingFontRecovery(); }}
      onManage={() => {
        onCancelTextFontPreview();
        controller.closeMissingFontRecovery();
        controller.openPsdReport();
      }}
      onPreview={(assetId) => {
        const request = controller.missingFontRecoveryRequest;
        if (!request) return;
        onPreviewTextFont(
          request.layerId, assetId, request.sourceIdentity, request.requestedFont
        );
      }}
      onReplace={(assetId) => {
        const request = controller.missingFontRecoveryRequest;
        if (!request) return;
        onReplaceTextFont(
          request.layerId, assetId, request.sourceIdentity, request.requestedFont,
          request.offset, request.affinity
        );
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
    <AboutUpdateDialog
      open={controller.aboutOpen}
      release={release}
      dirtyDocuments={dirtyDocuments}
      onClose={controller.closeAbout}
    />
    <CommandHelpDialog open={controller.commandHelpOpen} onClose={controller.closeCommandHelp} />
  </>
);
