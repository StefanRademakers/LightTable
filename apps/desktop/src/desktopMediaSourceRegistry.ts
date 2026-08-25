import { randomUUID } from 'node:crypto';

export interface DesktopMediaSourceDescriptor {
  readonly id: string;
  readonly url: string;
  readonly byteLength: number;
}

export interface DesktopMediaSourceRecord {
  readonly id: string;
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

/**
 * Capability registry for host-owned media streams.
 *
 * Renderer URLs contain only an unguessable token: absolute filesystem paths
 * never cross into markup and arbitrary `lighttable-media:` URLs cannot read
 * arbitrary files. Entries live exactly as long as their document owner.
 */
export class DesktopMediaSourceRegistry {
  readonly #sources = new Map<string, DesktopMediaSourceRecord>();

  authorize(path: string, mediaType: string, byteLength: number): DesktopMediaSourceDescriptor {
    const id = randomUUID();
    this.#sources.set(id, { id, path, mediaType, byteLength });
    return {
      id,
      url: `lighttable-media://local/${id}`,
      byteLength
    };
  }

  resolve(requestUrl: string): DesktopMediaSourceRecord | null {
    try {
      const url = new URL(requestUrl);
      if (url.protocol !== 'lighttable-media:' || url.hostname !== 'local') return null;
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!id || id.includes('/')) return null;
      return this.#sources.get(id) ?? null;
    } catch {
      return null;
    }
  }

  release(id: string): boolean {
    return this.#sources.delete(id);
  }

  clear(): void {
    this.#sources.clear();
  }

  get size(): number {
    return this.#sources.size;
  }
}
