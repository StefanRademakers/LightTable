import { describe, expect, it, vi } from 'vitest';
import { deliverDocumentExport, deliverDocumentTaskExport } from './documentExportDelivery';

const file = new File(['result'], 'result.png', { type: 'image/png' });

describe('deliverDocumentExport', () => {
  it('uses the fallback only when no host delivery exists', async () => {
    const fallback = vi.fn();
    await expect(deliverDocumentExport(file, undefined, fallback)).resolves.toBe('unreported');
    expect(fallback).toHaveBeenCalledWith(file);
  });

  it('preserves host commit and cancel as normal terminal outcomes', async () => {
    await expect(deliverDocumentExport(
      file, async () => ({ status: 'committed', durability: 'atomic-replace' }), vi.fn()
    )).resolves.toBe('committed');
    await expect(deliverDocumentExport(
      file, async () => ({ status: 'canceled' }), vi.fn()
    )).resolves.toBe('canceled');
  });

  it('surfaces a resolved host failure instead of reporting success', async () => {
    await expect(deliverDocumentExport(file, async () => ({
      status: 'failed', phase: 'publish', message: 'Disk is full.'
    }), vi.fn())).rejects.toThrow('Export failed during publish: Disk is full.');
  });

  it('maps host cancellation onto a normal task cancellation signal', async () => {
    await expect(deliverDocumentTaskExport(
      file, async () => ({ status: 'canceled' }), vi.fn()
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});
