import type { Layer } from 'ag-psd';
import { writeVersionAndDescriptor } from 'ag-psd/dist/descriptor';
import { createWriter, getWriterBufferNoCopy } from 'ag-psd/dist/psdWriter';

interface ModernVibranceDescriptor {
  readonly temperature: number;
  readonly tint: number;
  readonly vibrance: number;
  readonly saturation: number;
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly extraLengthOffset: number;
  readonly payload: Uint8Array<ArrayBuffer>;
}

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));
const align = (value: number, multiple: number) => Math.ceil(value / multiple) * multiple;

const modernDescriptors = (layers: Layer[] | undefined) => {
  const result: Array<ModernVibranceDescriptor | null> = [];
  const visit = (entries: Layer[] | undefined) => {
    for (const layer of entries ?? []) {
      if (layer.adjustment?.type === 'vibrance') {
        const source = layer.adjustment as typeof layer.adjustment & {
          temperature?: number;
          tint?: number;
          useLegacy?: boolean;
        };
        result.push(source.useLegacy === false ? {
          temperature: source.temperature ?? 0,
          tint: source.tint ?? 0,
          vibrance: source.vibrance ?? 0,
          saturation: source.saturation ?? 0
        } : null);
      }
      visit(layer.children);
    }
  };
  visit(layers);
  return result;
};

const descriptorPayload = (descriptor: ModernVibranceDescriptor) => {
  const writer = createWriter();
  writeVersionAndDescriptor(writer, '', 'null', {
    temperature: descriptor.temperature,
    tint: descriptor.tint,
    useLegacy: false,
    vibrance: descriptor.vibrance,
    Strt: descriptor.saturation
  });
  return getWriterBufferNoCopy(writer).slice();
};

const replace = (
  source: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
  value: Uint8Array<ArrayBuffer>
) => {
  const result = new Uint8Array(source.length - (end - start) + value.length);
  result.set(source.subarray(0, start));
  result.set(value, start);
  result.set(source.subarray(end), start + value.length);
  return result;
};

/**
 * Enriches ag-psd's legacy vibA output with Photoshop 27 Temperature/Tint.
 * The parser is deliberately limited to PSD v1 layer records; PSB export is
 * not emitted by LightTable and therefore never enters this path.
 */
export const writePsdColorVibranceDescriptors = (
  encodedSource: Uint8Array<ArrayBufferLike>,
  layers: Layer[] | undefined
): Uint8Array<ArrayBuffer> => {
  const encoded = Uint8Array.from(encodedSource);
  const descriptors = modernDescriptors(layers);
  if (!descriptors.some(Boolean)) return encoded;
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  if (ascii(encoded, 0, 4) !== '8BPS' || view.getUint16(4, false) !== 1) return encoded;

  let offset = 26;
  for (let section = 0; section < 2; section += 1) {
    if (offset + 4 > encoded.length) return encoded;
    offset += 4 + view.getUint32(offset, false);
  }
  if (offset + 8 > encoded.length) return encoded;
  const layerAndMaskLengthOffset = offset;
  const layerAndMaskLength = view.getUint32(offset, false);
  const layerAndMaskStart = offset + 4;
  const layerInfoLengthOffset = layerAndMaskStart;
  const layerInfoLength = view.getUint32(layerInfoLengthOffset, false);
  if (layerInfoLength < 2 || layerInfoLengthOffset + 4 + layerInfoLength > encoded.length) return encoded;
  offset = layerInfoLengthOffset + 4;
  const layerCount = Math.abs(view.getInt16(offset, false));
  offset += 2;
  const replacements: Replacement[] = [];
  let vibranceIndex = 0;

  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    if (offset + 18 > encoded.length) return encoded;
    offset += 16;
    const channelCount = view.getUint16(offset, false);
    offset += 2 + channelCount * 6;
    if (offset + 16 > encoded.length || ascii(encoded, offset, 4) !== '8BIM') return encoded;
    offset += 12; // blend signature/key plus opacity, clipping, flags and filler
    const extraLengthOffset = offset;
    const extraLength = view.getUint32(offset, false);
    offset += 4;
    const extraEnd = offset + extraLength;
    if (extraEnd > encoded.length || offset + 4 > extraEnd) return encoded;
    const maskLength = view.getUint32(offset, false);
    offset += 4 + maskLength;
    if (offset + 4 > extraEnd) return encoded;
    const blendingRangesLength = view.getUint32(offset, false);
    offset += 4 + blendingRangesLength;
    if (offset >= extraEnd) return encoded;
    offset += align(1 + encoded[offset]!, 4);

    while (offset + 12 <= extraEnd) {
      const signature = ascii(encoded, offset, 4);
      const key = ascii(encoded, offset + 4, 4);
      if (signature !== '8BIM' && signature !== '8B64') break;
      if (signature === '8B64') return encoded;
      const length = view.getUint32(offset + 8, false);
      const blockEnd = offset + 12 + align(length, 2);
      if (blockEnd > extraEnd) return encoded;
      if (key === 'vibA') {
        const descriptor = descriptors[vibranceIndex];
        vibranceIndex += 1;
        if (descriptor) replacements.push({
          start: offset,
          end: blockEnd,
          extraLengthOffset,
          payload: descriptorPayload(descriptor)
        });
      }
      offset = blockEnd;
    }
    offset = extraEnd;
  }

  if (!replacements.length) return encoded;
  let result = encoded;
  let totalDelta = 0;
  const extraDeltas = new Map<number, number>();
  for (const replacement of [...replacements].reverse()) {
    const paddedPayloadLength = align(replacement.payload.length, 2);
    const block = new Uint8Array(12 + paddedPayloadLength);
    block.set(encoded.subarray(replacement.start, replacement.start + 8));
    new DataView(block.buffer).setUint32(8, replacement.payload.length, false);
    block.set(replacement.payload, 12);
    const delta = block.length - (replacement.end - replacement.start);
    result = replace(result, replacement.start, replacement.end, block);
    totalDelta += delta;
    extraDeltas.set(
      replacement.extraLengthOffset,
      (extraDeltas.get(replacement.extraLengthOffset) ?? 0) + delta
    );
  }
  const resultView = new DataView(result.buffer);
  for (const [lengthOffset, delta] of extraDeltas) {
    resultView.setUint32(lengthOffset, view.getUint32(lengthOffset, false) + delta, false);
  }
  resultView.setUint32(layerInfoLengthOffset, layerInfoLength + totalDelta, false);
  resultView.setUint32(layerAndMaskLengthOffset, layerAndMaskLength + totalDelta, false);
  return result;
};
