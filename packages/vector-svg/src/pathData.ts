import type { Vec2, VectorAnchor, VectorSubpath } from '@lighttable/vector-core';
import { SvgCodecError, type SvgCodecLimits } from './types';

const TOKEN = /[AaCcHhLlMmQqSsTtVvZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gu;
const COMMAND = /^[AaCcHhLlMmQqSsTtVvZz]$/u;
const point = (x: number, y: number): Vec2 => ({ x, y });
const same = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;
const reflect = (control: Vec2, around: Vec2) => point(2 * around.x - control.x, 2 * around.y - control.y);

const tokenize = (data: string) => {
  const tokens = [...data.matchAll(TOKEN)].map((match) => match[0]);
  const residue = data.replace(TOKEN, '').replace(/[\s,]+/gu, '');
  if (residue) throw new SvgCodecError('invalid-path-data', `SVG path contains invalid syntax near “${residue.slice(0, 24)}”.`);
  return tokens;
};

interface CubicArc { c1: Vec2; c2: Vec2; end: Vec2 }

const arcToCubics = (
  start: Vec2, rawRx: number, rawRy: number, rotationDegrees: number,
  largeArc: boolean, sweep: boolean, end: Vec2
): CubicArc[] => {
  if (same(start, end)) return [];
  let rx = Math.abs(rawRx); let ry = Math.abs(rawRy);
  if (rx === 0 || ry === 0) return [{ c1: { ...start }, c2: { ...end }, end: { ...end } }];
  const phi = rotationDegrees * Math.PI / 180;
  const cosPhi = Math.cos(phi); const sinPhi = Math.sin(phi);
  const dx = (start.x - end.x) / 2; const dy = (start.y - end.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const scale = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (scale > 1) { const factor = Math.sqrt(scale); rx *= factor; ry *= factor; }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const sign = largeArc === sweep ? -1 : 1;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cxp = coefficient * rx * y1p / ry;
  const cyp = coefficient * -ry * x1p / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const cosine = length === 0 ? 1 : Math.min(1, Math.max(-1, (ux * vx + uy * vy) / length));
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(cosine);
  };
  const ux = (x1p - cxp) / rx; const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx; const vy = (-y1p - cyp) / ry;
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const startAngle = angle(1, 0, ux, uy);
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const map = (x: number, y: number): Vec2 => point(
    cx + rx * (cosPhi * x - sinPhi * y),
    cy + ry * (sinPhi * x + cosPhi * y)
  );
  const result: CubicArc[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a0 = startAngle + index * step; const a1 = a0 + step;
    const alpha = 4 / 3 * Math.tan((a1 - a0) / 4);
    const p0 = point(Math.cos(a0), Math.sin(a0));
    const p1 = point(Math.cos(a1), Math.sin(a1));
    result.push({
      c1: map(p0.x - alpha * p0.y, p0.y + alpha * p0.x),
      c2: map(p1.x + alpha * p1.y, p1.y - alpha * p1.x),
      end: map(p1.x, p1.y)
    });
  }
  result[result.length - 1]!.end = { ...end };
  return result;
};

export interface ParsedSvgPath {
  readonly subpaths: VectorSubpath[];
  readonly anchorCount: number;
  readonly convertedQuadratics: number;
  readonly convertedArcs: number;
}

export const parseSvgPathData = (
  data: string,
  createId: (kind: 'subpath' | 'anchor') => string,
  limits: Pick<SvgCodecLimits, 'maxPathDataBytes' | 'maxSubpaths' | 'maxAnchors'>
): ParsedSvgPath => {
  if (new TextEncoder().encode(data).byteLength > limits.maxPathDataBytes) {
    throw new SvgCodecError('path-data-limit', 'SVG path data exceeds the byte limit.');
  }
  const tokens = tokenize(data);
  let index = 0; let command = ''; let previousCommand = '';
  let current = point(0, 0); let subpath: VectorSubpath | null = null;
  const subpaths: VectorSubpath[] = [];
  let lastQuadratic: Vec2 | null = null; let convertedQuadratics = 0; let convertedArcs = 0;
  const number = () => {
    const token = tokens[index++];
    if (token === undefined || COMMAND.test(token)) throw new SvgCodecError('invalid-path-data', `SVG path command ${command} is missing parameters.`);
    const value = Number(token);
    if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) throw new SvgCodecError('invalid-path-number', 'SVG path coordinate is not finite or bounded.');
    return value;
  };
  const hasNumber = () => index < tokens.length && !COMMAND.test(tokens[index]!);
  const coordinate = (relative: boolean) => {
    const x = number(); const y = number();
    return relative ? point(current.x + x, current.y + y) : point(x, y);
  };
  const addAnchor = (position: Vec2, handleIn: Vec2 | null = null) => {
    if (!subpath) throw new SvgCodecError('path-missing-move', 'SVG path must start with a move command.');
    const anchor: VectorAnchor = { id: createId('anchor'), position: { ...position }, handleIn,
      handleOut: null, mode: 'corner' };
    subpath.anchors.push(anchor);
    if (subpaths.reduce((sum, entry) => sum + entry.anchors.length, 0) > limits.maxAnchors) {
      throw new SvgCodecError('anchor-limit', 'SVG path exceeds the anchor limit.');
    }
    current = { ...position };
    return anchor;
  };
  const begin = (position: Vec2) => {
    if (subpaths.length >= limits.maxSubpaths) throw new SvgCodecError('subpath-limit', 'SVG path exceeds the subpath limit.');
    subpath = { id: createId('subpath'), closed: false, anchors: [] };
    subpaths.push(subpath);
    addAnchor(position);
  };
  const activeSubpath = () => {
    if (!subpath) throw new SvgCodecError('path-missing-move', 'SVG path has no current subpath.');
    return subpath as VectorSubpath;
  };
  const lineTo = (end: Vec2) => { addAnchor(end); };
  const cubicTo = (c1: Vec2, c2: Vec2, end: Vec2) => {
    if (!subpath?.anchors.length) throw new SvgCodecError('path-missing-move', 'SVG curve has no current subpath.');
    subpath.anchors[subpath.anchors.length - 1]!.handleOut = { ...c1 };
    addAnchor(end, { ...c2 });
  };

  while (index < tokens.length) {
    if (COMMAND.test(tokens[index]!)) command = tokens[index++]!;
    else if (!command) throw new SvgCodecError('path-missing-command', 'SVG path data starts without a command.');
    const lower = command.toLowerCase(); const relative = command === lower;
    if (lower === 'z') {
      const active = activeSubpath();
      if (!active.anchors.length) throw new SvgCodecError('invalid-close', 'SVG close command has no open subpath.');
      active.closed = true; current = { ...active.anchors[0]!.position };
      lastQuadratic = null; previousCommand = command; command = '';
      continue;
    }
    if (!hasNumber()) throw new SvgCodecError('invalid-path-data', `SVG path command ${command} has no parameters.`);
    if (lower === 'm') {
      begin(coordinate(relative));
      while (hasNumber()) lineTo(coordinate(relative));
    } else if (lower === 'l') {
      while (hasNumber()) lineTo(coordinate(relative));
    } else if (lower === 'h') {
      while (hasNumber()) { const x = number(); lineTo(point(relative ? current.x + x : x, current.y)); }
    } else if (lower === 'v') {
      while (hasNumber()) { const y = number(); lineTo(point(current.x, relative ? current.y + y : y)); }
    } else if (lower === 'c') {
      while (hasNumber()) {
        const c1 = coordinate(relative); const base = { ...current };
        const c2raw = coordinate(false); const endRaw = coordinate(false);
        const c2 = relative ? point(base.x + c2raw.x, base.y + c2raw.y) : c2raw;
        const end = relative ? point(base.x + endRaw.x, base.y + endRaw.y) : endRaw;
        cubicTo(c1, c2, end);
      }
    } else if (lower === 's') {
      while (hasNumber()) {
        const base = { ...current };
        const active = activeSubpath();
        const c1 = /[cs]/iu.test(previousCommand) && active.anchors.at(-1)?.handleIn
          ? reflect(active.anchors.at(-1)!.handleIn!, base) : { ...base };
        const c2raw = coordinate(false); const endRaw = coordinate(false);
        const c2 = relative ? point(base.x + c2raw.x, base.y + c2raw.y) : c2raw;
        const end = relative ? point(base.x + endRaw.x, base.y + endRaw.y) : endRaw;
        cubicTo(c1, c2, end); previousCommand = command;
      }
    } else if (lower === 'q' || lower === 't') {
      while (hasNumber()) {
        const start = { ...current };
        const control: Vec2 = lower === 'q' ? coordinate(relative)
          : /[qt]/iu.test(previousCommand) && lastQuadratic ? reflect(lastQuadratic, start) : { ...start };
        const end = coordinate(relative);
        cubicTo(point(start.x + 2 / 3 * (control.x - start.x), start.y + 2 / 3 * (control.y - start.y)),
          point(end.x + 2 / 3 * (control.x - end.x), end.y + 2 / 3 * (control.y - end.y)), end);
        lastQuadratic = control; convertedQuadratics += 1; previousCommand = command;
      }
    } else if (lower === 'a') {
      while (hasNumber()) {
        const base = { ...current }; const rx = number(); const ry = number(); const rotation = number();
        const large = number(); const sweep = number();
        if ((large !== 0 && large !== 1) || (sweep !== 0 && sweep !== 1)) {
          throw new SvgCodecError('invalid-arc-flag', 'SVG arc flags must be zero or one.');
        }
        const rawEnd = coordinate(false);
        const end = relative ? point(base.x + rawEnd.x, base.y + rawEnd.y) : rawEnd;
        const cubics = arcToCubics(base, rx, ry, rotation, large === 1, sweep === 1, end);
        if (!cubics.length) current = end;
        else for (const cubic of cubics) cubicTo(cubic.c1, cubic.c2, cubic.end);
        convertedArcs += 1; previousCommand = command;
      }
    } else {
      throw new SvgCodecError('unsupported-path-command', `Unsupported SVG path command ${command}.`);
    }
    if (lower !== 'q' && lower !== 't') lastQuadratic = null;
    previousCommand = command;
  }
  const anchorCount = subpaths.reduce((sum, entry) => sum + entry.anchors.length, 0);
  if (!anchorCount) throw new SvgCodecError('empty-path', 'SVG path has no geometry.');
  return { subpaths, anchorCount, convertedQuadratics, convertedArcs };
};

