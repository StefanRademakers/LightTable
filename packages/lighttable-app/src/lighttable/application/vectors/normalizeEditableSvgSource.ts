import { normalizeSvg } from '@lighttable/vector-svg-normalizer';
import { SVG_IMPORT_CODEC_LIMITS, SVG_IMPORT_MAX_BYTES } from './svgImportLimits';

/**
 * Renderer-independent import preparation shared by File > Open, File > Place,
 * clipboard placement and the semantic/MCP command route.
 */
export const normalizeEditableSvgSource = async (source: string): Promise<string> =>
  (await normalizeSvg(source, {
    maxInputBytes: SVG_IMPORT_MAX_BYTES,
    maxOutputBytes: SVG_IMPORT_MAX_BYTES,
    maxElements: SVG_IMPORT_CODEC_LIMITS.maxElements,
    maxDepth: 256
  })).svg;

