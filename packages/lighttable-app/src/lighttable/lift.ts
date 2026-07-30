/** Maps the UI range to LightTable's normalized black-pedestal range. */
export const liftUiToPedestal = (value: number): number => (
  Math.max(-100, Math.min(100, value)) / 100 * 0.16
);

/** CPU reference for the WGSL Lift operation. */
export const applyLiftChannel = (value: number, uiLift: number): number => {
  const lift = liftUiToPedestal(uiLift);
  return lift + value * (1 - lift);
};
