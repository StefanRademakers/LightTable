import { useCallback, useState } from 'react';
import type { LayerId } from '../document/documentTypes';
import type { PdfExportPreflightRequest } from '../pdf/PdfExportPreflightDialog';

export type FlattenRequest =
  | { readonly kind: 'group'; readonly groupId: LayerId }
  | { readonly kind: 'image' };

export interface TextToShapeRequest {
  readonly layerId: LayerId;
}

export const useEditorDialogController = () => {
  const [featherOpen, setFeatherOpen] = useState(false);
  const [flattenRequest, setFlattenRequest] =
    useState<FlattenRequest | null>(null);
  const [psdReportOpen, setPsdReportOpen] = useState(false);
  const [textToShapeRequest, setTextToShapeRequest] = useState<TextToShapeRequest | null>(null);
  const [pdfExportPreflightRequest, setPdfExportPreflightRequest] = useState<PdfExportPreflightRequest | null>(null);

  const reset = useCallback(() => {
    setFeatherOpen(false);
    setFlattenRequest(null);
    setPsdReportOpen(false);
    setTextToShapeRequest(null);
    setPdfExportPreflightRequest(null);
  }, []);

  return {
    featherOpen,
    flattenRequest,
    psdReportOpen,
    textToShapeRequest,
    pdfExportPreflightRequest,
    openFeather: useCallback(() => setFeatherOpen(true), []),
    closeFeather: useCallback(() => setFeatherOpen(false), []),
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
    openPdfExportPreflight: useCallback(
      (request: PdfExportPreflightRequest) => setPdfExportPreflightRequest(request),
      []
    ),
    closePdfExportPreflight: useCallback(() => setPdfExportPreflightRequest(null), []),
    openPsdReport: useCallback(() => setPsdReportOpen(true), []),
    closePsdReport: useCallback(() => setPsdReportOpen(false), []),
    reset
  };
};

export type EditorDialogController =
  ReturnType<typeof useEditorDialogController>;
