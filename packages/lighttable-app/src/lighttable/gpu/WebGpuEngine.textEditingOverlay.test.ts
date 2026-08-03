import type { TextEditingOverlay } from '@lighttable/text-rendering';
import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';

const overlay: TextEditingOverlay = {
  layerId: 'text', resourceKey: 'text:layout:0:0', quads: [], lines: [], markers: []
};

describe('WebGpuEngine text editing overlay presentation', () => {
  it('invalidates only viewport presentation for geometry, selection and blink changes', () => {
    const invalidate = vi.fn();
    const requestRender = vi.fn();
    const engine = {
      textEditingOverlay: null,
      textCaretVisible: true,
      renderDirty: { invalidate },
      requestRender
    } as unknown as WebGpuEngine;
    const setOverlay = WebGpuEngine.prototype.setTextEditingOverlay.bind(engine);

    setOverlay(overlay, true);
    setOverlay(overlay, true);
    setOverlay(overlay, false);
    setOverlay({ ...overlay, resourceKey: 'text:layout:0:1' }, false);

    expect(invalidate.mock.calls).toEqual([
      ['viewport'], ['viewport'], ['viewport']
    ]);
    expect(requestRender).toHaveBeenCalledTimes(3);
  });
});
