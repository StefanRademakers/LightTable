import type { Layer } from 'ag-psd';
import { readVersionAndDescriptor } from 'ag-psd/dist/descriptor';
import { createReader } from 'ag-psd/dist/psdReader';

export interface PsdVibranceDescriptorExtension {
  readonly temperature?: number;
  readonly tint?: number;
  readonly useLegacy?: boolean;
  readonly vibrance?: number;
  readonly saturation?: number;
}

const SIGNATURE = [0x38, 0x42, 0x49, 0x4d, 0x76, 0x69, 0x62, 0x41] as const; // 8BIMvibA

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? value
  : undefined;

/** Reads fields added to vibA by Photoshop 27 but not yet exposed by ag-psd 31. */
export const readPsdVibranceDescriptorExtensions = (
  bytes: ArrayBuffer
): PsdVibranceDescriptorExtension[] => {
  const source = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const result: PsdVibranceDescriptorExtension[] = [];
  for (let offset = 0; offset <= source.length - 12; offset += 1) {
    if (!SIGNATURE.every((value, index) => source[offset + index] === value)) continue;
    const length = view.getUint32(offset + 8, false);
    const payload = offset + 12;
    if (length < 12 || payload + length > source.length) continue;
    try {
      const descriptor = readVersionAndDescriptor(createReader(bytes, payload, length)) as Record<string, unknown>;
      const extension = {
        temperature: finite(descriptor.temperature),
        tint: finite(descriptor.tint),
        useLegacy: typeof descriptor.useLegacy === 'boolean' ? descriptor.useLegacy : undefined,
        vibrance: finite(descriptor.vibrance),
        saturation: finite(descriptor.Strt)
      };
      if (Object.values(extension).some((value) => value !== undefined)) result.push(extension);
    } catch {
      // A byte sequence inside compressed pixel data is not an additional-info
      // block. Descriptor validation keeps such an accidental match harmless.
    }
  }
  return result;
};

/** ag-psd and PSD both expose sibling layers bottom-to-top, including groups. */
export const applyPsdVibranceDescriptorExtensions = (
  layers: Layer[] | undefined,
  descriptors: readonly PsdVibranceDescriptorExtension[]
): void => {
  let descriptorIndex = 0;
  const visit = (entries: Layer[] | undefined) => {
    for (const layer of entries ?? []) {
      if (layer.adjustment?.type === 'vibrance') {
        const descriptor = descriptors[descriptorIndex];
        descriptorIndex += 1;
        if (descriptor) Object.assign(layer.adjustment, descriptor);
      }
      visit(layer.children);
    }
  };
  visit(layers);
};
