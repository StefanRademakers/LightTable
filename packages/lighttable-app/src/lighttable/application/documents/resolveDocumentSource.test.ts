import { describe, expect, it, vi } from 'vitest';
import { resolveDocumentSource } from './resolveDocumentSource';

describe('resolveDocumentSource', () => {
  it('prefers explicit inline bytes without invoking the host', async () => {
    const inlineSource = new Blob(['local']);
    const loadSource = vi.fn();

    await expect(resolveDocumentSource({
      inlineSource,
      projectId: 'project',
      sourceFileKey: 'remote.png',
      loadSource
    }, new AbortController().signal)).resolves.toBe(inlineSource);
    expect(loadSource).not.toHaveBeenCalled();
  });

  it('resolves a persistent host source handle', async () => {
    const source = new Blob(['remote']);
    const loadSource = vi.fn().mockResolvedValue(source);
    const controller = new AbortController();

    await expect(resolveDocumentSource({
      inlineSource: null,
      projectId: 'project',
      sourceFileKey: 'remote.png',
      loadSource
    }, controller.signal)).resolves.toBe(source);
    expect(loadSource).toHaveBeenCalledWith({
      projectId: 'project',
      sourceFileKey: 'remote.png',
      signal: controller.signal
    });
  });

  it('reports missing source and missing host capabilities distinctly', async () => {
    const signal = new AbortController().signal;

    await expect(resolveDocumentSource({
      inlineSource: null,
      projectId: 'project',
      sourceFileKey: null
    }, signal)).rejects.toThrow('No source image was supplied');
    await expect(resolveDocumentSource({
      inlineSource: null,
      projectId: 'project',
      sourceFileKey: 'remote.png'
    }, signal)).rejects.toThrow('host cannot read');
  });

  it('does not start host work after cancellation', async () => {
    const controller = new AbortController();
    const loadSource = vi.fn();
    controller.abort(new Error('canceled'));

    await expect(resolveDocumentSource({
      inlineSource: null,
      projectId: 'project',
      sourceFileKey: 'remote.png',
      loadSource
    }, controller.signal)).rejects.toThrow('canceled');
    expect(loadSource).not.toHaveBeenCalled();
  });
});
