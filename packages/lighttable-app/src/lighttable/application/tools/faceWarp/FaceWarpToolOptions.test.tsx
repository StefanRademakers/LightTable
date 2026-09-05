import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultFaceWarpParameters } from '../../../effects/faceWarp/faceWarpTypes';
import { FaceWarpToolOptions, type FaceWarpToolOptionsProps } from './FaceWarpToolOptions';

const pendingFace = {
  id: 'face-1',
  confidence: 0.8,
  landmarks: {
    mesh: [], faceTop: { x: 0, y: 0 }, chin: { x: 0, y: 1 },
    leftCheek: { x: 0, y: 0 }, rightCheek: { x: 1, y: 0 },
    leftEye: { x: 0, y: 0 }, rightEye: { x: 1, y: 0 },
    noseTop: { x: 0, y: 0 }, noseTip: { x: 0, y: 0 },
    noseLeft: { x: 0, y: 0 }, noseRight: { x: 1, y: 0 },
    mouthLeft: { x: 0, y: 0 }, mouthRight: { x: 1, y: 0 },
    mouthTop: { x: 0, y: 0 }, mouthBottom: { x: 0, y: 1 }
  },
  parameters: createDefaultFaceWarpParameters()
};

const props = (): FaceWarpToolOptionsProps => ({
  faces: [pendingFace], selectedFaceId: pendingFace.id, busy: false,
  reviewPending: true,
  meshVisible: true, brushSize: 100, brushStrength: 0.35,
  semanticTarget: 'both', protectedFeature: 'eyes',
  onDetect: vi.fn(), onAcceptDetection: vi.fn(), onCancelDetection: vi.fn(),
  onSelectFace: vi.fn(), onMeshVisibleChange: vi.fn(), onBrushChange: vi.fn(),
  onSemanticTargetChange: vi.fn(), onProtectedFeatureChange: vi.fn(),
  onProtectionChange: vi.fn(), onParametersChange: vi.fn(),
  onInteractionStart: vi.fn(), onInteractionEnd: vi.fn(),
  onInteractionCancel: vi.fn(), onReset: vi.fn()
});

describe('FaceWarpToolOptions mesh review', () => {
  it('requires an explicit decision before editing controls are exposed', () => {
    const markup = renderToStaticMarkup(<FaceWarpToolOptions {...props()} />);
    expect(markup).toContain('Check that the mesh follows the face.');
    expect(markup).toContain('Accept mesh');
    expect(markup).toContain('Cancel');
    expect(markup).not.toContain('Sculpt');
    expect(markup).not.toContain('Reset face');
  });
});
