import { useCallback, useState } from 'react';
import type { LayerId } from '../document/documentTypes';
import type { PdfExportPreflightRequest } from '../pdf/PdfExportPreflightDialog';

export type FlattenRequest =
  | { readonly kind: 'group'; readonly groupId: LayerId }
  | { readonly kind: 'image' };

export interface TextToShapeRequest {
  readonly layerId: LayerId;
}

export interface MissingFontRecoveryRequest {
  readonly layerId: LayerId;
  readonly sourceIdentity: string;
  readonly requestedFont: string | null;
  readonly layerName: string;
  readonly metricsChanged: boolean;
  readonly offset?: number;
  readonly affinity?: 'upstream' | 'downstream';
}

export const useEditorDialogController = () => {
  const [featherOpen, setFeatherOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [flattenRequest, setFlattenRequest] =
    useState<FlattenRequest | null>(null);
  const [psdReportOpen, setPsdReportOpen] = useState(false);
  const [formatSupportOpen, setFormatSupportOpen] = useState(false);
  const [thirdPartyLicensesOpen, setThirdPartyLicensesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [commandHelpOpen, setCommandHelpOpen] = useState(false);
  const [textToShapeRequest, setTextToShapeRequest] = useState<TextToShapeRequest | null>(null);
  const [missingFontRecoveryRequest, setMissingFontRecoveryRequest] =
    useState<MissingFontRecoveryRequest | null>(null);
  const [pdfExportPreflightRequest, setPdfExportPreflightRequest] = useState<PdfExportPreflightRequest | null>(null);

  const reset = useCallback(() => {
    setFeatherOpen(false);
    setFillOpen(false);
    setImageSizeOpen(false);
    setFlattenRequest(null);
    setPsdReportOpen(false);
    setFormatSupportOpen(false);
    setThirdPartyLicensesOpen(false);
    setAboutOpen(false);
    setCommandHelpOpen(false);
    setTextToShapeRequest(null);
    setMissingFontRecoveryRequest(null);
    setPdfExportPreflightRequest(null);
  }, []);

  return {
    featherOpen,
    fillOpen,
    imageSizeOpen,
    flattenRequest,
    psdReportOpen,
    formatSupportOpen,
    thirdPartyLicensesOpen,
    aboutOpen,
    commandHelpOpen,
    textToShapeRequest,
    missingFontRecoveryRequest,
    pdfExportPreflightRequest,
    openFeather: useCallback(() => setFeatherOpen(true), []),
    closeFeather: useCallback(() => setFeatherOpen(false), []),
    openFill: useCallback(() => setFillOpen(true), []),
    closeFill: useCallback(() => setFillOpen(false), []),
    openImageSize: useCallback(() => setImageSizeOpen(true), []),
    closeImageSize: useCallback(() => setImageSizeOpen(false), []),
    requestFlatten: useCallback(
      (request: FlattenRequest) => setFlattenRequest(request),
      []
    ),
    closeFlatten: useCallback(() => setFlattenRequest(null), []),
    requestTextToShape: useCallback(
      (request: TextToShapeRequest) => setTextToShapeRequest(request),
      []
    ),
    closeTextToShape: useCallback(() => setTextToShapeRequest(null), []),
    requestMissingFontRecovery: useCallback(
      (request: MissingFontRecoveryRequest) => setMissingFontRecoveryRequest(request),
      []
    ),
    closeMissingFontRecovery: useCallback(() => setMissingFontRecoveryRequest(null), []),
    openPdfExportPreflight: useCallback(
      (request: PdfExportPreflightRequest) => setPdfExportPreflightRequest(request),
      []
    ),
    closePdfExportPreflight: useCallback(() => setPdfExportPreflightRequest(null), []),
    openPsdReport: useCallback(() => setPsdReportOpen(true), []),
    closePsdReport: useCallback(() => setPsdReportOpen(false), []),
    openFormatSupport: useCallback(() => setFormatSupportOpen(true), []),
    closeFormatSupport: useCallback(() => setFormatSupportOpen(false), []),
    openThirdPartyLicenses: useCallback(() => setThirdPartyLicensesOpen(true), []),
    closeThirdPartyLicenses: useCallback(() => setThirdPartyLicensesOpen(false), []),
    openAbout: useCallback(() => setAboutOpen(true), []),
    closeAbout: useCallback(() => setAboutOpen(false), []),
    openCommandHelp: useCallback(() => setCommandHelpOpen(true), []),
    closeCommandHelp: useCallback(() => setCommandHelpOpen(false), []),
    reset
  };
};

export type EditorDialogController =
  ReturnType<typeof useEditorDialogController>;
