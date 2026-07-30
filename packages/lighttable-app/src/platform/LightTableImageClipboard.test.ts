import { describe, expect, it } from 'vitest';
import {
  createLightTableImageClipboard,
  type LightTableImageClipboardTransport
} from './LightTableImageClipboard';

const png = (contents: string) => new Blob([contents], { type: 'image/png' });

describe('LightTableImageClipboard', () => {
  it('restores placement metadata while the system clipboard still contains the copied image', async () => {
    let systemImage: Blob | null = null;
    const transport: LightTableImageClipboardTransport = {
      writePng: async (blob) => {
        systemImage = blob;
      },
      readImage: async () => systemImage
    };
    const clipboard = createLightTableImageClipboard(transport);
    const placement = {
      sourceDocumentId: 'document-a',
      x: 12,
      y: 18,
      width: 320,
      height: 180
    };

    await clipboard.writeImage(png('lighttable pixels'), placement);

    await expect(clipboard.readImage()).resolves.toMatchObject({ placement });
  });

  it('drops private placement metadata when another application replaces the clipboard image', async () => {
    let systemImage: Blob | null = null;
    const transport: LightTableImageClipboardTransport = {
      writePng: async (blob) => {
        systemImage = blob;
      },
      readImage: async () => systemImage
    };
    const clipboard = createLightTableImageClipboard(transport);

    await clipboard.writeImage(png('lighttable pixels'), {
      sourceDocumentId: 'document-a',
      x: 12,
      y: 18,
      width: 320,
      height: 180
    });
    systemImage = png('photoshop pixels');

    await expect(clipboard.readImage()).resolves.toMatchObject({
      blob: systemImage,
      placement: null
    });
  });
});
