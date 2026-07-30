import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import {
  resetDocumentOpenPresentation,
  type DocumentOpenPresentationResetPort
} from './resetDocumentOpenPresentation';

describe('resetDocumentOpenPresentation', () => {
  it('applies every reset concern in application-owned order', () => {
    const calls: string[] = [];
    const record = (name: string) => vi.fn(() => {
      calls.push(name);
    });
    const port: DocumentOpenPresentationResetPort = {
      resetTelemetry: record('telemetry'),
      resetSource: record('source'),
      resetDocument: record('document'),
      resetSelection: record('selection'),
      resetLensBlur: record('lens blur'),
      publishAdjustments: record('adjustments'),
      resetHistory: record('history'),
      resetViewport: record('viewport'),
      resetScopes: record('scopes'),
      resetDiagnostics: record('diagnostics'),
      publishGroupVisibility: record('group visibility')
    };

    const state = resetDocumentOpenPresentation({ port });

    expect(calls).toEqual([
      'telemetry',
      'source',
      'document',
      'selection',
      'lens blur',
      'adjustments',
      'history',
      'viewport',
      'scopes',
      'diagnostics',
      'group visibility'
    ]);
    expect(port.resetSelection).toHaveBeenCalledWith(state.editorSession);
    expect(port.publishAdjustments).toHaveBeenCalledWith(state.adjustments);
    expect(port.resetScopes).toHaveBeenCalledWith(
      state.scopeSettings,
      state.scopeVisibility
    );
    expect(port.publishGroupVisibility).toHaveBeenCalledWith(
      state.groupVisibility
    );
  });

  it('clones initial adjustments before publishing them', () => {
    const initialAdjustments = createDefaultAdjustments();
    const port: DocumentOpenPresentationResetPort = {
      resetTelemetry: vi.fn(),
      resetSource: vi.fn(),
      resetDocument: vi.fn(),
      resetSelection: vi.fn(),
      resetLensBlur: vi.fn(),
      publishAdjustments: vi.fn(),
      resetHistory: vi.fn(),
      resetViewport: vi.fn(),
      resetScopes: vi.fn(),
      resetDiagnostics: vi.fn(),
      publishGroupVisibility: vi.fn()
    };

    const state = resetDocumentOpenPresentation({
      initialAdjustments,
      port
    });

    expect(state.adjustments).toEqual(initialAdjustments);
    expect(state.adjustments).not.toBe(initialAdjustments);
  });
});
