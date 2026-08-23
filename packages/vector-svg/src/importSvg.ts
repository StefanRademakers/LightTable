import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import { cloneVectorElement, createVectorLiveShape, createVectorPath, identityAffineMatrix, multiplyMatrices,
  translationMatrix, type AffineMatrix, type VectorElement, type VectorPaint,
  type VectorStyle, type VectorSubpath } from '@lighttable/vector-core';
import { linearChannelToSrgb, parseSvgColor } from './color';
import { finiteNumber, parseLength, parseNumberList } from './numbers';
import { parseSvgPathData } from './pathData';
import { parseSvgTransform } from './transform';
import { DEFAULT_SVG_CODEC_LIMITS, SvgCodecError, type SvgCodecLimits,
  type SvgConversionNotice, type SvgImportOptions, type SvgImportPlan, type SvgSceneNode,
  type SvgClipPath, type SvgViewBox } from './types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DRAWABLES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ACTIVE_CONTENT = new Set(['script', 'foreignobject', 'iframe', 'object']);
const UNSUPPORTED = new Set(['image', 'text', 'style',
  'animate', 'animatemotion', 'animatetransform', 'set', 'filter', 'mask', 'clippath', 'pattern',
  'marker', 'lineargradient', 'radialgradient', 'use', 'defs']);
const METADATA = new Set(['title', 'desc', 'metadata']);
const PRESENTATION = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'color']);
const GLOBAL_ATTRIBUTES = new Set(['id', 'transform', 'style', 'opacity', 'clip-path', ...PRESENTATION]);
const GEOMETRY_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  svg: ['width', 'height', 'viewBox', 'preserveAspectRatio', 'version', 'xmlns'],
  g: [], a: [], path: ['d'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points']
});
const RENDERING_HINT_ATTRIBUTES = new Set([
  'shape-rendering', 'color-rendering', 'image-rendering', 'text-rendering'
]);

interface StyleContext {
  fill: string; fillOpacity: number; fillRule: 'nonzero' | 'evenodd';
  stroke: string; strokeOpacity: number; strokeWidth: number;
  strokeCap: 'butt' | 'round' | 'square'; strokeJoin: 'miter' | 'round' | 'bevel';
  strokeMiterLimit: number; strokeDash: number[]; strokeDashOffset: number; color: string;
}

const DEFAULT_STYLE: StyleContext = Object.freeze({
  fill: 'black', fillOpacity: 1, fillRule: 'nonzero', stroke: 'none', strokeOpacity: 1,
  strokeWidth: 1, strokeCap: 'butt', strokeJoin: 'miter', strokeMiterLimit: 4,
  strokeDash: [], strokeDashOffset: 0, color: 'black'
});
const boundedUnit = (value: string, label: string) => {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) throw new SvgCodecError('invalid-opacity', `${label} must be between zero and one.`);
  return number;
};
const nonnegative = (value: string, label: string) => {
  const number = finiteNumber(value.replace(/px$/iu, ''), label);
  if (number < 0) throw new SvgCodecError('invalid-length', `${label} cannot be negative.`);
  return number;
};
const positive = (value: string, label: string) => {
  const number = nonnegative(value, label);
  if (number <= 0) throw new SvgCodecError('non-rendering-geometry', `${label} must be greater than zero for editable import.`);
  return number;
};

const styleDeclarations = (element: XmlElement) => {
  const declarations = new Map<string, string>();
  const raw = element.getAttribute('style');
  if (!raw) return declarations;
  if (raw.length > 16_384) throw new SvgCodecError('style-limit', 'Inline SVG style exceeds the byte limit.');
  for (const declaration of raw.split(';')) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(':');
    if (separator <= 0) throw new SvgCodecError('invalid-style', 'Inline SVG style syntax is invalid.');
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!PRESENTATION.has(property) && property !== 'opacity') {
      throw new SvgCodecError('unsupported-style', `Unsupported inline SVG style property “${property}”.`);
    }
    if (/url\s*\(/iu.test(value) || /!important/iu.test(value)) {
      throw new SvgCodecError('unsafe-style', `Unsafe or unsupported SVG style value for “${property}”.`);
    }
    declarations.set(property, value);
  }
  return declarations;
};

const property = (element: XmlElement, inline: Map<string, string>, name: string) => (
  inline.get(name) ?? element.getAttribute(name)
);

const inheritedStyle = (element: XmlElement, parent: StyleContext) => {
  const inline = styleDeclarations(element); const next: StyleContext = structuredClone(parent);
  const fill = property(element, inline, 'fill'); if (fill !== null) next.fill = fill;
  const fillOpacity = property(element, inline, 'fill-opacity'); if (fillOpacity !== null) next.fillOpacity = boundedUnit(fillOpacity, 'fill-opacity');
  const fillRule = property(element, inline, 'fill-rule');
  if (fillRule !== null) {
    if (fillRule !== 'nonzero' && fillRule !== 'evenodd') throw new SvgCodecError('unsupported-fill-rule', 'SVG fill-rule must be nonzero or evenodd.');
    next.fillRule = fillRule;
  }
  const stroke = property(element, inline, 'stroke'); if (stroke !== null) next.stroke = stroke;
  const strokeOpacity = property(element, inline, 'stroke-opacity'); if (strokeOpacity !== null) next.strokeOpacity = boundedUnit(strokeOpacity, 'stroke-opacity');
  const strokeWidth = property(element, inline, 'stroke-width'); if (strokeWidth !== null) next.strokeWidth = nonnegative(strokeWidth, 'stroke-width');
  const cap = property(element, inline, 'stroke-linecap');
  if (cap !== null) {
    if (cap !== 'butt' && cap !== 'round' && cap !== 'square') throw new SvgCodecError('unsupported-linecap', 'Unsupported SVG stroke-linecap.');
    next.strokeCap = cap;
  }
  const join = property(element, inline, 'stroke-linejoin');
  if (join !== null) {
    if (join !== 'miter' && join !== 'round' && join !== 'bevel') throw new SvgCodecError('unsupported-linejoin', 'Unsupported SVG stroke-linejoin.');
    next.strokeJoin = join;
  }
  const miter = property(element, inline, 'stroke-miterlimit'); if (miter !== null) next.strokeMiterLimit = nonnegative(miter, 'stroke-miterlimit');
  const dash = property(element, inline, 'stroke-dasharray');
  if (dash !== null) {
    next.strokeDash = dash.trim().toLowerCase() === 'none' ? [] : parseNumberList(dash, 'stroke-dasharray');
    if (next.strokeDash.length > 64 || next.strokeDash.some((part) => part < 0)) throw new SvgCodecError('invalid-dash', 'SVG stroke dash array is invalid or exceeds 64 entries.');
    if (next.strokeDash.length % 2 === 1) next.strokeDash = [...next.strokeDash, ...next.strokeDash];
  }
  const offset = property(element, inline, 'stroke-dashoffset'); if (offset !== null) next.strokeDashOffset = finiteNumber(offset.replace(/px$/iu, ''), 'stroke-dashoffset');
  const color = property(element, inline, 'color'); if (color !== null) next.color = color;
  const opacity = property(element, inline, 'opacity');
  return { inherited: next, opacity: opacity === null ? 1 : boundedUnit(opacity, 'opacity') };
};

