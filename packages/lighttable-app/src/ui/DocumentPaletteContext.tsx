import React from 'react';

/**
 * UI-facing palette projection. The editor owns how these values are sampled
 * and clustered; reusable color controls only depend on this immutable view.
 */
export interface DocumentPaletteColor {
  readonly rgb: readonly [number, number, number];
  readonly hex: string;
  readonly coverage: number;
  readonly pixelCount: number;
  readonly oklab: readonly [number, number, number];
}

export type DocumentPaletteLoader = (
  colorCount: number
) => Promise<readonly DocumentPaletteColor[]>;

const DocumentPaletteContext = React.createContext<DocumentPaletteLoader | null>(null);

export const DocumentPaletteProvider: React.FC<React.PropsWithChildren<{
  readonly loadPalette: DocumentPaletteLoader;
}>> = ({ loadPalette, children }) => (
  <DocumentPaletteContext.Provider value={loadPalette}>{children}</DocumentPaletteContext.Provider>
);

export const useDocumentPaletteLoader = () => React.useContext(DocumentPaletteContext);
