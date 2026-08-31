import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../../application/adjustments/groupVisibility';
import { AdjustmentPresentationStore } from '../../application/adjustments/adjustmentPresentationStore';
import { createDefaultAdjustments } from '../../types';
import { CurvesPropertiesPanel } from './CurvesPropertiesPanel';

describe('CurvesPropertiesPanel', () => {
  it('renders only the focused Curves editor for a standalone node', () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(<CurvesPropertiesPanel
      model={{
        adjustmentStore: new AdjustmentPresentationStore(createDefaultAdjustments()),
        metadata: null,
        visibility: createDefaultGroupVisibility(),
        histogram: null,
        resetModifierActive: false,
        masterEnabled: true,
        colorMixerScopeContainerRef: { current: null },
        colorMixerHueCanvasRef: noop,
        pointColorPickerActive: false,
        pointColorRangeVisualizationActive: false
      }}
      commands={{
        resetAll: noop, toggleMasterEnabled: noop, toggleVisibility: noop, resetGroup: noop,
        updateDetail: noop, resetDetailControl: noop, resetDetail: noop,
        beginAdjustment: noop, endAdjustment: noop, updateAdjustment: noop,
        resetAdjustment: noop, updateColorMixer: noop, resetColorMixer: noop,
        setBlackWhiteMixEnabled: noop, updateBlackWhiteMix: noop, resetBlackWhiteMix: noop,
        setGradeLookAsset: noop, updateGradeLookStrength: noop, resetGradeLook: noop,
        addPointColorSample: noop, updatePointColorSample: noop,
        resetPointColorSample: noop, removePointColorSample: noop, togglePointColorPicker: noop,
        setPointColorRangeVisualization: noop,
        updateColorGradingWheel: noop, updateColorGradingLuminance: noop,
        updateColorGradingControl: noop, resetColorGradingControl: noop,
        resetColorGradingZone: noop, resetColorGradingLuminance: noop,
        updateCurve: noop, resetCurve: noop, updateGradientMap: noop, resetGradientMap: noop,
        updatePhotoshopAdjustment: noop, resetPhotoshopAdjustment: noop
      }}
    />);

    expect(markup).toContain('aria-label="Curves properties"');
    expect(markup).toContain('data-ui-component="panel-section-header"');
    expect(markup).toContain('>Curves</span>');
    expect(markup).toContain('RGB');
    expect(markup).not.toContain('Grade - All');
    expect(markup).not.toContain('Color Mixer');
  });
});
