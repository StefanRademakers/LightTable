import { describe, expect, it } from 'vitest';
import { filterSupportedDroppedFiles } from './useStandaloneFileDrop';

describe('standalone file drop', () => {
  it('keeps every supported file so a multi-file drop can open multiple documents', () => {
    const files = [
      new File(['png'], 'first.png', { type: 'image/png' }),
      new File(['psd'], 'second.psd', { type: 'image/vnd.adobe.photoshop' }),
      new File(['text'], 'notes.txt', { type: 'text/plain' })
    ];

    expect(filterSupportedDroppedFiles(files).map((file) => file.name)).toEqual([
      'first.png',
      'second.psd'
    ]);
  });

  it('accepts extension-based desktop files with a generic MIME type', () => {
    const file = new File(['tiff'], 'precision.TIFF', {
      type: 'application/octet-stream'
    });

    expect(filterSupportedDroppedFiles([file])).toEqual([file]);
  });

  it('accepts MP4 and WebM as typed video documents without admitting unrelated files', () => {
    const mp4 = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const webm = new File(['video'], 'clip.WEBM', { type: 'application/octet-stream' });
    const text = new File(['text'], 'clip.txt', { type: 'text/plain' });

    expect(filterSupportedDroppedFiles([mp4, webm, text])).toEqual([mp4, webm]);
  });
});
