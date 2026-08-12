export interface SnapSettings {
  enabled: boolean;
  targets: {
    guides: boolean;
    grid: boolean;
    layers: boolean;
    documentBounds: boolean;
  };
  extrasVisible: boolean;
  smartGuidesVisible: boolean;
  guidesVisible: boolean;
  gridVisible: boolean;
  rulersVisible: boolean;
  guidesLocked: boolean;
  gridSpacing: number;
  gridSubdivisions: number;
  gridOriginX: number;
  gridOriginY: number;
}

export const createDefaultSnapSettings = (): SnapSettings => ({
  enabled: true,
  targets: {
    guides: true,
    grid: false,
    layers: true,
    documentBounds: true
  },
  extrasVisible: true,
  smartGuidesVisible: true,
  guidesVisible: true,
  gridVisible: false,
  rulersVisible: false,
  guidesLocked: false,
  gridSpacing: 100,
  gridSubdivisions: 10,
  gridOriginX: 0,
  gridOriginY: 0
});
