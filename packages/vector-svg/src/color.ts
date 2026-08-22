import type { SolidPaint } from '@lighttable/vector-core';
import { SvgCodecError } from './types';

const NAMED: Readonly<Record<string, string>> = Object.freeze({
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
  lime: '#00ff00', navy: '#000080', teal: '#008080', purple: '#800080', orange: '#ffa500'
});

const srgbToLinear = (channel: number) => channel <= 0.04045
  ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const byte = (hex: string) => Number.parseInt(hex, 16) / 255;

export const parseSvgColor = (input: string, currentColor = 'black'): SolidPaint | null => {
  let value = input.trim().toLowerCase();
  if (value === 'none') return null;
  if (value === 'currentcolor') value = currentColor.trim().toLowerCase();
  value = NAMED[value] ?? value;
  let rgba: [number, number, number, number] | null = null;
  let match = /^#([\da-f]{3,4})$/iu.exec(value);
  if (match) {
    const digits = match[1]!;
    rgba = [byte(digits[0]! + digits[0]!), byte(digits[1]! + digits[1]!),
      byte(digits[2]! + digits[2]!), digits.length === 4 ? byte(digits[3]! + digits[3]!) : 1];
  }
  match = /^#([\da-f]{6}|[\da-f]{8})$/iu.exec(value);
  if (match) {
    const digits = match[1]!;
    rgba = [byte(digits.slice(0, 2)), byte(digits.slice(2, 4)), byte(digits.slice(4, 6)),
      digits.length === 8 ? byte(digits.slice(6, 8)) : 1];
  }
  match = /^rgba?\((.*)\)$/iu.exec(value);
  if (match) {
    const parts = match[1]!.split(/\s*,\s*/u);
    if (parts.length === 3 || parts.length === 4) {
      const rgb = parts.slice(0, 3).map((part) => part.endsWith('%')
        ? Number(part.slice(0, -1)) * 2.55 : Number(part));
      const alpha = parts[3] === undefined ? 1 : parts[3]!.endsWith('%')
        ? Number(parts[3]!.slice(0, -1)) / 100 : Number(parts[3]);
      if (rgb.every((part) => Number.isFinite(part) && part >= 0 && part <= 255)
        && Number.isFinite(alpha) && alpha >= 0 && alpha <= 1) {
        rgba = [rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255, alpha];
      }
    }
  }
  if (!rgba) throw new SvgCodecError('unsupported-color', `Unsupported SVG color “${input}”.`);
  return { type: 'solid', color: [srgbToLinear(rgba[0]), srgbToLinear(rgba[1]),
    srgbToLinear(rgba[2]), rgba[3]] };
};

export const linearChannelToSrgb = (channel: number) => channel <= 0.0031308
  ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
const hex = (channel: number) => Math.round(Math.min(1, Math.max(0, linearChannelToSrgb(channel))) * 255)
  .toString(16).padStart(2, '0');

export const serializeSolidPaint = (paint: SolidPaint) => ({
  color: `#${hex(paint.color[0])}${hex(paint.color[1])}${hex(paint.color[2])}`,
  alpha: paint.color[3]
});
