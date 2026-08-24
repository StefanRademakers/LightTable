/**
 * Host-side limits are passed explicitly into the codec. Keeping these out of
 * a Vite-optimized workspace dependency prevents a hot dev session from
 * combining a new error message with stale prebundled limit values.
 */
export const SVG_IMPORT_MAX_BYTES = 33_554_432;
export const SVG_IMPORT_MAX_PATH_DATA_BYTES = 8_388_608;
export const SVG_IMPORT_MAX_ELEMENTS = 32_768;
export const SVG_IMPORT_MAX_SUBPATHS = 4_096;
export const SVG_IMPORT_MAX_ANCHORS = 262_144;

export const SVG_IMPORT_CODEC_LIMITS = Object.freeze({
  maxInputBytes: SVG_IMPORT_MAX_BYTES,
  maxPathDataBytes: SVG_IMPORT_MAX_PATH_DATA_BYTES,
  maxElements: SVG_IMPORT_MAX_ELEMENTS,
  maxSubpaths: SVG_IMPORT_MAX_SUBPATHS,
  maxAnchors: SVG_IMPORT_MAX_ANCHORS
});
