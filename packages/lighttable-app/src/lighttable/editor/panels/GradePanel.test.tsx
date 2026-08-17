import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../../application/adjustments/groupVisibility';
import { AdjustmentPresentationStore } from '../../application/adjustments/adjustmentPresentationStore';
import { createDefaultAdjustments } from '../../types';
import { GradePanel, type GradePanelProps } from './GradePanel';
import { GradientMapPropertiesPanel } from './GradientMapPropertiesPanel';

const props = (globalGrade: boolean): GradePanelProps => {
  const noop = vi.fn();
  return {
    model: {
      adjustmentStore: new AdjustmentPresentationStore(createDefaultAdjustments()),
      metadata: null,
      visibility: { ...createDefaultGroupVisibility(), globalGrade },
      histogram: null,
      resetModifierActive: false,
      masterEnabled: globalGrade,
      colorMixerScopeContainerRef: { current: null },
      colorMixerHueCanvasRef: noop,
      pointColorPickerActive: false
    },
    commands: {
      resetAll: noop, toggleMasterEnabled: noop, toggleVisibility: noop, resetGroup: noop,
      beginAdjustment: noop, endAdjustment: noop, updateAdjustment: noop,
      resetAdjustment: noop, updateDetail: noop, resetDetailControl: noop, resetDetail: noop,
      updateColorMixer: noop, resetColorMixer: noop,
      addPointColorSample: noop, updatePointColorSample: noop,
      resetPointColorSample: noop, removePointColorSample: noop, togglePointColorPicker: noop,
      updateColorGradingWheel: noop, updateColorGradingLuminance: noop,
      updateColorGradingControl: noop, resetColorGradingControl: noop,
      resetColorGradingZone: noop, resetColorGradingLuminance: noop,
      updateCurve: noop, resetCurve: noop, updateGradientMap: noop, resetGradientMap: noop,
      updatePhotoshopAdjustment: noop, resetPhotoshopAdjustment: noop
    }
  };
};

describe('GradePanel', () => {
  it('uses Global Grade visibility for its master switch and omits Gradient Map', () => {
    const enabled = renderToStaticMarkup(<GradePanel {...props(true)} gradeTitle="Global Grade" />);
    const disabled = renderToStaticMarkup(<GradePanel {...props(false)} gradeTitle="Global Grade" />);

    expect(enabled).toContain('aria-label="Disable Global Grade"');
    expect(enabled).toContain('aria-label="Global Grade properties"');
    expect(enabled).toContain('<strong>Global Grade</strong>');
    expect(enabled).toContain('aria-checked="true"');
    expect(disabled).toContain('aria-label="Enable Global Grade"');
    expect(disabled).toContain('aria-checked="false"');
    expect(enabled).not.toContain('Gradient Map');
    expect(enabled).toContain('Point Color');
    expect(enabled).toContain('Texture / Clarity / Dehaze');
    expect(enabled).toContain('Sharpening');
    expect(enabled).toContain('Noise Reduction');
    expect(enabled).toContain('Color Noise Reduction');
    expect(enabled).toContain('>Amount<');
    expect(enabled).toContain('>Luminance<');
    expect(enabled).toContain('>Color<');
    expect(enabled).not.toContain('>Radius<');
  });

  it('retains Gradient Map as its focused adjustment editor', () => {
    const markup = renderToStaticMarkup(<GradientMapPropertiesPanel {...props(true)} />);

    expect(markup).toContain('aria-label="Gradient Map properties"');
    expect(markup).toContain('<strong>Gradient Map</strong>');
  });

  it.each(['Grade Layer', 'Local Grade'] as const)('presents the %s ownership context', (gradeTitle) => {
    const markup = renderToStaticMarkup(<GradePanel {...props(true)} gradeTitle={gradeTitle} />);

    expect(markup).toContain(`aria-label="${gradeTitle} properties"`);
    expect(markup).toContain(`<strong>${gradeTitle}</strong>`);
    expect(markup).toContain(`aria-label="Disable ${gradeTitle}"`);
  });
});
