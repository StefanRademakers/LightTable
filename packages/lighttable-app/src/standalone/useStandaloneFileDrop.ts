import { useCallback, useEffect, useState } from 'react';
import {
  imagePickerFormatNames,
  isSupportedImageFile
} from '../lighttable/image-io/supportedImageFormats';
import type { StandaloneDecodeMode } from './standaloneDocumentRuntime';

const hasFiles = (transfer: DataTransfer | null) =>
  transfer !== null && Array.from(transfer.types).includes('Files');

export const filterSupportedDroppedFiles = (
  files: readonly File[],
  decodeMode: StandaloneDecodeMode = 'automatic'
) => files.filter((file) =>
  isSupportedImageFile(file, file.name, decodeMode)
);

export interface StandaloneFileDropState {
  readonly active: boolean;
  readonly error: string | null;
  clearError(): void;
}

/**
 * Turns the complete standalone window into a host-neutral document drop zone.
 *
 * Only operating-system file drags are claimed. Dockview panel drags and editor
 * gestures continue to use their own data-transfer payloads. Every accepted
 * file enters the same workspace open path as File > Open, so a drop creates a
 * separate document session instead of replacing the active document.
 */
export const useStandaloneFileDrop = (
  onOpen: (file: File, decodeMode?: StandaloneDecodeMode) => unknown,
  onAccepted?: (files: readonly File[]) => void
): StandaloneFileDropState => {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let depth = 0;

    const reset = () => {
      depth = 0;
      setActive(false);
    };
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth += 1;
      setActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      reset();

      const supported = filterSupportedDroppedFiles(dropped);
      if (supported.length === 0) {
        setError(
          `Unsupported file. Drop ${imagePickerFormatNames('automatic')}.`
        );
        return;
      }

      setError(
        supported.length === dropped.length
          ? null
          : `Opened ${supported.length} supported file${supported.length === 1 ? '' : 's'}; `
            + `${dropped.length - supported.length} unsupported file${dropped.length - supported.length === 1 ? '' : 's'} skipped.`
      );
      supported.forEach((file) => onOpen(file, 'automatic'));
      onAccepted?.(supported);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('blur', reset);
    };
  }, [onAccepted, onOpen]);

  return { active, error, clearError };
};
