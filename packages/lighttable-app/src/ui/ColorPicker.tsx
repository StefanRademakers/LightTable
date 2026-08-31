import React from 'react';
import { ColorPicker as SharedColorPicker, MaskIcon, type ColorPickerProps as SharedColorPickerProps } from '@lighttable/ui';
import { lightTableIcon } from '../assets/icons';
import { sampleScreenColor } from './colorSampling';
import { useDocumentPaletteLoader, useDocumentPaletteRevision, type DocumentPaletteColor } from './DocumentPaletteContext';

export { colorPickerHex, colorPickerParseHex, colorPickerRgbToHsv, colorPickerHsvToRgb,
  colorPickerRgbToHsl, colorPickerHslToRgb, colorPickerHsvFromValue, type ColorPickerColor } from '@lighttable/ui';
export type ColorPickerProps = Pick<SharedColorPickerProps, 'value' | 'onChange' | 'opacity' | 'onOpacityChange' | 'variant'>;

const USER_PALETTE_STORAGE_KEY = 'lighttable.color-picker.palette';
const storedColors = (key: string) => {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && /^#[0-9a-f]{6}$/i.test(entry))
      : [];
  } catch {
    return [];
  }
};
const storeColors = (key: string, colors: readonly string[]) => {
  try { window.localStorage.setItem(key, JSON.stringify(colors)); } catch { /* storage is optional */ }
};


/** Host capabilities only: deferred document analysis, palette persistence and screen sampling. */
export function ColorPicker(props: ColorPickerProps) {
  const [userPalette, setUserPalette] = React.useState<readonly string[]>(() => storedColors(USER_PALETTE_STORAGE_KEY));
  const loadDocumentPalette = useDocumentPaletteLoader();
  const documentPaletteRevision = useDocumentPaletteRevision();
  const [imagePalette, setImagePalette] = React.useState<readonly DocumentPaletteColor[] | null>(null);
  const [paletteError, setPaletteError] = React.useState<string | null>(null);
  const loadedPaletteRevision = React.useRef<string | number | null>(null);
  React.useEffect(() => {
    if (!loadDocumentPalette) return;
    let current = true;
    let timer: number | null = null;
    let idle: number | null = null;
    const inputPending = () => Boolean((navigator as Navigator & {
      scheduling?: { isInputPending?: () => boolean };
    }).scheduling?.isInputPending?.());
    const load = () => {
      if (!current) return;
      if (inputPending()) {
        timer = window.setTimeout(scheduleIdle, 1000);
        return;
      }
      setPaletteError(null);
      void loadDocumentPalette(16).then((palette) => {
        if (!current) return;
        loadedPaletteRevision.current = documentPaletteRevision;
        setImagePalette(palette);
      }).catch((reason) => {
        if (current) setPaletteError(reason instanceof Error ? reason.message : String(reason));
      });
    };
    const scheduleIdle = () => {
      if (!current) return;
      if (typeof window.requestIdleCallback === 'function') {
        idle = window.requestIdleCallback((deadline) => {
          idle = null;
          if (inputPending() || (!deadline.didTimeout && deadline.timeRemaining() < 8)) {
            timer = window.setTimeout(scheduleIdle, 1000);
            return;
          }
          load();
        }, { timeout: 5000 });
      } else {
        timer = window.setTimeout(load, 500);
      }
    };
    const initialLoad = loadedPaletteRevision.current === null;
    timer = window.setTimeout(scheduleIdle, initialLoad ? 0 : 2500);
    return () => {
      current = false;
      if (timer !== null) window.clearTimeout(timer);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, [documentPaletteRevision, loadDocumentPalette]);

  return <SharedColorPicker {...props}
    onSample={sampleScreenColor}
    sampleIcon={<MaskIcon src={lightTableIcon('tool_sample_color.png')} />}
    documentColors={loadDocumentPalette ? imagePalette?.map(color => ({
      color: color.hex, title: `${color.hex} · ${Math.round(color.coverage * 100)}%`
    })) ?? [] : undefined}
    documentColorsStatus={paletteError ? 'Palette unavailable' : imagePalette === null ? 'Analyzing image…' : undefined}
    palette={loadDocumentPalette ? userPalette : undefined}
    onPaletteChange={next => { storeColors(USER_PALETTE_STORAGE_KEY, next); setUserPalette(next); }}
  />;
}
