export const traceSmartSelection = (event: string, detail?: Record<string, unknown>) => {
  const target = (globalThis as typeof globalThis & {
    __LIGHTTABLE_SMART_SELECTION_TRACE__?: Array<{ event: string; detail?: Record<string, unknown> }>;
  }).__LIGHTTABLE_SMART_SELECTION_TRACE__;
  target?.push({ event, detail });
};
