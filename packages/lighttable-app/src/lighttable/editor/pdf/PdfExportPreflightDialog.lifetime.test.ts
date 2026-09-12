import { beforeEach, expect, it, vi } from 'vitest';
import { PdfExportPreflightDialog, type PdfExportPreflightRequest } from './PdfExportPreflightDialog';
const state = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => { const setter = vi.fn(); state.setters.push(setter); return [initial, setter]; },
  useRef: (current: unknown) => ({ current }), useEffect: () => {}
}));
vi.mock('@lighttable/ui', () => ({ Button: 'button', Dialog: 'dialog' }));
beforeEach(() => { state.setters = []; });
type Element = { props?: { children?: unknown; onClick?: () => void } };
const visit = (node: unknown): (() => void) | undefined => {
  if (Array.isArray(node)) return node.map(visit).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  const props = (node as Element).props;
  if (props?.children === 'Validate font resources') return props.onClick;
  return visit(props?.children);
};
it.each([['AbortError', 'idle'], ['Error', 'error']] as const)(
  'projects %s validation as %s without hiding genuine failures', async (name, kind) => {
    const request: PdfExportPreflightRequest = {
      fontLabels: {}, plan: { fonts: [], layers: [], canExport: true, requiresConfirmation: false,
        summary: { subset: 0, 'embed-existing': 0, 'embed-full': 0, outline: 0, raster: 0, blocked: 0 } },
      validateFonts: async () => { throw name === 'AbortError'
        ? new DOMException('Retired source', 'AbortError') : new Error('Current validation failed'); }
    };
    const tree = PdfExportPreflightDialog({ open: true, request, onClose() {} });
    const validate = visit(tree); expect(validate).toBeTypeOf('function'); validate!();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(state.setters[0]).toHaveBeenLastCalledWith(kind === 'idle'
      ? { kind: 'idle' } : { kind: 'error', message: 'Current validation failed' });
  });
