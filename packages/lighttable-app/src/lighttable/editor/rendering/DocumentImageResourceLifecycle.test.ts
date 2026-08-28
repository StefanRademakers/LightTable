import { describe, expect, it, vi } from 'vitest';
import { DocumentImageResourceLifecycle } from './DocumentImageResourceLifecycle';
import { DocumentResourceState } from './DocumentResourceState';

describe('DocumentImageResourceLifecycle', () => {
  it('invalidates pending work before replacing resources and dimensions', () => {
    const resourceState = new DocumentResourceState();
    resourceState.setDimensions(640, 480);
    const generation = resourceState.generation();
    const observations: string[] = [];
    const lifecycle = new DocumentImageResourceLifecycle({
      resourceState,
      maximumTextureDimension: 16_384,
      teardown: [
        () => {
          observations.push(
            `${resourceState.isCurrent(generation)}:${resourceState.dimensions().width}`
          );
        }
      ]
    });

    lifecycle.begin(1920, 1080);

    expect(observations).toEqual(['false:640']);
    expect(resourceState.dimensions()).toEqual({ width: 1920, height: 1080 });
  });

  it('runs every registered teardown action in stable order', () => {
    const resourceState = new DocumentResourceState();
    const first = vi.fn();
    const second = vi.fn();
    const lifecycle = new DocumentImageResourceLifecycle({
      resourceState,
      maximumTextureDimension: 16_384,
      teardown: [first, second]
    });

    lifecycle.destroy();

    expect(first.mock.invocationCallOrder[0]).toBeLessThan(
      second.mock.invocationCallOrder[0]
    );
    expect(resourceState.generation()).toBe(1);
  });

  it('rejects dimensions beyond the adapter limit before tearing down the current image', () => {
    const resourceState = new DocumentResourceState();
    resourceState.setDimensions(640, 480);
    const teardown = vi.fn();
    const lifecycle = new DocumentImageResourceLifecycle({
      resourceState,
      maximumTextureDimension: 8_192,
      teardown: [teardown]
    });

    expect(() => lifecycle.begin(8_193, 100)).toThrow(/8,?192-pixel texture limit/);
    expect(teardown).not.toHaveBeenCalled();
    expect(resourceState.dimensions()).toEqual({ width: 640, height: 480 });
  });
});
