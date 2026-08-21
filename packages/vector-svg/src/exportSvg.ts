import { isIdentityAffineMatrix, realizeLiveShape, type SolidPaint, type VectorElement,
  type VectorStyle } from '@lighttable/vector-core';
import { serializeSolidPaint } from './color';
import { serializeSvgPathData } from './pathData';
import { serializeTransform } from './transform';
import { DEFAULT_SVG_CODEC_LIMITS, SvgCodecError, type SvgExportOptions } from './types';

const escape = (value: string) => value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
  .replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const number = (value: number) => Number(value.toFixed(6)).toString();
const paint = (value: VectorStyle['fill'], role: 'fill' | 'stroke', opacity = 1) => {
  if (value === null) return [`${role}="none"`];
  if (!('type' in value) || value.type !== 'solid') throw new SvgCodecError('unsupported-export-paint', 'Pass 1 SVG export supports only solid vector paint.');
  const serialized = serializeSolidPaint(value as SolidPaint);
  const combinedOpacity = serialized.alpha * opacity;
  return [`${role}="${serialized.color}"`, ...(combinedOpacity < 1 ? [`${role}-opacity="${number(combinedOpacity)}"`] : [])];
};
const styleAttributes = (style: VectorStyle) => {
  const attributes = [...paint(style.fill, 'fill')];
  if (style.stroke) attributes.push(...paint(style.stroke.paint, 'stroke', style.stroke.opacity ?? 1),
    `stroke-width="${number(style.stroke.width)}"`, `stroke-linecap="${style.stroke.cap}"`,
    `stroke-linejoin="${style.stroke.join}"`, `stroke-miterlimit="${number(style.stroke.miterLimit)}"`,
    ...(style.stroke.dash.length ? [`stroke-dasharray="${style.stroke.dash.map(number).join(' ')}"`] : []),
    ...(style.stroke.dashOffset ? [`stroke-dashoffset="${number(style.stroke.dashOffset)}"`] : []));
  else attributes.push('stroke="none"');
  if (style.opacity < 1) attributes.push(`opacity="${number(style.opacity)}"`);
  return attributes;
};

const serializeElement = (element: VectorElement) => {
  const attributes = [`id="${escape(element.name || element.id)}"`, ...styleAttributes(element.style)];
  if (!isIdentityAffineMatrix(element.transform)) attributes.push(`transform="${serializeTransform(element.transform)}"`);
  if (element.type === 'live-shape' && element.geometry.kind === 'rectangle') {
    const radii = element.geometry.cornerRadii;
    if (radii.every((radius) => Math.abs(radius - radii[0]!) < 1e-9)) {
      attributes.push(`width="${number(element.geometry.width)}"`, `height="${number(element.geometry.height)}"`);
      if (radii[0]!) attributes.push(`rx="${number(radii[0]!)}"`);
      return `<rect ${attributes.join(' ')}/>`;
    }
  }
  if (element.type === 'live-shape' && element.geometry.kind === 'ellipse') {
    attributes.push(`cx="${number(element.geometry.width / 2)}"`, `cy="${number(element.geometry.height / 2)}"`,
      `rx="${number(element.geometry.width / 2)}"`, `ry="${number(element.geometry.height / 2)}"`);
    return `<ellipse ${attributes.join(' ')}/>`;
  }
  if (element.type === 'live-shape' && element.geometry.kind === 'line'
    && !element.geometry.startArrow && !element.geometry.endArrow) {
    attributes.push(`x1="${number(element.geometry.start.x)}"`, `y1="${number(element.geometry.start.y)}"`,
      `x2="${number(element.geometry.end.x)}"`, `y2="${number(element.geometry.end.y)}"`);
    return `<line ${attributes.join(' ')}/>`;
  }
  const path = element.type === 'path' ? element : realizeLiveShape(element);
  attributes.push(`d="${serializeSvgPathData(path.subpaths)}"`, `fill-rule="${path.fillRule}"`);
  return `<path ${attributes.join(' ')}/>`;
};

export const exportSvg = (elements: readonly VectorElement[], options: SvgExportOptions) => {
  const limits = { ...DEFAULT_SVG_CODEC_LIMITS, ...options.limits };
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height)
    || options.width <= 0 || options.height <= 0) throw new SvgCodecError('invalid-export-size', 'SVG export dimensions must be positive and finite.');
  if (!elements.length) throw new SvgCodecError('empty-export', 'SVG export requires at least one vector element.');
  if (elements.length > limits.maxElements) throw new SvgCodecError('element-limit', 'SVG export exceeds the element limit.');
  const title = options.title ? `\n  <title>${escape(options.title)}</title>` : '';
  const body = elements.map((element) => `  ${serializeElement(element)}`).join('\n');
  const output = `<svg xmlns="http://www.w3.org/2000/svg" width="${number(options.width)}" height="${number(options.height)}" viewBox="0 0 ${number(options.width)} ${number(options.height)}">${title}\n${body}\n</svg>\n`;
  if (new TextEncoder().encode(output).byteLength > limits.maxOutputBytes) {
    throw new SvgCodecError('output-limit', 'SVG export exceeds the byte limit.');
  }
  return output;
};
