import { FileField as PanelFileField, IconButton, MaskIcon, PanelSectionHeader,
  SelectField as PanelSelectField } from '@lighttable/ui';
import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider, type AdjustmentSliderTrack } from '../../../ui/AdjustmentSlider';
import { useGradePresentation } from '../../application/adjustments/adjustmentPresentationStore';
import {
  createDefaultPhotoshopAdjustment,
  type PhotoshopAdjustmentKind,
  type PhotoshopAdjustmentSettings
} from '../../photoshopAdjustments';
import type { GradePanelProps } from './GradePanel';
import { LevelsPropertiesPanel } from './LevelsPropertiesPanel';
import {
  PanelCheckboxField,
  PanelColorSwatch
} from '../../../ui/PanelControls';
import { COLOR_TEMPERATURE_RANGE } from '../config/adjustmentControls';

interface SliderSpec {
  readonly key: keyof PhotoshopAdjustmentSettings;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly format?: (value: number) => string;
  readonly track?: AdjustmentSliderTrack;
}

const percent = (value: number) => `${Math.round(value)}%`;
const FAMILY_SLIDERS: Partial<Record<PhotoshopAdjustmentKind, readonly SliderSpec[]>> = {
  'brightness-contrast': [
    { key: 'brightness', label: 'Brightness', min: -150, max: 150, track: 'luminance' },
    { key: 'contrast', label: 'Contrast', min: -50, max: 100, track: 'luminance' }
  ],
  exposure: [
    { key: 'exposure', label: 'Exposure', min: -20, max: 20, step: 0.01, format: (value) => value.toFixed(2), track: 'luminance' },
    { key: 'exposureOffset', label: 'Offset', min: -0.5, max: 0.5, step: 0.001, format: (value) => value.toFixed(3), track: 'luminance' },
    { key: 'exposureGamma', label: 'Gamma Correction', min: 0.01, max: 9.99, step: 0.01, format: (value) => value.toFixed(2), track: 'luminance' }
  ],
  vibrance: [
    { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, format: percent, track: 'vibrance' },
    { key: 'vibranceSaturation', label: 'Saturation', min: -100, max: 100, format: percent, track: 'saturation' }
  ],
  'color-vibrance': [
    { key: 'colorVibranceTemperature', label: 'Temperature', ...COLOR_TEMPERATURE_RANGE, track: 'temperature' },
    { key: 'colorVibranceTint', label: 'Tint', min: -100, max: 100, track: 'tint' },
    { key: 'colorVibranceVibrance', label: 'Vibrance', min: -100, max: 100, format: percent, track: 'vibrance' },
    { key: 'colorVibranceSaturation', label: 'Saturation', min: -100, max: 100, format: percent, track: 'saturation' }
  ],
  'hue-saturation': [
    { key: 'hue', label: 'Hue', min: -180, max: 180, format: (value) => `${Math.round(value)}°`, track: 'hue' },
    { key: 'hueSaturation', label: 'Saturation', min: -100, max: 100, format: percent, track: 'saturation' },
    { key: 'hueLightness', label: 'Lightness', min: -100, max: 100, format: percent, track: 'luminance' }
  ],
  'photo-filter': [
    { key: 'photoFilterDensity', label: 'Density', min: 1, max: 100, format: percent }
  ],
  posterize: [
    { key: 'posterizeLevels', label: 'Levels', min: 2, max: 255 }
  ],
  threshold: [
    { key: 'thresholdLevel', label: 'Threshold Level', min: 1, max: 255, track: 'luminance' }
  ]
};

const titleFor = (kind: PhotoshopAdjustmentKind) => ({
  'brightness-contrast': 'Brightness / Contrast', levels: 'Levels', exposure: 'Exposure',
  vibrance: 'Vibrance', 'color-vibrance': 'Color and Vibrance',
  'hue-saturation': 'Hue / Saturation', 'color-balance': 'Color Balance',
  'black-white': 'Black & White', 'photo-filter': 'Photo Filter',
  'channel-mixer': 'Channel Mixer', 'color-lookup': 'Color Lookup',
  'selective-color': 'Selective Color', invert: 'Invert', posterize: 'Posterize',
  threshold: 'Threshold'
}[kind]);

