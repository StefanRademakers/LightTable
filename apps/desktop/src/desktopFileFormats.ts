export interface DesktopOpenDialogFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

const DOCUMENT_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'psd', 'psb', 'pdf', 'lighttable.png'
] as const;

/** Keeps PDF visible as its own Windows file-type choice as well as in All supported files. */
export const createDesktopOpenDialogFilters = (): DesktopOpenDialogFilter[] => [
  {
    name: 'Supported images and documents',
    extensions: [...DOCUMENT_EXTENSIONS]
  },
  { name: 'PDF documents', extensions: ['pdf'] },
  { name: 'Photoshop documents', extensions: ['psd', 'psb'] },
  { name: 'All files', extensions: ['*'] }
];

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  psd: 'image/vnd.adobe.photoshop',
  psb: 'image/vnd.adobe.photoshop',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm'
};

export const desktopMediaTypeForFileName = (fileName: string): string => {
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  return MEDIA_TYPE_BY_EXTENSION[extension] ?? '';
};
