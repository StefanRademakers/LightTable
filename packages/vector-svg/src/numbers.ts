import { SvgCodecError } from './types';

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iu;

export const finiteNumber = (value: string, label: string) => {
  const number = Number(value.trim());
  if (!Number.isFinite(number) || Math.abs(number) > 10_000_000) {
    throw new SvgCodecError('invalid-number', `${label} must be a finite bounded number.`);
  }
  return number;
};

export const parseNumberList = (value: string, label: string): number[] => {
  const result: number[] = [];
  let rest = value.trim();
  while (rest.length) {
    rest = rest.replace(/^[\s,]+/u, '');
    if (!rest.length) break;
    const match = NUMBER.exec(rest);
    if (!match) throw new SvgCodecError('invalid-number-list', `${label} contains invalid numeric syntax.`);
    result.push(finiteNumber(match[0], label));
    rest = rest.slice(match[0].length);
  }
  return result;
};

export const parseLength = (value: string | null, fallback: number, label: string) => {
  if (value === null || value.trim() === '') return fallback;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?$/iu.exec(value.trim());
  if (!match) throw new SvgCodecError('unsupported-length', `${label} supports only unitless or px lengths.`);
  const number = finiteNumber(match[1]!, label);
  if (number <= 0) throw new SvgCodecError('invalid-length', `${label} must be positive.`);
  return number;
};
