import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it, vi } from 'vitest';
import { exportSvg } from './exportSvg';
import { importSvg } from './importSvg';
import { SvgCodecError } from './types';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 50">
  <g transform="translate(5 3)" fill="#ff0000" stroke="rgb(0, 0, 255)" stroke-width="2">
    <rect id="card" x="1" y="2" width="20" height="10" rx="2"/>
    <path id="curve" d="M 0 20 Q 10 0 20 20 T 40 20 A 10 5 0 0 1 60 20 Z" fill-rule="evenodd"/>
    <polyline id="open" points="0,30 10,35 20,30" fill="none"/>
  </g>
</svg>`;

describe('native SVG codec', () => {
  it('walks a large flat document once without xmldom descendant rescans', () => {
    const root = new DOMParser().parseFromString('<svg/>', 'image/svg+xml').documentElement;
    const prototype = Object.getPrototypeOf(root) as { getElementsByTagName: (...args: unknown[]) => unknown };
    const descendantScan = vi.spyOn(prototype, 'getElementsByTagName');
    try {
      const shapes = Array.from({ length: 5_000 }, (_, index) =>
        `<path id="p${index}" d="M${index} 0L${index + 1} 1" fill="none" stroke="black"/>`).join('');
      const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`, {
        limits: { maxInputBytes: 2 * 1024 * 1024, maxElements: 5_100, maxAnchors: 12_000 }
      });
      expect(plan.elements).toHaveLength(5_000);
      expect(descendantScan).not.toHaveBeenCalled();
    } finally {
      descendantScan.mockRestore();
    }
  });

  it('imports the bounded native subset as editable vector elements', () => {
    const plan = importSvg(SVG);
    expect(plan).toMatchObject({ width: 100, height: 50,
      viewBox: { minX: 0, minY: 0, width: 100, height: 50 } });
    expect(plan.elements).toHaveLength(3);
    expect(plan.elements[0]).toMatchObject({ type: 'live-shape', name: 'card',
      geometry: { kind: 'rectangle', width: 20, height: 10 },
      style: { stroke: { width: 2 } } });
    expect(plan.elements[1]).toMatchObject({ type: 'path', name: 'curve', fillRule: 'evenodd' });
    expect(plan.report.conversions.map(({ code }) => code)).toEqual([
      'flattened-group-transform', 'quadratic-to-cubic', 'arc-to-cubic'
    ]);
    expect(plan.elements[2]).toMatchObject({ type: 'path', name: 'open', style: { fill: null } });
    expect(plan.elements.every(({ transform }) => transform.a === 1 && transform.d === 1)).toBe(true);
  });

  it('uses viewBox user units for an editable document instead of presentation dimensions', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" viewBox="10 20 688 600"><circle cx="110" cy="120" r="20"/></svg>');
    expect(plan).toMatchObject({
      width: 688,
      height: 600,
      viewBox: { minX: 10, minY: 20, width: 688, height: 600 }
    });
    expect(plan.elements[0]?.transform).toMatchObject({ a: 1, d: 1, tx: 80, ty: 80 });
  });

  it('rounds fractional SVG dimensions up to a valid GPU pixel surface', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="357.57196" height="479.54791"><rect width="10" height="10"/></svg>');
    expect(plan).toMatchObject({
      width: 358,
      height: 480,
      viewBox: { width: 357.57196, height: 479.54791 }
    });
  });

  it('exports and reimports a semantically equivalent native subset', () => {
    const first = importSvg(SVG);
    const serialized = exportSvg(first.elements, { width: first.width, height: first.height, title: 'Round trip' });
    const second = importSvg(serialized);
    expect(serialized).toContain('<rect');
    expect(serialized).toContain('<path');
    expect(second.elements).toHaveLength(first.elements.length);
    expect(second.elements.map(({ type, name }) => ({ type, name })))
      .toEqual(first.elements.map(({ type, name }) => ({ type, name })));
    expect(second.elements[1]).toMatchObject({ type: 'path', fillRule: 'evenodd' });
  });

  it('resolves local linear-gradient paint and preserves it through SVG export', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <defs>
        <linearGradient id="sky" x1="10%" y1="20%" x2="90%" y2="70%"
          gradientTransform="rotate(12)" spreadMethod="reflect">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".25"/>
          <stop offset="40%" stop-color="#34c759"/>
          <stop offset="100%" stop-color="#007aff"/>
        </linearGradient>
      </defs>
      <rect id="gradient-card" width="180" height="80" fill="url(#sky)" fill-opacity=".8"/>
    </svg>`;
    const first = importSvg(source);
    expect(first.elements).toHaveLength(1);
    expect(first.elements[0]?.style.fill).toMatchObject({
      kind: 'gradient', shape: 'linear', coordinateSpace: 'object-bounds', spread: 'reflect',
      asset: { colorStops: [
        { position: 0, color: { r: expect.closeTo(1, 12), g: expect.closeTo(1, 12),
          b: expect.closeTo(1, 12) } },
        { position: 0.4, color: { r: expect.closeTo(52 / 255, 6), g: expect.closeTo(199 / 255, 6),
          b: expect.closeTo(89 / 255, 6) } },
        { position: 1, color: { r: 0, g: expect.closeTo(122 / 255, 6), b: expect.closeTo(1, 12) } }
      ] }
    });
    expect(first.elements[0]?.style.fill && 'kind' in first.elements[0].style.fill
      ? first.elements[0].style.fill.asset.opacityStops.map(({ opacity }) => opacity)
      : []).toEqual([0.2, 0.8, 0.8]);
    expect(first.report.conversions).toContainEqual(expect.objectContaining({
      code: 'resolved-linear-gradient', element: 'gradient-card'
    }));

    const serialized = exportSvg(first.elements, { width: first.width, height: first.height });
    expect(serialized).toContain('<defs>');
    expect(serialized).toContain('fill="url(#lighttable-gradient-1)"');
    expect(serialized).toContain('spreadMethod="reflect"');
    const second = importSvg(serialized);
    expect(second.elements[0]?.style.fill).toMatchObject({
      kind: 'gradient', shape: 'linear', coordinateSpace: 'object-bounds', spread: 'reflect'
    });
  });

  it('maps user-space gradients through the current SVG transform', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
      <defs><linearGradient id="g" gradientUnits="userSpaceOnUse"
        x1="10" y1="20" x2="110" y2="20"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>
      <g transform="translate(5 7)"><rect width="50" height="20" fill="url(#g)"/></g>
    </svg>`);
    expect(plan.elements[0]?.style.fill).toMatchObject({
      kind: 'gradient', coordinateSpace: 'document',
      transform: { a: 100, b: 0, c: 0, d: 100, tx: 5, ty: 7 }
    });
  });

  it('inherits local gradient templates with a bounded resource chain', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="base" x1=".2" x2=".8"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
        <linearGradient id="derived" href="#base" spreadMethod="repeat"/>
      </defs>
      <rect width="10" height="10" fill="url(#derived)"/>
    </svg>`);
    expect(plan.elements[0]?.style.fill).toMatchObject({
      kind: 'gradient', spread: 'repeat', transform: { a: expect.closeTo(0.6, 12), tx: 0.2 },
      asset: { colorStops: [{ position: 0 }, { position: 1 }] }
    });
  });

  it('skips cyclic local gradient resources without losing supported geometry', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>
      <rect id="safe-shape" width="10" height="10" fill="url(#a)" stroke="black"/>
    </svg>`);
    expect(plan.elements[0]).toMatchObject({ name: 'safe-shape', style: { fill: null } });
    expect(plan.report.warnings).toContainEqual(expect.objectContaining({
      code: 'ignored-invalid-paint-server', element: 'safe-shape'
    }));
  });

  it.each([
    'https://example.test/gradient.svg#g',
    'file:///C:/secret.svg#g',
    'data:image/svg+xml;base64,PHN2Zy8+#g',
    '//example.test/gradient.svg#g'
  ])('rejects external gradient resources without loading them: %s', (reference) => {
    expect(() => importSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <rect width="10" height="10" fill="url(${reference})"/>
    </svg>`)).toThrowError(/External SVG URL/u);
  });

  it('rejects ambiguous duplicate local resource ids', () => {
    expect(() => importSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g"/><linearGradient id="g"/></defs>
      <rect width="10" height="10" fill="url(#g)"/>
    </svg>`)).toThrowError(/ambiguous/u);
  });

  it('supports relative path commands and smooth cubic reflection', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="m10 10 c5 0 5 10 10 10 s5 10 10 10 z"/></svg>');
    const path = plan.elements[0];
    expect(path).toMatchObject({ type: 'path', subpaths: [{ closed: true }] });
    if (path?.type !== 'path') throw new Error('Expected path.');
    expect(path.subpaths[0]!.anchors.map(({ position }) => position)).toEqual([
      { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }
    ]);
    expect(path.subpaths[0]!.anchors[1]!.handleOut).toEqual({ x: 25, y: 20 });
  });

  it('closes open filled contours using SVG implicit fill semantics', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path id="eye" d="M10 100 Q60 0 110 100" fill="#000"/></svg>');
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]).toMatchObject({
      type: 'path',
      name: 'eye',
      subpaths: [{ closed: true }],
      style: { fill: { type: 'solid' }, stroke: null }
    });
    expect(plan.report.conversions).toContainEqual(expect.objectContaining({
      code: 'implicit-fill-close',
      element: 'eye'
    }));
  });

  it('preserves an open SVG stroke separately from its implicitly closed fill', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path id="eye" d="M10 100 Q60 0 110 100" fill="#000" stroke="#f00" stroke-width="4"/></svg>');
    expect(plan.elements).toHaveLength(2);
    expect(plan.elements[0]).toMatchObject({
      type: 'path', name: 'eye', subpaths: [{ closed: true }],
      style: { fill: { type: 'solid' }, stroke: null }
    });
    expect(plan.elements[1]).toMatchObject({
      type: 'path', name: 'eye stroke', subpaths: [{ closed: false }],
      style: { fill: null, stroke: { width: 4 } }
    });
    expect(plan.report.conversions.map(({ code }) => code)).toEqual([
      'quadratic-to-cubic',
      'implicit-fill-close',
      'split-open-fill-and-stroke'
    ]);
  });

  it('keeps an explicit closepath as one path with joined fill and stroke geometry', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path id="closed" d="M0 0 C10 20 20 20 30 0 Z" fill="#000" stroke="#f00"/></svg>');
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]).toMatchObject({
      type: 'path', name: 'closed', subpaths: [{ closed: true }],
      style: { fill: { type: 'solid' }, stroke: { paint: { type: 'solid' } } }
    });
    expect(plan.report.conversions.map(({ code }) => code)).not.toContain('implicit-fill-close');
  });

  it('does not infer stroke closure when the final coordinate merely equals the initial coordinate', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path id="manual" d="M0 0 L30 0 L0 0" fill="#000" stroke="#f00"/></svg>');
    expect(plan.elements).toHaveLength(2);
    expect(plan.elements[0]).toMatchObject({ type: 'path', subpaths: [{ closed: true }] });
    expect(plan.elements[1]).toMatchObject({ type: 'path', subpaths: [{ closed: false }] });
  });

  it('leaves stroke-only open paths open', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path id="stroke" d="M0 0 Q20 30 40 0" fill="none" stroke="#000"/></svg>');
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]).toMatchObject({
      type: 'path', subpaths: [{ closed: false }], style: { fill: null, stroke: { width: 1 } }
    });
    expect(plan.report.conversions.map(({ code }) => code)).not.toContain('implicit-fill-close');
  });

  it('applies implicit fill closure independently to every open subpath', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path id="compound" d="M0 0 Q10 20 20 0 M30 0 Q40 20 50 0" fill="#000" fill-rule="evenodd"/></svg>');
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]).toMatchObject({
      type: 'path', fillRule: 'evenodd', subpaths: [{ closed: true }, { closed: true }]
    });
  });

  it('applies SVG implicit fill closure to polylines', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><polyline id="triangle" points="0,0 20,0 10,20" fill="#000"/></svg>');
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]).toMatchObject({
      type: 'path', name: 'triangle', subpaths: [{ closed: true }]
    });
  });

  it('skips object opacity that cannot be composited atomically and keeps supported siblings', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path id="unsupported" d="M0 0 Q10 20 20 0 Z" fill="#000" stroke="#f00" opacity=".5"/><rect id="visible" width="10" height="10"/></svg>');
    expect(plan.elements.map(({ name }) => name)).toEqual(['visible']);
    expect(plan.report.warnings).toContainEqual(expect.objectContaining({
      code: 'ignored-object-opacity', element: 'unsupported'
    }));
  });

  it.each([
    ['DTD', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'],
    ['script', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'],
    ['event handler', '<svg xmlns="http://www.w3.org/2000/svg"><path onclick="alert(1)" d="M0 0L1 1"/></svg>'],
    ['external reference', '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.test/a)" d="M0 0L1 1"/></svg>'],
    ['foreign object', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>'],
    ['CSS class', '<svg xmlns="http://www.w3.org/2000/svg"><path class="secret" d="M0 0L1 1"/></svg>'],
    ['non-scaling stroke', '<svg xmlns="http://www.w3.org/2000/svg"><path vector-effect="non-scaling-stroke" d="M0 0L1 1"/></svg>']
  ])('rejects active or ambiguous %s SVG semantics', (_name, value) => {
    expect(() => importSvg(value)).toThrow(SvgCodecError);
  });

  it('fails before publication when resource limits are exceeded', () => {
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>', {
      limits: { maxInputBytes: 12 }
    })).toThrow(/byte limit/u);
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><g><g><path d="M0 0L1 1"/></g></g></svg>', {
      limits: { maxDepth: 1 }
    })).toThrow(/depth limit/u);
  });

  it('skips group opacity that would change overlap compositing and keeps supported siblings', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="unsupported" opacity=".5"><rect width="10" height="10"/></g><circle id="visible" cx="5" cy="5" r="4"/></svg>');
    expect(plan.elements.map(({ name }) => name)).toEqual(['visible']);
    expect(plan.report.warnings).toContainEqual(expect.objectContaining({
      code: 'ignored-group-opacity', element: 'unsupported'
    }));
  });

  it('flattens an anchor container and explicitly discards navigation behavior', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.test" target="_blank"><path d="M0 0L10 10"/></a></svg>');
    expect(plan.elements).toHaveLength(1);
    expect(plan.report.conversions).toContainEqual(expect.objectContaining({
      code: 'flattened-link-container'
    }));
    expect(plan.report.warnings.filter(({ code }) => code === 'discarded-link-attribute'))
      .toHaveLength(2);
  });

  it('ignores non-rendering namespaced metadata from SVG authoring tools', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"
      xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
      sodipodi:version="0.32">
      <path sodipodi:nodetypes="cc" d="M0 0L10 10"/>
    </svg>`);
    expect(plan.elements).toHaveLength(1);
    expect(plan.report.warnings.filter(({ code }) => code === 'ignored-metadata-attribute'))
      .toHaveLength(2);
  });

  it('ignores foreign editor elements while importing supported SVG siblings', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"
      xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">
      <sodipodi:namedview id="editor-view"><sodipodi:guide position="1,2"/></sodipodi:namedview>
      <path id="visible" d="M0 0L10 10"/>
    </svg>`);
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]?.name).toBe('visible');
    expect(plan.report.warnings).toContainEqual(expect.objectContaining({
      code: 'ignored-foreign-element', element: 'editor-view'
    }));
  });

  it('skips unknown SVG subtrees without losing supported siblings', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <futureShape id="unknown"><path id="nested" d="M0 0L2 2"/></futureShape>
      <circle id="visible" cx="5" cy="5" r="4"/>
    </svg>`);
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]?.name).toBe('visible');
    expect(plan.report.warnings).toContainEqual(expect.objectContaining({
      code: 'ignored-unsupported-element', element: 'unknown'
    }));
  });

  it('skips known but unsupported passive elements and keeps supported siblings', () => {
    const plan = importSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <text x="1" y="2">Not editable yet</text>
      <rect id="visible" width="10" height="10"/>
    </svg>`);
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0]?.name).toBe('visible');
    expect(plan.report.warnings).toContainEqual(expect.objectContaining({
      code: 'ignored-unsupported-element', element: 'text'
    }));
  });

  it('still rejects references carried by a foreign namespace', () => {
    expect(() => importSvg(`<svg xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink">
      <path xlink:href="https://example.test/path" d="M0 0L10 10"/>
    </svg>`)).toThrow(/reference attribute/u);
  });

  it('enforces the configured serialized output limit', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    expect(() => exportSvg(plan.elements, { width: 10, height: 10,
      limits: { maxOutputBytes: 32 } })).toThrowError(/export exceeds the byte limit/i);
  });

  it('combines stroke paint alpha and stroke opacity into one SVG attribute', () => {
    const plan = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10" fill="none" stroke="rgba(0,0,255,.5)" stroke-opacity=".5"/></svg>');
    const output = exportSvg(plan.elements, { width: 20, height: 20 });
    expect(output.match(/stroke-opacity=/gu)).toHaveLength(1);
    expect(output).toContain('stroke-opacity="0.25"');
  });
});
