import { describe, expect, it } from 'vitest';
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

  it('rejects object opacity where fill and stroke overlap cannot be composited atomically', () => {
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 Q10 20 20 0 Z" fill="#000" stroke="#f00" opacity=".5"/></svg>'))
      .toThrowError(/object-level overlap compositing/u);
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

  it('rejects group opacity because flattening would change overlap compositing', () => {
    expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><g opacity=".5"><rect width="10" height="10"/></g></svg>'))
      .toThrow(/cannot be flattened/u);
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
