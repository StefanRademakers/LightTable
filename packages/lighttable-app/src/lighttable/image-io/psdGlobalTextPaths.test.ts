import { describe, expect, it } from 'vitest';
import type { Psd } from 'ag-psd';
import { parsePsdGlobalEngineData, recoverPsdGlobalTextPaths } from './psdGlobalTextPaths';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('PSD global text paths', () => {
  it('tolerates escaped Photoshop byte strings without a UTF-16 BOM', () => {
    const parsed = parsePsdGlobalEngineData(bytes('/0 << /98 (plain\\)text) >>'));
    expect(parsed).toEqual({ '0': { '98': 'plain)text' } });
  });

  it('reattaches a TextFrameSet cubic path to its indexed text layer', () => {
    const engine = [
      '/0 << /8 << /0 [ << /0 <<',
      '/1 << /0 [ 10 20 30 40 50 60 70 80 ] >>',
      '/2 << /0 2 /1 0 /2 [ 1 0 0 1 -10 -20 ] /6 [ 0 1 ] /11 << /0 true >> >>',
      '>> >> ] >> >>'
    ].join(' ');
    const text = { index: 0, text: 'Path text' };
    const psd = {
      width: 100,
      height: 100,
      engineData: btoa(engine),
      children: [{ name: 'Path text', text }]
    } as unknown as Psd;

    expect(recoverPsdGlobalTextPaths(psd)).toBe(1);
    expect(text).toMatchObject({
      textPath: {
        bezierCurve: { controlPoints: [10, 20, 30, 40, 50, 60, 70, 80] },
        data: {
          type: 2,
          frameMatrix: [1, 0, 0, 1, -10, -20],
          textRange: [0, 1],
          pathData: { reversed: true }
        }
      }
    });
  });
});
