import { invertMatrix, isIdentityAffineMatrix, multiplyMatrices, realizeLiveShape,
  type AffineMatrix, type SolidPaint, type VectorElement, type VectorStyle } from '@lighttable/vector-core';
import { sampleGradientAsset, type GradientPaintInstance } from '@lighttable/paint-core';
import { serializeSolidPaint } from './color';
import { serializeSvgPathData } from './pathData';
import { serializeTransform } from './transform';
import { DEFAULT_SVG_CODEC_LIMITS, SvgCodecError, type SvgExportOptions,
  type SvgSceneNode } from './types';

const escape = (value: string) => value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')
  .replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const number = (value: number) => Number(value.toFixed(6)).toString();
interface GradientExportRegistry {
  readonly ids: Map<string, string>;
  readonly definitions: { readonly id: string; readonly gradient: GradientPaintInstance }[];
  readonly usedIds: Set<string>;
}

const claimId = (requested: string, registry: GradientExportRegistry) => {
  const base = requested || 'lighttable-element';
  let candidate = base; let suffix = 2;
  while (registry.usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
  registry.usedIds.add(candidate);
  return candidate;
};

const registerGradient = (gradient: GradientPaintInstance, registry: GradientExportRegistry) => {
  if (gradient.asset.type !== 'solid'
    || (gradient.shape !== 'linear' && gradient.shape !== 'radial')) {
    throw new SvgCodecError('unsupported-export-paint', 'SVG export currently supports solid, linear-gradient and radial-gradient vector paint.');
  }
  const key = JSON.stringify(gradient);
  const cached = registry.ids.get(key);
  if (cached) return cached;
  const id = claimId(`lighttable-gradient-${registry.definitions.length + 1}`, registry);
  registry.ids.set(key, id);
  registry.definitions.push({ id, gradient });
  return id;
};

const paint = (
  value: VectorStyle['fill'],
  role: 'fill' | 'stroke',
  registry: GradientExportRegistry,
  elementTransform: AffineMatrix,
  opacity = 1
) => {
  if (value === null) return [`${role}="none"`];
  if ('kind' in value) {
    let exportPaint = value;
    if (value.coordinateSpace !== 'object-bounds') {
      const inverse = invertMatrix(elementTransform);
      if (!inverse) throw new SvgCodecError('noninvertible-gradient-transform',
        'SVG export cannot express a document-space gradient on a non-invertible element transform.');
      exportPaint = {
        ...value,
        coordinateSpace: 'document',
        transform: multiplyMatrices(inverse, value.transform)
      };
    }
    return [`${role}="url(#${registerGradient(exportPaint, registry)})"`,
      ...(opacity < 1 ? [`${role}-opacity="${number(opacity)}"`] : [])];
  }
  if (value.type !== 'solid') throw new SvgCodecError('unsupported-export-paint', 'SVG export encountered unknown vector paint.');
  const serialized = serializeSolidPaint(value as SolidPaint);
  const combinedOpacity = serialized.alpha * opacity;
  return [`${role}="${serialized.color}"`, ...(combinedOpacity < 1 ? [`${role}-opacity="${number(combinedOpacity)}"`] : [])];
};
const styleAttributes = (
  style: VectorStyle,
  registry: GradientExportRegistry,
  elementTransform: AffineMatrix
) => {
  const attributes = [...paint(style.fill, 'fill', registry, elementTransform)];
  if (style.stroke) attributes.push(...paint(
    style.stroke.paint,
    'stroke',
    registry,
    elementTransform,
    style.stroke.opacity ?? 1
  ),
    `stroke-width="${number(style.stroke.width)}"`, `stroke-linecap="${style.stroke.cap}"`,
    `stroke-linejoin="${style.stroke.join}"`, `stroke-miterlimit="${number(style.stroke.miterLimit)}"`,
    ...(style.stroke.dash.length ? [`stroke-dasharray="${style.stroke.dash.map(number).join(' ')}"`] : []),
    ...(style.stroke.dashOffset ? [`stroke-dashoffset="${number(style.stroke.dashOffset)}"`] : []));
  else attributes.push('stroke="none"');
  if (style.opacity < 1) attributes.push(`opacity="${number(style.opacity)}"`);
  return attributes;
};

const serializeElement = (
  element: VectorElement,
  registry: GradientExportRegistry,
  parentTransform: AffineMatrix
) => {
  const effectiveTransform = multiplyMatrices(parentTransform, element.transform);
  const attributes = [`id="${escape(claimId(element.name || element.id, registry))}"`,
    ...styleAttributes(element.style, registry, effectiveTransform)];
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

const serializeNode = (
  node: SvgSceneNode,
  registry: GradientExportRegistry,
  parentTransform: AffineMatrix,
  depth: number
): string => {
  const indent = '  '.repeat(depth);
  if (node.kind === 'element') {
    return `${indent}${serializeElement(node.element, registry, parentTransform)}`;
  }
  const attributes = [`id="${escape(claimId(node.name, registry))}"`];
  if (node.opacity < 1) attributes.push(`opacity="${number(node.opacity)}"`);
  if (!isIdentityAffineMatrix(node.transform)) {
    attributes.push(`transform="${serializeTransform(node.transform)}"`);
  }
  const transform = multiplyMatrices(parentTransform, node.transform);
  const children = node.children.map(child => serializeNode(child, registry, transform, depth + 1));
  return `${indent}<g ${attributes.join(' ')}>${children.length ? `\n${children.join('\n')}\n${indent}` : ''}</g>`;
};

const gradientDefinition = (gradient: GradientPaintInstance, id: string) => {
  const units = gradient.coordinateSpace === 'object-bounds' ? 'objectBoundingBox' : 'userSpaceOnUse';
  const stops = [...new Set([
    ...gradient.asset.colorStops.map(({ position }) => position),
    ...gradient.asset.opacityStops.map(({ position }) => position)
  ])].sort((left, right) => left - right).map((position) => {
    const sampled = sampleGradientAsset(gradient.asset, position);
    const serialized = serializeSolidPaint({ type: 'solid',
      color: [sampled.r, sampled.g, sampled.b, 1] });
    return `      <stop offset="${number(position)}" stop-color="${serialized.color}"${
      sampled.a < 1 ? ` stop-opacity="${number(sampled.a)}"` : ''}/>`;
  }).join('\n');
  const transform = gradient.transform;
  if (gradient.shape === 'radial') {
    const focus = gradient.radialFocus ?? { x: 0, y: 0 };
    return `    <radialGradient id="${id}" gradientUnits="${units}" cx="0" cy="0" r="1" fx="${number(focus.x)}" fy="${number(focus.y)}" fr="${number(gradient.radialStartRadius ?? 0)}" gradientTransform="${serializeTransform(transform)}" spreadMethod="${gradient.spread ?? 'pad'}">\n${stops}\n    </radialGradient>`;
  }
  return `    <linearGradient id="${id}" gradientUnits="${units}" x1="0" y1="0" x2="1" y2="0" gradientTransform="${serializeTransform(transform)}" spreadMethod="${gradient.spread ?? 'pad'}">\n${stops}\n    </linearGradient>`;
};

export const exportSvgScene = (nodes: readonly SvgSceneNode[], options: SvgExportOptions) => {
  const limits = { ...DEFAULT_SVG_CODEC_LIMITS, ...options.limits };
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height)
    || options.width <= 0 || options.height <= 0) throw new SvgCodecError('invalid-export-size', 'SVG export dimensions must be positive and finite.');
  if (!nodes.length) throw new SvgCodecError('empty-export', 'SVG export requires at least one vector element.');
  let count = 0;
  const inspect = (entries: readonly SvgSceneNode[], depth: number): void => {
    if (depth > limits.maxDepth) throw new SvgCodecError('nesting-limit', 'SVG export exceeds the nesting limit.');
    for (const node of entries) {
      count += 1;
      if (count > limits.maxElements) throw new SvgCodecError('element-limit', 'SVG export exceeds the element limit.');
      if (node.kind === 'group') inspect(node.children, depth + 1);
    }
  };
  inspect(nodes, 1);
  const gradients: GradientExportRegistry = { ids: new Map(), definitions: [], usedIds: new Set() };
  const title = options.title ? `\n  <title>${escape(options.title)}</title>` : '';
  const body = nodes.map(node => serializeNode(
    node, gradients, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 1
  )).join('\n');
  const definitions = gradients.definitions.length
    ? `\n  <defs>\n${gradients.definitions.map(({ gradient, id }) => gradientDefinition(
      gradient,
      id
    )).join('\n')}\n  </defs>`
    : '';
  const output = `<svg xmlns="http://www.w3.org/2000/svg" width="${number(options.width)}" height="${number(options.height)}" viewBox="0 0 ${number(options.width)} ${number(options.height)}">${title}${definitions}\n${body}\n</svg>\n`;
  if (new TextEncoder().encode(output).byteLength > limits.maxOutputBytes) {
    throw new SvgCodecError('output-limit', 'SVG export exceeds the byte limit.');
  }
  return output;
};

export const exportSvg = (elements: readonly VectorElement[], options: SvgExportOptions) =>
  exportSvgScene(elements.map(element => ({ kind: 'element', element })), options);
