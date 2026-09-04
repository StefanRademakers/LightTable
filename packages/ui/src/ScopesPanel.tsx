import { PanelSection } from './PanelSection';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import React from 'react';

import { SwitchControl } from './SwitchControl';
import { Histogram } from './Histogram';
import type { RgbHistogram } from './Histogram';

export interface ScopeVisibility { histogram: boolean; hueDistribution: boolean; parade: boolean; vectorscope: boolean; }
export type VectorscopeRange = 'all' | 'low' | 'mid' | 'high';
export interface ScopePoint { x: number; y: number; }

export interface ScopesPanelProps {
  containerRef: React.RefObject<HTMLElement | null>;
  visibility: ScopeVisibility;
  range: VectorscopeRange;
  targets: ReadonlyArray<ScopePoint & { label: string }>;
  skinEnd: ScopePoint;
  graticule?: boolean;
  skinTone?: boolean;
  histogram: RgbHistogram | null;
  hueDistributionCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  paradeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  vectorscopeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onCanvasesReady?: () => void;
  error: string | null;
  onVisibilityChange: (scope: keyof ScopeVisibility, visible: boolean) => void;
  onRangeChange: (range: VectorscopeRange) => void;
}

const VECTOR_RANGE_OPTIONS: Array<SegmentOption<VectorscopeRange>> = [
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
  <PanelSection label={title} expanded={visible} onExpandedChange={onVisibleChange}
    keepMounted padding="none" contentClassName="ui-scope__body" actions={
      <SwitchControl
        checked={visible}
        onCheckedChange={onVisibleChange}
        label={`${visible ? 'Disable' : 'Enable'} ${title}`}
      />
    }>{children}</PanelSection>
);

export const ScopesPanel: React.FC<ScopesPanelProps> = ({
  containerRef,
  visibility,
  range, targets, skinEnd, graticule = true, skinTone = true,
  histogram,
  hueDistributionCanvasRef,
  paradeCanvasRef,
  vectorscopeCanvasRef,
  onCanvasesReady,
  error,
  onVisibilityChange,
  onRangeChange
}) => {
  React.useLayoutEffect(() => {
    const notifyWhenReady = () => {
      const canvases = [
        hueDistributionCanvasRef.current,
        paradeCanvasRef.current,
        vectorscopeCanvasRef.current
      ];
      if (
        canvases.every((canvas) => Boolean(canvas))
        && canvases.some((canvas) => {
          const bounds = canvas!.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        })
      ) onCanvasesReady?.();
    };
    notifyWhenReady();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(notifyWhenReady);
    [
      hueDistributionCanvasRef.current,
      paradeCanvasRef.current,
      vectorscopeCanvasRef.current
    ].forEach((canvas) => {
      if (canvas) observer.observe(canvas);
    });
    return () => observer.disconnect();
  }, [hueDistributionCanvasRef, onCanvasesReady, paradeCanvasRef, vectorscopeCanvasRef]);

  return (
    <aside ref={containerRef} className="ui-scopes" data-ui-component="scopes" data-suite-control="scopes">
      <div className="ui-scopes__content">
        {error ? <div className="ui-scopes__error">{error}</div> : null}

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
          <div className="ui-hue-distribution">
            <canvas
              ref={hueDistributionCanvasRef}
              className="ui-scope__canvas"
              aria-label="Hue Distribution"
            />
          </div>
        </ScopeSection>

        <ScopeSection
          title="RGB Parade"
          visible={visibility.parade}
          onVisibleChange={(visible) => onVisibilityChange('parade', visible)}
        >
          <div className="ui-parade">
            <div className="ui-parade__channels" aria-hidden="true"><span>R</span><span>G</span><span>B</span></div>
            <div className="ui-parade__plot">
              <div className="ui-parade__scale" aria-hidden="true">
                {PERCENT_SCALE.map((label) => <span key={label}>{label}</span>)}
              </div>
              <div className="ui-parade__canvas-wrap">
                <canvas ref={paradeCanvasRef} className="ui-scope__canvas" aria-label="RGB Parade" />
                <div className="ui-parade__grid" aria-hidden="true" />
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
            className="ui-scope__range"
            value={range}
            options={VECTOR_RANGE_OPTIONS}
            onChange={onRangeChange}
            label="Vectorscope tonal range"
          />
          <div className="ui-vectorscope">
            <canvas ref={vectorscopeCanvasRef} className="ui-scope__canvas" aria-label="Vectorscope" />
            <svg className="ui-vectorscope__overlay" viewBox="0 0 100 100" aria-hidden="true">
              <g className="ui-vectorscope__graticule" visibility={graticule ? undefined : 'hidden'}>
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
                className="ui-vectorscope__skin-line"
                visibility={skinTone ? undefined : 'hidden'}
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
