import { createHash, verify } from 'node:crypto';

export type LightTableReleaseChannel = 'dev' | 'preview' | 'stable';

export interface SignedUpdateManifest {
  readonly schemaVersion: 1;
  readonly product: 'LightTable';
  readonly version: string;
  readonly channel: LightTableReleaseChannel;
  readonly publishedAt: string;
  readonly releaseNotes: string;
  readonly minimumDocumentManifestVersion: number;
  readonly maximumRecoveryVersion: number;
  readonly artifact: {
    readonly url: string;
    readonly sha256: string;
    readonly byteLength: number;
  };
  readonly signature: string;
}

export type UpdateManifestDecision =
  | { readonly status: 'available'; readonly manifest: SignedUpdateManifest }
  | { readonly status: 'current' | 'older' | 'channel-blocked'; readonly manifest: SignedUpdateManifest }
  | { readonly status: 'invalid'; readonly message: string };

export const canonicalUpdateManifestPayload = (manifest: Omit<SignedUpdateManifest, 'signature'>): string =>
  JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    product: manifest.product,
    version: manifest.version,
    channel: manifest.channel,
    publishedAt: manifest.publishedAt,
    releaseNotes: manifest.releaseNotes,
    minimumDocumentManifestVersion: manifest.minimumDocumentManifestVersion,
    maximumRecoveryVersion: manifest.maximumRecoveryVersion,
    artifact: {
      url: manifest.artifact.url,
      sha256: manifest.artifact.sha256,
      byteLength: manifest.artifact.byteLength
    }
  });

const parseVersion = (version: string): readonly [number, number, number, string] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''] : null;
};

export const compareReleaseVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Release versions must use semantic versioning.');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Number(a[index]) - Number(b[index]);
  }
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3].localeCompare(b[3], 'en', { numeric: true });
};

const channelAllows = (current: LightTableReleaseChannel, offered: LightTableReleaseChannel): boolean =>
  current === 'dev' || current === offered || (current === 'preview' && offered === 'stable');

export const verifyUpdateManifest = ({
  value,
  publicKeyPem,
  currentVersion,
  currentChannel
}: {
  readonly value: unknown;
  readonly publicKeyPem: string;
  readonly currentVersion: string;
  readonly currentChannel: LightTableReleaseChannel;
}): UpdateManifestDecision => {
  try {
    if (!value || typeof value !== 'object') throw new Error('The update manifest is not an object.');
    const manifest = value as SignedUpdateManifest;
    if (manifest.schemaVersion !== 1 || manifest.product !== 'LightTable') {
      throw new Error('The update manifest schema or product is unsupported.');
    }
    if (!parseVersion(manifest.version) || !['dev', 'preview', 'stable'].includes(manifest.channel)) {
      throw new Error('The update version or channel is invalid.');
    }
    if (typeof manifest.publishedAt !== 'string' || !Number.isFinite(Date.parse(manifest.publishedAt))
      || typeof manifest.releaseNotes !== 'string' || manifest.releaseNotes.length > 100_000
      || !Number.isSafeInteger(manifest.minimumDocumentManifestVersion)
      || !Number.isSafeInteger(manifest.maximumRecoveryVersion)) {
      throw new Error('The update metadata or compatibility declaration is invalid.');
    }
    if (!Number.isSafeInteger(manifest.artifact?.byteLength) || manifest.artifact.byteLength <= 0
      || manifest.artifact.byteLength > 2_147_483_647
      || !/^[a-f\d]{64}$/i.test(manifest.artifact.sha256)
      || !/^https:\/\//i.test(manifest.artifact.url)
      || typeof manifest.signature !== 'string') {
      throw new Error('The update artifact declaration is invalid.');
    }
    const { signature, ...unsigned } = manifest;
    const authentic = verify(
      null,
      Buffer.from(canonicalUpdateManifestPayload(unsigned)),
      publicKeyPem,
      Buffer.from(signature, 'base64')
    );
    if (!authentic) throw new Error('The update manifest signature is invalid.');
    if (!channelAllows(currentChannel, manifest.channel)) return { status: 'channel-blocked', manifest };
    const comparison = compareReleaseVersions(manifest.version, currentVersion);
    if (comparison === 0) return { status: 'current', manifest };
    return comparison < 0 ? { status: 'older', manifest } : { status: 'available', manifest };
  } catch (reason) {
    return { status: 'invalid', message: reason instanceof Error ? reason.message : String(reason) };
  }
};

export const verifyUpdateArtifact = (
  manifest: SignedUpdateManifest,
  bytes: Uint8Array
): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
  if (bytes.byteLength !== manifest.artifact.byteLength) {
    return { ok: false, message: 'The downloaded update length does not match the signed manifest.' };
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  return hash === manifest.artifact.sha256
    ? { ok: true }
    : { ok: false, message: 'The downloaded update hash does not match the signed manifest.' };
};

export const releaseChannelFor = (
  version: string,
  packaged: boolean,
  configured?: string
): LightTableReleaseChannel => {
  if (configured && ['dev', 'preview', 'stable'].includes(configured)) {
    return configured as LightTableReleaseChannel;
  }
  if (!packaged) return 'dev';
  return version.includes('-') ? 'preview' : 'stable';
};

export const fetchUpdateManifest = async (
  url: string,
  signal: AbortSignal,
  request: typeof fetch = fetch
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 'unavailable' | 'canceled'; readonly message: string }
> => {
  try {
    const response = await request(url, { signal });
    if (!response.ok) {
      return { ok: false, status: 'unavailable', message: `Update service returned HTTP ${response.status}.` };
    }
    return { ok: true, value: JSON.parse(await response.text()) };
  } catch (reason) {
    return signal.aborted
      ? { ok: false, status: 'canceled', message: 'The update check was canceled or timed out.' }
      : { ok: false, status: 'unavailable', message: reason instanceof Error ? reason.message : String(reason) };
  }
};
