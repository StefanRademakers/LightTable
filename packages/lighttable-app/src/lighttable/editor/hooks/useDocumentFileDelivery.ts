import { useCallback, useLayoutEffect, useRef } from 'react';
import { captureDocumentFileDelivery, type DocumentFileDeliverySource } from '../../application/documents/captureDocumentFileDelivery';

/** Retire publication authority synchronously with unmount, before passive cleanup/decode continuations. */
export const useDocumentFileDelivery = (resolve: () => DocumentFileDeliverySource, download: (file: File) => void) => {
  const ports = useRef({ resolve, download }); ports.current = { resolve, download };
  const generation = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  return useCallback(() => {
    if (!mounted.current) throw new DOMException('The file delivery view was unmounted.', 'AbortError');
    return captureDocumentFileDelivery(
      () => ports.current.resolve(), () => generation.current, ports.current.download
    );
  }, []);
};
