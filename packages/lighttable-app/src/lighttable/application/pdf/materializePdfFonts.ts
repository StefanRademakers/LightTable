import type {
  PdfExportFontPlan,
  PdfExportFontDisposition,
  PdfTextExportPlan
} from '@lighttable/pdf-core';
import type { DocumentFontAsset } from '../../editor/document/documentTypes';

export interface PdfFontSubsetRequest {
  readonly fontBytes: Uint8Array;
  readonly faceIndex: number;
  readonly glyphIds: readonly number[];
  readonly variableAxes: Readonly<Record<string, number>>;
  readonly downgradeCff2: boolean;
}

export interface PdfFontMaterializationLimits {
  readonly maximumFontBytes: number;
  readonly maximumTotalOutputBytes: number;
  readonly maximumEmbeddedFontCount: number;
}

export const DEFAULT_PDF_FONT_MATERIALIZATION_LIMITS: PdfFontMaterializationLimits = Object.freeze({
  maximumFontBytes: 64 * 1024 * 1024,
  maximumTotalOutputBytes: 256 * 1024 * 1024,
  maximumEmbeddedFontCount: 256
});

export interface PdfFontMaterializationDependencies {
  readonly fonts: readonly DocumentFontAsset[];
  readonly loadFontBytes: (assetId: string) => Promise<Uint8Array | null>;
  readonly subsetSfnt: (request: PdfFontSubsetRequest) => Promise<Uint8Array> | Uint8Array;
  readonly decodeSfnt?: (
    bytes: Uint8Array,
    asset: DocumentFontAsset
  ) => Promise<Uint8Array> | Uint8Array;
  readonly limits?: Partial<PdfFontMaterializationLimits>;
}

export type PdfEmbeddedFontDisposition = Extract<
  PdfExportFontDisposition,
  'subset' | 'embed-existing' | 'embed-full'
>;

export interface PdfEmbeddedFontResource {
  readonly instanceId: string;
  readonly assetId: string;
  readonly sourceFingerprintSha256: string;
  readonly postScriptName: string | null;
  readonly faceIndex: number;
  readonly disposition: PdfEmbeddedFontDisposition;
  readonly bytes: Uint8Array;
  readonly glyphIds: readonly number[];
  readonly retainGlyphIds: boolean;
}

export interface PdfFontMaterializationResult {
  readonly embedded: readonly PdfEmbeddedFontResource[];
  readonly fallback: readonly PdfExportFontPlan[];
  readonly totalEmbeddedBytes: number;
}

const fail = (message: string): never => {
  throw new Error(`PDF font materialization ${message}`);
};

const positiveLimit = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive safe integer.`);
};

const isEmbeddedDisposition = (
  disposition: PdfExportFontDisposition
): disposition is PdfEmbeddedFontDisposition => (
  disposition === 'subset' || disposition === 'embed-existing' || disposition === 'embed-full'
);

/**
 * Converts a validated writer-neutral plan into immutable font resources.
 * The injected subsetter is intentionally runtime-agnostic so browser and
 * Electron can execute HarfBuzz in a lazy worker without changing PDF policy.
 */
export const materializePdfFonts = async (
  plan: PdfTextExportPlan,
  dependencies: PdfFontMaterializationDependencies
): Promise<PdfFontMaterializationResult> => {
  const limits = {
    ...DEFAULT_PDF_FONT_MATERIALIZATION_LIMITS,
    ...dependencies.limits
  };
  positiveLimit(limits.maximumFontBytes, 'maximumFontBytes');
  positiveLimit(limits.maximumTotalOutputBytes, 'maximumTotalOutputBytes');
  positiveLimit(limits.maximumEmbeddedFontCount, 'maximumEmbeddedFontCount');
  const directPlans = plan.fonts.filter(font => isEmbeddedDisposition(font.disposition));
  if (directPlans.length > limits.maximumEmbeddedFontCount) {
    fail(`font count exceeds ${limits.maximumEmbeddedFontCount}.`);
  }
  const metadata = new Map(dependencies.fonts.map(font => [font.assetId, font]));
  const bytePromises = new Map<string, Promise<Uint8Array>>();
  const load = (font: DocumentFontAsset) => {
    const pending = bytePromises.get(font.assetId);
    if (pending) return pending;
    const request = dependencies.loadFontBytes(font.assetId).then(bytes => {
      if (!bytes) return fail(`could not load bytes for ${font.assetId}.`);
      if (bytes.byteLength < 1 || bytes.byteLength > limits.maximumFontBytes) {
        return fail(`bytes for ${font.assetId} exceed the per-font limit.`);
      }
      if (font.byteLength !== bytes.byteLength) {
        return fail(`bytes for ${font.assetId} do not match registered length ${font.byteLength}.`);
      }
      return Uint8Array.from(bytes);
    });
    bytePromises.set(font.assetId, request);
    return request;
  };

  const embedded: PdfEmbeddedFontResource[] = [];
  let totalEmbeddedBytes = 0;
  for (const fontPlan of directPlans) {
    const disposition = fontPlan.disposition;
    if (!isEmbeddedDisposition(disposition)) continue;
    const asset = metadata.get(fontPlan.assetId)
      ?? fail(`plan references missing font ${fontPlan.assetId}.`);
    const source = await load(asset);
    let bytes: Uint8Array;
    if (disposition === 'subset') {
      if (fontPlan.subsetter !== 'harfbuzz' || !fontPlan.retainGlyphIds) {
        fail(`subset plan ${fontPlan.instanceId} has an incompatible subset contract.`);
      }
      const sfnt = fontPlan.requiresSfntDecode
        ? dependencies.decodeSfnt
          ? await dependencies.decodeSfnt(source, asset)
          : fail(`requires an SFNT decoder for ${fontPlan.instanceId}.`)
        : source;
      bytes = await dependencies.subsetSfnt({
        fontBytes: Uint8Array.from(sfnt),
        faceIndex: asset.faceIndex,
        glyphIds: fontPlan.glyphIds,
        variableAxes: fontPlan.variableAxes,
        downgradeCff2: asset.outline === 'cff2'
      });
    } else {
      bytes = source;
    }
    if (bytes.byteLength < 1 || bytes.byteLength > limits.maximumFontBytes) {
      fail(`output for ${fontPlan.instanceId} exceeds the per-font limit.`);
    }
    totalEmbeddedBytes += bytes.byteLength;
    if (totalEmbeddedBytes > limits.maximumTotalOutputBytes) {
      fail(`output exceeds ${limits.maximumTotalOutputBytes} bytes.`);
    }
    embedded.push({
      instanceId: fontPlan.instanceId,
      assetId: asset.assetId,
      sourceFingerprintSha256: asset.fingerprintSha256,
      postScriptName: asset.postScriptName ?? null,
      faceIndex: asset.faceIndex,
      disposition,
      bytes: Uint8Array.from(bytes),
      glyphIds: [...fontPlan.glyphIds],
      retainGlyphIds: fontPlan.retainGlyphIds
    });
  }
  return {
    embedded,
    fallback: plan.fonts.filter(font => !isEmbeddedDisposition(font.disposition)),
    totalEmbeddedBytes
  };
};
