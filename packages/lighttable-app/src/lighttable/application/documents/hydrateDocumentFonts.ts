import type { DocumentFontAsset } from '../../editor/document/documentTypes';
import type { FontAssetBlob } from '../../editor/persistence/layeredDocumentFormat';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';

/** Restores every face alias while reading shared collection bytes only once. */
export const hydrateDocumentFonts = async (
  registry: DocumentFontRegistry,
  binaries: readonly FontAssetBlob[],
  metadata: readonly DocumentFontAsset[],
  isCurrent: () => boolean = () => true
) => {
  await Promise.all(binaries.map(async (binary) => {
    if (!isCurrent()) return;
    const faces = metadata.filter((asset) =>
      asset.fingerprintSha256 === binary.fingerprintSha256
    );
    const [first] = faces;
    if (!first) return;
    faces.forEach((face) => registry.registerReference(face));
    const { byteLength: _byteLength, ...registration } = first;
    const bytes = new Uint8Array(await binary.source.arrayBuffer());
    if (!isCurrent()) return;
    await registry.registerBytes(bytes, registration);
  }));
};
