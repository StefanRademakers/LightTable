import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ColorSwatchField,
  colorPickerPopoverAnchor,
  colorPickerPopoverPosition,
  sampleScreenColor
} from './ColorSwatchField';

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

    expect(markup).toContain('data-suite-control="color-swatch"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('linear-gradient(#123456, #123456)');
    expect(markup).toContain('aria-label="Sample fill color"');
    expect(markup).toContain('pipette.png');
  });

  it('can reuse the picker with a dropdown chevron instead of the sampler', () => {
    const markup = renderToStaticMarkup(
      <ColorSwatchField value="#123456" accessory="chevron"
        ariaLabel="Fill color" onChange={vi.fn()} />
    );

    expect(markup).toContain('class="ui-paint-field__chevron"');
    expect(markup).toContain('aria-label="Fill color"');
    expect(markup).not.toContain('aria-label="Sample fill color"');
    expect(markup).not.toContain('pipette.png');
  });

  it('keeps the picker inside the viewport and away from the trigger where possible', () => {
    expect(colorPickerPopoverPosition(
      { left: 760, right: 780, top: 580, bottom: 600 } as DOMRect,
      { width: 320, height: 300 }, { width: 800, height: 600 }
    )).toEqual({ left: 434, top: 294 });
  });

  it('places a context-menu picker outside its containing floating surface', () => {
    expect(colorPickerPopoverAnchor(
      { left: 910, right: 980, top: 110, bottom: 130 } as DOMRect,
      { left: 744, right: 994 } as DOMRect
    )).toEqual({ left: 744, right: 994, top: 110, bottom: 130 });
    expect(colorPickerPopoverPosition(
      colorPickerPopoverAnchor(
        { left: 910, right: 980, top: 110, bottom: 130 } as DOMRect,
        { left: 744, right: 994 } as DOMRect
      ),
      { width: 320, height: 300 }, { width: 1040, height: 700 }
    )).toEqual({ left: 418, top: 110 });
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
