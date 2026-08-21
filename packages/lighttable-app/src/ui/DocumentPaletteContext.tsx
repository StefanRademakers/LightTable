import React from 'react';
import type { PaletteColor } from '../lighttable/application/color/documentPalette';

export type DocumentPaletteLoader = (colorCount: number) => Promise<readonly PaletteColor[]>;

const DocumentPaletteContext = React.createContext<DocumentPaletteLoader | null>(null);

export const DocumentPaletteProvider: React.FC<React.PropsWithChildren<{
  readonly loadPalette: DocumentPaletteLoader;
}>> = ({ loadPalette, children }) => (
  <DocumentPaletteContext.Provider value={loadPalette}>{children}</DocumentPaletteContext.Provider>
);

export const useDocumentPaletteLoader = () => React.useContext(DocumentPaletteContext);
