export const VIDEO_DOCUMENT_EXTENSIONS = ['mp4', 'webm'] as const;
export const VIDEO_DOCUMENT_MEDIA_TYPES = ['video/mp4', 'video/webm'] as const;

export type VideoDocumentMediaType = typeof VIDEO_DOCUMENT_MEDIA_TYPES[number];

const mediaTypeByExtension: Readonly<Record<string, VideoDocumentMediaType>> = {
  mp4: 'video/mp4',
  webm: 'video/webm'
};

export const videoMediaTypeForName = (name: string): VideoDocumentMediaType | null => {
  const extension = name.toLocaleLowerCase('en-US').match(/\.([^.]+)$/)?.[1] ?? '';
  return mediaTypeByExtension[extension] ?? null;
};

/** MIME and extension are admission hints; the host still owns safe probing. */
export const isSupportedVideoDocument = ({
  name,
  mediaType
}: {
  readonly name: string;
  readonly mediaType?: string;
}): boolean => VIDEO_DOCUMENT_MEDIA_TYPES.includes(mediaType as VideoDocumentMediaType)
  || videoMediaTypeForName(name) !== null;
