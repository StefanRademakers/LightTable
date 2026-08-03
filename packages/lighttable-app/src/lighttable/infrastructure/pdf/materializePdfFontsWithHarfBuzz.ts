import type { PdfTextExportPlan } from '@lighttable/pdf-core';
import harfBuzzSubsetWasmUrl from '@lighttable/harfbuzz-subset-wasm?url';
import {
  materializePdfFonts,
  type PdfFontMaterializationDependencies,
  type PdfFontMaterializationResult
} from '../../application/pdf/materializePdfFonts';
import { createHarfBuzzFontSubsetter } from './HarfBuzzFontSubsetter';
import { decodeWebFontToSfnt } from './decodeWebFontToSfnt';

const MAXIMUM_SUBSET_WASM_BYTES = 4 * 1024 * 1024;

export type HarfBuzzPdfFontMaterializationDependencies = Omit<
  PdfFontMaterializationDependencies,
  'subsetSfnt'
> & {
  readonly fetchWasm?: typeof fetch;
};

const loadSubsetWasm = async (fetchWasm: typeof fetch) => {
  const response = await fetchWasm(harfBuzzSubsetWasmUrl);
  if (!response.ok) {
    throw new Error(`HarfBuzz subset WASM could not be loaded (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_SUBSET_WASM_BYTES) {
    throw new Error('HarfBuzz subset WASM exceeds its byte limit.');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_SUBSET_WASM_BYTES) {
    throw new Error('HarfBuzz subset WASM has an invalid byte length.');
  }
  return bytes;
};

/**
 * Production browser/Electron adapter. The 613-kB WASM asset and its heap are
 * loaded only when at least one planned font needs subsetting. One runtime is
 * reused for the export transaction and is not retained afterwards.
 */
export const materializePdfFontsWithHarfBuzz = async (
  plan: PdfTextExportPlan,
  dependencies: HarfBuzzPdfFontMaterializationDependencies
): Promise<PdfFontMaterializationResult> => {
  const requiresSubsetting = plan.fonts.some(font => font.disposition === 'subset');
  if (!requiresSubsetting) {
    return materializePdfFonts(plan, {
      ...dependencies,
      subsetSfnt: () => {
        throw new Error('The PDF plan did not authorize font subsetting.');
      }
    });
  }
  const subsetter = await createHarfBuzzFontSubsetter(await loadSubsetWasm(
    dependencies.fetchWasm ?? fetch
  ));
  return materializePdfFonts(plan, {
    ...dependencies,
    decodeSfnt: dependencies.decodeSfnt ?? ((bytes, asset) => {
      if (asset.container !== 'woff' && asset.container !== 'woff2') {
        throw new Error(`No PDF SFNT decoder is installed for ${asset.container} fonts.`);
      }
      return decodeWebFontToSfnt(bytes);
    }),
    subsetSfnt: request => subsetter.subset(request)
  });
};
