export interface CoalescedPointerSampleSource<Sample> {
  getCoalescedEvents?: () => readonly Sample[];
}

/**
 * Returns raw pointer samples when the host coalesced high-rate input into one
 * pointermove. Browsers without the API keep the dispatched event as the
 * exact fallback, so mouse and web compatibility remain unchanged.
 */
export const coalescedPointerSamples = <Sample>(
  event: Sample & CoalescedPointerSampleSource<Sample>
): readonly Sample[] => {
  const samples = event.getCoalescedEvents?.() ?? [];
  return samples.length ? samples : [event];
};
