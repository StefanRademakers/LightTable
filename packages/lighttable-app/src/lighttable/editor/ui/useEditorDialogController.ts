import { useCallback, useState } from 'react';
import type { LayerId } from '../document/documentTypes';
import type { PdfExportPreflightRequest } from '../pdf/PdfExportPreflightDialog';

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
  const [featherCanvasBounds, setFeatherCanvasBounds] = useState(false);
  const [selectionMorphology, setSelectionMorphology] =
    useState<'border' | 'smooth' | 'expand' | 'contract' | null>(null);
  const [selectionMorphologyCanvasBounds, setSelectionMorphologyCanvasBounds] = useState({
    border: false,
    smooth: false,
    expand: false,
    contract: false
  });
  const [fillOpen, setFillOpen] = useState(false);
  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [canvasSizeOpen, setCanvasSizeOpen] = useState(false);
  const [arbitraryRotationOpen, setArbitraryRotationOpen] = useState(false);
  const [duplicateImageOpen, setDuplicateImageOpen] = useState(false);
  const [newGuideOpen, setNewGuideOpen] = useState(false);
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
    setSelectionMorphology(null);
    setFillOpen(false);
    setImageSizeOpen(false);
    setCanvasSizeOpen(false);
    setArbitraryRotationOpen(false);
    setDuplicateImageOpen(false);
    setNewGuideOpen(false);
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
    featherCanvasBounds,
    selectionMorphology,
    selectionMorphologyCanvasBounds,
    fillOpen,
    imageSizeOpen,
    canvasSizeOpen,
    arbitraryRotationOpen,
    duplicateImageOpen,
    newGuideOpen,
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
    setFeatherCanvasBounds,
    openBorder: useCallback(() => setSelectionMorphology('border'), []),
    openSmooth: useCallback(() => setSelectionMorphology('smooth'), []),
    openExpand: useCallback(() => setSelectionMorphology('expand'), []),
    openContract: useCallback(() => setSelectionMorphology('contract'), []),
    closeSelectionMorphology: useCallback(() => setSelectionMorphology(null), []),
    setSelectionMorphologyCanvasBounds: useCallback((
      mode: 'border' | 'smooth' | 'expand' | 'contract',
      enabled: boolean
    ) => setSelectionMorphologyCanvasBounds((current) => ({ ...current, [mode]: enabled })), []),
    openFill: useCallback(() => setFillOpen(true), []),
    closeFill: useCallback(() => setFillOpen(false), []),
    openImageSize: useCallback(() => setImageSizeOpen(true), []),
    closeImageSize: useCallback(() => setImageSizeOpen(false), []),
    openCanvasSize: useCallback(() => setCanvasSizeOpen(true), []),
    closeCanvasSize: useCallback(() => setCanvasSizeOpen(false), []),
    openArbitraryRotation: useCallback(() => setArbitraryRotationOpen(true), []),
    closeArbitraryRotation: useCallback(() => setArbitraryRotationOpen(false), []),
    openDuplicateImage: useCallback(() => setDuplicateImageOpen(true), []),
    closeDuplicateImage: useCallback(() => setDuplicateImageOpen(false), []),
    openNewGuide: useCallback(() => setNewGuideOpen(true), []),
    closeNewGuide: useCallback(() => setNewGuideOpen(false), []),
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
