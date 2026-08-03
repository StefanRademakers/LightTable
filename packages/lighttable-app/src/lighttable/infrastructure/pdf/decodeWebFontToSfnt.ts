import { isSfntFont } from './HarfBuzzFontSubsetter';

const MAXIMUM_WEB_FONT_INPUT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_SFNT_OUTPUT_BYTES = 64 * 1024 * 1024;

const signature = (source: Uint8Array) => source.byteLength >= 4
  ? String.fromCharCode(source[0]!, source[1]!, source[2]!, source[3]!)
  : '';

/** Lazy, CSP-safe WOFF/WOFF2 decoder used only by a PDF font transaction. */
export const decodeWebFontToSfnt = async (source: Uint8Array): Promise<Uint8Array> => {
  if (source.byteLength < 1 || source.byteLength > MAXIMUM_WEB_FONT_INPUT_BYTES) {
    throw new Error('Web-font input exceeds its PDF export byte limit.');
  }
  const input = Uint8Array.from(source);
  const format = signature(input);
  const decoded = format === 'wOF2'
    ? await (await import('woff-lib/woff2/decode')).woff2Decode(input)
    : format === 'wOFF'
      ? await (await import('woff-lib/woff/decode')).woffDecode(input)
      : (() => { throw new Error('PDF SFNT decoding requires WOFF or WOFF2 input.'); })();
  const result = Uint8Array.from(decoded);
  if (result.byteLength < 1 || result.byteLength > MAXIMUM_SFNT_OUTPUT_BYTES) {
    throw new Error('Decoded SFNT exceeds its PDF export byte limit.');
  }
  if (!isSfntFont(result)) throw new Error('Web-font decoder did not produce an SFNT font.');
  return result;
};