const format = (value: number) => Number(value.toFixed(6)).toString();
const sameControl = (a: Vec2 | null, b: Vec2) => !a || same(a, b);

export const serializeSvgPathData = (subpaths: readonly VectorSubpath[]) => subpaths.map((subpath) => {
  if (!subpath.anchors.length) return '';
  const first = subpath.anchors[0]!;
  const parts = [`M${format(first.position.x)} ${format(first.position.y)}`];
  const segmentCount = subpath.closed ? subpath.anchors.length : subpath.anchors.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = subpath.anchors[index]!;
    const end = subpath.anchors[(index + 1) % subpath.anchors.length]!;
    if (sameControl(start.handleOut, start.position) && sameControl(end.handleIn, end.position)) {
      if (!subpath.closed || index < segmentCount - 1) parts.push(`L${format(end.position.x)} ${format(end.position.y)}`);
    } else {
      const c1 = start.handleOut ?? start.position; const c2 = end.handleIn ?? end.position;
      parts.push(`C${format(c1.x)} ${format(c1.y)} ${format(c2.x)} ${format(c2.y)} ${format(end.position.x)} ${format(end.position.y)}`);
    }
  }
  if (subpath.closed) parts.push('Z');
  return parts.join(' ');
}).filter(Boolean).join(' ');
