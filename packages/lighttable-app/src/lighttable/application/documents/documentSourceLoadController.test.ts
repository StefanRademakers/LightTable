import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentSourceLoadController,
  type DocumentSourceLoadControllerPort
} from './documentSourceLoadController';
import { createDefaultAdjustments } from '../../types';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';

const createRequest = () => ({
  blob: new Blob(['fixture'], { type: 'image/png' }),
  name: 'fixture.png',
  cacheKey: 'fixture-cache',
  sourceIdentity: 'fixture-source',
  decodeMode: 'fast' as const,
  initialAdjustments: createDefaultAdjustments()
});

describe('createDocumentSourceLoadController', () => {
  it('does not begin source work without a renderer', async () => {
    const getPublicationPorts = vi.fn();
    const port = {
      getRenderer: () => null,
      getRendererGeneration: () => 0,
      getGroupVisibility: createDefaultGroupVisibility,
      getPublicationPorts
    } satisfies DocumentSourceLoadControllerPort;

    await expect(
      createDocumentSourceLoadController(port).load(createRequest())
    ).resolves.toBe(false);
    expect(getPublicationPorts).not.toHaveBeenCalled();
  });

  it('does not begin source work for an already canceled generation', async () => {
    const getPublicationPorts = vi.fn();
    const port = {
      getRenderer: () => ({}) as ReturnType<
        DocumentSourceLoadControllerPort['getRenderer']
      >,
      getRendererGeneration: () => 1,
      getGroupVisibility: createDefaultGroupVisibility,
      getPublicationPorts
    } satisfies DocumentSourceLoadControllerPort;

    await expect(
      createDocumentSourceLoadController(port).load({
        ...createRequest(),
        isCanceled: () => true
      })
    ).resolves.toBe(false);
    expect(getPublicationPorts).not.toHaveBeenCalled();
  });

  it('invalidates source publication when the shared renderer generation changes', async () => {
    const renderer = {} as NonNullable<ReturnType<DocumentSourceLoadControllerPort['getRenderer']>>;
    let generation = 4;
    const prepareAndPublish = vi.fn(async (request) => {
      expect(request.isCanceled?.()).toBe(false);
      generation = 5;
      expect(request.isCanceled?.()).toBe(true);
      return false;
    });
    const port = {
      getRenderer: () => renderer,
      getRendererGeneration: () => generation,
      getGroupVisibility: createDefaultGroupVisibility,
      getPublicationPorts: () => ({}) as never
    } satisfies DocumentSourceLoadControllerPort;

    await expect(createDocumentSourceLoadController(port, prepareAndPublish)
      .load(createRequest())).resolves.toBe(false);
    expect(prepareAndPublish).toHaveBeenCalledOnce();
  });

  it('invalidates source publication when the renderer instance is replaced', async () => {
    const first = {} as NonNullable<ReturnType<DocumentSourceLoadControllerPort['getRenderer']>>;
    const second = {} as NonNullable<ReturnType<DocumentSourceLoadControllerPort['getRenderer']>>;
    let renderer = first;
    const prepareAndPublish = vi.fn(async (request) => {
      renderer = second;
      expect(request.isCanceled?.()).toBe(true);
      return false;
    });
    const port = {
      getRenderer: () => renderer,
      getRendererGeneration: () => 1,
      getGroupVisibility: createDefaultGroupVisibility,
      getPublicationPorts: () => ({}) as never
    } satisfies DocumentSourceLoadControllerPort;

    await expect(createDocumentSourceLoadController(port, prepareAndPublish)
      .load(createRequest())).resolves.toBe(false);
  });
});
