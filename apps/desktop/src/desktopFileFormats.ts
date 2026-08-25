export interface DesktopOpenDialogFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

const DOCUMENT_EXTENSIONS = [
  ...NATIVE_BITMAP_FORMATS.flatMap((format) => format.extensions.map((value) => value.slice(1))),
  'svg', 'psd', 'psb', 'pdf', 'mp4', 'webm', 'lighttable.png'
] as const;

/** Keeps PDF visible as its own Windows file-type choice as well as in All supported files. */
export const createDesktopOpenDialogFilters = (): DesktopOpenDialogFilter[] => [
  {
    name: 'Supported media and documents',
    extensions: [...DOCUMENT_EXTENSIONS]
  },
  { name: 'PDF documents', extensions: ['pdf'] },
  { name: 'SVG documents', extensions: ['svg'] },
  { name: 'Photoshop documents', extensions: ['psd', 'psb'] },
  { name: 'Video files', extensions: ['mp4', 'webm'] },
  { name: 'All files', extensions: ['*'] }
];

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  psd: 'image/vnd.adobe.photoshop',
  psb: 'image/vnd.adobe.photoshop',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm'
};

export const desktopMediaTypeForFileName = (fileName: string): string => {
  const native = nativeBitmapFormatForFile(fileName);
  if (native) return native.mediaType;
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  return MEDIA_TYPE_BY_EXTENSION[extension] ?? '';
};
import {
  NATIVE_BITMAP_FORMATS,
  nativeBitmapFormatForFile
} from '@lighttable/app/bitmap-formats';