const nativeStyle = (
  context: StyleContext,
  opacity: number,
  resolvePaint: (value: string, opacity: number) => VectorPaint | null
): VectorStyle => {
  const resolvedFill = resolvePaint(context.fill, context.fillOpacity);
  const strokePaint = resolvePaint(context.stroke, 1);
  return {
    fill: resolvedFill,
    stroke: strokePaint ? { paint: strokePaint, opacity: context.strokeOpacity,
      width: context.strokeWidth, alignment: 'center', cap: context.strokeCap,
      join: context.strokeJoin, miterLimit: context.strokeMiterLimit,
      dash: [...context.strokeDash], dashOffset: context.strokeDashOffset } : null,
    opacity
  };
};

const LOCAL_FRAGMENT = /^#([A-Za-z_][A-Za-z0-9_.:-]*)$/u;
const LOCAL_PAINT = /^url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)$/iu;
const localPaintId = (value: string) => LOCAL_PAINT.exec(value.trim())?.[2] ?? null;

const collectDescendantElements = (root: XmlElement, maximum: number) => {
  const descendants: XmlElement[] = [];
  const pending: XmlElement[] = [];
  const pushChildrenInReverseOrder = (element: XmlElement) => {
    const children: XmlElement[] = [];
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) children.push(child as XmlElement);
    }
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  };
  pushChildrenInReverseOrder(root);
  while (pending.length) {
    const element = pending.pop()!;
    descendants.push(element);
    if (descendants.length > maximum) {
      throw new SvgCodecError('element-limit', `SVG exceeds the ${maximum} element limit.`);
    }
    pushChildrenInReverseOrder(element);
  }
  return descendants;
};

