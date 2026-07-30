export interface AdvancedImageIoCapabilities {
  available: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  worker: boolean;
  webAssembly: boolean;
  simd: boolean;
  reasons: string[];
}

// Minimal WebAssembly module containing a SIMD instruction. Validation does not
// instantiate it and therefore does not initialize the optional decoder.
const SIMD_VALIDATION_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b
]);

export const getAdvancedImageIoCapabilities = (): AdvancedImageIoCapabilities => {
  const isolated = globalThis.crossOriginIsolated === true;
  const shared = typeof globalThis.SharedArrayBuffer !== 'undefined';
  const worker = typeof globalThis.Worker !== 'undefined';
  const webAssembly = typeof globalThis.WebAssembly !== 'undefined';
  const simd = webAssembly && WebAssembly.validate(SIMD_VALIDATION_MODULE);
  const reasons: string[] = [];

  if (!isolated) reasons.push('The page is not cross-origin isolated (COOP/COEP).');
  if (!shared) reasons.push('SharedArrayBuffer is not available.');
  if (!worker) reasons.push('Web Workers are not available.');
  if (!webAssembly) reasons.push('WebAssembly is not available.');
  else if (!simd) reasons.push('WebAssembly SIMD is not available.');

  return {
    available: isolated && shared && worker && webAssembly && simd,
    crossOriginIsolated: isolated,
    sharedArrayBuffer: shared,
    worker,
    webAssembly,
    simd,
    reasons
  };
};
