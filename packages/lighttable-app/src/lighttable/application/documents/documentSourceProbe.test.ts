import { describe, expect, it } from 'vitest';
import { probeDocumentSource } from './documentSourceProbe';

const blobWithHeader = (
  header: readonly number[],
  suffix: readonly number[] = []
) => new Blob([new Uint8Array([...header, ...suffix])]);

const pngHeader = (bitDepth: number) => {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[24] = bitDepth;
  return bytes;
};

describe('probeDocumentSource', () => {
  it('keeps ordinary 8-bit PNG on the browser-native fast lane', async () => {
    await expect(probeDocumentSource(new Blob([pngHeader(8)]))).resolves.toMatchObject({
      format: 'png',
      codec: 'browser-native',
      decodeMode: 'fast',
      bitDepth: 8
    });
  });

  it('routes 16-bit PNG and TIFF through the precision codec lazily', async () => {
    await expect(probeDocumentSource(new Blob([pngHeader(16)]))).resolves.toMatchObject({
      format: 'png',
      codec: 'wasm-vips',
      decodeMode: 'preserve-precision',
      bitDepth: 16
    });
    await expect(probeDocumentSource(
      blobWithHeader([0x49, 0x49, 0x2a, 0x00])
    )).resolves.toMatchObject({
      format: 'tiff',
      codec: 'wasm-vips',
      decodeMode: 'preserve-precision'
    });
  });

  it('recognizes PSD and PSB from their signatures without an extension', async () => {
    const psd = new Uint8Array(32);
    psd.set(new TextEncoder().encode('8BPS'));
    new DataView(psd.buffer).setUint16(4, 1, false);
    new DataView(psd.buffer).setUint16(22, 16, false);
    await expect(probeDocumentSource(new Blob([psd]))).resolves.toMatchObject({
      format: 'psd',
      codec: 'photoshop',
      bitDepth: 16
    });

    new DataView(psd.buffer).setUint16(4, 2, false);
    await expect(probeDocumentSource(new Blob([psd]))).resolves.toMatchObject({
      format: 'psb',
      codec: 'photoshop'
    });
  });

  it('routes PDF bytes to the lazy page raster adapter', async () => {
    await expect(probeDocumentSource(
      new Blob([new TextEncoder().encode('%PDF-1.4\n')])
    )).resolves.toMatchObject({
      format: 'pdf',
      codec: 'pdf-raster',
      decodeMode: 'fast',
      bitDepth: null
    });
  });

  it('refuses animated PNG and WebP instead of silently opening one frame', async () => {
    const png = new Uint8Array(8 + 12 + 12);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set(new TextEncoder().encode('acTL'), 12);
    await expect(probeDocumentSource(new Blob([png]))).rejects.toThrow('Animated PNG');

    const webp = new Uint8Array(22);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBP'), 8);
    webp.set(new TextEncoder().encode('VP8X'), 12);
    new DataView(webp.buffer).setUint32(16, 1, true);
    webp[20] = 0x02;
    await expect(probeDocumentSource(new Blob([webp]))).rejects.toThrow('Animated WebP');
  });

  it('rejects unsafe raster dimensions before browser decode allocates pixels', async () => {
    const png = pngHeader(8);
    png.set(new TextEncoder().encode('IHDR'), 12);
    new DataView(png.buffer).setUint32(16, 40_000, false);
    new DataView(png.buffer).setUint32(20, 100, false);
    await expect(probeDocumentSource(new Blob([png]))).rejects.toThrow('safe raster decode limit');
  });

  it('routes SVG text to the native editable codec without trusting MIME metadata', async () => {
    const source = new Blob([new TextEncoder().encode(
      '\uFEFF <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
    )], { type: 'application/octet-stream' });
    await expect(probeDocumentSource(source)).resolves.toMatchObject({
      format: 'svg', codec: 'svg-native', decodeMode: 'fast', bitDepth: null
    });
  });

  it('recognizes an Inkscape SVG with a leading authoring comment', async () => {
    const source = new Blob([new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!-- Created with Inkscape (http://www.inkscape.org/) -->\n'
      + '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
    )]);
    await expect(probeDocumentSource(source)).resolves.toMatchObject({
      format: 'svg', codec: 'svg-native'
    });
  });

  it('recognizes a layered LightTable document from its footer', async () => {
    const footer = new Uint8Array(12);
    footer.set(new TextEncoder().encode('LTBLDOC1'));
    const result = await probeDocumentSource(
      new Blob([pngHeader(8), footer])
    );
    expect(result).toMatchObject({
      format: 'lighttable',
      codec: 'lighttable',
      decodeMode: 'fast'
    });
  });

  it('does not trust a misleading filename or MIME type', async () => {
    const source = new File(
      [new Uint8Array([0x00, 0x01, 0x02])],
      'renamed.png',
      { type: 'image/png' }
    );
    await expect(probeDocumentSource(source)).resolves.toMatchObject({
      format: 'unknown',
      codec: 'unsupported'
    });
  });
});
