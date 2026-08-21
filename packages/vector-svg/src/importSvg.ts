import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import { createVectorLiveShape, createVectorPath, identityAffineMatrix, multiplyMatrices,
  translationMatrix, type AffineMatrix, type VectorElement, type VectorPaint,
  type VectorStyle, type VectorSubpath } from '@lighttable/vector-core';
import { parseSvgColor } from './color';
import { finiteNumber, parseLength, parseNumberList } from './numbers';
import { parseSvgPathData } from './pathData';
import { parseSvgTransform } from './transform';
import { DEFAULT_SVG_CODEC_LIMITS, SvgCodecError, type SvgCodecLimits,
  type SvgConversionNotice, type SvgImportOptions, type SvgImportPlan, type SvgViewBox } from './types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DRAWABLES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const FORBIDDEN = new Set(['script', 'foreignobject', 'image', 'text', 'style', 'iframe', 'object',
  'animate', 'animatemotion', 'animatetransform', 'set', 'filter', 'mask', 'clippath', 'pattern',
  'marker', 'lineargradient', 'radialgradient', 'use', 'defs']);
const METADATA = new Set(['title', 'desc', 'metadata']);
const PRESENTATION = new Set(['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'color']);
const GLOBAL_ATTRIBUTES = new Set(['id', 'transform', 'style', 'opacity', ...PRESENTATION]);
const GEOMETRY_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  svg: ['width', 'height', 'viewBox', 'preserveAspectRatio', 'version', 'xmlns'],
  g: [], a: [], path: ['d'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points']
});

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

const nativeStyle = (context: StyleContext, opacity: number): VectorStyle => {
  const fill = parseSvgColor(context.fill, context.color);
  const resolvedFill: VectorPaint | null = fill ? { ...fill,
    color: [fill.color[0], fill.color[1], fill.color[2], fill.color[3] * context.fillOpacity] } : null;
  const strokePaint = parseSvgColor(context.stroke, context.color);
  return {
    fill: resolvedFill,
    stroke: strokePaint ? { paint: strokePaint, opacity: context.strokeOpacity,
      width: context.strokeWidth, alignment: 'center', cap: context.strokeCap,
      join: context.strokeJoin, miterLimit: context.strokeMiterLimit,
      dash: [...context.strokeDash], dashOffset: context.strokeDashOffset } : null,
    opacity
  };
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
const nameOf = (element: XmlElement) => element.getAttribute('id')?.trim() || element.localName || element.tagName;
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
  try {
    document = new DOMParser({ onError: (_level, message) => { parserMessage = message; } })
      .parseFromString(svg, 'image/svg+xml');
  } catch (reason) {
    throw new SvgCodecError('invalid-xml', `SVG XML is invalid: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  if (parserMessage) throw new SvgCodecError('invalid-xml', `SVG XML is invalid: ${parserMessage}`);
  const root = document.documentElement;
  if (!root || root.localName?.toLowerCase() !== 'svg') throw new SvgCodecError('invalid-root', 'SVG document must have an <svg> root.');
  if (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE) throw new SvgCodecError('invalid-namespace', 'SVG root uses an unsupported namespace.');
  const descendantElementCount = root.getElementsByTagName('*').length;
  if (descendantElementCount > limits.maxElements) {
    throw new SvgCodecError('element-limit',
      `SVG contains ${descendantElementCount} elements and exceeds the ${limits.maxElements} element limit.`);
  }
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
  const width = viewBoxRaw ? viewBox.width : declaredWidth;
  const height = viewBoxRaw ? viewBox.height : declaredHeight;
  const baseTransform = viewBoxRaw
    ? translationMatrix(-viewBox.minX, -viewBox.minY)
    : identityAffineMatrix();
  let id = 0; const createId = options.createId ?? ((kind) => `svg-${kind}-${++id}`);
  const warnings: SvgConversionNotice[] = []; const conversions: SvgConversionNotice[] = [];
  const elements: VectorElement[] = []; let sourceElementCount = 0; let totalAnchors = 0;

  const validateAttributes = (element: XmlElement, tag: string) => {
    if (element.attributes.length > limits.maxAttributesPerElement) throw new SvgCodecError('attribute-limit', `<${tag}> exceeds the attribute limit.`);
    const allowed = new Set([...GLOBAL_ATTRIBUTES, ...(GEOMETRY_ATTRIBUTES[tag] ?? [])]);
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)!; const name = attribute.name;
      if (tag === 'a' && (/href$/iu.test(name)
        || ['target', 'download', 'rel', 'hreflang', 'referrerpolicy'].includes(name))) {
        warnings.push({ code: 'discarded-link-attribute', element: nameOf(element),
          message: `Discarded non-rendering SVG link attribute "${name}".` });
        continue;
      }
      if (/^on/iu.test(name)) throw new SvgCodecError('event-handler', `SVG event attribute “${name}” is forbidden.`);
      if (/href$/iu.test(name) || /url\s*\(/iu.test(attribute.value)) throw new SvgCodecError('external-reference', `SVG reference attribute “${name}” is unsupported.`);
      if (!allowed.has(name) && !name.startsWith('xmlns:')) {
        if (name === 'class') throw new SvgCodecError('unsupported-css', 'SVG class-based styling is unsupported.');
        // Namespaced attributes from authoring tools (for example
        // sodipodi:version, sodipodi:nodetypes and inkscape:label) do not
        // participate in SVG rendering. Strict reference and active-content
        // checks have already run above, so discard this editor metadata.
        if ((attribute.namespaceURI && attribute.namespaceURI !== SVG_NAMESPACE)
          || name.startsWith('data-') || name.startsWith('aria-') || name === 'role'
          || name === 'xml:lang' || name === 'xml:space') {
          warnings.push({ code: 'ignored-metadata-attribute', element: nameOf(element), message: `Ignored non-presentation attribute “${name}”.` });
        } else {
          throw new SvgCodecError('unsupported-attribute', `Unsupported SVG attribute “${name}” on <${tag}>.`);
        }
      }
    }
  };

  const visit = (element: XmlElement, parentStyle: StyleContext, parentTransform: AffineMatrix, depth: number) => {
    if (depth > limits.maxDepth) throw new SvgCodecError('nesting-limit', 'SVG nesting exceeds the depth limit.');
    const tag = (element.localName || element.tagName).toLowerCase();
    sourceElementCount += 1;
    if (sourceElementCount > limits.maxElements) throw new SvgCodecError('element-limit',
      `SVG exceeds the ${limits.maxElements} element limit.`);
    if (element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE) throw new SvgCodecError('foreign-namespace', `Foreign SVG namespace on <${tag}> is forbidden.`);
    if (FORBIDDEN.has(tag)) throw new SvgCodecError('unsupported-element', `SVG element <${tag}> is unsupported in editable import.`);
    if (METADATA.has(tag)) {
      warnings.push({ code: 'ignored-metadata', element: tag, message: `Ignored non-rendering <${tag}> metadata.` }); return;
    }
    if (tag !== 'svg' && tag !== 'g' && tag !== 'a' && !DRAWABLES.has(tag)) throw new SvgCodecError('unsupported-element', `Unsupported SVG element <${tag}>.`);
    if (tag === 'svg' && element !== root) throw new SvgCodecError('nested-svg', 'Nested <svg> viewports are unsupported.');
    validateAttributes(element, tag);
    const style = inheritedStyle(element, parentStyle);
    if ((tag === 'svg' || tag === 'g' || tag === 'a') && style.opacity !== 1) {
      throw new SvgCodecError('group-opacity', 'Group/root opacity cannot be flattened without changing overlap compositing.');
    }
    const transform = multiplyMatrices(parentTransform, parseSvgTransform(element.getAttribute('transform')));
    if (tag === 'svg' || tag === 'g' || tag === 'a') {
      if ((tag === 'g' || tag === 'a') && element.getAttribute('transform')?.trim()) conversions.push({
        code: 'flattened-group-transform', element: nameOf(element),
        message: 'Flattened the group transform into its native child elements.'
      });
      if (tag === 'a') conversions.push({
        code: 'flattened-link-container', element: nameOf(element),
        message: 'Flattened a non-interactive SVG link container into editable native elements.'
      });
      for (const child of elementChildren(element)) visit(child, style.inherited, transform, depth + 1);
      return;
    }
    if (elementChildren(element).length) throw new SvgCodecError('drawable-children', `<${tag}> cannot contain child elements in editable import.`);
    const elementName = nameOf(element); const vectorStyle = nativeStyle(style.inherited, style.opacity);
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
      throw new SvgCodecError(
        'paint-opacity-compositing',
        `SVG element <${tag}> combines fill, stroke and opacity; native import cannot preserve object-level overlap compositing.`
      );
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
        conversions.push({
          code: 'split-open-fill-and-stroke',
          element: elementName,
          message: 'Split implicit closed fill from the authored open stroke to preserve SVG rendering semantics.'
        });
        return;
      }
    }
    elements.push(vector);
  };

  const rootStyle = inheritedStyle(root, DEFAULT_STYLE);
  if (rootStyle.opacity !== 1) throw new SvgCodecError('group-opacity', 'Root SVG opacity cannot be flattened safely.');
  validateAttributes(root, 'svg');
  for (const child of elementChildren(root)) visit(child, rootStyle.inherited,
    multiplyMatrices(baseTransform, parseSvgTransform(root.getAttribute('transform'))), 1);
  if (!elements.length) throw new SvgCodecError('empty-svg', 'SVG contains no supported editable geometry.');
  return { width, height, viewBox, elements, sourceElementCount, report: { warnings, conversions } };
};
