import { describe, expect, it } from 'vitest';
import { imagePickerAccept } from '../../image-io/supportedImageFormats';
import { LIGHTTABLE_FORMAT_CAPABILITIES } from './formatCapabilities';

describe('format capability projection', () => {
  it('covers every extension advertised by the automatic Open route', () => {
    const advertised = imagePickerAccept('automatic')
      .split(',')
      .filter((value) => value.startsWith('.'));
    const openExtensions = new Set(LIGHTTABLE_FORMAT_CAPABILITIES
      .filter(({ open }) => open !== 'unavailable')
      .flatMap(({ extensions }) => extensions));
    advertised.forEach((extension) => expect(openExtensions.has(extension)).toBe(true));
  });

  it('does not advertise PSD, PSB or AI export before their parity gates pass', () => {
    ['psd', 'ai'].forEach((id) => expect(
      LIGHTTABLE_FORMAT_CAPABILITIES.find((format) => format.id === id)?.export
    ).toBe('unavailable'));
  });
});