export const PhotoshopAdjustmentPropertiesPanel = ({
  kind,
  model,
  commands
}: GradePanelProps & { readonly kind: PhotoshopAdjustmentKind }) => {
  const adjustments = useGradePresentation(model.adjustmentStore);
  const settings = adjustments.photoshopAdjustment.kind === kind
    ? adjustments.photoshopAdjustment
    : createDefaultPhotoshopAdjustment(kind);
  const defaults = createDefaultPhotoshopAdjustment(kind);
  const sliders: readonly SliderSpec[] = kind === 'hue-saturation' && settings.colorize ? [
    { key: 'hue', label: 'Hue', min: 0, max: 360, format: (value) => `${Math.round(value)}°`, track: 'hue' },
    { key: 'hueSaturation', label: 'Saturation', min: 0, max: 100, format: percent, track: 'saturation' },
    { key: 'hueLightness', label: 'Lightness', min: -100, max: 100, format: percent, track: 'luminance' }
  ] : FAMILY_SLIDERS[kind] ?? [];
  const [lutError, setLutError] = React.useState<string | null>(null);
  const loadLut = async (file: File) => {
    if (!commands.loadColorLookup) return;
    setLutError(null);
    try {
      await commands.loadColorLookup(file);
    } catch (error) {
      setLutError(error instanceof Error ? error.message : 'The .cube LUT could not be loaded.');
    }
  };

  const update = (next: PhotoshopAdjustmentSettings) =>
    commands.updatePhotoshopAdjustment(next);
  const commit = (next: PhotoshopAdjustmentSettings) => {
    update(next);
    commands.endAdjustment();
  };
  if (kind === 'levels') {
    return <LevelsPropertiesPanel model={model} commands={commands} settings={settings} />;
  }
  const selectedHueRange = kind === 'hue-saturation' && !settings.colorize
    && settings.hueSaturationChannel !== 'master'
    ? settings.hueSaturationRanges[settings.hueSaturationChannel]
    : null;
  const scalarValue = (spec: SliderSpec, index: number) => {
    if (selectedHueRange) {
      if (spec.key === 'hue') return selectedHueRange.hue;
      if (spec.key === 'hueSaturation') return selectedHueRange.saturation;
      if (spec.key === 'hueLightness') return selectedHueRange.lightness;
    }
    const value = settings[spec.key];
    if (typeof value === 'number') return value;
    return 0;
  };
  const resetValue = (spec: SliderSpec, index: number) => {
    if (selectedHueRange && (spec.key === 'hue' || spec.key === 'hueSaturation' || spec.key === 'hueLightness')) {
      return 0;
    }
    const value = defaults[spec.key];
    if (typeof value === 'number') return value;
    return 0;
  };
  const updateScalar = (spec: SliderSpec, index: number, value: number) => {
    if (selectedHueRange) {
      const field = spec.key === 'hue' ? 'hue'
        : spec.key === 'hueSaturation' ? 'saturation'
          : spec.key === 'hueLightness' ? 'lightness' : null;
      if (field) {
        const channel = settings.hueSaturationChannel;
        if (channel === 'master') return;
        update({
          ...settings,
          hueSaturationRanges: {
            ...settings.hueSaturationRanges,
            [channel]: { ...selectedHueRange, [field]: value }
          }
        });
        return;
      }
    }
    update({ ...settings, [spec.key]: value });
  };
  const renderArraySliders = (
    values: readonly number[],
    labels: readonly string[],
    minimum: number,
    maximum: number,
    defaultsForArray: readonly number[],
    publish: (next: number[]) => void,
    tracks: readonly (AdjustmentSliderTrack | undefined)[] = []
  ) => labels.map((label, index) => (
    <AdjustmentSlider
      key={label}
      label={label}
      value={values[index] ?? 0}
      min={minimum}
      max={maximum}
      track={tracks[index]}
      resetValue={defaultsForArray[index] ?? 0}
      disabled={!model.metadata}
      resetModifierActive={model.resetModifierActive}
      onChange={(value) => {
        const next = [...values];
        next[index] = value;
        publish(next);
      }}
      onReset={() => {
        const next = [...values];
        next[index] = defaultsForArray[index] ?? 0;
        publish(next);
        commands.endAdjustment();
      }}
      onInteractionStart={commands.beginAdjustment}
      onInteractionEnd={commands.endAdjustment}
    />
  ));
  const balanceValues = settings.colorBalanceTone === 'shadows'
    ? settings.colorBalanceShadows
    : settings.colorBalanceTone === 'highlights'
      ? settings.colorBalanceHighlights
      : settings.colorBalanceMidtones;
  const channelMixerValues = settings.channelMixerOutput === 'red'
    ? settings.channelMixerRed
    : settings.channelMixerOutput === 'green'
      ? settings.channelMixerGreen
      : settings.channelMixerBlue;
  const selectiveOffset = settings.selectiveColorRange * 4;
  const selectiveValues = settings.selectiveColorValues.slice(selectiveOffset, selectiveOffset + 4);

  return (
    <aside className="lighttable-panel lighttable-grade-panel" aria-label={`${titleFor(kind)} properties`}>
      <section className="lighttable-group lighttable-master-group">
        <PanelSectionHeader label={titleFor(kind)} actions={<>
            <IconButton variant="quiet" type="button" onClick={commands.resetPhotoshopAdjustment} aria-label={`Reset ${titleFor(kind)}`} title={`Reset ${titleFor(kind)}`} icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
          </>} />
      </section>
      <div className="lighttable-panel__controls">
        <section className="lighttable-group">
          <div className="lighttable-group__controls lighttable-property-stack">
            {kind === 'hue-saturation' && !settings.colorize ? (
              <PanelSelectField label="Range" value={settings.hueSaturationChannel}
                options={['master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((value) => ({
                  value, label: `${value[0].toUpperCase()}${value.slice(1)}`
                }))}
                onChange={(hueSaturationChannel) => commit({
                  ...settings,
                  hueSaturationChannel: hueSaturationChannel as PhotoshopAdjustmentSettings['hueSaturationChannel']
                })} />
            ) : null}
            {sliders.map((slider, index) => (
              <AdjustmentSlider
                key={`${slider.key}-${slider.label}`}
                label={slider.label}
                value={scalarValue(slider, index)}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                format={slider.format}
                track={slider.track}
                resetValue={resetValue(slider, index)}
                disabled={!model.metadata}
                resetModifierActive={model.resetModifierActive}
                onChange={(value) => updateScalar(slider, index, value)}
                onReset={() => {
                  updateScalar(slider, index, resetValue(slider, index));
                  commands.endAdjustment();
                }}
                onInteractionStart={commands.beginAdjustment}
                onInteractionEnd={commands.endAdjustment}
              />
            ))}
            {kind === 'brightness-contrast' ? (
              <PanelCheckboxField label="Use Legacy" checked={settings.useLegacyBrightnessContrast}
                onChange={(useLegacyBrightnessContrast) => commit({ ...settings, useLegacyBrightnessContrast })} />
            ) : null}
            {kind === 'hue-saturation' ? (
              <PanelCheckboxField label="Colorize" checked={settings.colorize}
                onChange={(colorize) => commit({ ...settings, colorize })} />
            ) : null}
            {kind === 'color-balance' ? <>
              <PanelSelectField label="Tone" value={settings.colorBalanceTone}
                options={['shadows', 'midtones', 'highlights'].map((value) => ({
                  value, label: `${value[0].toUpperCase()}${value.slice(1)}`
                }))}
                onChange={(colorBalanceTone) => commit({ ...settings, colorBalanceTone: colorBalanceTone as PhotoshopAdjustmentSettings['colorBalanceTone'] })} />
              {renderArraySliders(balanceValues, ['Cyan / Red', 'Magenta / Green', 'Yellow / Blue'], -100, 100, [0, 0, 0], (next) => {
                const key = settings.colorBalanceTone === 'shadows' ? 'colorBalanceShadows'
                  : settings.colorBalanceTone === 'highlights' ? 'colorBalanceHighlights'
                    : 'colorBalanceMidtones';
                update({ ...settings, [key]: next as PhotoshopAdjustmentSettings[typeof key] });
              }, ['cyan-red', 'magenta-green', 'yellow-blue'])}
              <PanelCheckboxField label="Preserve Luminosity" checked={settings.preserveLuminosity}
                onChange={(preserveLuminosity) => commit({ ...settings, preserveLuminosity })} />
            </> : null}
            {kind === 'black-white' ? <>
              {renderArraySliders(settings.blackWhiteMix, ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'], -200, 300, defaults.blackWhiteMix, (next) => update({ ...settings, blackWhiteMix: next as PhotoshopAdjustmentSettings['blackWhiteMix'] }), ['luminance', 'luminance', 'luminance', 'luminance', 'luminance', 'luminance'])}
              <PanelCheckboxField label="Tint" checked={settings.blackWhiteTint}
                onChange={(blackWhiteTint) => commit({ ...settings, blackWhiteTint })} />
              {settings.blackWhiteTint ? <PanelColorSwatch label="Tint color" value={settings.blackWhiteTintColor}
                onChange={(blackWhiteTintColor) => update({ ...settings, blackWhiteTintColor })}
                onInteractionStart={commands.beginAdjustment}
                onInteractionCommit={commands.endAdjustment}
                onInteractionCancel={commands.endAdjustment} /> : null}
            </> : null}
            {kind === 'photo-filter' ? <>
              <PanelColorSwatch label="Color" value={settings.photoFilterColor}
                onChange={(photoFilterColor) => update({ ...settings, photoFilterColor })}
                onInteractionStart={commands.beginAdjustment}
                onInteractionCommit={commands.endAdjustment}
                onInteractionCancel={commands.endAdjustment} />
              <PanelCheckboxField label="Preserve Luminosity" checked={settings.preserveLuminosity}
                onChange={(preserveLuminosity) => commit({ ...settings, preserveLuminosity })} />
            </> : null}
            {kind === 'channel-mixer' ? <>
              <PanelSelectField label="Output Channel" value={settings.channelMixerOutput}
                options={['red', 'green', 'blue'].map((value) => ({ value, label: `${value[0].toUpperCase()}${value.slice(1)}` }))}
                onChange={(channelMixerOutput) => commit({ ...settings, channelMixerOutput: channelMixerOutput as PhotoshopAdjustmentSettings['channelMixerOutput'] })} />
              {renderArraySliders(channelMixerValues, ['Red', 'Green', 'Blue', 'Constant'], -200, 200, settings.channelMixerOutput === 'red' ? defaults.channelMixerRed : settings.channelMixerOutput === 'green' ? defaults.channelMixerGreen : defaults.channelMixerBlue, (next) => {
                const key = settings.channelMixerOutput === 'red' ? 'channelMixerRed'
                  : settings.channelMixerOutput === 'green' ? 'channelMixerGreen' : 'channelMixerBlue';
                update({ ...settings, [key]: next as PhotoshopAdjustmentSettings[typeof key] });
              }, ['cyan-red', 'magenta-green', 'yellow-blue', 'luminance'])}
              <PanelCheckboxField label="Monochrome" checked={settings.channelMixerMonochrome}
                onChange={(channelMixerMonochrome) => commit({ ...settings, channelMixerMonochrome })} />
            </> : null}
            {kind === 'selective-color' ? <>
              <PanelSelectField label="Colors" value={String(settings.selectiveColorRange)}
                options={['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas', 'Whites', 'Neutrals', 'Blacks'].map((label, value) => ({ value: String(value), label }))}
                onChange={(selectiveColorRange) => commit({ ...settings, selectiveColorRange: Number(selectiveColorRange) })} />
              {renderArraySliders(selectiveValues, ['Cyan', 'Magenta', 'Yellow', 'Black'], -100, 100, [0, 0, 0, 0], (next) => {
                const selectiveColorValues = [...settings.selectiveColorValues];
                next.forEach((value, index) => { selectiveColorValues[selectiveOffset + index] = value; });
                update({ ...settings, selectiveColorValues });
              }, ['red-cyan', 'green-magenta', 'blue-yellow', 'white-black'])}
              <PanelSelectField label="Method" value={settings.selectiveColorMethod}
                options={[{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }]}
                onChange={(selectiveColorMethod) => commit({ ...settings, selectiveColorMethod: selectiveColorMethod as PhotoshopAdjustmentSettings['selectiveColorMethod'] })} />
            </> : null}
            {kind === 'invert' ? <p className="lighttable-panel__hint">Invert has no adjustment controls.</p> : null}
            {kind === 'color-lookup' ? <>
              <PanelSelectField label="Look"
                value={settings.colorLookupAssetId
                  ? `asset:${settings.colorLookupAssetId}`
                  : `preset:${settings.colorLookupPreset}`}
                options={[
                  { value: 'preset:none', label: 'None' },
                  { value: 'preset:film-stock', label: 'Film Stock' },
                  { value: 'preset:moonlight', label: 'Moonlight' },
                  { value: 'preset:teal-orange', label: 'Teal & Orange' },
                  ...(model.colorLookupAssets ?? []).map((asset) => ({
                    value: `asset:${asset.id}`,
                    label: asset.name
                  }))
                ]}
                onChange={(value) => commit(value.startsWith('asset:') ? {
                  ...settings,
                  colorLookupPreset: 'none',
                  colorLookupAssetId: value.slice(6)
                } : {
                  ...settings,
                  colorLookupPreset: value.slice(7) as PhotoshopAdjustmentSettings['colorLookupPreset'],
                  colorLookupAssetId: null
                })} />
              <PanelFileField label="3D LUT"
                buttonLabel={lutError ? 'Could not load' : 'Load .cube...'}
                accept=".cube"
                title={lutError ?? 'Choose or drop a 3D .cube LUT'}
                disabled={!commands.loadColorLookup}
                onFile={loadLut}
                onRejected={() => setLutError('Choose a 3D .cube LUT file.')} />
            </> : null}
          </div>
        </section>
      </div>
    </aside>
  );
};
