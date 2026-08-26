import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { TextInputDialog } from '../../../ui/TextInputDialog';
import React from 'react';
import type { ReferenceDifferenceMetrics } from '../../application/rendering/rendererTypes';
import type { DocumentFontAsset, ImageDocument, LayerId, PhotoshopImportReport } from '../document/documentTypes';
import type { ImageSizeRequest } from '../../application/imageSize/imageSizeModel';
import type { DocumentGeometryRequest } from '../../application/documentGeometry/documentGeometryModel';
import type { EditorDialogController } from './useEditorDialogController';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import type { LightTableReleaseService } from '../../../platform/LightTableHost';

const PsdImportReportDialog = React.lazy(async () => ({
  default: (await import('../psd/PsdImportReportDialog')).PsdImportReportDialog
}));
const PdfExportPreflightDialog = React.lazy(async () => ({
  default: (await import('../pdf/PdfExportPreflightDialog')).PdfExportPreflightDialog
}));
const MissingFontRecoveryDialog = React.lazy(async () => ({
  default: (await import('./MissingFontRecoveryDialog')).MissingFontRecoveryDialog
}));
const FormatSupportDialog = React.lazy(async () => ({
  default: (await import('./FormatSupportDialog')).FormatSupportDialog
}));
const FillDialog = React.lazy(async () => ({
  default: (await import('./FillDialog')).FillDialog
}));
const AboutUpdateDialog = React.lazy(async () => ({
  default: (await import('./AboutUpdateDialog')).AboutUpdateDialog
}));
const CommandHelpDialog = React.lazy(async () => ({
  default: (await import('./CommandHelpDialog')).CommandHelpDialog
}));
const ImageSizeDialog = React.lazy(async () => ({
  default: (await import('./ImageSizeDialog')).ImageSizeDialog
}));
const ThirdPartyLicensesDialog = React.lazy(async () => ({
  default: (await import('./ThirdPartyLicensesDialog')).ThirdPartyLicensesDialog
}));
const NewGuideDialog = React.lazy(async () => ({
  default: (await import('./NewGuideDialog')).NewGuideDialog
}));
const DuplicateImageDialog = React.lazy(async () => ({
  default: (await import('./DuplicateImageDialog')).DuplicateImageDialog
}));
const CanvasSizeDialog = React.lazy(async () => ({
  default: (await import('./CanvasSizeDialog')).CanvasSizeDialog
}));
const ArbitraryRotationDialog = React.lazy(async () => ({
  default: (await import('./ArbitraryRotationDialog')).ArbitraryRotationDialog
}));

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
  readonly onFeather: (radius: number, applyAtCanvasBounds: boolean) => void;
  readonly onSelectionModify: (
    mode: 'border' | 'smooth' | 'expand' | 'contract',
    amount: number,
    applyAtCanvasBounds: boolean
  ) => void;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly onFill: (color: string, preserveTransparency: boolean) => void;
  readonly onConvertTextToShape: (layerId: LayerId) => void;
  readonly onError: (message: string) => void;
  readonly release?: LightTableReleaseService;
  readonly dirtyDocuments: boolean;
  readonly document: ImageDocument | null;
  readonly imageSizeBusy?: boolean;
  readonly onResizeImage: (request: ImageSizeRequest) => void;
  readonly documentGeometryBusy?: boolean;
  readonly onApplyDocumentGeometry: (request: DocumentGeometryRequest) => void;
  readonly duplicateImageBusy?: boolean;
  readonly duplicateImageError?: string | null;
  readonly duplicateImageSourceName: string;
  readonly onDuplicateImage: (name: string) => void;
  readonly onCreateGuide: (guide: Omit<import('../document/documentTypes').DocumentGuide, 'id'>) => void;
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
  onSelectionModify,
  foregroundColor,
  backgroundColor,
  onFill,
  onConvertTextToShape,
  onError,
  release,
  dirtyDocuments,
  document,
  imageSizeBusy,
  onResizeImage,
  documentGeometryBusy,
  onApplyDocumentGeometry,
  duplicateImageBusy,
  duplicateImageError,
  duplicateImageSourceName,
  onDuplicateImage,
  onCreateGuide
}: EditorDialogsProps) => (
  <React.Suspense fallback={null}>
    {controller.arbitraryRotationOpen ? <ArbitraryRotationDialog open busy={documentGeometryBusy}
      onCancel={controller.closeArbitraryRotation}
      onCommit={(degrees: number) => {
        onApplyDocumentGeometry({ operation: 'rotate', rotation: { degrees } });
        controller.closeArbitraryRotation();
      }} /> : null}
    {controller.canvasSizeOpen ? <CanvasSizeDialog
      open
      document={document}
      busy={documentGeometryBusy}
      onCancel={controller.closeCanvasSize}
      onCommit={onApplyDocumentGeometry}
    /> : null}
    {controller.duplicateImageOpen ? <DuplicateImageDialog
      open
      sourceName={duplicateImageSourceName}
      busy={Boolean(duplicateImageBusy)}
      error={duplicateImageError}
      onCancel={controller.closeDuplicateImage}
      onConfirm={onDuplicateImage}
    /> : null}
    {controller.newGuideOpen ? <NewGuideDialog open onCancel={controller.closeNewGuide}
      onCommit={(guide: Omit<import('../document/documentTypes').DocumentGuide, 'id'>) => {
        controller.closeNewGuide();
        onCreateGuide(guide);
      }} /> : null}
    {controller.imageSizeOpen ? <ImageSizeDialog
      open
      document={document}
      busy={imageSizeBusy}
      onCancel={controller.closeImageSize}
      onCommit={onResizeImage}
    /> : null}
    {controller.fillOpen ? <FillDialog
      open
      foregroundColor={foregroundColor}
      backgroundColor={backgroundColor}
      onCancel={controller.closeFill}
      onFill={onFill}
    /> : null}
    {controller.featherOpen ? <TextInputDialog
      open
      title="Select feather"
      initialValue="8.0"
      selectAllOnOpen
      compact
      backdropClassName="lighttable-dialog-backdrop"
      checkboxLabel="Apply effect at canvas bounds"
      checkboxChecked={controller.featherCanvasBounds}
      onCheckboxChange={controller.setFeatherCanvasBounds}
      onCancel={controller.closeFeather}
      onConfirm={(value) => {
        const radius = Number(value);
        if (!Number.isFinite(radius) || radius < 0 || radius > 250) {
          onError('Feather radius must be a number between 0 and 250 pixels.');
          return;
        }
        controller.closeFeather();
        onFeather(radius, controller.featherCanvasBounds);
      }}
    /> : null}
    {controller.selectionMorphology ? <TextInputDialog
      open
      title={`${controller.selectionMorphology[0].toUpperCase()}${controller.selectionMorphology.slice(1)} selection`}
      initialValue="1"
      selectAllOnOpen
      compact
      backdropClassName="lighttable-dialog-backdrop"
      checkboxLabel={controller.selectionMorphology === 'border'
        ? undefined : 'Apply effect at canvas bounds'}
      checkboxChecked={controller.selectionMorphologyCanvasBounds[controller.selectionMorphology]}
      onCheckboxChange={(enabled) => controller.setSelectionMorphologyCanvasBounds(
        controller.selectionMorphology!,
        enabled
      )}
      onCancel={controller.closeSelectionMorphology}
      onConfirm={(value) => {
        const radius = Number(value);
        const maximum = controller.selectionMorphology === 'border' ? 200
          : controller.selectionMorphology === 'smooth' ? 100 : 500;
        if (!Number.isInteger(radius) || radius < 1 || radius > maximum) {
          onError(`Selection amount must be a whole number between 1 and ${maximum} pixels.`);
          return;
        }
        const mode = controller.selectionMorphology;
        if (!mode) return;
        const applyAtCanvasBounds = controller.selectionMorphologyCanvasBounds[mode];
        controller.closeSelectionMorphology();
        onSelectionModify(mode, radius, applyAtCanvasBounds);
      }}
    /> : null}
    {controller.textToShapeRequest ? <ConfirmDialog
      open
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
    /> : null}
    {controller.psdReportOpen ? <PsdImportReportDialog
      open
      report={photoshopReport}
      metrics={differenceMetrics}
      textFontDiagnostics={textFontDiagnostics}
      replacementFonts={replacementFonts}
      onResolveTextFont={onResolveTextFont}
      onSelectLayer={onSelectCompatibilityLayer}
      onReplaceTextFonts={onReplaceTextFonts}
      onClose={controller.closePsdReport}
    /> : null}
    {controller.missingFontRecoveryRequest ? <MissingFontRecoveryDialog
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
      onPreview={(assetId: string) => {
        const request = controller.missingFontRecoveryRequest;
        if (!request) return;
        onPreviewTextFont(
          request.layerId, assetId, request.sourceIdentity, request.requestedFont
        );
      }}
      onReplace={(assetId: string) => {
        const request = controller.missingFontRecoveryRequest;
        if (!request) return;
        onReplaceTextFont(
          request.layerId, assetId, request.sourceIdentity, request.requestedFont,
          request.offset, request.affinity
        );
      }}
    /> : null}
    {controller.pdfExportPreflightRequest ? <PdfExportPreflightDialog
      open
      request={controller.pdfExportPreflightRequest}
      onClose={controller.closePdfExportPreflight}
    /> : null}
    {controller.formatSupportOpen ? <FormatSupportDialog
      open
      onClose={controller.closeFormatSupport}
    /> : null}
    {controller.thirdPartyLicensesOpen ? <ThirdPartyLicensesDialog
      open
      includeDesktopRuntime={Boolean(release)}
      onClose={controller.closeThirdPartyLicenses}
    /> : null}
    {controller.aboutOpen ? <AboutUpdateDialog
      open
      release={release}
      dirtyDocuments={dirtyDocuments}
      onClose={controller.closeAbout}
    /> : null}
    {controller.commandHelpOpen
      ? <CommandHelpDialog open onClose={controller.closeCommandHelp} />
      : null}
  </React.Suspense>
);