const preflightReferences = (root: XmlElement, descendants: readonly XmlElement[]) => {
  const candidates = [root, ...descendants];
  for (const element of candidates) {
    const tag = (element.localName || element.tagName).toLowerCase();
    if (ACTIVE_CONTENT.has(tag)) {
      throw new SvgCodecError('active-content', `Active SVG element <${tag}> is forbidden.`);
    }
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)!;
      if (/^on/iu.test(attribute.name)) {
        throw new SvgCodecError('event-handler', `SVG event attribute “${attribute.name}” is forbidden.`);
      }
      if (/href$/iu.test(attribute.name) && tag !== 'a'
        && !LOCAL_FRAGMENT.test(attribute.value.trim())) {
        throw new SvgCodecError('external-reference',
          `External SVG reference attribute “${attribute.value}” is forbidden.`);
      }
      if (/url\s*\(/iu.test(attribute.value)) {
        const withoutLocalFragments = attribute.value.replace(
          /url\(\s*(['"]?)#[A-Za-z_][A-Za-z0-9_.:-]*\1\s*\)/giu,
          ''
        );
        if (/url\s*\(/iu.test(withoutLocalFragments)) {
          throw new SvgCodecError('external-reference', `External SVG URL in “${attribute.name}” is forbidden.`);
        }
      }
    }
  }
};

const parseViewBox = (root: XmlElement, width: number, height: number): SvgViewBox => {
  const raw = root.getAttribute('viewBox');
  if (raw === null) return { minX: 0, minY: 0, width, height };
  const values = parseNumberList(raw, 'viewBox');
  if (values.length !== 4 || values[2]! <= 0 || values[3]! <= 0) throw new SvgCodecError('invalid-viewbox', 'SVG viewBox must contain four values with positive dimensions.');
  return { minX: values[0]!, minY: values[1]!, width: values[2]!, height: values[3]! };
};

const elementChildren = (element: XmlElement) => {
  const result: XmlElement[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) result.push(child as XmlElement);
  return result;
};
const nameOf = (element: XmlElement) => element.getAttribute('data-name')?.trim()
  || element.getAttribute('aria-label')?.trim()
  || element.getAttribute('inkscape:label')?.trim()
  || element.getAttribute('id')?.trim()
  || element.localName
  || element.tagName;
const coordinate = (element: XmlElement, name: string, fallback = 0) => {
  const value = element.getAttribute(name); return value === null ? fallback : finiteNumber(value.replace(/px$/iu, ''), name);
};

const polylineSubpath = (element: XmlElement, closed: boolean, createId: (kind: 'subpath' | 'anchor') => string): VectorSubpath => {
  const values = parseNumberList(element.getAttribute('points') ?? '', 'points');
  if (values.length < 4 || values.length % 2 !== 0) throw new SvgCodecError('invalid-points', `${element.localName} requires coordinate pairs.`);
  return { id: createId('subpath'), closed, anchors: Array.from({ length: values.length / 2 }, (_, index) => ({
    id: createId('anchor'), position: { x: values[index * 2]!, y: values[index * 2 + 1]! },
    handleIn: null, handleOut: null, mode: 'corner' as const
  })) };
};

export const importSvg = (svg: string, options: SvgImportOptions = {}): SvgImportPlan => {
  const limits: SvgCodecLimits = { ...DEFAULT_SVG_CODEC_LIMITS, ...options.limits };
  if (new TextEncoder().encode(svg).byteLength > limits.maxInputBytes) throw new SvgCodecError('input-limit', 'SVG input exceeds the byte limit.');
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(svg)) throw new SvgCodecError('forbidden-xml', 'SVG DTDs and entities are forbidden.');
  const withoutDeclaration = svg.replace(/^\s*<\?xml[^?]*\?>/iu, '');
  if (/<\?/u.test(withoutDeclaration)) throw new SvgCodecError('forbidden-xml', 'SVG processing instructions are forbidden.');
  let parserMessage = '';
  let document: ReturnType<DOMParser['parseFromString']>;
  options.trace?.onParseBegin?.();
  try {
    document = new DOMParser({ onError: (_level, message) => { parserMessage = message; } })
      .parseFromString(svg, 'image/svg+xml');
  } catch (reason) {
    throw new SvgCodecError('invalid-xml', `SVG XML is invalid: ${reason instanceof Error ? reason.message : String(reason)}`);
  } finally {
    options.trace?.onParseEnd?.();
  }
  if (parserMessage) throw new SvgCodecError('invalid-xml', `SVG XML is invalid: ${parserMessage}`);
  const root = document.documentElement;
  if (!root || root.localName?.toLowerCase() !== 'svg') throw new SvgCodecError('invalid-root', 'SVG document must have an <svg> root.');
  if (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE) throw new SvgCodecError('invalid-namespace', 'SVG root uses an unsupported namespace.');
  options.trace?.onCanonicalBegin?.();
  const descendants = collectDescendantElements(root, limits.maxElements);
  preflightReferences(root, descendants);
  const viewBoxRaw = root.getAttribute('viewBox');
  const provisional = viewBoxRaw ? parseNumberList(viewBoxRaw, 'viewBox') : [];
  const declaredWidth = viewBoxRaw
    ? provisional[2] ?? 300
    : parseLength(root.getAttribute('width'), 300, 'SVG width');
  const declaredHeight = viewBoxRaw
    ? provisional[3] ?? 150
    : parseLength(root.getAttribute('height'), 150, 'SVG height');
  const viewBox = parseViewBox(root, declaredWidth, declaredHeight);
  // Editable import treats viewBox user units as canonical document pixels.
  // width/height describe an SVG presentation viewport and must not shrink or
  // stretch the native geometry/canvas when both representations are present.
  // SVG user units may be fractional; LightTable's backing surface is a
  // pixel-addressed GPU texture and therefore requires positive integers.
  // Ceil preserves the final fractional row/column while geometry remains in
  // the original authored user units.
  const width = Math.max(1, Math.ceil(viewBoxRaw ? viewBox.width : declaredWidth));
  const height = Math.max(1, Math.ceil(viewBoxRaw ? viewBox.height : declaredHeight));
  const baseTransform = viewBoxRaw
    ? translationMatrix(-viewBox.minX, -viewBox.minY)
    : identityAffineMatrix();
  let id = 0; const createId = options.createId ?? ((kind) => `svg-${kind}-${++id}`);
  const warnings: SvgConversionNotice[] = []; const conversions: SvgConversionNotice[] = [];
  const elements: VectorElement[] = []; const nodes: SvgSceneNode[] = [];
  let sourceElementCount = 0; let totalAnchors = 0;
  const resources = new Map<string, XmlElement>();
  for (const resource of descendants) {
    const resourceId = resource.getAttribute('id')?.trim();
    if (!resourceId) continue;
    if (resources.has(resourceId)) {
      throw new SvgCodecError('duplicate-resource-id', `SVG resource id “${resourceId}” is ambiguous.`);
    }
    resources.set(resourceId, resource);
  }

  const localPaintServerId = (value: string, label: string) => {
    const match = /^url\(\s*(['"]?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)$/iu.exec(value.trim());
    if (!match) throw new SvgCodecError('unsupported-reference', `${label} must use a local url(#id) reference.`);
    return match[2]!;
  };

  const resolveClipPath = (
    value: string | null,
    referenceTransform: AffineMatrix,
    referenceName: string
  ): SvgClipPath | undefined => {
    if (!value || value.trim().toLowerCase() === 'none') return undefined;
    const resourceId = localPaintServerId(value, 'clip-path');
    const resource = resources.get(resourceId);
    if (!resource || (resource.localName || resource.tagName).toLowerCase() !== 'clippath') {
      throw new SvgCodecError('missing-clip-path', `SVG clip-path “${resourceId}” is missing.`);
    }
    if (resource.getAttribute('clipPathUnits') === 'objectBoundingBox') {
      throw new SvgCodecError(
        'unnormalized-object-bounds-clip',
        'objectBoundingBox clip paths must be normalized before editable import.'
      );
    }
    const clipElements: VectorElement[] = [];
    const visitClip = (node: XmlElement, parent: AffineMatrix, depth: number): void => {
      if (depth > limits.maxDepth) throw new SvgCodecError('resource-depth', `Clip path “${resourceId}” exceeds the resource depth limit.`);
      const tag = (node.localName || node.tagName).toLowerCase();
      const transform = multiplyMatrices(parent, parseSvgTransform(node.getAttribute('transform')));
      if (tag === 'g') {
        elementChildren(node).forEach(child => visitClip(child, transform, depth + 1));
        return;
      }
      if (tag !== 'path') {
        throw new SvgCodecError(
          'unnormalized-clip-geometry',
          `Clip path “${resourceId}” contains <${tag}>; normalize it to path geometry first.`
        );
      }
      const parsed = parseSvgPathData(node.getAttribute('d') ?? '', createId, limits);
      totalAnchors += parsed.anchorCount;
      if (totalAnchors > limits.maxAnchors) throw new SvgCodecError('anchor-limit', 'SVG exceeds the total anchor limit.');
      const path = createVectorPath(
        createId('element'),
        `${referenceName} clip`,
        parsed.subpaths.map(subpath => subpath.closed ? subpath : { ...subpath, closed: true })
      );
      const rule = node.getAttribute('clip-rule') ?? node.getAttribute('fill-rule') ?? 'nonzero';
      if (rule !== 'nonzero' && rule !== 'evenodd') {
        throw new SvgCodecError('unsupported-clip-rule', `Clip path “${resourceId}” has an unsupported fill rule.`);
      }
      path.fillRule = rule;
      path.transform = transform;
      path.style = {
        fill: { type: 'solid', color: [1, 1, 1, 1] },
        stroke: null,
        opacity: 1
      };
      clipElements.push(path);
    };
    const clipTransform = multiplyMatrices(
      referenceTransform,
      parseSvgTransform(resource.getAttribute('transform'))
    );
    elementChildren(resource).forEach(child => visitClip(child, clipTransform, 1));
    if (!clipElements.length) {
      throw new SvgCodecError('empty-clip-path', `SVG clip-path “${resourceId}” has no geometry.`);
    }
    return {
      id: `svg-clip-${resourceId}-${createId('element')}`,
      name: resourceId,
      elements: clipElements.map(cloneVectorElement)
    };
  };

  const gradientCoordinate = (
    value: string | null,
    name: string,
    fallback: string,
    axis: 'x' | 'y' | 'radius',
    units: 'objectBoundingBox' | 'userSpaceOnUse'
  ) => {
    const raw = value?.trim() || fallback;
    const percentage = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))%$/u.exec(raw);
    if (percentage) {
      const ratio = finiteNumber(percentage[1]!, name) / 100;
      if (units === 'objectBoundingBox') return ratio;
      if (axis === 'radius') return ratio * Math.hypot(viewBox.width, viewBox.height) / Math.SQRT2;
      return (axis === 'x' ? viewBox.minX : viewBox.minY)
        + ratio * (axis === 'x' ? viewBox.width : viewBox.height);
    }
    return finiteNumber(raw.replace(/px$/iu, ''), name);
  };

  const stopProperty = (stop: XmlElement, name: 'stop-color' | 'stop-opacity') => {
    const inline = stop.getAttribute('style') ?? '';
    for (const declaration of inline.split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      if (declaration.slice(0, separator).trim().toLowerCase() === name) {
        return declaration.slice(separator + 1).trim();
      }
    }
    return stop.getAttribute(name);
  };

  const gradientPaint = (
    gradient: XmlElement,
    currentTransform: AffineMatrix,
    paintOpacity: number
  ): GradientPaintInstance => {
    const gradientId = gradient.getAttribute('id')!.trim();
    const gradientTag = (gradient.localName || gradient.tagName).toLowerCase();
    if (gradientTag !== 'lineargradient' && gradientTag !== 'radialgradient') {
      throw new SvgCodecError('unsupported-paint-server', `Resource “${gradientId}” is not an SVG gradient.`);
    }
    const chain: XmlElement[] = [];
    const visited = new Set<string>();
    let template: XmlElement | null = gradient;
    while (template) {
      const templateId = template.getAttribute('id')?.trim() || gradientId;
      if (visited.has(templateId)) {
        throw new SvgCodecError('resource-cycle', `Gradient “${gradientId}” contains a reference cycle.`);
      }
      if (chain.length >= limits.maxDepth) {
        throw new SvgCodecError('resource-depth', `Gradient “${gradientId}” exceeds the resource depth limit.`);
      }
      visited.add(templateId); chain.push(template);
      const href: string | null = template.getAttribute('href') || template.getAttribute('xlink:href');
      if (!href) break;
      const referencedId: string | undefined = LOCAL_FRAGMENT.exec(href.trim())?.[1];
      const referenced: XmlElement | null = referencedId ? resources.get(referencedId) ?? null : null;
      if (!referenced || (referenced.localName || referenced.tagName).toLowerCase() !== gradientTag) {
        throw new SvgCodecError('unsupported-gradient-template',
          `Gradient “${gradientId}” references an unsupported template.`);
      }
      template = referenced;
    }
    const inheritedAttribute = (name: string) => chain.find((candidate) => candidate.hasAttribute(name))
      ?.getAttribute(name) ?? null;
    const stopOwner = chain.find((candidate) => elementChildren(candidate).some((child) => (
      (child.localName || child.tagName).toLowerCase() === 'stop'
    ))) ?? gradient;
    const unitsRaw = inheritedAttribute('gradientUnits') || 'objectBoundingBox';
    if (unitsRaw !== 'objectBoundingBox' && unitsRaw !== 'userSpaceOnUse') {
      throw new SvgCodecError('unsupported-gradient-units', `Gradient “${gradientId}” has invalid gradientUnits.`);
    }
    const spreadRaw = inheritedAttribute('spreadMethod') || 'pad';
    if (spreadRaw !== 'pad' && spreadRaw !== 'reflect' && spreadRaw !== 'repeat') {
      throw new SvgCodecError('unsupported-gradient-spread', `Gradient “${gradientId}” has invalid spreadMethod.`);
    }
    let gradientGeometry: AffineMatrix;
    let radialFocus: { x: number; y: number } | undefined;
    let radialStartRadius: number | undefined;
    if (gradientTag === 'lineargradient') {
      const x1 = gradientCoordinate(inheritedAttribute('x1'), 'x1', '0%', 'x', unitsRaw);
      const y1 = gradientCoordinate(inheritedAttribute('y1'), 'y1', '0%', 'y', unitsRaw);
      const x2 = gradientCoordinate(inheritedAttribute('x2'), 'x2', '100%', 'x', unitsRaw);
      const y2 = gradientCoordinate(inheritedAttribute('y2'), 'y2', '0%', 'y', unitsRaw);
      const dx = x2 - x1; const dy = y2 - y1;
      if (Math.hypot(dx, dy) < 1e-12) {
        throw new SvgCodecError('degenerate-gradient', `Gradient “${gradientId}” has coincident endpoints.`);
      }
      gradientGeometry = { a: dx, b: dy, c: -dy, d: dx, tx: x1, ty: y1 };
    } else {
      const cx = gradientCoordinate(inheritedAttribute('cx'), 'cx', '50%', 'x', unitsRaw);
      const cy = gradientCoordinate(inheritedAttribute('cy'), 'cy', '50%', 'y', unitsRaw);
      const r = gradientCoordinate(inheritedAttribute('r'), 'r', '50%', 'radius', unitsRaw);
      if (!(r > 0)) throw new SvgCodecError('degenerate-gradient', `Gradient “${gradientId}” must have a positive radius.`);
      const fx = gradientCoordinate(inheritedAttribute('fx'), 'fx', String(cx), 'x', unitsRaw);
      const fy = gradientCoordinate(inheritedAttribute('fy'), 'fy', String(cy), 'y', unitsRaw);
      const fr = gradientCoordinate(inheritedAttribute('fr'), 'fr', '0', 'radius', unitsRaw);
      if (fr < 0 || fr >= r) throw new SvgCodecError('invalid-gradient-radius', `Gradient “${gradientId}” has an invalid focal radius.`);
      radialFocus = { x: (fx - cx) / r, y: (fy - cy) / r };
      radialStartRadius = fr / r;
      const focusDistance = Math.hypot(radialFocus.x, radialFocus.y);
      const maximumFocusDistance = Math.max(0, 1 - radialStartRadius) * (1 - 1e-7);
      if (focusDistance > maximumFocusDistance && focusDistance > 0) {
        const scale = maximumFocusDistance / focusDistance;
        radialFocus = { x: radialFocus.x * scale, y: radialFocus.y * scale };
        conversions.push({
          code: 'clamped-radial-focal-circle', element: gradientId,
          message: `Moved SVG radial gradient “${gradientId}” focal circle inside its end circle as required by SVG rendering semantics.`
        });
      }
      gradientGeometry = { a: r, b: 0, c: 0, d: r, tx: cx, ty: cy };
    }
    let transform = multiplyMatrices(
      parseSvgTransform(inheritedAttribute('gradientTransform')),
      gradientGeometry
    );
    if (unitsRaw === 'userSpaceOnUse') transform = multiplyMatrices(currentTransform, transform);

    const colorStops: GradientPaintInstance['asset']['colorStops'] = [];
    const opacityStops: GradientPaintInstance['asset']['opacityStops'] = [];
    let previousOffset = 0;
    for (const stop of elementChildren(stopOwner)) {
      if ((stop.localName || stop.tagName).toLowerCase() !== 'stop') continue;
      const offsetRaw = stop.getAttribute('offset')?.trim() || '0';
      const percentage = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))%$/u.exec(offsetRaw);
      const parsedOffset = percentage
        ? finiteNumber(percentage[1]!, 'gradient stop offset') / 100
        : finiteNumber(offsetRaw, 'gradient stop offset');
      const offset = Math.max(previousOffset, Math.min(1, Math.max(0, parsedOffset)));
      previousOffset = offset;
      const parsedColor = parseSvgColor(stopProperty(stop, 'stop-color') || 'black', 'black');
      if (!parsedColor) throw new SvgCodecError('invalid-gradient-stop', `Gradient “${gradientId}” has no stop color.`);
      const stopOpacity = boundedUnit(stopProperty(stop, 'stop-opacity') || '1', 'stop-opacity');
      const stopId = `${gradientId}:stop:${colorStops.length}`;
      colorStops.push({ id: stopId, position: offset, midpoint: 0.5,
        color: {
          r: linearChannelToSrgb(parsedColor.color[0]),
          g: linearChannelToSrgb(parsedColor.color[1]),
          b: linearChannelToSrgb(parsedColor.color[2]),
          a: 1
        } });
      opacityStops.push({ id: `${stopId}:opacity`, position: offset, midpoint: 0.5,
        opacity: parsedColor.color[3] * stopOpacity * paintOpacity });
    }
    if (!colorStops.length) {
      colorStops.push({ id: `${gradientId}:transparent`, position: 0, midpoint: 0.5,
        color: { r: 0, g: 0, b: 0, a: 1 } });
      opacityStops.push({ id: `${gradientId}:transparent:opacity`, position: 0, midpoint: 0.5,
        opacity: 0 });
    }
    return {
      kind: 'gradient',
      asset: { id: gradientId, name: gradientId, type: 'solid', smoothness: 1,
        colorStops, opacityStops, roughness: 0, seed: 0 },
      shape: gradientTag === 'lineargradient' ? 'linear' : 'radial',
      coordinateSpace: unitsRaw === 'objectBoundingBox' ? 'object-bounds' : 'document',
      transform,
      ...(radialFocus ? { radialFocus } : {}),
      ...(radialStartRadius ? { radialStartRadius } : {}),
      reverse: false,
      dither: true,
      interpolation: 'classic',
      spread: spreadRaw
    };
  };

  const resolvePaint = (
    value: string,
    color: string,
    paintOpacity: number,
    currentTransform: AffineMatrix,
    owner: string
  ): VectorPaint | null => {
    const referenceId = localPaintId(value);
    if (!referenceId) {
      const solid = parseSvgColor(value, color);
      return solid ? { ...solid, color: [solid.color[0], solid.color[1], solid.color[2],
        solid.color[3] * paintOpacity] } : null;
    }
    const resource = resources.get(referenceId);
    const resourceTag = resource && (resource.localName || resource.tagName).toLowerCase();
    if (!resource || (resourceTag !== 'lineargradient' && resourceTag !== 'radialgradient')) {
      warnings.push({ code: 'ignored-unsupported-paint-server', element: owner,
        message: `Ignored unsupported local SVG paint server “#${referenceId}”.` });
      return null;
    }
    try {
      const paint = gradientPaint(resource, currentTransform, paintOpacity);
      conversions.push({ code: `resolved-${paint.shape}-gradient`, element: owner,
        message: `Resolved local SVG ${paint.shape} gradient “#${referenceId}” to native editable paint.` });
      return paint;
    } catch (reason) {
      if (!(reason instanceof SvgCodecError)) throw reason;
      warnings.push({ code: 'ignored-invalid-paint-server', element: owner,
        message: `Ignored local SVG paint server “#${referenceId}”: ${reason.message}` });
      return null;
    }
  };

  const validateAttributes = (element: XmlElement, tag: string) => {
    if (element.attributes.length > limits.maxAttributesPerElement) throw new SvgCodecError('attribute-limit', `<${tag}> exceeds the attribute limit.`);
    const allowed = new Set([...GLOBAL_ATTRIBUTES, ...(GEOMETRY_ATTRIBUTES[tag] ?? [])]);
    let renderable = true;
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)!; const name = attribute.name;
      if (tag === 'a' && (/href$/iu.test(name)
        || ['target', 'download', 'rel', 'hreflang', 'referrerpolicy'].includes(name))) {
        warnings.push({ code: 'discarded-link-attribute', element: nameOf(element),
          message: `Discarded non-rendering SVG link attribute "${name}".` });
        continue;
      }
      if (/^on/iu.test(name)) throw new SvgCodecError('event-handler', `SVG event attribute “${name}” is forbidden.`);
      if (/href$/iu.test(name) || /url\s*\(/iu.test(attribute.value)) {
        const localReference = /url\s*\(\s*(['"]?)#[^)]+\1\s*\)/iu.test(attribute.value);
        if (!localReference) throw new SvgCodecError('external-reference', `SVG reference attribute “${name}” is unsupported.`);
        if ((name === 'fill' || name === 'stroke') && localPaintId(attribute.value)) continue;
        if (name === 'clip-path') {
          localPaintServerId(attribute.value, 'clip-path');
          continue;
        }
        warnings.push({ code: 'ignored-reference-element', element: nameOf(element),
          message: `Ignored <${tag}> because local SVG reference “${name}” is not supported yet.` });
        renderable = false;
        continue;
      }
      if (name === 'style') {
        const unsupportedProperty = attribute.value.split(';').map((declaration) => {
          const separator = declaration.indexOf(':');
          return separator < 0 ? '' : declaration.slice(0, separator).trim().toLowerCase();
        }).find((entry) => entry && !PRESENTATION.has(entry) && entry !== 'opacity');
        if (unsupportedProperty) {
          warnings.push({ code: 'ignored-unsupported-style', element: nameOf(element),
            message: `Ignored <${tag}> because inline SVG property “${unsupportedProperty}” is unsupported.` });
          renderable = false;
          continue;
        }
      }
      if (!allowed.has(name) && !name.startsWith('xmlns:')) {
        // Namespaced attributes from authoring tools (for example
        // sodipodi:version, sodipodi:nodetypes and inkscape:label) do not
        // participate in SVG rendering. Strict reference and active-content
        // checks have already run above, so discard this editor metadata.
        if ((attribute.namespaceURI && attribute.namespaceURI !== SVG_NAMESPACE)
          || RENDERING_HINT_ATTRIBUTES.has(name)
          || name.startsWith('data-') || name.startsWith('aria-') || name === 'role'
          || name === 'xml:lang' || name === 'xml:space') {
          warnings.push({ code: 'ignored-metadata-attribute', element: nameOf(element), message: `Ignored non-presentation attribute “${name}”.` });
        } else {
          warnings.push({ code: 'ignored-unsupported-attribute', element: nameOf(element),
            message: `Ignored <${tag}> because SVG attribute “${name}” is unsupported.` });
          renderable = false;
        }
      }
    }
    return renderable;
  };

  const visit = (
    element: XmlElement,
    parentStyle: StyleContext,
    parentTransform: AffineMatrix,
    depth: number,
    target: SvgSceneNode[]
  ) => {
    if (depth > limits.maxDepth) throw new SvgCodecError('nesting-limit', 'SVG nesting exceeds the depth limit.');
    const tag = (element.localName || element.tagName).toLowerCase();
    sourceElementCount += 1;
    if (sourceElementCount > limits.maxElements) throw new SvgCodecError('element-limit',
      `SVG exceeds the ${limits.maxElements} element limit.`);
    if (element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE) {
      warnings.push({ code: 'ignored-foreign-element', element: nameOf(element),
        message: `Ignored non-SVG extension element <${element.tagName}>.` });
      return;
    }
    if (ACTIVE_CONTENT.has(tag)) throw new SvgCodecError('active-content', `Active SVG element <${tag}> is forbidden.`);
    if (METADATA.has(tag)) {
      warnings.push({ code: 'ignored-metadata', element: tag, message: `Ignored non-rendering <${tag}> metadata.` }); return;
    }
    if (tag === 'defs' || tag === 'lineargradient' || tag === 'radialgradient') return;
    if (UNSUPPORTED.has(tag) || (tag !== 'svg' && tag !== 'g' && tag !== 'a' && !DRAWABLES.has(tag))) {
      warnings.push({ code: 'ignored-unsupported-element', element: nameOf(element),
        message: `Ignored unsupported SVG element <${tag}>.` });
      return;
    }
    if (tag === 'svg' && element !== root) {
      warnings.push({ code: 'ignored-unsupported-element', element: nameOf(element),
        message: 'Ignored unsupported nested <svg> viewport.' });
      return;
    }
    if (!validateAttributes(element, tag)) return;
    const style = inheritedStyle(element, parentStyle);
    const transform = multiplyMatrices(parentTransform, parseSvgTransform(element.getAttribute('transform')));
    const clipPath = resolveClipPath(element.getAttribute('clip-path'), transform, nameOf(element));
    if (tag === 'svg' || tag === 'g' || tag === 'a') {
      if ((tag === 'g' || tag === 'a') && element.getAttribute('transform')?.trim()) conversions.push({
        code: 'flattened-group-transform', element: nameOf(element),
        message: 'Flattened the group transform into its native child elements.'
      });
      if (tag === 'a') conversions.push({
        code: 'flattened-link-container', element: nameOf(element),
        message: 'Flattened a non-interactive SVG link container into editable native elements.'
      });
      let childTarget = target;
      // A source group is an authoring boundary even when it has no isolated
      // compositing effect. Preserve that hierarchy for the canonical layer
      // tree; geometry transforms remain flattened into leaves until the SVG
      // codec can retain group-local coordinate systems without changing
      // gradient and clip semantics.
      if (tag === 'g' || tag === 'a' || style.opacity !== 1 || clipPath) {
        const group: SvgSceneNode = {
          kind: 'group', name: nameOf(element), opacity: style.opacity,
          // Transforms remain flattened into leaf geometry for now. Keeping
          // the compositing boundary is the semantic requirement for opacity.
          transform: identityAffineMatrix(),
          ...(clipPath ? { clipPath } : {}),
          children: []
        };
        target.push(group);
        childTarget = group.children as SvgSceneNode[];
        if (style.opacity !== 1) conversions.push({ code: 'preserved-group-opacity', element: nameOf(element),
          message: `Preserved <${tag}> opacity as an isolated editable group.` });
        if (clipPath) conversions.push({ code: 'preserved-vector-clip', element: nameOf(element),
          message: `Preserved <${tag}> clip-path as editable vector geometry.` });
      }
      for (const child of elementChildren(element)) {
        visit(child, style.inherited, transform, depth + 1, childTarget);
      }
      return;
    }
    let nodeTarget = target;
    if (clipPath) {
      const group: SvgSceneNode = {
        kind: 'group', name: `${nameOf(element)} clipped`, opacity: 1,
        transform: identityAffineMatrix(), clipPath, children: []
      };
      target.push(group);
      nodeTarget = group.children as SvgSceneNode[];
    }
    if (elementChildren(element).length) throw new SvgCodecError('drawable-children', `<${tag}> cannot contain child elements in editable import.`);
    const elementName = nameOf(element); const vectorStyle = nativeStyle(
      style.inherited,
      style.opacity,
      (value, paintOpacity) => resolvePaint(
        value,
        style.inherited.color,
        paintOpacity,
        transform,
        elementName
      )
    );
    let vector: VectorElement;
    if (tag === 'path') {
      const parsed = parseSvgPathData(element.getAttribute('d') ?? '', createId, limits);
      totalAnchors += parsed.anchorCount;
      if (parsed.convertedQuadratics) conversions.push({ code: 'quadratic-to-cubic', element: elementName,
        message: `Converted ${parsed.convertedQuadratics} quadratic segment(s) to cubic Béziers.` });
      if (parsed.convertedArcs) conversions.push({ code: 'arc-to-cubic', element: elementName,
        message: `Converted ${parsed.convertedArcs} elliptical arc(s) to cubic Béziers.` });
      vector = createVectorPath(createId('element'), elementName, parsed.subpaths); vector.fillRule = style.inherited.fillRule;
    } else if (tag === 'rect') {
      const x = coordinate(element, 'x'); const y = coordinate(element, 'y');
      const widthValue = positive(element.getAttribute('width') ?? '', 'rect width');
      const heightValue = positive(element.getAttribute('height') ?? '', 'rect height');
      const rxRaw = element.getAttribute('rx'); const ryRaw = element.getAttribute('ry');
      const rx = rxRaw === null ? (ryRaw === null ? 0 : nonnegative(ryRaw, 'rect ry')) : nonnegative(rxRaw, 'rect rx');
      const ry = ryRaw === null ? rx : nonnegative(ryRaw, 'rect ry');
      if (Math.abs(rx - ry) > 1e-9) {
        const k = 0.5522847498307936; const clampedRx = Math.min(rx, widthValue / 2); const clampedRy = Math.min(ry, heightValue / 2);
        const d = `M${x + clampedRx} ${y} H${x + widthValue - clampedRx} C${x + widthValue - clampedRx + clampedRx * k} ${y} ${x + widthValue} ${y + clampedRy - clampedRy * k} ${x + widthValue} ${y + clampedRy} V${y + heightValue - clampedRy} C${x + widthValue} ${y + heightValue - clampedRy + clampedRy * k} ${x + widthValue - clampedRx + clampedRx * k} ${y + heightValue} ${x + widthValue - clampedRx} ${y + heightValue} H${x + clampedRx} C${x + clampedRx - clampedRx * k} ${y + heightValue} ${x} ${y + heightValue - clampedRy + clampedRy * k} ${x} ${y + heightValue - clampedRy} V${y + clampedRy} C${x} ${y + clampedRy - clampedRy * k} ${x + clampedRx - clampedRx * k} ${y} ${x + clampedRx} ${y} Z`;
        const parsed = parseSvgPathData(d, createId, limits); totalAnchors += parsed.anchorCount;
        vector = createVectorPath(createId('element'), elementName, parsed.subpaths);
        conversions.push({ code: 'elliptical-rounded-rect-to-path', element: elementName, message: 'Converted elliptical rectangle corners to an editable cubic path.' });
      } else {
        vector = createVectorLiveShape(createId('element'), { kind: 'rectangle', width: widthValue, height: heightValue,
          cornerRadii: [rx, rx, rx, rx], linkedCorners: true }, elementName);
        vector.transform = translationMatrix(x, y);
      }
    } else if (tag === 'circle' || tag === 'ellipse') {
      const rx = tag === 'circle' ? positive(element.getAttribute('r') ?? '', 'circle radius') : positive(element.getAttribute('rx') ?? '', 'ellipse rx');
      const ry = tag === 'circle' ? rx : positive(element.getAttribute('ry') ?? '', 'ellipse ry');
      const cx = coordinate(element, 'cx'); const cy = coordinate(element, 'cy');
      vector = createVectorLiveShape(createId('element'), { kind: 'ellipse', width: rx * 2, height: ry * 2 }, elementName);
      vector.transform = translationMatrix(cx - rx, cy - ry);
    } else if (tag === 'line') {
      const x1 = coordinate(element, 'x1'); const y1 = coordinate(element, 'y1');
      const x2 = coordinate(element, 'x2'); const y2 = coordinate(element, 'y2');
      vector = createVectorLiveShape(createId('element'), { kind: 'line', start: { x: 0, y: 0 },
        end: { x: x2 - x1, y: y2 - y1 }, startArrow: null, endArrow: null }, elementName);
      vector.transform = translationMatrix(x1, y1);
    } else {
      const subpath = polylineSubpath(element, tag === 'polygon', createId); totalAnchors += subpath.anchors.length;
      vector = createVectorPath(createId('element'), elementName, [subpath]); vector.fillRule = style.inherited.fillRule;
    }
    if (totalAnchors > limits.maxAnchors) throw new SvgCodecError('anchor-limit', 'SVG exceeds the total anchor limit.');
    vector.transform = multiplyMatrices(transform, vector.transform ?? identityAffineMatrix());
    vector.style = vectorStyle;

    if (vectorStyle.opacity !== 1 && vectorStyle.fill && vectorStyle.stroke) {
      warnings.push({ code: 'ignored-object-opacity', element: elementName,
        message: `Ignored <${tag}> because combined fill, stroke and opacity cannot preserve overlap compositing.` });
      return;
    }

    if (vector.type === 'path' && vectorStyle.fill
      && vector.subpaths.some((subpath) => !subpath.closed && subpath.anchors.length >= 2)) {
      const sourceSubpaths = vector.subpaths;
      vector.subpaths = sourceSubpaths.map((subpath) => subpath.closed || subpath.anchors.length < 2
        ? subpath
        : { ...subpath, closed: true });
      conversions.push({
        code: 'implicit-fill-close',
        element: elementName,
        message: 'Closed open SVG subpaths for native fill geometry, matching SVG implicit fill closure.'
      });

      if (vectorStyle.stroke) {
        const strokeSubpaths = sourceSubpaths.map((subpath) => ({
          id: createId('subpath'),
          closed: subpath.closed,
          anchors: subpath.anchors.map((anchor) => ({
            ...anchor,
            id: createId('anchor'),
            position: { ...anchor.position },
            handleIn: anchor.handleIn ? { ...anchor.handleIn } : null,
            handleOut: anchor.handleOut ? { ...anchor.handleOut } : null
          }))
        }));
        totalAnchors += strokeSubpaths.reduce((count, subpath) => count + subpath.anchors.length, 0);
        if (totalAnchors > limits.maxAnchors) {
          throw new SvgCodecError('anchor-limit', 'SVG exceeds the total anchor limit after preserving implicit fill closure.');
        }
        const strokeVector = createVectorPath(createId('element'), `${elementName} stroke`, strokeSubpaths);
        strokeVector.fillRule = vector.fillRule;
        strokeVector.transform = { ...vector.transform };
        strokeVector.style = { ...vectorStyle, fill: null };
        vector.style = { ...vectorStyle, stroke: null };
        elements.push(vector, strokeVector);
        nodeTarget.push({ kind: 'element', element: vector }, { kind: 'element', element: strokeVector });
        conversions.push({
          code: 'split-open-fill-and-stroke',
          element: elementName,
          message: 'Split implicit closed fill from the authored open stroke to preserve SVG rendering semantics.'
        });
        return;
      }
    }
    elements.push(vector);
    nodeTarget.push({ kind: 'element', element: vector });
  };

  const rootAttributesSupported = validateAttributes(root, 'svg');
  const rootStyle = rootAttributesSupported ? inheritedStyle(root, DEFAULT_STYLE)
    : { inherited: DEFAULT_STYLE, opacity: 1 };
  let rootTarget = nodes;
  if (rootStyle.opacity !== 1) {
    const group: SvgSceneNode = { kind: 'group', name: nameOf(root), opacity: rootStyle.opacity,
      transform: identityAffineMatrix(), children: [] };
    nodes.push(group); rootTarget = group.children as SvgSceneNode[];
    conversions.push({ code: 'preserved-group-opacity', element: nameOf(root),
      message: 'Preserved root SVG opacity as an isolated editable group.' });
  }
  for (const child of elementChildren(root)) visit(child, rootStyle.inherited,
    multiplyMatrices(baseTransform, parseSvgTransform(root.getAttribute('transform'))), 1, rootTarget);
  if (!elements.length) throw new SvgCodecError('empty-svg', 'SVG contains no supported editable geometry.');
  return { width, height, viewBox, elements, nodes, sourceElementCount,
    report: { warnings, conversions } };
};
