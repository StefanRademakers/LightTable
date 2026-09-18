import { describe, expect, it } from 'vitest';
import { calculateWorkspaceFloatingPlacement } from './workspaceFloatingPlacement';

describe('calculateWorkspaceFloatingPlacement', () => {
  it('uses the same bounded result for preview and final floating placement', () => {
    expect(calculateWorkspaceFloatingPlacement({
      workspaceWidth: 1200,
      workspaceHeight: 800,
      requestedWidth: 260,
      pointerX: 680,
      pointerY: 330,
      minimumWidth: 250,
      maximumWidth: 520
    })).toEqual({ x: 640, y: 315, width: 260, height: 480 });
  });

  it('keeps a large panel recoverable near the workspace edge', () => {
    expect(calculateWorkspaceFloatingPlacement({
      workspaceWidth: 700,
      workspaceHeight: 500,
      requestedWidth: 900,
      pointerX: 698,
      pointerY: 498,
      minimumWidth: 250,
      maximumWidth: 520
    })).toEqual({ x: 180, y: 200, width: 520, height: 300 });
  });
});
