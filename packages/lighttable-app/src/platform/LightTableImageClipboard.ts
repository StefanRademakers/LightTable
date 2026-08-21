export interface LightTableClipboardImagePlacement {
  readonly sourceDocumentId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LightTableClipboardImage {
  readonly blob: Blob;
  readonly placement: LightTableClipboardImagePlacement | null;
}

export interface LightTableImageClipboard {
  writeImage(
    blob: Blob,
    placement: LightTableClipboardImagePlacement
  ): Promise<void>;
  readImage(): Promise<LightTableClipboardImage | null>;
}

export interface LightTableImageClipboardTransport {
  writePng(blob: Blob): Promise<void>;
  readImage(): Promise<Blob | null>;
}

const fingerprint = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
};

/**
 * Adds LightTable-only placement metadata around a standards-based image
 * clipboard. Other applications receive an ordinary PNG; when the same image
 * returns to LightTable, its original document position can be restored.
 */
export const createLightTableImageClipboard = (
  transport: LightTableImageClipboardTransport
): LightTableImageClipboard => {
  let localImage: {
    fingerprint: string;
    placement: LightTableClipboardImagePlacement;
  } | null = null;

  return {
    async writeImage(blob, placement) {
      await transport.writePng(blob);
      localImage = {
        fingerprint: await fingerprint(blob),
        placement
      };
    },
    async readImage() {
      const blob = await transport.readImage();
      if (!blob) return null;
      const imageFingerprint = await fingerprint(blob);
      return {
        blob,
        placement: localImage?.fingerprint === imageFingerprint
          ? localImage.placement
          : null
      };
    }
  };
};

const browserTransport: LightTableImageClipboardTransport = {
  async writePng(blob) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('This browser does not support copying images to the system clipboard.');
    }
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
  },
  async readImage() {
    if (!navigator.clipboard?.read) {
      throw new Error('This browser does not support pasting images from the system clipboard.');
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = ['image/png', 'image/webp', 'image/gif', 'image/avif']
        .find((candidate) => item.types.includes(candidate))
        ?? item.types.find((candidate) => candidate.startsWith('image/'));
      if (type) return item.getType(type);
    }
    return null;
  }
};

let browserClipboard: LightTableImageClipboard | null = null;

export const browserImageClipboard = () => {
  browserClipboard ??= createLightTableImageClipboard(browserTransport);
  return browserClipboard;
};
