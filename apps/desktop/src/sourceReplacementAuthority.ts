import path from 'node:path';
import {
  isNativeBitmapFormatId,
  nativeBitmapFormat,
  nativeBitmapFormatForFile,
  type NativeBitmapFormatId
} from '@lighttable/app/bitmap-formats';

export interface DesktopSourceReplacement {
  readonly path: string;
  readonly format: NativeBitmapFormatId;
}

export interface SourceFileIdentity {
  readonly size: number;
  readonly modifiedAtMs: number;
}

const extensionMatchesFormat = (filePath: string, format: DesktopSourceReplacement['format']) => {
  return nativeBitmapFormatForFile(filePath)?.id === nativeBitmapFormat(format).id;
};

const canonicalKey = (filePath: string) => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
};

/** Limits source replacement to paths that entered through a trusted open flow. */
export class SourceReplacementAuthority {
  private readonly allowed = new Map<string, {
    readonly path: string;
    readonly identity: SourceFileIdentity;
  }>();

  constructor(private readonly maximumEntries = 256) {}

  authorize(filePath: string, identity: SourceFileIdentity): string {
    if (!Number.isSafeInteger(identity.size) || identity.size < 0
      || !Number.isFinite(identity.modifiedAtMs) || identity.modifiedAtMs < 0) {
      throw new Error('Invalid source file identity.');
    }
    const resolved = path.resolve(filePath);
    const key = canonicalKey(resolved);
    this.allowed.delete(key);
    this.allowed.set(key, { path: resolved, identity });
    while (this.allowed.size > this.maximumEntries) {
      const oldest = this.allowed.keys().next().value as string | undefined;
      if (!oldest) break;
      this.allowed.delete(oldest);
    }
    return resolved;
  }

  resolve(request: DesktopSourceReplacement, currentIdentity: SourceFileIdentity): string {
    if (!request || typeof request.path !== 'string' || request.path.length > 32_768
      || !isNativeBitmapFormatId(request.format)) {
      throw new Error('Invalid source replacement request.');
    }
    const resolved = path.resolve(request.path);
    if (!extensionMatchesFormat(resolved, request.format)) {
      throw new Error('The source format does not match the replacement path.');
    }
    const authorized = this.allowed.get(canonicalKey(resolved));
    if (!authorized) throw new Error('The source file was not authorized for replacement.');
    if (authorized.identity.size !== currentIdentity.size
      || authorized.identity.modifiedAtMs !== currentIdentity.modifiedAtMs) {
      throw new Error('The source file changed outside LightTable after it was opened.');
    }
    return authorized.path;
  }
}
