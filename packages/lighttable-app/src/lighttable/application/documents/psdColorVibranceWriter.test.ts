import { describe, expect, it } from 'vitest';
import {
  readPsd,
  writePsdUint8Array,
  type AdjustmentLayer,
  type Layer
} from 'ag-psd';
import { readPsdVibranceDescriptorExtensions } from '../../image-io/psdVibranceDescriptor';
import { writePsdColorVibranceDescriptors } from './psdColorVibranceWriter';

const adjustment = (
  name: string,
  values: Record<string, unknown>
): Layer => ({
  name,
  adjustment: {
    type: 'vibrance', vibrance: 0, saturation: 0, ...values
  } as AdjustmentLayer
});

describe('Photoshop Color and Vibrance PSD writer', () => {
  it('enriches only modern vibA blocks and leaves classic Vibrance ordered', () => {
    const children = [
      adjustment('Classic', { vibrance: 20, saturation: -20 }),
      adjustment('Modern', {
        temperature: -91, tint: 37, useLegacy: false, vibrance: -44, saturation: 63
      })
    ];
    const encoded = writePsdUint8Array({
      width: 1,
      height: 1,
      children,
      imageData: { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }
    }, { generateThumbnail: false, noBackground: true });
    const enriched = writePsdColorVibranceDescriptors(encoded, children);

    expect(() => readPsd(enriched, {
      skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true
    })).not.toThrow();
    expect(readPsdVibranceDescriptorExtensions(enriched.buffer)).toEqual([
      { temperature: undefined, tint: undefined, useLegacy: undefined, vibrance: 20, saturation: -20 },
      { temperature: -91, tint: 37, useLegacy: false, vibrance: -44, saturation: 63 }
    ]);
  });
});
