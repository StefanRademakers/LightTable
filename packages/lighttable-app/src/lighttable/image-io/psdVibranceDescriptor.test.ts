import { describe, expect, it } from 'vitest';
import type { Layer } from 'ag-psd';
import { writeVersionAndDescriptor } from 'ag-psd/dist/descriptor';
import {
  createWriter,
  getWriterBufferNoCopy,
  writeBytes,
  writeSignature,
  writeUint32
} from 'ag-psd/dist/psdWriter';
import {
  applyPsdVibranceDescriptorExtensions,
  readPsdVibranceDescriptorExtensions
} from './psdVibranceDescriptor';

const vibABlock = (descriptor: Record<string, unknown>) => {
  const payloadWriter = createWriter();
  writeVersionAndDescriptor(payloadWriter, '', 'null', descriptor);
  const payload = getWriterBufferNoCopy(payloadWriter);
  const writer = createWriter();
  writeSignature(writer, '8BIM');
  writeSignature(writer, 'vibA');
  writeUint32(writer, payload.length);
  writeBytes(writer, payload);
  return getWriterBufferNoCopy(writer).slice().buffer;
};

describe('Photoshop vibA descriptor extension', () => {
  it('recovers the Photoshop 27 fields omitted by ag-psd 31', () => {
    expect(readPsdVibranceDescriptorExtensions(vibABlock({
      temperature: -91,
      tint: 37,
      useLegacy: false,
      vibrance: -44,
      Strt: 63
    }))).toEqual([{
      temperature: -91,
      tint: 37,
      useLegacy: false,
      vibrance: -44,
      saturation: 63
    }]);
  });

  it('enriches vibrance layers in bottom-to-top group order', () => {
    const bottom = { adjustment: { type: 'vibrance' } } as Layer;
    const nested = { adjustment: { type: 'vibrance' } } as Layer;
    const layers = [bottom, { children: [nested] } as Layer];
    applyPsdVibranceDescriptorExtensions(layers, [
      { temperature: 10, useLegacy: false },
      { temperature: 20, useLegacy: false }
    ]);
    expect(bottom.adjustment).toMatchObject({ temperature: 10, useLegacy: false });
    expect(nested.adjustment).toMatchObject({ temperature: 20, useLegacy: false });
  });
});
