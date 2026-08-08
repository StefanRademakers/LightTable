import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorSwatchField, sampleScreenColor } from './ColorSwatchField';

const originalEyeDropper = Object.getOwnPropertyDescriptor(globalThis, 'EyeDropper');

afterEach(() => {
  if (originalEyeDropper) Object.defineProperty(globalThis, 'EyeDropper', originalEyeDropper);
  else Reflect.deleteProperty(globalThis, 'EyeDropper');
});

describe('ColorSwatchField', () => {
  it('keeps manual color input and eyedropper in one bounded control', () => {
    const markup = renderToStaticMarkup(
      <ColorSwatchField value="#123456" ariaLabel="Fill color" onChange={vi.fn()} />
    );

    expect(markup).toContain('class="color-swatch-field color-swatch-field--regular"');
    expect(markup).toContain('type="color"');
    expect(markup).toContain('value="#123456"');
    expect(markup).toContain('aria-label="Sample fill color"');
    expect(markup).toContain('tool_sample_color');
  });

  it('normalizes a sampled color for the same value callback', async () => {
    Object.defineProperty(globalThis, 'EyeDropper', {
      configurable: true,
      value: class {
        async open() { return { sRGBHex: '#A1B2C3' }; }
      }
    });

    await expect(sampleScreenColor()).resolves.toBe('#a1b2c3');
  });

  it('treats unavailable, cancelled and invalid samples as no selection', async () => {
    await expect(sampleScreenColor()).resolves.toBeNull();
    Object.defineProperty(globalThis, 'EyeDropper', {
      configurable: true,
      value: class {
        async open() { throw new DOMException('Cancelled', 'AbortError'); }
      }
    });
    await expect(sampleScreenColor()).resolves.toBeNull();
  });
});
