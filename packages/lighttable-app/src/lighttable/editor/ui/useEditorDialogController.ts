import { useCallback, useState } from 'react';
import type { LayerId } from '../document/documentTypes';

export type FlattenRequest =
  | { readonly kind: 'group'; readonly groupId: LayerId }
  | { readonly kind: 'image' };

export const useEditorDialogController = () => {
  const [featherOpen, setFeatherOpen] = useState(false);
  const [flattenRequest, setFlattenRequest] =
    useState<FlattenRequest | null>(null);
  const [psdReportOpen, setPsdReportOpen] = useState(false);

  const reset = useCallback(() => {
    setFeatherOpen(false);
    setFlattenRequest(null);
    setPsdReportOpen(false);
  }, []);

  return {
    featherOpen,
    flattenRequest,
    psdReportOpen,
    openFeather: useCallback(() => setFeatherOpen(true), []),
    closeFeather: useCallback(() => setFeatherOpen(false), []),
    requestFlatten: useCallback(
      (request: FlattenRequest) => setFlattenRequest(request),
      []
    ),
    closeFlatten: useCallback(() => setFlattenRequest(null), []),
    openPsdReport: useCallback(() => setPsdReportOpen(true), []),
    closePsdReport: useCallback(() => setPsdReportOpen(false), []),
    reset
  };
};

export type EditorDialogController =
  ReturnType<typeof useEditorDialogController>;
