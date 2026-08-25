export interface LightTableExternalMediaSource {
  readonly url: string;
  readonly byteLength: number;
  release(): void;
}

const sources = new WeakMap<File, LightTableExternalMediaSource>();

export const registerExternalMediaSource = (
  file: File,
  source: LightTableExternalMediaSource
): void => {
  sources.set(file, source);
};

export const externalMediaSourceFor = (file: File): LightTableExternalMediaSource | null =>
  sources.get(file) ?? null;

export const sourceByteLengthFor = (file: File): number =>
  sources.get(file)?.byteLength ?? file.size;

export const releaseExternalMediaSource = (file: File): void => {
  const source = sources.get(file);
  if (!source) return;
  sources.delete(file);
  source.release();
};
