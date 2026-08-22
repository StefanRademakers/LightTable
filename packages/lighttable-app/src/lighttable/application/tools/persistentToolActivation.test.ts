import { describe, expect, it } from 'vitest';
import { planPersistentToolActivation } from './persistentToolActivation';

describe('planPersistentToolActivation', () => {
  it('activates an ordinary persistent tool directly', () => {
    expect(planPersistentToolActivation('view', 'brush', false)).toEqual({
      finishTransform: false,
      restartTransform: false,
      nextTool: 'brush'
    });
  });

  it('does not churn state when the requested tool is already active', () => {
    expect(planPersistentToolActivation('brush', 'brush', false)).toEqual({
      finishTransform: false,
      restartTransform: false,
      nextTool: null
    });
  });

  it('commits an active transform before switching tools', () => {
    expect(planPersistentToolActivation('transform', 'erase', true)).toEqual({
      finishTransform: true,
      restartTransform: false,
      nextTool: 'erase'
    });
  });

  it('treats a repeated transform activation as commit', () => {
    expect(planPersistentToolActivation('transform', 'transform', true)).toEqual({
      finishTransform: true,
      restartTransform: false,
      nextTool: null
    });
  });

  it('allows a pending transform launch to be cancelled by the effect lifecycle', () => {
    expect(planPersistentToolActivation('transform', 'view', false)).toEqual({
      finishTransform: false,
      restartTransform: false,
      nextTool: 'view'
    });
  });

  it('restarts an inactive transform tool without churning global tool state', () => {
    expect(planPersistentToolActivation('transform', 'transform', false)).toEqual({
      finishTransform: false,
      restartTransform: true,
      nextTool: null
    });
  });
});
