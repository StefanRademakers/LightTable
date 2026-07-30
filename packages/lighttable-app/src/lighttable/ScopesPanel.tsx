import React from 'react';
import { SegmentedControl, type SegmentedControlOption } from '../ui/SegmentedControl';
import { lightTableIcon } from '../assets/icons';
import { Histogram } from './Histogram';
import {
  skinToneReferenceEnd,
  vectorscopeTargetPositions,
  type ScopeSettings,
  type ScopeVisibility,
  type VectorscopeRange
} from './scopes';
import type { RgbHistogram } from './types';

interface ScopesPanelProps {
  containerRef: React.RefObject<HTMLElement | null>;
  visibility: ScopeVisibility;
  settings: ScopeSettings;
  histogram: RgbHistogram | null;
  hueDistributionCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  paradeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  vectorscopeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  error: string | null;
  onVisibilityChange: (scope: keyof ScopeVisibility, visible: boolean) => void;
  onSettingsChange: (settings: ScopeSettings) => void;
}

const VECTOR_RANGE_OPTIONS: Array<SegmentedControlOption<VectorscopeRange>> = [
  { value: 'all', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' }
];

const PERCENT_SCALE = ['100', '87.5', '75', '62.5', '50', '37.5', '25', '12.5', '0'];

interface ScopeSectionProps {
  title: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  children: React.ReactNode;
}

const ScopeSection: React.FC<ScopeSectionProps> = ({ title, visible, onVisibleChange, children }) => (
  <section className={`lighttable-scope${visible ? '' : ' lighttable-scope--collapsed'}`}>
    <button
      type="button"
      className="lighttable-scope__header"
      onClick={() => onVisibleChange(!visible)}
      aria-expanded={visible}
    >
      <span>
        <img src={lightTableIcon(visible ? 'area_open.png' : 'area_closed.png')} alt="" aria-hidden="true" />
        <strong>{title}</strong>
      </span>
      <span className="lighttable-scope__status">{visible ? 'On' : 'Off'}</span>
    </button>
    <div className="lighttable-scope__body" hidden={!visible}>{children}</div>
  </section>
);

export const ScopesPanel: React.FC<ScopesPanelProps> = ({
  containerRef,
  visibility,
  settings,
  histogram,
  hueDistributionCanvasRef,
  paradeCanvasRef,
  vectorscopeCanvasRef,
  error,
  onVisibilityChange,
  onSettingsChange
}) => {
  const targets = vectorscopeTargetPositions();
  const skinEnd = skinToneReferenceEnd();
  const update = <Key extends keyof ScopeSettings>(key: Key, value: ScopeSettings[Key]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <aside ref={containerRef} className="lighttable-scopes">
      <div className="lighttable-scopes__content">
        {error ? <div className="lighttable-scopes__error">{error}</div> : null}

        <ScopeSection
          title="Histogram"
          visible={visibility.histogram}
          onVisibleChange={(visible) => onVisibilityChange('histogram', visible)}
        >
          <Histogram histogram={histogram} />
        </ScopeSection>

        <ScopeSection
          title="Hue Distribution"
          visible={visibility.hueDistribution}
          onVisibleChange={(visible) => onVisibilityChange('hueDistribution', visible)}
        >
          <div className="lighttable-hue-distribution">
            <canvas
              ref={hueDistributionCanvasRef}
              className="lighttable-scope__canvas"
              aria-label="Hue Distribution"
            />
          </div>
        </ScopeSection>

        <ScopeSection
          title="RGB Parade"
          visible={visibility.parade}
          onVisibleChange={(visible) => onVisibilityChange('parade', visible)}
        >
          <div className="lighttable-parade">
            <div className="lighttable-parade__channels" aria-hidden="true"><span>R</span><span>G</span><span>B</span></div>
            <div className="lighttable-parade__plot">
              <div className="lighttable-parade__scale" aria-hidden="true">
                {PERCENT_SCALE.map((label) => <span key={label}>{label}</span>)}
              </div>
              <div className="lighttable-parade__canvas-wrap">
                <canvas ref={paradeCanvasRef} className="lighttable-scope__canvas" aria-label="RGB Parade" />
                <div className="lighttable-parade__grid" aria-hidden="true" />
              </div>
            </div>
          </div>
        </ScopeSection>

        <ScopeSection
          title="Vectorscope"
          visible={visibility.vectorscope}
          onVisibleChange={(visible) => onVisibilityChange('vectorscope', visible)}
        >
          <SegmentedControl
            className="lighttable-scope__range"
            value={settings.vectorscopeRange}
            options={VECTOR_RANGE_OPTIONS}
            onChange={(value) => update('vectorscopeRange', value)}
            ariaLabel="Vectorscope tonal range"
          />
          <div className="lighttable-vectorscope">
            <canvas ref={vectorscopeCanvasRef} className="lighttable-scope__canvas" aria-label="Vectorscope" />
            <svg className="lighttable-vectorscope__overlay" viewBox="0 0 100 100" aria-hidden="true">
              <g className="lighttable-vectorscope__graticule">
                  <circle cx="50" cy="50" r="49" />
                  <line x1="1" y1="50" x2="99" y2="50" />
                  <line x1="50" y1="1" x2="50" y2="99" />
                  {targets.map((target) => (
                    <g key={target.label}>
                      <circle cx={target.x * 100} cy={target.y * 100} r="2.2" />
                      <line x1={target.x * 100 - 2.8} y1={target.y * 100} x2={target.x * 100 + 2.8} y2={target.y * 100} />
                      <line x1={target.x * 100} y1={target.y * 100 - 2.8} x2={target.x * 100} y2={target.y * 100 + 2.8} />
                      <text x={target.x * 100 + 2.8} y={target.y * 100 - 2.8}>{target.label}</text>
                    </g>
                  ))}
              </g>
              <line
                className="lighttable-vectorscope__skin-line"
                x1="50"
                y1="50"
                x2={skinEnd.x * 100}
                y2={skinEnd.y * 100}
              />
            </svg>
          </div>
        </ScopeSection>
      </div>
    </aside>
  );
};
